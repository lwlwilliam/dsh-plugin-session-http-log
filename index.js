/**
 * 会话 HTTP 日志 —— 宿主半侧。
 *
 * 包装 `globalThis.fetch`，抓取会话产生的原始 HTTP 线上流量
 * （LLM API 调用、网页搜索/抓取、MCP HTTP 等），把每次交换归属到
 * 发起它的会话，按会话保留一份有上限的内存日志，并按配置
 * 以 JSONL 追加到 `$DSH_HOME/session-http-log`（目录名保持稳定，不随
 * 插件改名迁移，以免已有抓包数据在面板中消失），同时提供五个
 * 经过身份校验的 `/api/dsh-plugin-session-http-log/*` 路由供客户端面板读取。
 *
 * 本模块必须保持自包含：从已安装的 bundle 位置只能解析 Node 内置模块，
 * 因此这里不得出现任何 `@deepseek-ai/*` 导入。
 *
 * 路由（全部经过身份校验，仅属主浏览器可达）：
 *   GET  /api/dsh-plugin-session-http-log/records?sessionId&limit  → 概要 + 总量，最新在最后
 *   GET  /api/dsh-plugin-session-http-log/record?sessionId&id      → 单条完整记录
 *   POST /api/dsh-plugin-session-http-log/clear                    → { ok, removed }
 *   GET  /api/dsh-plugin-session-http-log/har?sessionId            → HAR 1.2 归档
 *   POST /api/dsh-plugin-session-http-log/reveal                   → { ok, dir }（打开数据目录）
 *
 * @module @local/dsh-plugin-session-http-log
 */

import { execFile, spawn } from 'node:child_process'
import { appendFile, mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/* -------------------------------------------------------------------------- */
/* 常量                                                                       */
/* -------------------------------------------------------------------------- */

/** 配置默认值，见 CONTRACT.md。 */
const DEFAULT_MAX_REQUESTS_PER_SESSION = 500
const DEFAULT_MAX_REQUEST_BODY_BYTES = 2 * 1024 * 1024
const DEFAULT_MAX_RESPONSE_BODY_BYTES = 4 * 1024 * 1024
const DEFAULT_MAX_SESSION_BYTES = 32 * 1024 * 1024
const DEFAULT_MAX_LOG_FILE_BYTES = 8 * 1024 * 1024
/** 孤儿日志清理的默认扫描间隔。 */
const DEFAULT_ORPHAN_SWEEP_INTERVAL_MS = 60 * 1000

/** 提供给属主浏览器的精确 fetch 路由。 */
const ROUTE_PATHS = Object.freeze({
  records: '/api/dsh-plugin-session-http-log/records',
  record: '/api/dsh-plugin-session-http-log/record',
  clear: '/api/dsh-plugin-session-http-log/clear',
  har: '/api/dsh-plugin-session-http-log/har',
  reveal: '/api/dsh-plugin-session-http-log/reveal',
})

/** 监视一次 reveal 派生的 spawn 异步 `error` 多久后按成功上报。 */
const REVEAL_SPAWN_WATCH_MS = 500

/** 每个 JSON 路由都使用的响应头。 */
const JSON_RESPONSE_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
})

/** HAR 下载响应头。 */
const HAR_RESPONSE_HEADERS = Object.freeze({
  'content-type': 'application/json',
  'cache-control': 'no-store',
  'content-disposition': 'attachment; filename="dsh-plugin-session-http-log.har"',
})

const HAR_CREATOR = Object.freeze({ name: 'dsh-plugin-session-http-log', version: '0.1.0' })

/** 浏览器接受的会话 id；同时保证文件名可预测。 */
const SESSION_ID_PATTERN = /^[A-Za-z0-9._-]{1,200}$/

/** 没有会话发起者时的归属桶（仅在配置开启时使用）。 */
const UNATTRIBUTED_SESSION = 'unattributed'

/** 捕获记录中用于替换凭据头部的占位值。 */
const REDACTED_VALUE = '[redacted]'

/** 默认情况下其值永远不会进入日志或磁盘的头部名称。 */
const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'x-auth-token',
  'x-goog-api-key',
])

/** 路径以模型端点结尾的 URL 归类为 LLM 流量。 */
const KIND_PATH_PATTERN = /\/(chat\/completions|completions|messages|responses|embeddings)(\?|$)/

/** 以 UTF-8 文本而非 base64 存储的内容类型。 */
const TEXTUAL_CONTENT_TYPE_PATTERN = /(json|xml|javascript|ecmascript|graphql|event-stream|www-form-urlencoded)/

/**
 * `$DSH_HOME` 下的持久化目录名。
 * 刻意保持为 `session-http-log`：目录名是磁盘数据兼容标识，插件改名后
 * 不迁移、不改名，避免已有抓包数据在面板中凭空消失。
 */
const DATA_DIR_NAME = 'session-http-log'

/** 数据目录内说明文件的文件名；仅在缺失时创建，绝不覆盖。 */
const DATA_DIR_MARKER_NAME = 'README.txt'

/** 数据目录说明文件的内容：提示数据来源、卸载后留存以及安全删除方式。 */
const DATA_DIR_MARKER_CONTENT = [
  '会话 HTTP 记录（@local/dsh-plugin-session-http-log）数据目录',
  '================================================',
  '',
  '本目录保存 @local/dsh-plugin-session-http-log 插件抓取的各会话原始 HTTP 报文，',
  '每个会话对应一个 <sessionId>.jsonl 文件，每行一条 JSON 记录。',
  '',
  '- 卸载插件不会删除本目录，其中的记录会一直保留到手动清理。',
  '- 不再需要这些记录时，可以整体删除本目录，不会影响其他功能。',
  `- 单个会话文件达到 maxLogFileBytes（默认 ${DEFAULT_MAX_LOG_FILE_BYTES / (1024 * 1024)} MiB）后只保留最近一小段记录并重新写入。`,
  '- 此上限只影响单个会话，不会因为一个会话超限而删除其它会话的日志。',
  '- 归档或删除会话后，孤儿清理会删除对应的 jsonl 文件。',
  '- 凭据类请求头（authorization、cookie、api-key 等）默认已脱敏为 [redacted]。',
  '- 清理某个会话只会删除对应的 jsonl 文件，本说明文件会保留。',
  '- 目录名沿用 session-http-log：插件改名不会迁移本目录，以免已有数据丢失。',
  '',
  'This directory holds the raw HTTP capture files of the',
  '@local/dsh-plugin-session-http-log plugin, one <sessionId>.jsonl per session.',
  'Uninstalling the plugin does NOT delete them, and the directory is',
  'safe to delete wholesale once the captures are no longer needed.',
  `Each session file is reset when it reaches maxLogFileBytes (default ${DEFAULT_MAX_LOG_FILE_BYTES / (1024 * 1024)} MiB),`,
  'keeping only its most recent records;',
  'this never deletes another session\'s file. Orphan cleanup removes files',
  'for archived or deleted sessions. Credential headers are redacted by default.',
  'The directory name stays "session-http-log" so a plugin rename never',
  'orphans existing captures.',
  '',
].join('\n')

/**
 * 对刚在微任务中启动的捕获读取器做有界等待。这样在 `await fetch()`
 * 之后立即读取路由时，看到的是已完成的记录而不是待定记录；
 * 真正进行中的交换在此上限之后仍会以待定状态返回。
 */
const SETTLE_GRACE_MS = 75

/** 解码器：声明为文本时使用非严格模式，嗅探内容类型时使用严格模式。 */
const UTF8_DECODER = new TextDecoder('utf-8')
const STRICT_UTF8_DECODER = new TextDecoder('utf-8', { fatal: true })

/**
 * 在调用方的响应体流可达期间，让包装器创建的每个 Request 保持可达。
 * Node 的 fetch 只有在 Request 保持可达时才转发调用方的中止信号；
 * 捕获用的克隆与调用方流共享同一个源，并在捕获读取期间让它保持可达。
 * 条目在 `response.clone()` 之后设置，因为该调用会替换 `response.body`。
 * 该映射是模块级的，因此 dispose 之前获得的响应仍能让其 Request
 * 保持可达。
 */
const requestsByBody = new WeakMap()

/* -------------------------------------------------------------------------- */
/* 插件入口                                                                   */
/* -------------------------------------------------------------------------- */

/** `apply` 运行前本插件需要的宿主服务。 */
export const inject = ['connection']

/**
 * 安装 fetch 观察器以及五个经过身份校验的路由；持久化开启时还会在数据目录
 * 内放置一份清理提示说明文件。
 * @param {import('@deepseek-ai/cordis').Context} ctx - 宿主插件上下文。
 * @param {object} [config] - patch 行配置，按防御式读取。
 */
export function apply(ctx, config = {}) {
  const runtime = createRuntime(ctx, resolveConfig(config))
  ctx.effect(() => runtime.install(), 'dsh-plugin-session-http-log: fetch observer')
  for (const route of runtime.routes) {
    ctx.effect(() => runtime.registerRoute(route), `dsh-plugin-session-http-log: ${route.path}`)
  }
  // 说明文件是尽力而为的副产物：不 await，失败只记日志，绝不影响激活。
  runtime.writeDirectoryMarker()
  // 会话可能在本进程运行期间被归档或删除；定时扫描一次数据目录，
  // 删掉已没有对应会话的 JSONL。扫描只碰本插件命名的 *.jsonl，
  // 且读不到权威会话列表时会安全跳过。
  ctx.effect(() => {
    if (runtime.cleanupOrphans !== true) return () => {}
    let initialTimer = null
    const sweep = () => { void runtime.sweepOrphanLogs() }
    initialTimer = setTimeout(sweep, 1000)
    if (typeof initialTimer.unref === 'function') initialTimer.unref()
    const interval = setInterval(sweep, runtime.orphanSweepIntervalMs)
    if (typeof interval.unref === 'function') interval.unref()
    return () => {
      if (initialTimer !== null) clearTimeout(initialTimer)
      clearInterval(interval)
    }
  }, 'dsh-plugin-session-http-log: orphan log cleanup')
}

/* -------------------------------------------------------------------------- */
/* 配置                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * 规范化 patch 行配置，补全所有默认值且不抛异常。
 * 未知键会被忽略。
 * @param {unknown} raw - Loader 提供的配置值。
 * @returns {{
 *   maxRequestsPerSession: number,
 *   maxRequestBodyBytes: number,
 *   maxResponseBodyBytes: number,
 *   maxSessionBytes: number,
 *   maxLogFileBytes: number,
 *   cleanupOrphans: boolean,
 *   orphanSweepIntervalMs: number,
 *   redactSensitiveHeaders: boolean,
 *   persist: boolean,
 *   captureUnattributed: boolean,
 *   dataDir: string,
 *   openDirectoryCommand: string,
 * }}
 */
function resolveConfig(raw) {
  const input = raw !== null && typeof raw === 'object' ? raw : {}
  const dataDir = typeof input.dataDir === 'string' ? input.dataDir.trim() : ''
  return {
    maxRequestsPerSession: positiveInteger(input.maxRequestsPerSession, DEFAULT_MAX_REQUESTS_PER_SESSION),
    maxRequestBodyBytes: positiveInteger(input.maxRequestBodyBytes, DEFAULT_MAX_REQUEST_BODY_BYTES),
    maxResponseBodyBytes: positiveInteger(input.maxResponseBodyBytes, DEFAULT_MAX_RESPONSE_BODY_BYTES),
    maxSessionBytes: positiveInteger(input.maxSessionBytes, DEFAULT_MAX_SESSION_BYTES),
    maxLogFileBytes: positiveInteger(input.maxLogFileBytes, DEFAULT_MAX_LOG_FILE_BYTES),
    cleanupOrphans: input.cleanupOrphans !== false,
    orphanSweepIntervalMs: positiveInteger(input.orphanSweepIntervalMs, DEFAULT_ORPHAN_SWEEP_INTERVAL_MS),
    redactSensitiveHeaders: input.redactSensitiveHeaders !== false,
    persist: input.persist !== false,
    captureUnattributed: input.captureUnattributed === true,
    dataDir: dataDir !== '' ? dataDir : defaultDataDir(),
    openDirectoryCommand:
      typeof input.openDirectoryCommand === 'string' ? input.openDirectoryCommand.trim() : '',
  }
}

/**
 * 读取一个正整数选项。
 * @param {unknown} value - 原始选项值。
 * @param {number} fallback - 任何不可用值的默认值。
 * @returns {number}
 */
function positiveInteger(value, fallback) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.floor(value)
  return fallback
}

/**
 * 默认持久化目录：`$DSH_HOME/session-http-log`，其次 `~/.dsh/session-http-log`。
 * @returns {string}
 */
function defaultDataDir() {
  const dshHome = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : ''
  if (dshHome !== '') return join(dshHome, DATA_DIR_NAME)
  try {
    return join(homedir(), '.dsh', DATA_DIR_NAME)
  } catch {
    return join(process.cwd(), DATA_DIR_NAME)
  }
}

/**
 * 判断当前 Host 是否运行在 WSL 中。WSL 会设置 `WSL_DISTRO_NAME`
 * 或 `WSL_INTEROP`；仅凭 Linux 平台无法区分 WSL 与普通 Linux。
 * @param {NodeJS.ProcessEnv|Record<string, string|undefined>} [env] - 环境变量。
 * @returns {boolean}
 */
function isWslEnvironment(env = process.env) {
  if (env === null || typeof env !== 'object') return false
  return (
    (typeof env.WSL_DISTRO_NAME === 'string' && env.WSL_DISTRO_NAME.trim() !== '') ||
    (typeof env.WSL_INTEROP === 'string' && env.WSL_INTEROP.trim() !== '')
  )
}

/**
 * 在没有 `wslpath` 时把 Linux 路径转换为 Windows 可访问路径。
 * `/mnt/c/...` 转为 `C:\...`，其它路径转为 `\\wsl.localhost\<distro>\...`。
 * @param {string} dir - Linux 绝对路径。
 * @param {NodeJS.ProcessEnv|Record<string, string|undefined>} [env] - 环境变量。
 * @returns {string}
 */
function wslFallbackWindowsDirectory(dir, env = process.env) {
  if (typeof dir !== 'string' || dir === '') return dir
  const mounted = /^\/mnt\/([A-Za-z])(?:\/(.*))?$/.exec(dir)
  if (mounted !== null) {
    const rest = typeof mounted[2] === 'string' ? mounted[2].replace(/\//g, '\\') : ''
    return `${mounted[1].toUpperCase()}:\\${rest}`
  }
  const distro =
    env !== null && typeof env === 'object' && typeof env.WSL_DISTRO_NAME === 'string'
      ? env.WSL_DISTRO_NAME.trim()
      : ''
  if (distro === '') return dir
  const suffix = dir.replace(/^\/+/, '').replace(/\//g, '\\')
  return `\\\\wsl.localhost\\${distro}\\${suffix}`
}

/**
 * 用 `wslpath -w` 把数据目录转换为 Windows 路径，供 explorer.exe 打开。
 * `wslpath` 不可用时回退到等价的 UNC / 盘符路径。
 * @param {string} dir - Linux 绝对路径。
 * @returns {Promise<string>} Windows 路径。
 */
function resolveWslWindowsDirectory(dir) {
  return new Promise((resolve) => {
    try {
      execFile(
        'wslpath',
        ['-w', dir],
        { encoding: 'utf8', timeout: 2000, windowsHide: true, maxBuffer: 64 * 1024 },
        (error, stdout) => {
          const converted = typeof stdout === 'string' ? stdout.trim() : ''
          resolve(error === null && converted !== '' ? converted : wslFallbackWindowsDirectory(dir))
        },
      )
    } catch {
      resolve(wslFallbackWindowsDirectory(dir))
    }
  })
}

/* -------------------------------------------------------------------------- */
/* 运行时                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * @typedef {object} RouteDefinition
 * @property {string} path - 注册在 `/api` 下的绝对路径。
 * @property {string[]} methods - 该精确路由拥有的 HTTP 方法。
 * @property {(request: Request) => Promise<Response>} handler - 路由实现。
 */

/**
 * 构建一个闭包运行时，持有捕获状态、存储与路由。
 * @param {import('@deepseek-ai/cordis').Context} ctx - 宿主插件上下文。
 * @param {ReturnType<typeof resolveConfig>} config - 已解析的配置。
 * @returns {{
 *   install: () => (() => Promise<void>),
 *   registerRoute: (route: RouteDefinition) => (() => void),
 *   routes: RouteDefinition[],
 * }}
 */
function createRuntime(ctx, config) {
  /** 已经通过 logger 上报过的不同错误。 */
  const reportedErrors = new Set()
  /** `Map<sessionId, { nextId, records, loadedFromDisk, loading }>` */
  const sessions = new Map()
  /** 进行中的响应体捕获 Promise，dispose 时会等待它们。 */
  const pendingCaptures = new Set()
  /** `Map<file, Promise>`，按会话文件串行化 JSONL 追加。 */
  const pendingWrites = new Map()
  /** `WeakMap<record, number>`：已计入某个桶 `bytes` 的大小。 */
  const accountedBytes = new WeakMap()
  /** 被字节预算淘汰的记录；迟到的捕获更新不得再计入。 */
  const evictedRecords = new WeakSet()
  /** 已经写入当前会话 JSONL（普通追加或轮转重写）的记录。 */
  const persistedRecords = new WeakSet()
  /** 中止所有进行中的捕获读取器；每次 install 时替换。 */
  let captureSignal = null
  /** 在 install 之前和 dispose 之后为 false；禁用新的捕获。 */
  let captureEnabled = false
  /** 防止定时器和手动触发产生重叠的孤儿扫描。 */
  let sweepingOrphans = false

  /* ---------------------------------------------------------------- 日志    */

  /**
   * 通过宿主 logger 上报一次不同的失败，同一失败最多上报一次。
   * @param {string} source - 标识失败步骤的简短标签。
   * @param {unknown} error - 被包含处理的错误。
   */
  function reportOnce(source, error) {
    let message
    try {
      message = errorMessage(error)
    } catch {
      message = 'unrenderable error'
    }
    const key = `${source}: ${message}`
    if (reportedErrors.has(key)) return
    reportedErrors.add(key)
    if (reportedErrors.size > 256) {
      const oldest = reportedErrors.values().next()
      if (oldest.done !== true) reportedErrors.delete(oldest.value)
    }
    try {
      ctx.logger?.warn?.(`[dsh-plugin-session-http-log] ${key}`)
    } catch {
      /* 记录日志是尽力而为 */
    }
  }

  /**
   * 跟踪一个进行中的 Promise，便于 dispose 等待它。
   * @param {Promise<unknown>} promise - 捕获 Promise。
   * @param {{ pending: Set<Promise<unknown>> }|null} [entry] - 要跟踪到的会话桶。
   */
  function track(promise, entry) {
    pendingCaptures.add(promise)
    if (entry !== null && entry !== undefined) entry.pending.add(promise)
    const settle = () => {
      pendingCaptures.delete(promise)
      if (entry !== null && entry !== undefined) entry.pending.delete(promise)
    }
    promise.then(settle, settle)
  }

  /**
   * 为当前会话进行中的捕获读取器做一段短暂的有界等待。
   * @param {{ pending: Set<Promise<unknown>> }} entry - 会话桶。
   * @returns {Promise<void>}
   */
  async function settleSession(entry) {
    if (entry.pending.size === 0) return
    await Promise.race([
      Promise.allSettled([...entry.pending]),
      new Promise((resolve) => {
        const timer = setTimeout(resolve, SETTLE_GRACE_MS)
        if (typeof timer.unref === 'function') timer.unref()
      }),
    ])
  }

  /* ---------------------------------------------------------------- 存储    */

  /**
   * 获取或创建一个会话的内存桶。
   * `bytes` 是 `records` 的估算存储大小，受 `maxSessionBytes` 限制；
   * `logBytes` 缓存 JSONL 文件大小用于磁盘增长上限（null 表示
   * “尚未测量”）。
   * @param {string} sessionId - 会话 id 或 unattributed 桶名。
   * @returns {{
   *   sessionId: string,
   *   nextId: number,
   *   records: object[],
   *   bytes: number,
   *   loadedFromDisk: boolean,
   *   loading: Promise<void>|undefined,
   *   pending: Set<Promise<unknown>>,
   *   logBytes: number|null,
   * }}
   */
  function sessionEntry(sessionId) {
    let entry = sessions.get(sessionId)
    if (entry === undefined) {
      entry = {
        sessionId,
        nextId: 1,
        records: [],
        bytes: 0,
        loadedFromDisk: false,
        loading: undefined,
        pending: new Set(),
        logBytes: null,
      }
      sessions.set(sessionId, entry)
    }
    return entry
  }

  /**
   * 解析一个会话桶用于读取，不影响进行中的捕获。
   * @param {string} sessionId - 已验证的会话 id。
   * @returns {Promise<ReturnType<typeof sessionEntry>>}
   */
  async function resolveSession(sessionId) {
    const entry = sessionEntry(sessionId)
    if (entry.loading !== undefined) {
      await entry.loading
      return entry
    }
    if (entry.loadedFromDisk) return entry
    entry.loadedFromDisk = true
    if (entry.records.length > 0 || config.persist !== true) return entry
    entry.loading = loadSessionFile(sessionId, entry)
    try {
      await entry.loading
    } finally {
      entry.loading = undefined
    }
    return entry
  }

  /**
   * 解析一个会话桶用于路由读取，并让它的捕获读取器结算。
   * @param {string} sessionId - 已验证的会话 id。
   * @returns {Promise<ReturnType<typeof sessionEntry>>}
   */
  async function readSession(sessionId) {
    const entry = await resolveSession(sessionId)
    await settleSession(entry)
    return entry
  }

  /**
   * 把最后 `maxRequestsPerSession` 条完整 JSONL 记录加载进一个桶。
   * 追加被中断产生的残缺末行会被跳过。
   * @param {string} sessionId - 会话 id。
   * @param {{ nextId: number, records: object[] }} entry - 要填充的桶。
   * @returns {Promise<void>}
   */
  async function loadSessionFile(sessionId, entry) {
    const file = sessionFile(sessionId)
    let text
    try {
      text = await readFile(file, 'utf8')
    } catch (error) {
      if (error?.code !== 'ENOENT') reportOnce(`load:${sessionId}`, error)
      return
    }
    if (typeof text !== 'string' || text.length === 0) return
    const loaded = []
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (trimmed === '') continue
      try {
        const record = JSON.parse(trimmed)
        if (record !== null && typeof record === 'object' && Number.isInteger(record.id)) loaded.push(record)
      } catch {
        /* 追加被中断时留下的残缺行 */
      }
    }
    if (loaded.length === 0) return
    const tail = loaded.slice(-config.maxRequestsPerSession)
    for (const record of tail) {
      if (typeof record.id === 'number' && record.id >= entry.nextId) entry.nextId = record.id + 1
    }
    if (entry.records.length > 0) return
    entry.records = tail
    for (const record of entry.records) {
      const size = estimateRecordBytes(record)
      accountedBytes.set(record, size)
      entry.bytes += size
      // 这些行来自当前 JSONL；轮转时可以把它们作为安全的历史尾部重写。
      persistedRecords.add(record)
    }
    enforceSessionBytes(entry)
  }

  /**
   * 会话的 JSONL 绝对路径。
   * @param {string} sessionId - 会话 id。
   * @returns {string}
   */
  function sessionFile(sessionId) {
    return join(config.dataDir, `${safeFileName(sessionId)}.jsonl`)
  }

  /**
   * 确保持久化目录存在，并在缺失时写入清理提示说明文件。
   * 只创建、不覆盖（`flag: 'wx'`，`EEXIST` 视为成功）；其他失败经
   * `reportOnce` 记录一次日志。整个操作异步执行，绝不阻塞插件激活。
   */
  function writeDirectoryMarker() {
    if (config.persist !== true) return
    void (async () => {
      try {
        await mkdir(config.dataDir, { recursive: true })
        await writeFile(join(config.dataDir, DATA_DIR_MARKER_NAME), DATA_DIR_MARKER_CONTENT, {
          encoding: 'utf8',
          flag: 'wx',
        })
      } catch (error) {
        if (error?.code === 'EEXIST') return
        reportOnce('data-dir-marker', error)
      }
    })()
  }

  /**
   * 追加一条记录，并执行每会话的条数与字节预算。
   * `nextId` 保持单调递增：存活记录绝不会被重新编号。
   * @param {ReturnType<typeof sessionEntry>} entry - 会话桶。
   * @param {object} record - 要追加的内部记录。
   */
  function pushRecord(entry, record) {
    entry.records.push(record)
    accountRecordBytes(entry, record)
    enforceSessionBytes(entry)
    const overflow = entry.records.length - config.maxRequestsPerSession
    if (overflow > 0) {
      for (const removed of entry.records.splice(0, overflow)) releaseRecordBytes(entry, removed)
    }
  }

  /**
   * 在桶中新增或更新一条记录的估算存储大小。
   * @param {ReturnType<typeof sessionEntry>} entry - 会话桶。
   * @param {object} record - 内部记录。
   */
  function accountRecordBytes(entry, record) {
    const previous = accountedBytes.get(record) ?? 0
    const current = estimateRecordBytes(record)
    accountedBytes.set(record, current)
    entry.bytes += current - previous
    if (entry.bytes < 0) entry.bytes = 0
  }

  /**
   * 把一条记录从计数中移除，并做标记，使迟到的捕获更新
   * 不再被计入。
   * @param {ReturnType<typeof sessionEntry>} entry - 会话桶。
   * @param {object} record - 从桶中移除的内部记录。
   */
  function releaseRecordBytes(entry, record) {
    const size = accountedBytes.get(record) ?? estimateRecordBytes(record)
    accountedBytes.delete(record)
    evictedRecords.add(record)
    entry.bytes -= size
    if (entry.bytes < 0) entry.bytes = 0
  }

  /**
   * 重新计算捕获体增长后的记录大小，然后重新检查
   * 字节预算。对已从内存淘汰的记录会被忽略。
   * @param {ReturnType<typeof sessionEntry>|null|undefined} entry - 会话桶。
   * @param {object} record - 内部记录。
   */
  function updateRecordBytes(entry, record) {
    if (entry === null || entry === undefined) return
    if (evictedRecords.has(record)) return
    accountRecordBytes(entry, record)
    enforceSessionBytes(entry)
  }

  /**
   * 淘汰最旧的记录，直到会话符合其字节预算，
   * 同时始终保留最新记录，使面板仍能看到实时交换。
   * @param {ReturnType<typeof sessionEntry>} entry - 会话桶。
   */
  function enforceSessionBytes(entry) {
    while (entry.bytes > config.maxSessionBytes && entry.records.length > 1) {
      const removed = entry.records.shift()
      releaseRecordBytes(entry, removed)
      reportOnce(
        `session-bytes:${entry.sessionId}`,
        new Error(
          `memory budget of ${config.maxSessionBytes} bytes reached; dropped oldest records`,
        ),
      )
    }
  }

  /**
   * 轮转时为当前会话重写一份最近记录，避免直接把整个文件清空。
   * 只选取已完成记录（`completedAt !== null`）以及当前要写入的记录，
   * 防止把仍在捕获中的记录提前持久化、随后又重复追加。
   * @param {object[]} records - 会话内存桶中的记录。
   * @param {object} current - 当前待持久化记录。
   * @param {number} budget - 期望保留的字节预算。
   * @returns {{ text: string, bytes: number, records: object[] }}
   */
  function rotationTail(records, current, budget) {
    const selected = []
    const selectedSet = new Set()
    let total = 0
    const add = (record) => {
      if (record === null || typeof record !== 'object' || selectedSet.has(record)) return false
      let line
      try {
        line = `${JSON.stringify(record)}\n`
      } catch (error) {
        reportOnce('persist-serialize', error)
        return false
      }
      const bytes = Buffer.byteLength(line, 'utf8')
      selected.push({ record, line })
      selectedSet.add(record)
      total += bytes
      return true
    }
    add(current)
    for (let index = records.length - 1; index >= 0; index -= 1) {
      const candidate = records[index]
      if (
        candidate === current ||
        !persistedRecords.has(candidate) ||
        candidate?.completedAt === null ||
        candidate?.completedAt === undefined
      ) {
        continue
      }
      let line
      try {
        line = `${JSON.stringify(candidate)}\n`
      } catch (error) {
        reportOnce('persist-serialize', error)
        continue
      }
      const bytes = Buffer.byteLength(line, 'utf8')
      if (selected.length > 0 && total + bytes > budget) break
      selected.push({ record: candidate, line })
      total += bytes
    }
    selected.sort((left, right) => {
      const leftId = Number.isInteger(left.record?.id) ? left.record.id : 0
      const rightId = Number.isInteger(right.record?.id) ? right.record.id : 0
      return leftId - rightId
    })
    return {
      text: selected.map((entry) => entry.line).join(''),
      bytes: total,
      records: selected.map((entry) => entry.record),
    }
  }

  /**
   * 把一条完成的记录追加到会话文件，按文件串行化。
   * 文件上限为 `maxLogFileBytes`：每个会话测量一次大小，之后按追加的
   * 字节长度累计。超过上限时只重写这个会话最近的少量记录，而不是把
   * 整个历史直接丢弃；其它会话完全不受影响，也绝不影响捕获、路由或
   * fetch 调用方。
   * @param {string} sessionId - 会话 id。
   * @param {object} record - 已完成的内部记录。
   */
  function persistRecord(sessionId, record) {
    if (config.persist !== true) return
    let line
    try {
      line = `${JSON.stringify(record)}\n`
    } catch (error) {
      reportOnce('persist-serialize', error)
      return
    }
    const bytes = Buffer.byteLength(line, 'utf8')
    const file = sessionFile(sessionId)
    const entry = sessionEntry(sessionId)
    const previous = pendingWrites.get(file) ?? Promise.resolve()
    const next = previous
      .then(async () => {
        if (entry.logBytes === null) entry.logBytes = await fileSize(file)
        if (entry.logBytes > 0 && entry.logBytes + bytes > config.maxLogFileBytes) {
          // 单会话磁盘上限：保留最近约 1/4 上限的记录（最多 2 MiB），
          // 然后继续追加后续记录。其它会话的文件完全不受影响。
          const tailBudget = Math.max(
            1024,
            Math.min(2 * 1024 * 1024, Math.floor(config.maxLogFileBytes / 4)),
          )
          const tail = rotationTail(entry.records, record, tailBudget)
          try {
            await unlink(file)
          } catch (error) {
            if (error?.code !== 'ENOENT') throw error
          }
          await mkdir(dirname(file), { recursive: true })
          await writeFile(file, tail.text, 'utf8')
          entry.logBytes = tail.bytes
          for (const persisted of tail.records) persistedRecords.add(persisted)
          return
        }
        await mkdir(dirname(file), { recursive: true })
        await appendFile(file, line, 'utf8')
        entry.logBytes += bytes
        persistedRecords.add(record)
      })
      .catch((error) => {
        reportOnce(`persist:${file}`, error)
      })
    pendingWrites.set(file, next)
    const settle = () => {
      if (pendingWrites.get(file) === next) pendingWrites.delete(file)
    }
    next.then(settle, settle)
  }

  /**
   * 会话文件的大小；文件尚不存在时为 0。
   * @param {string} file - JSONL 绝对路径。
   * @returns {Promise<number>}
   */
  async function fileSize(file) {
    try {
      const info = await stat(file)
      return typeof info.size === 'number' ? info.size : 0
    } catch (error) {
      if (error?.code === 'ENOENT') return 0
      throw error
    }
  }

  /**
   * 把某个会话从内存和磁盘中移除，并报告移除了多少。
   * 只删除该会话的 jsonl 文件；数据目录与说明文件（README.txt）保留。
   * @param {string} sessionId - 已验证的会话 id。
   * @returns {Promise<number>} 被移除的记录条数。
   */
  async function clearSession(sessionId) {
    const entry = await readSession(sessionId)
    const removed = entry.records.length
    sessions.delete(sessionId)
    if (config.persist !== true) return removed
    const file = sessionFile(sessionId)
    const pendingWrite = pendingWrites.get(file)
    if (pendingWrite !== undefined) {
      try {
        await pendingWrite
      } catch {
        /* 追加失败已经上报过 */
      }
    }
    pendingWrites.delete(file)
    try {
      await unlink(file)
    } catch (error) {
      if (error?.code !== 'ENOENT') reportOnce(`clear:${file}`, error)
    }
    entry.logBytes = null
    entry.bytes = 0
    return removed
  }

  /* -------------------------------------------------------------- 孤儿清理    */

  /**
   * 收集当前仍然有效、且没有归档的会话 id。
   * 返回 null 表示无法取得权威会话列表；调用方必须放弃本轮清理，
   * 绝不能把“服务暂时不可用”误判成“所有会话都已删除”。
   * @returns {Promise<Set<string>|null>}
   */
  async function knownSessionIds() {
    // 不能把 sessions Map 里的所有桶都当成有效会话：它们可能只是插件内存里
    // 尚未释放的历史桶，真实 Session 已经删除。权威来源必须是 live Session
    // 与 sessionPersistence；正在读写中的桶另行通过 pending 检查保护。
    const known = new Set()
    /** `Map<childSessionId, parentSessionId>`：用于把子代理/团队日志跟着父会话清理。 */
    const parentBySession = new Map()
    try {
      const liveSessions = ctx.get('sessions')
      if (liveSessions !== undefined && typeof liveSessions.list === 'function') {
        for (const session of liveSessions.list()) {
          const id = session !== null && typeof session === 'object' ? session.id : session
          if (typeof id !== 'string' || id === '') continue
          known.add(id)
          const parent = session?.header?.parentSession
          if (typeof parent === 'string' && parent !== '') parentBySession.set(id, parent)
        }
      }
    } catch {
      return null
    }
    try {
      const persistence = ctx.get('sessionPersistence')
      if (persistence === undefined || typeof persistence.list !== 'function') return null
      const stored = await persistence.list()
      if (!Array.isArray(stored)) return null
      for (const snapshot of stored) {
        // SessionPersistenceSnapshot 的权威身份在 header.id；兼容旧形态的 id。
        const header = snapshot !== null && typeof snapshot === 'object' ? snapshot.header : undefined
        const id = header !== null && typeof header === 'object' ? header.id : snapshot?.id
        if (typeof id !== 'string' || id === '') continue
        known.add(id)
        const parent = header?.parentSession
        if (typeof parent === 'string' && parent !== '') parentBySession.set(id, parent)
      }
    } catch (error) {
      reportOnce('orphan-known-sessions', error)
      return null
    }
    // 归档会话仍在 sessionPersistence 中，但用户已经把它从会话列表移走；
    // 按本插件的保留策略，抓包数据一并清理，避免长期残留。
    try {
      const workspaceRegistry = ctx.get('workspaceRegistry')
      const archived = workspaceRegistry?.archivedSessionIds
      if (Array.isArray(archived)) {
        for (const id of archived) {
          if (typeof id === 'string') known.delete(id)
        }
      }
    } catch (error) {
      reportOnce('orphan-archived-sessions', error)
      return null
    }
    // 父会话被归档/删除时，连同其派生的智能体团队/子代理会话一起清理；
    // 迭代到不动点以覆盖多层子代理。
    let changed = true
    while (changed) {
      changed = false
      for (const [id, parent] of parentBySession) {
        if (known.has(id) && !known.has(parent)) {
          known.delete(id)
          changed = true
        }
      }
    }
    return known
  }

  /**
   * 扫描数据目录，删除不属于任何有效/未归档会话的 `.jsonl` 文件。
   * 只处理文件名严格符合会话 id 规则的 JSONL；README、未知文件和
   * `unattributed` 桶都保留。扫描绝不会让插件激活失败。
   * @returns {Promise<void>}
   */
  async function sweepOrphanLogs() {
    if (config.persist !== true || config.cleanupOrphans !== true || sweepingOrphans) return
    sweepingOrphans = true
    try {
      const known = await knownSessionIds()
      if (known === null) return
      let entries
      try {
        entries = await readdir(config.dataDir, { withFileTypes: true })
      } catch (error) {
        if (error?.code !== 'ENOENT') reportOnce('orphan-readdir', error)
        return
      }
      for (const entry of entries) {
        if (entry === null || typeof entry !== 'object' || entry.isFile?.() !== true) continue
        const name = String(entry.name)
        if (!name.endsWith('.jsonl')) continue
        const sessionId = name.slice(0, -'.jsonl'.length)
        if (sessionId === UNATTRIBUTED_SESSION) continue
        if (!SESSION_ID_PATTERN.test(sessionId) || known.has(sessionId)) continue
        const activeEntry = sessions.get(sessionId)
        if (activeEntry !== undefined && activeEntry.pending.size > 0) continue
        const file = join(config.dataDir, name)
        const pendingWrite = pendingWrites.get(file)
        if (pendingWrite !== undefined) {
          try {
            await pendingWrite
          } catch {
            /* 追加失败已经上报过 */
          }
        }
        try {
          await unlink(file)
          sessions.delete(sessionId)
          pendingWrites.delete(file)
        } catch (error) {
          if (error?.code !== 'ENOENT') reportOnce(`orphan-unlink:${file}`, error)
        }
      }
    } catch (error) {
      reportOnce('orphan-sweep', error)
    } finally {
      sweepingOrphans = false
    }
  }

  /* -------------------------------------------------------------- 归属判定    */

  /**
   * 通过 agent 驱动解析发起当前 fetch 的会话。
   * @returns {string|null} 会话 id；无法归属时为 null。
   */
  function currentSessionId() {
    try {
      const agents = ctx.get('agents')
      const initiator = agents?.currentInitiator?.()
      const id = initiator?.id
      if (typeof id === 'string' && id.length > 0) return id
    } catch {
      /* fetch 工作运行期间 agents 服务可能被卸载 */
    }
    return null
  }

  /* ----------------------------------------------------------------- 捕获    */

  /**
   * 按配置对凭据类头部值做脱敏。
   * @param {Array<[string, string]>} entries - 按线上顺序排列的头部对。
   * @returns {Array<[string, string]>}
   */
  function redactHeaderEntries(entries) {
    if (config.redactSensitiveHeaders !== true) return entries
    return entries.map(([name, value]) =>
      typeof name === 'string' && SENSITIVE_HEADER_NAMES.has(name.toLowerCase())
        ? [name, REDACTED_VALUE]
        : [name, value],
    )
  }

  /**
   * 为一次 fetch 调用创建记录并启动请求体捕获。
   * 当这次交换不应被记录时返回 null。
   * @param {Request} request - 包装器创建的请求。
   * @returns {object|null} 交换句柄。
   */
  function beginExchange(request) {
    if (!captureEnabled) return null
    const initiatorId = currentSessionId()
    if (initiatorId === null && config.captureUnattributed !== true) return null
    const sessionId = initiatorId ?? UNATTRIBUTED_SESSION
    const entry = sessionEntry(sessionId)
    const startedAt = Date.now()
    const record = {
      id: entry.nextId++,
      sessionId,
      startedAt,
      method: request.method,
      url: request.url,
      status: null,
      statusText: '',
      durationMs: null,
      completedMs: null,
      requestBytes: 0,
      responseBytes: 0,
      requestTruncated: false,
      responseTruncated: false,
      kind: classifyKind(request.url),
      model: null,
      error: null,
      requestHeaders: redactHeaderEntries(headerEntries(request.headers)),
      requestBody: null,
      requestBodyEncoding: 'utf8',
      responseHeaders: [],
      responseMimeType: '',
      responseBody: null,
      responseBodyEncoding: 'utf8',
      completedAt: null,
    }
    pushRecord(entry, record)
    const exchange = {
      sessionId,
      entry,
      record,
      requestSettled: false,
      responseReceived: false,
      responseSettled: false,
      failed: false,
      finished: false,
    }
    startRequestBodyCapture(exchange, request)
    return exchange
  }

  /**
   * 通过 `request.clone()` 分流请求体，且不拖慢 fetch。
   * @param {object} exchange - 交换句柄。
   * @param {Request} request - 包装器创建的请求。
   */
  function startRequestBodyCapture(exchange, request) {
    const record = exchange.record
    let clone = null
    if (request.body !== null) {
      try {
        clone = request.clone()
      } catch (error) {
        reportOnce('request-clone', error)
      }
    }
    if (clone === null || clone.body === null) {
      exchange.requestSettled = true
      maybeFinalize(exchange)
      return
    }
    const contentType = request.headers.get('content-type') ?? ''
    track(
      captureBody(clone.body, config.maxRequestBodyBytes, captureSignal, (bytes, truncated) => {
        record.requestBytes = bytes
        record.requestTruncated = truncated
        updateRecordBytes(exchange.entry, record)
      }).then(
        (outcome) => {
          try {
            applyCapturedBody(record, 'request', outcome, contentType)
            const model = modelFromBody(record.requestBody, record.requestBodyEncoding)
            if (model !== null) record.model = model
            updateRecordBytes(exchange.entry, record)
          } catch (error) {
            reportOnce('request-store', error)
          }
          exchange.requestSettled = true
          try {
            maybeFinalize(exchange)
          } catch (error) {
            reportOnce('request-finalize', error)
          }
        },
        (error) => {
          reportOnce('request-capture', error)
          exchange.requestSettled = true
          try {
            maybeFinalize(exchange)
          } catch {
            /* 已包含处理：捕获逻辑绝不能打断调用方 */
          }
        },
      ),
      exchange.entry,
    )
  }

  /**
   * 记录响应头，并通过 `response.clone()` 分流响应体。
   * @param {object} exchange - 交换句柄。
   * @param {Response} response - 被包装 fetch 返回的响应。
   */
  function handleResponse(exchange, response) {
    const record = exchange.record
    const receivedAt = Date.now()
    record.status = typeof response.status === 'number' ? response.status : null
    record.statusText = typeof response.statusText === 'string' ? response.statusText : ''
    record.durationMs = Math.max(0, receivedAt - record.startedAt)
    record.responseHeaders = redactHeaderEntries(headerEntries(response.headers))
    const contentType = response.headers.get('content-type') ?? ''
    record.responseMimeType = mediaType(contentType)
    exchange.responseReceived = true
    updateRecordBytes(exchange.entry, record)
    let clone = null
    try {
      clone = response.clone()
    } catch (error) {
      reportOnce('response-clone', error)
    }
    if (clone === null || clone.body === null) {
      exchange.responseSettled = true
      maybeFinalize(exchange)
      return
    }
    track(
      captureBody(clone.body, config.maxResponseBodyBytes, captureSignal, (bytes, truncated) => {
        record.responseBytes = bytes
        record.responseTruncated = truncated
        updateRecordBytes(exchange.entry, record)
      }).then(
        (outcome) => {
          try {
            applyCapturedBody(record, 'response', outcome, contentType)
            updateRecordBytes(exchange.entry, record)
          } catch (error) {
            reportOnce('response-store', error)
          }
          exchange.responseSettled = true
          try {
            maybeFinalize(exchange)
          } catch (error) {
            reportOnce('response-finalize', error)
          }
        },
        (error) => {
          reportOnce('response-capture', error)
          exchange.responseSettled = true
          try {
            maybeFinalize(exchange)
          } catch {
            /* 已包含处理：捕获逻辑绝不能打断调用方 */
          }
        },
      ),
      exchange.entry,
    )
  }

  /**
   * 记录一次被拒绝的 fetch，并立即完成记录。
   * @param {object} exchange - 交换句柄。
   * @param {unknown} error - fetch 的拒绝原因。
   */
  function handleFailure(exchange, error) {
    const record = exchange.record
    const failedAt = Date.now()
    record.durationMs = Math.max(0, failedAt - record.startedAt)
    record.completedAt = failedAt
    record.completedMs = record.durationMs
    record.error = errorMessage(error)
    exchange.failed = true
    exchange.responseSettled = true
    maybeFinalize(exchange)
  }

  /**
   * 两个响应体捕获都结算后（或失败时立即）完成记录。
   * @param {object} exchange - 交换句柄。
   */
  function maybeFinalize(exchange) {
    if (exchange.finished) return
    if (exchange.failed === true) {
      finalizeExchange(exchange)
      return
    }
    if (exchange.responseReceived && exchange.requestSettled && exchange.responseSettled) {
      finalizeExchange(exchange)
    }
  }

  /**
   * 写入完成时间、补全 model 名称并持久化记录。
   * @param {object} exchange - 交换句柄。
   */
  function finalizeExchange(exchange) {
    if (exchange.finished) return
    exchange.finished = true
    const record = exchange.record
    if (typeof record.completedAt !== 'number') record.completedAt = Date.now()
    if (typeof record.completedMs !== 'number') {
      record.completedMs = Math.max(0, record.completedAt - record.startedAt)
    }
    if (exchange.failed === true) {
      /* 传输错误同样在一个已知时刻完成（失败）。 */
      if (typeof record.durationMs !== 'number') record.durationMs = record.completedMs
    }
    if (record.model === null) {
      const model = modelFromBody(record.requestBody, record.requestBodyEncoding)
      if (model !== null) record.model = model
    }
    persistRecord(exchange.sessionId, record)
  }

  /* ----------------------------------------------------------------- 路由   */

  /**
   * 注册一条精确 fetch 路由并返回其清理函数。
   * @param {RouteDefinition} route - 路由定义。
   * @returns {() => void} 注销该路由的清理函数。
   */
  function registerRoute(route) {
    let dispose
    try {
      const connection = ctx.get('connection')
      const registry = connection?.fetch
      if (registry === undefined || typeof registry.register !== 'function') {
        throw new Error('connection fetch registry is unavailable')
      }
      dispose = registry.register({
        path: route.path,
        methods: route.methods,
        requestBody: 'buffered',
        fetch: guardRoute(route.handler),
      })
    } catch (error) {
      reportOnce(`route:${route.path}`, error)
      return () => {}
    }
    return () => {
      try {
        const result = dispose?.()
        if (result !== null && typeof result?.then === 'function') result.catch(() => {})
      } catch (error) {
        reportOnce(`route-dispose:${route.path}`, error)
      }
    }
  }

  /**
   * 包含处理器的失败，并对 HEAD 请求返回无响应体的应答。
   * @param {(request: Request) => Promise<Response>} handler - 路由处理器。
   * @returns {(request: Request) => Promise<Response>}
   */
  function guardRoute(handler) {
    return async (request) => {
      try {
        const response = await handler(request)
        if (request.method !== 'HEAD') return response
        try {
          await response.body?.cancel()
        } catch {
          /* 响应体已经被消费 */
        }
        return new Response(null, { status: response.status, headers: response.headers })
      } catch (error) {
        reportOnce('route-handler', error)
        return errorResponse(500, 'internal error')
      }
    }
  }

  /**
   * `GET /records` → 返回有上限的概要加面板页脚所需的总量，最新在最后。
   * @param {Request} request - 路由请求。
   * @returns {Promise<Response>}
   */
  async function handleRecordsRequest(request) {
    const url = new URL(request.url)
    const sessionId = url.searchParams.get('sessionId') ?? ''
    if (!SESSION_ID_PATTERN.test(sessionId)) return invalidSessionResponse()
    const entry = await readSession(sessionId)
    const limit = parseLimit(url.searchParams.get('limit'), config.maxRequestsPerSession)
    const selected = limit === null ? entry.records.slice() : entry.records.slice(-limit)
    return jsonResponse({
      sessionId,
      total: entry.records.length,
      totalBytes: entry.bytes,
      fileBytes: await sessionFileBytes(sessionId),
      dir: config.dataDir,
      persist: config.persist === true,
      maxLogFileBytes: config.maxLogFileBytes,
      records: selected.map(summarizeRecord),
    })
  }

  /**
   * 某个会话 JSONL 文件的当前磁盘大小。
   * 持久化关闭、文件不存在或 stat 失败时返回 `null`：
   * 元数据探测绝不能使路由失败。
   * @param {string} sessionId - 已验证的会话 id。
   * @returns {Promise<number|null>}
   */
  async function sessionFileBytes(sessionId) {
    if (config.persist !== true) return null
    try {
      const info = await stat(sessionFile(sessionId))
      return typeof info.size === 'number' ? info.size : null
    } catch {
      return null
    }
  }

  /**
   * `GET /record` → 返回一条完整记录，不存在时返回 404。
   * @param {Request} request - 路由请求。
   * @returns {Promise<Response>}
   */
  async function handleRecordRequest(request) {
    const url = new URL(request.url)
    const sessionId = url.searchParams.get('sessionId') ?? ''
    if (!SESSION_ID_PATTERN.test(sessionId)) return invalidSessionResponse()
    const id = Number(url.searchParams.get('id') ?? '')
    if (!Number.isInteger(id) || id < 1) return errorResponse(400, 'id must be a positive integer')
    const entry = await readSession(sessionId)
    const record = entry.records.find((candidate) => candidate.id === id)
    if (record === undefined) return errorResponse(404, 'record not found')
    return jsonResponse({ record: detailRecord(record) })
  }

  /**
   * `POST /clear` → 删除该会话的记录与文件。
   * @param {Request} request - 路由请求。
   * @returns {Promise<Response>}
   */
  async function handleClearRequest(request) {
    let payload
    try {
      payload = await request.json()
    } catch {
      return errorResponse(400, 'invalid JSON body')
    }
    const sessionId = payload !== null && typeof payload === 'object' ? payload.sessionId : undefined
    if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) return invalidSessionResponse()
    const removed = await clearSession(sessionId)
    return jsonResponse({ ok: true, removed })
  }

  /**
   * `GET /har` → 下载 HAR 1.2 归档。
   * @param {Request} request - 路由请求。
   * @returns {Promise<Response>}
   */
  async function handleHarRequest(request) {
    const url = new URL(request.url)
    const sessionId = url.searchParams.get('sessionId') ?? ''
    if (!SESSION_ID_PATTERN.test(sessionId)) return invalidSessionResponse()
    const entry = await readSession(sessionId)
    const har = {
      log: {
        version: '1.2',
        creator: { ...HAR_CREATOR },
        entries: entry.records.map(toHarEntry),
      },
    }
    return new Response(JSON.stringify(har), { headers: HAR_RESPONSE_HEADERS })
  }

  /**
   * `POST /reveal` → 确保配置的数据目录存在，并在
   * 操作系统文件管理器中打开它。路径始终是 `config.dataDir`；不读取任何请求输入，
   * 因此该路由绝不可能打开任意位置。
   * @returns {Promise<Response>}
   */
  async function handleRevealRequest() {
    const dir = config.dataDir
    try {
      await mkdir(dir, { recursive: true })
    } catch (error) {
      reportOnce('reveal-mkdir', error)
      return errorResponse(500, errorMessage(error))
    }
    try {
      await openDirectory(dir)
    } catch (error) {
      reportOnce('reveal-open', error)
      return errorResponse(500, errorMessage(error))
    }
    return jsonResponse({ ok: true, dir })
  }

  /**
   * 解析 reveal 路由使用的可执行文件：优先配置覆盖，
   * 否则使用平台默认值（`open`、`explorer.exe`、`xdg-open`）。
   * WSL 必须使用 Windows 侧的 `explorer.exe`，因为 WSL 里的浏览器
   * 由 Windows 打开，而 `xdg-open` 通常不可用或无法打开 Linux 路径。
   * @returns {string}
   */
  function openDirectoryCommand() {
    if (config.openDirectoryCommand !== '') return config.openDirectoryCommand
    if (process.platform === 'darwin') return 'open'
    if (process.platform === 'win32') return 'explorer.exe'
    if (isWslEnvironment()) return 'explorer.exe'
    return 'xdg-open'
  }

  /**
   * 以分离方式派生出目录打开器，且不使宿主进程保持运行。
   * 子进程报告成功 spawn 后即 resolve；spawn 出错（例如可执行文件缺失）时 reject；
   * `REVEAL_SPAWN_WATCH_MS` 计时器为两者都不报告的平台
   * 提供有界兜底。
   * @param {string} command - 可执行文件。
   * @param {string[]} args - 参数。
   * @returns {Promise<void>}
   */
  function spawnDetached(command, args) {
    return new Promise((resolve, reject) => {
      let child
      try {
        child = spawn(command, args, {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        })
      } catch (error) {
        reject(error)
        return
      }
      let settled = false
      let timer
      /** 只结算一次；让已派生的子进程脱离宿主，使其寿命超过本次请求。 */
      const finish = (error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        child.removeAllListeners('spawn')
        child.removeAllListeners('error')
        try {
          child.unref()
        } catch {
          /* 已经退出 */
        }
        if (error === undefined) {
          resolve()
        } else {
          reject(error)
        }
      }
      child.once('spawn', () => finish())
      child.once('error', (error) => finish(error))
      timer = setTimeout(() => finish(), REVEAL_SPAWN_WATCH_MS)
      if (typeof timer.unref === 'function') timer.unref()
    })
  }

  /**
   * 在系统文件管理器中打开数据目录。
   * - 普通 Linux：`xdg-open`；
   * - WSL：把 Linux 路径转成 Windows 路径后交给 `explorer.exe`，
   *   并在 PATH 中没有 Windows interop 时尝试挂载盘上的 explorer.exe；
   * - 自定义 `openDirectoryCommand` 时保持原样，只传 Linux 目录。
   * @param {string} dir - 要打开的目录（始终是配置的数据目录）。
   * @returns {Promise<void>}
   */
  async function openDirectory(dir) {
    /** @type {Array<{ command: string, args: string[] }>} */
    const candidates = []
    if (config.openDirectoryCommand !== '') {
      candidates.push({ command: config.openDirectoryCommand, args: [dir] })
    } else if (process.platform === 'darwin') {
      candidates.push({ command: 'open', args: [dir] })
    } else if (process.platform === 'win32') {
      candidates.push({ command: 'explorer.exe', args: [dir] })
    } else if (isWslEnvironment()) {
      const windowsDir = await resolveWslWindowsDirectory(dir)
      candidates.push({ command: openDirectoryCommand(), args: [windowsDir] })
      // 某些 WSL 配置不会把 Windows PATH 注入 Linux；直接调用挂载盘里的
      // explorer.exe 仍能通过 WSL interop 打开 \\wsl.localhost\... 路径。
      candidates.push({ command: '/mnt/c/Windows/explorer.exe', args: [windowsDir] })
      candidates.push({ command: 'wslview', args: [dir] })
      candidates.push({ command: 'xdg-open', args: [dir] })
    } else {
      candidates.push({ command: 'xdg-open', args: [dir] })
    }

    let lastError = null
    for (const candidate of candidates) {
      try {
        await spawnDetached(candidate.command, candidate.args)
        return
      } catch (error) {
        lastError = error
        // 只有“命令不存在”才值得换下一个候选；权限等错误直接上报。
        if (error?.code !== 'ENOENT') throw error
      }
    }
    if (lastError !== null) throw lastError
    throw new Error('no directory opener is available')
  }

  /** 各路由共用的 400 响应：会话 id 缺失或格式错误。 */
  function invalidSessionResponse() {
    return errorResponse(400, 'sessionId must match /^[A-Za-z0-9._-]{1,200}$/')
  }

  /* --------------------------------------------------------------- 观察器   */

  /**
   * 包装 `globalThis.fetch`，并链接到下层已安装的任意包装器。
   * @returns {() => Promise<void>} 恢复先前 fetch 的清理函数。
   */
  function install() {
    const previous = globalThis.fetch
    if (typeof previous !== 'function') {
      reportOnce('install', new Error('globalThis.fetch is not a function; capture disabled'))
      return async () => {}
    }
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch')
    const controller = new AbortController()
    captureSignal = controller.signal
    captureEnabled = true
    let stopped = null

    /** 仅当我们的包装器仍然安装时才恢复描述符。 */
    function restoreFetch() {
      try {
        if (globalThis.fetch !== observedFetch) return
        if (originalDescriptor === undefined) {
          Reflect.deleteProperty(globalThis, 'fetch')
        } else {
          Object.defineProperty(globalThis, 'fetch', originalDescriptor)
        }
      } catch (error) {
        reportOnce('restore', error)
      }
    }

    /** 恢复全局 fetch，中止进行中的捕获读取器并等待它们和待写文件。 */
    async function stop() {
      if (stopped !== null) return stopped
      captureEnabled = false
      stopped = (async () => {
        restoreFetch()
        try {
          controller.abort()
        } catch {
          /* 已经中止 */
        }
        await Promise.allSettled([...pendingCaptures])
        await Promise.allSettled([...pendingWrites.values()])
      })()
      return stopped
    }

    /** 提供给调用方的可捕获 fetch 外观。 */
    async function observedFetch(input, init) {
      let request
      try {
        request = new Request(input, init)
      } catch (error) {
        reportOnce('request-build', error)
        return Reflect.apply(previous, globalThis, [input, init])
      }
      let exchange = null
      try {
        exchange = beginExchange(request)
      } catch (error) {
        reportOnce('begin-exchange', error)
      }
      let response
      try {
        response = await Reflect.apply(previous, globalThis, [request])
      } catch (error) {
        try {
          if (exchange !== null) handleFailure(exchange, error)
        } catch (captureError) {
          reportOnce('failure', captureError)
        }
        throw error
      }
      try {
        if (exchange !== null) handleResponse(exchange, response)
      } catch (error) {
        reportOnce('response', error)
      }
      try {
        if (response.body !== null && !requestsByBody.has(response.body)) {
          requestsByBody.set(response.body, request)
        }
      } catch {
        /* WeakMap 记录是尽力而为 */
      }
      return response
    }

    try {
      Object.defineProperty(observedFetch, 'name', { value: previous.name, configurable: true })
      Object.defineProperty(observedFetch, 'length', { value: previous.length, configurable: true })
    } catch {
      /* 仅用于展示层修饰 */
    }
    const installDescriptor =
      originalDescriptor !== undefined && 'value' in originalDescriptor
        ? { ...originalDescriptor, value: observedFetch }
        : { value: observedFetch, writable: true, configurable: true, enumerable: true }
    try {
      Object.defineProperty(globalThis, 'fetch', installDescriptor)
    } catch (error) {
      reportOnce('install', error)
      captureEnabled = false
      captureSignal = null
      return async () => {}
    }
    return stop
  }

  const routes = [
    { path: ROUTE_PATHS.records, methods: ['GET', 'HEAD'], handler: handleRecordsRequest },
    { path: ROUTE_PATHS.record, methods: ['GET', 'HEAD'], handler: handleRecordRequest },
    { path: ROUTE_PATHS.clear, methods: ['POST'], handler: handleClearRequest },
    { path: ROUTE_PATHS.har, methods: ['GET', 'HEAD'], handler: handleHarRequest },
    { path: ROUTE_PATHS.reveal, methods: ['POST'], handler: handleRevealRequest },
  ]

  return { install, registerRoute, routes, writeDirectoryMarker, sweepOrphanLogs, cleanupOrphans: config.cleanupOrphans && config.persist, orphanSweepIntervalMs: config.orphanSweepIntervalMs }
}

/* -------------------------------------------------------------------------- */
/* 响应体捕获与编码                                                           */
/* -------------------------------------------------------------------------- */

/**
 * 从响应体流中最多读取 `limit` 字节，且永不 reject。
 * 调用方的流不受影响：只读取分流出来的克隆（tee，`clone()`）。
 * @param {ReadableStream<Uint8Array>|null} body - 要读取的响应体。
 * @param {number} limit - 字节上限。
 * @param {AbortSignal|null} signal - 捕获信号；中止时会取消读取器。
 * @param {(bytes: number, truncated: boolean) => void} [onProgress] - 实时字节进度。
 * @returns {Promise<{ buffer: Buffer|null, bytes: number, truncated: boolean }>}
 */
async function captureBody(body, limit, signal, onProgress) {
  if (body === null || body === undefined || typeof body.getReader !== 'function') {
    return { buffer: null, bytes: 0, truncated: false }
  }
  const reader = body.getReader()
  const chunks = []
  let bytes = 0
  let truncated = false
  let completed = false
  let aborted = false
  /** 取消克隆读取器；在其生命周期的任何阶段都安全。 */
  const cancel = (reason) => {
    try {
      reader.cancel(reason).catch(() => {})
    } catch {
      /* 流已经关闭 */
    }
  }
  const onAbort = () => {
    aborted = true
    cancel(signal?.reason)
  }
  if (signal !== null && signal !== undefined) signal.addEventListener('abort', onAbort, { once: true })
  try {
    while (aborted === false && (signal === null || signal === undefined || !signal.aborted)) {
      let chunk
      try {
        const item = await reader.read()
        if (item.done === true) {
          completed = true
          break
        }
        chunk = item.value
      } catch {
        truncated = bytes > 0
        break
      }
      if (!(chunk instanceof Uint8Array) || chunk.byteLength === 0) continue
      const remaining = limit - bytes
      if (remaining <= 0) {
        truncated = true
        cancel('dsh-plugin-session-http-log: body capture limit reached')
        break
      }
      const take = chunk.byteLength > remaining ? chunk.subarray(0, remaining) : chunk
      chunks.push(Buffer.from(take))
      bytes += take.byteLength
      if (take.byteLength < chunk.byteLength) {
        truncated = true
        cancel('dsh-plugin-session-http-log: body capture limit reached')
        break
      }
      if (onProgress !== undefined) {
        try {
          onProgress(bytes, truncated)
        } catch {
          /* 进度上报是尽力而为 */
        }
      }
    }
    if (completed === false && aborted === true && bytes > 0) truncated = true
  } finally {
    if (signal !== null && signal !== undefined) signal.removeEventListener('abort', onAbort)
    try {
      reader.releaseLock()
    } catch {
      /* 流已经释放 */
    }
  }
  return { buffer: chunks.length === 0 ? null : Buffer.concat(chunks), bytes, truncated }
}

/**
 * 按文本与 base64 的规则，把捕获的一侧响应体存到记录上。
 * @param {object} record - 内部记录。
 * @param {'request'|'response'} side - 要存储的一侧。
 * @param {{ buffer: Buffer|null, bytes: number, truncated: boolean }} outcome - 捕获结果。
 * @param {string} contentType - 该侧的内容类型。
 */
function applyCapturedBody(record, side, outcome, contentType) {
  const encoded = encodeCapturedBody(outcome, contentType)
  if (side === 'request') {
    record.requestBytes = outcome.bytes
    record.requestTruncated = outcome.truncated
    record.requestBody = encoded.body
    record.requestBodyEncoding = encoded.encoding
  } else {
    record.responseBytes = outcome.bytes
    record.responseTruncated = outcome.truncated
    record.responseBody = encoded.body
    record.responseBodyEncoding = encoded.encoding
  }
}

/**
 * 当负载是文本时把捕获的字节编码为 UTF-8 文本，否则编码为 base64。
 * @param {{ buffer: Buffer|null, bytes: number, truncated: boolean }} outcome - 捕获结果。
 * @param {string} contentType - 该侧的内容类型。
 * @returns {{ body: string|null, encoding: 'utf8'|'base64' }}
 */
function encodeCapturedBody(outcome, contentType) {
  const { buffer, bytes } = outcome
  if (buffer === null || bytes === 0) return { body: null, encoding: 'utf8' }
  const declared = textualContentType(contentType)
  const text = declared === false ? null : decodeBodyText(buffer, declared === true)
  if (text === null) return { body: buffer.toString('base64'), encoding: 'base64' }
  return { body: text, encoding: 'utf8' }
}

/**
 * 按 UTF-8 解码字节。声明为文本的内容保留替换字符；
 * 未知内容类型必须是有效 UTF-8 且不含 NUL 才算文本。
 * @param {Buffer} buffer - 捕获的字节。
 * @param {boolean} declaredTextual - 内容类型声明为文本时为 true。
 * @returns {string|null} 解码后的文本；负载为二进制时为 null。
 */
function decodeBodyText(buffer, declaredTextual) {
  if (declaredTextual === true) return UTF8_DECODER.decode(buffer)
  try {
    const text = STRICT_UTF8_DECODER.decode(buffer)
    return text.includes('\u0000') ? null : text
  } catch {
    return null
  }
}

/**
 * 把内容类型归类为文本、二进制或未知。
 * @param {string} contentType - 原始 `content-type` 值。
 * @returns {boolean|undefined} 已知时为 true/false，缺失时为 undefined。
 */
function textualContentType(contentType) {
  const type = mediaType(contentType)
  if (type === '') return undefined
  if (type.startsWith('text/')) return true
  return TEXTUAL_CONTENT_TYPE_PATTERN.test(type)
}

/**
 * 去掉参数并转为小写的媒体类型。
 * @param {string} contentType - 原始 `content-type` 值。
 * @returns {string}
 */
function mediaType(contentType) {
  if (typeof contentType !== 'string') return ''
  return contentType.split(';', 1)[0].trim().toLowerCase()
}

/**
 * 当 JSON 请求体存在且 `model` 为字符串时提取它。
 * @param {string|null} body - 捕获的请求体文本。
 * @param {string} encoding - `utf8` 或 `base64`。
 * @returns {string|null}
 */
function modelFromBody(body, encoding) {
  if (typeof body !== 'string' || body === '' || encoding === 'base64') return null
  try {
    const parsed = JSON.parse(body)
    const model = parsed?.model
    return typeof model === 'string' && model !== '' ? model : null
  } catch {
    return null
  }
}

/**
 * 根据 URL 把一次交换归类为 LLM 或普通 HTTP。
 * @param {string} url - 请求 URL。
 * @returns {'llm'|'http'}
 */
function classifyKind(url) {
  return KIND_PATH_PATTERN.test(url) ? 'llm' : 'http'
}

/* -------------------------------------------------------------------------- */
/* 投影与响应辅助函数                                                         */
/* -------------------------------------------------------------------------- */

/**
 * 一条记录占用的宿主内存估算值：URL 与头部文本，加上捕获的响应体
 * 字节数。base64 响应体以 JS 字符串存储时约为原始字节的 4/3，因此要计入
 * 这一点。每当捕获体增长时重算，代价足够低。
 * @param {object} record - 内部记录。
 * @returns {number} 估算字节数。
 */
function estimateRecordBytes(record) {
  let total = 0
  if (typeof record.url === 'string') total += record.url.length
  total += headerStoredBytes(record.requestHeaders)
  total += headerStoredBytes(record.responseHeaders)
  total += bodyStoredBytes(record.requestBytes, record.requestBodyEncoding)
  total += bodyStoredBytes(record.responseBytes, record.responseBodyEncoding)
  return total
}

/**
 * 一侧捕获体占用的内存大小。
 * @param {unknown} bytes - 捕获的字节数。
 * @param {unknown} encoding - `utf8` 或 `base64`。
 * @returns {number}
 */
function bodyStoredBytes(bytes, encoding) {
  if (typeof bytes !== 'number' || bytes <= 0) return 0
  return encoding === 'base64' ? Math.ceil((bytes * 4) / 3) : bytes
}

/**
 * 捕获头部对的字符数，作为其内存占用的近似代理。
 * @param {unknown} headers - 捕获的头部对。
 * @returns {number}
 */
function headerStoredBytes(headers) {
  if (!Array.isArray(headers)) return 0
  let total = 0
  for (const entry of headers) {
    if (!Array.isArray(entry)) continue
    if (typeof entry[0] === 'string') total += entry[0].length
    if (typeof entry[1] === 'string') total += entry[1].length
  }
  return total
}

/**
 * 按契约投影为概要（不含响应体，也不含内部字段）。
 * @param {object} record - 内部记录。
 * @returns {object}
 */
function summarizeRecord(record) {
  return {
    id: record.id,
    sessionId: record.sessionId,
    startedAt: record.startedAt,
    method: record.method,
    url: record.url,
    status: record.status ?? null,
    statusText: typeof record.statusText === 'string' ? record.statusText : '',
    durationMs: record.durationMs ?? null,
    completedMs: record.completedMs ?? null,
    requestBytes: record.requestBytes ?? 0,
    responseBytes: record.responseBytes ?? 0,
    requestTruncated: record.requestTruncated === true,
    responseTruncated: record.responseTruncated === true,
    kind: record.kind === 'llm' ? 'llm' : 'http',
    model: typeof record.model === 'string' ? record.model : null,
    error: typeof record.error === 'string' ? record.error : null,
  }
}

/**
 * 按契约投影为详情：概要加上头部与捕获的响应体。
 * @param {object} record - 内部记录。
 * @returns {object}
 */
function detailRecord(record) {
  return {
    ...summarizeRecord(record),
    requestHeaders: Array.isArray(record.requestHeaders) ? record.requestHeaders : [],
    requestBody: typeof record.requestBody === 'string' ? record.requestBody : null,
    requestBodyEncoding: record.requestBodyEncoding === 'base64' ? 'base64' : 'utf8',
    responseHeaders: Array.isArray(record.responseHeaders) ? record.responseHeaders : [],
    responseMimeType: typeof record.responseMimeType === 'string' ? record.responseMimeType : '',
    responseBody: typeof record.responseBody === 'string' ? record.responseBody : null,
    responseBodyEncoding: record.responseBodyEncoding === 'base64' ? 'base64' : 'utf8',
  }
}

/**
 * 单条内部记录对应的 HAR 1.2 条目。
 * @param {object} record - 内部记录。
 * @returns {object}
 */
function toHarEntry(record) {
  const startedDateTime = new Date(typeof record.startedAt === 'number' ? record.startedAt : 0).toISOString()
  const wait = typeof record.durationMs === 'number' ? record.durationMs : 0
  const total = typeof record.completedMs === 'number' ? record.completedMs : wait
  const receive = Math.max(0, total - wait)
  const requestHeaders = toHarHeaders(record.requestHeaders)
  const responseHeaders = toHarHeaders(record.responseHeaders)
  const requestBody = typeof record.requestBody === 'string' ? record.requestBody : null
  const responseBody = typeof record.responseBody === 'string' ? record.responseBody : null
  const requestMimeType = headerValue(requestHeaders, 'content-type') ?? 'application/octet-stream'
  const request = {
    method: typeof record.method === 'string' ? record.method : 'GET',
    url: typeof record.url === 'string' ? record.url : '',
    httpVersion: 'HTTP/1.1',
    headers: requestHeaders,
    queryString: [],
    cookies: [],
    headersSize: -1,
    bodySize: record.requestBytes ?? 0,
    ...(requestBody === null
      ? {}
      : {
          postData: {
            mimeType: requestMimeType,
            text: requestBody,
            ...(record.requestBodyEncoding === 'base64' ? { encoding: 'base64' } : {}),
          },
        }),
  }
  return {
    startedDateTime,
    time: total,
    request,
    response: {
      status: typeof record.status === 'number' ? record.status : 0,
      statusText: typeof record.statusText === 'string' ? record.statusText : '',
      httpVersion: 'HTTP/1.1',
      headers: responseHeaders,
      cookies: [],
      content: {
        size: record.responseBytes ?? 0,
        mimeType: typeof record.responseMimeType === 'string' ? record.responseMimeType : '',
        text: responseBody ?? '',
        ...(record.responseBodyEncoding === 'base64' ? { encoding: 'base64' } : {}),
      },
      redirectURL: '',
      headersSize: -1,
      bodySize: record.responseBytes ?? 0,
    },
    cache: {},
    timings: { send: 0, wait, receive },
  }
}

/**
 * 把捕获的头部对转换为 HAR 头对象。
 * @param {unknown} headers - 捕获的头部对。
 * @returns {Array<{ name: string, value: string }>}
 */
function toHarHeaders(headers) {
  if (!Array.isArray(headers)) return []
  const result = []
  for (const entry of headers) {
    if (!Array.isArray(entry) || entry.length < 2) continue
    result.push({ name: String(entry[0]), value: headerText(entry[1]) })
  }
  return result
}

/**
 * HAR 头列表中某个头部的第一个值。
 * @param {Array<{ name: string, value: string }>} headers - HAR 头部。
 * @param {string} name - 小写头部名称。
 * @returns {string|null}
 */
function headerValue(headers, name) {
  for (const header of headers) {
    if (header.name.toLowerCase() === name) return header.value
  }
  return null
}

/**
 * 把捕获的头部值转为字符串。
 * @param {unknown} value - 捕获的值。
 * @returns {string}
 */
function headerText(value) {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  return String(value)
}

/**
 * 从 `Headers` 实例取得捕获的头部对。
 * @param {Headers} headers - 请求或响应头部。
 * @returns {Array<[string, string]>}
 */
function headerEntries(headers) {
  try {
    return [...headers.entries()]
  } catch {
    return []
  }
}

/**
 * 读取可选的 `limit` 查询参数。
 * @param {string|null} raw - 原始参数值。
 * @param {number} max - 上限（每会话记录数）。
 * @returns {number|null} 限制值；不限制时为 null。
 */
function parseLimit(raw, max) {
  if (raw === null || raw === undefined || raw === '') return null
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return null
  return Math.min(Math.floor(value), max)
}

/**
 * 带每个路由都使用的 no-store 响应头的 JSON 应答。
 * @param {unknown} payload - 可 JSON 序列化的负载。
 * @param {number} [status] - HTTP 状态码。
 * @returns {Response}
 */
function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: JSON_RESPONSE_HEADERS })
}

/**
 * 形如 `{ error }` 的 JSON 错误应答。
 * @param {number} status - HTTP 状态码。
 * @param {string} message - 错误消息。
 * @returns {Response}
 */
function errorResponse(status, message) {
  return jsonResponse({ error: message }, status)
}

/* -------------------------------------------------------------------------- */
/* 小型共用辅助函数                                                           */
/* -------------------------------------------------------------------------- */

/**
 * 只把错误渲染为消息（绝不包含堆栈）。
 * @param {unknown} error - 捕获到的值。
 * @returns {string}
 */
function errorMessage(error) {
  if (error instanceof Error) return error.message
  try {
    return String(error)
  } catch {
    return 'unrenderable error'
  }
}

/**
 * 会话 id 对应的文件系统安全文件名主干。
 * @param {string} sessionId - 会话 id。
 * @returns {string}
 */
function safeFileName(sessionId) {
  const raw = typeof sessionId === 'string' ? sessionId : String(sessionId ?? '')
  const name = raw.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 200)
  if (name === '' || name === '.' || name === '..') return '_session'
  return name
}
