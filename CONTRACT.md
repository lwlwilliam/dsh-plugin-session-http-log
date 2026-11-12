# 会话 HTTP 记录 —— 实现契约

一个记录**会话真实 HTTP 报文**并在右侧边栏展示的 Harness bundle。

宿主侧代码全部在 `index.js`（Host 插件），浏览器侧代码全部在 `client.js`（Client 插件模块）。
两半互不引用，也不导入任何 Harness 包：`index.js` 只用 Node 内置模块
（`node:fs`、`node:path`、`node:os`），`client.js` 只用 `require('react')`
（必要时 `require('react/jsx-runtime')`，用 `React.createElement`，无 JSX、无构建步骤）。

包目录：本仓库根目录（即 `package.json` 所在目录；下文 `<本包目录>` 均指它）。
包名：`@local/dsh-plugin-session-http-log`；bundle patch 行 id：`dsh-plugin-session-http-log`。
数据目录名保持 `session-http-log`（兼容已有抓包数据，不随插件改名迁移）。

文件归属（不要改别人的文件）：

| 文件 | 归属 |
|---|---|
| `index.js` | Host 半 |
| `client.js` | Client 半 |
| `package.json`、`cordis.patch.yml`、`locale/*.json`、`icon.svg`、`README.md`、`CONTRACT.md` | Lead |

## 已确认的 Harness 事实（无需重新调查）

- DSH 版本 `0.2.2-rc.1`，安装目录 `<dsh 安装目录>`，profile `web`
  （`$DSH_PROFILE_DIR=$DSH_HOME/profiles/web`），Web GUI `http://127.0.0.1:3080`。
- Host：Agent 驱动链使用 AsyncLocalStorage 记录 initiator；在模型/工具执行期间
  `ctx.get('agents').currentInitiator()` 返回 `{ id: <SessionId> }`。这是 Host `fetch`
  唯一受支持的会话归属机制。
- 所有 LLM 适配器与联网工具都走 `globalThis.fetch`（依据：`@deepseek-ai/dsh-llm-deepseek`
  与 `dsh-llm-pi-ai` 调用 `fetch(...)`；`dsh-http-proxy` 统一经全局 dispatcher 转发），
  因此包裹 `globalThis.fetch` 就能抓到原始字节。
- 可选的 Inspector bundle 也会包裹 `globalThis.fetch`；包装器必须**串联**（调用前一层 fetch），
  卸载时只在 `globalThis.fetch === observedFetch` 时还原自己这一层。
- 纯 JS bundle 的 Host→浏览器数据通道：`ctx.get('connection').fetch.register(route)`，其中
  `route = { path: '/api/...', methods: ['GET'|'HEAD'|'POST'], requestBody: 'buffered',
  fetch: (request: Request) => Promise<Response> }`。路由带鉴权，只有宿主所属浏览器可访问。
  浏览器端用**文档相对 URL** 调用：
  `fetch('api/dsh-plugin-session-http-log/records?...', { credentials: 'same-origin' })`
  （注意没有前导斜杠；不要自行拼接挂载前缀）。
- 右侧边栏 tab 的注册方式（照抄；参考实现：
  `node_modules/@deepseek-ai/dsh-experimental-session-inspector/lib/client.js`
  约 4440-4470 行的 `registerInspectorTab` 与其 `apply`）：
  ```js
  ctx.effect(() => ctx.locale.register(NS, { en, zh }))
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: PLUGIN_ID, kind: KIND, keepMounted: true,
    title: () => t('tab.title'),
    guide: [{ id: 'open', order: 65, title: () => t('tab.title'),
              description: () => t('tab.description') }],
  }))
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: PLUGIN_ID, locale: NS,
    inject: (sessionId) => ({ sessionId }),
  }, View))
  ```
  `PLUGIN_ID = '@local/dsh-plugin-session-http-log'`，必须与模块加载器 factory id、`dsh.client` 名称一致。
  插件对象返回 `{ inject: ['slots','locale','sidebarRightTabs'], apply(ctx) { … } }`；
  `View` 的 props 至少保证有 `props.sessionId`。
- 可用主题 token：`--dsw-alias-bg-base`、`-bg-layer-1`、`-bg-layer-2`、`-bg-overlay`、
  `--dsw-alias-border-l1`、`--dsw-alias-border-l2`、`--dsw-alias-brand-primary`、
  `--dsw-alias-label-primary`、`--dsw-alias-label-secondary`、
  `--dsw-alias-state-error-primary`、`--dsw-alias-state-idle-primary`、
  `--dsw-alias-state-success-primary`、`--dsw-alias-state-warn-primary`。
  只允许用这些 token（字面色只允许出现在 SVG 图标里），且明暗主题都要正确。

## Host 行为（`index.js`）

纯 ESM，`export const inject = ['connection']`，`export function apply(ctx, config)`。

配置按默认值防御式读取（patch 行提供 `config`；缺键不抛错、未知键忽略；因为本环境无法导入
schemastery，不导出 `Config`）：

```
maxRequestsPerTurn:   200               // 当前轮内存条数上限
maxTurnBytes:         32 * 1024 * 1024  // 当前轮内存字节安全阀
maxRequestBodyBytes:  8 * 1024 * 1024
maxResponseBodyBytes: 4 * 1024 * 1024
redactSensitiveHeaders: true
persist: true
dataDir: ''            // 默认：$DSH_HOME/session-http-log（回退 ~/.dsh/session-http-log）
maxLogFileBytes: 32 * 1024 * 1024   // 当前轮磁盘上限；达到后只重写本文件并保留最近尾部
retentionMs: 60 * 60 * 1000         // 最后写入后保留多久；每小时清理时删除超期文件
cleanupLogs: true                   // 开启归档即时清理、孤儿/过期文件与全局总容量清理
cleanupIntervalMs: 60 * 60 * 1000   // 每小时扫描；启动后约 1 秒先扫一次
maxTotalBytes: 512 * 1024 * 1024    // 所有文件总磁盘安全阀；0 关闭
captureUnattributed: false          // 为 true 时，无 initiator 的请求记入 "unattributed"
openDirectoryCommand: ''            // '' = 平台默认（open / explorer.exe / xdg-open）
```

旧配置名 `maxRequestsPerSession`、`maxSessionBytes`、`cleanupOrphans`、
`orphanSweepIntervalMs` 作为别名读取；新代码使用上表的新名称。

1. **安装 fetch 观测器**（放在一个 `ctx.effect(() => { install(); return stop })` 中）。
   - 保存 `const previous = globalThis.fetch`（及其属性描述符），安装 `observedFetch`；
     释放时仅当 `globalThis.fetch === observedFetch` 才还原，并中止抓取、等待未完成读取。
   - 每次调用：构造 `const request = new Request(input, init)`（try/catch；构造失败则退化为
     `previous(input, init)` 不观测，绝不破坏调用方）。用 `previous(request)` 发起请求（保证
     与 Inspector 的包装器串联）。调用方的 abort 依赖包装 Request 保持可达：用模块级
     `WeakMap<response.body, request>` 保持，做法与 Inspector 参考实现一致。
   - 抓**请求**：方法、URL、全部请求头、请求体原始字节前缀（`maxRequestBodyBytes`，通过
     `request.clone()` tee，异步读取，绝不拖慢 fetch）。文本/二进制判定（content-type 为
     text/json/xml/js/form/event-stream，或去掉 NUL 后是合法 UTF-8）——文本按 UTF-8 存，
     二进制存 base64。
   - 抓**响应**：状态、状态文本、响应头、content-type，以及响应体原始字节
     （`response.clone().body`，上限 `maxResponseBodyBytes`；同一套文本/二进制规则）。
     抓取超过上限时取消 clone 读取，不能阻塞调用方的流。调用方在流读完后主动 abort
     （模型适配器收到 `message_stop` 后就会这样做）会让 clone reader 以 `AbortError`
     结束；此时已读字节保留且**不**标记为 truncated，真实传输错误或抓取上限仍标记。
   - 计时：调用时 `startedAt`，收到响应头时 `durationMs`，响应体抓取结束时 `completedAt`。
     请求被 reject 时记录 `error`（只存 message，不存 stack）。
   - 当 `redactSensitiveHeaders` 为 true 时，把 `authorization`、`proxy-authorization`、
     `cookie`、`set-cookie`、`x-api-key`、`api-key`、`x-auth-token`、`x-goog-api-key`
     的值替换为 `[redacted]`（保留头名）。
   - **归属**：`const initiator = ctx.get('agents')?.currentInitiator?.()`（try/catch，服务可能
     已卸载），`sessionId = initiator?.id`；取不到则不记录（`captureUnattributed: true` 时归入
     `unattributed`，默认不展示）。
   - 富化：URL path 匹配 `/\/(chat\/completions|completions|messages|responses|embeddings)(\?|$)/`
     时 `kind = 'llm'`，否则 `'http'`；请求体能解析为 JSON 且含字符串 `model` 时记录 `model`
     （存储的原始 body 不做任何删改）。
   - 观测器的任何异常都不能进入被包装的调用：每步 try/catch，同一错误只通过
     `ctx.logger?.warn?.()` 告警一次。

2. **存储与轮次保留**
   - 监听 `session/event` 的 `turn/start`。该事件属于 Host 已提交事件；收到后按 `session.id`
     进入新轮次：清空该会话上一轮的内存记录、递增 `generation`，并把文件清空任务排入该文件的
     串行写队列。上一轮迟到的请求/响应捕获因 `generation` 不匹配而被丢弃，不得重新落盘。
   - `Map<sessionId, { nextId, records: Record[], bytes, loadedFromDisk, currentTurn, generation }>`；
     记录按 `maxRequestsPerTurn` 和 `maxTurnBytes` 双上限淘汰最旧记录（至少保留最新一条）。
     每条内部记录带 `turn`；它不进入前端 summary/detail 投影。
   - 可选持久化写两个文件：
     - `<dataDir>/<清洗后的 sessionId>.jsonl`：完整正文；
     - `<dataDir>/<清洗后的 sessionId>.jsonl.idx`：轻量 summary + 正文 `offset`/`length`。
     每条完成记录按“正文先写、索引后写”的顺序进入同一文件队列；每行索引不含 body。
     持久化是 fire-and-forget：抓包 finalize 只入队、不 await 写盘；队列任务先 `setImmediate`
     让出事件循环，再序列化/写文件。`dispose` 会等待待写队列完成。
   - 单轮正文文件达到 `maxLogFileBytes` 时重写正文和索引，保留最近约 1/4 上限的已完成记录
     （最多保留 8 MiB，且至少保留当前记录），不影响其它会话。
   - 冷读只读 `.jsonl.idx`，按 payload 行偏移懒读取 `/record` 详情；不存在索引的旧版完整
     JSONL 会在首次冷读时重建一次索引。HAR 导出是唯一会批量读取全部 body 的常规例外。
   - 列表响应带基于 `generation + revision + 条数 + 最后 id + fileBytes` 的 ETag；
     `If-None-Match` 命中时返回 304，不重复发送/解析 summary 数组。
   - 清理必须成对处理正文与索引；索引无正文时单独回收。
   - `clear(sessionId)` 清空内存并删除/清空文件；仍保留手动“打开目录”和“清空”能力。
   - **归档即时清理**（`cleanupLogs: true` 且 `persist: true`）：Harness 的
     `workspaceRegistry` 没有归档完成事件，因此在服务可用时用共享 Symbol 包装
     `workspaceRegistry.archiveSession()`；只有归档 Promise 成功后才删除该会话的
     `<sessionId>.jsonl` 与 `<sessionId>.jsonl.idx`，并再触发一轮扫描以覆盖
     `parentSession` 链上的子代理/团队会话。归档清理必须先递增该会话内存桶的
     `generation`（并移出 `sessions`）再排入删除任务，保证归档瞬间仍在进行的响应
     捕获在结束后因 generation 不匹配而丢弃，不会在删除后重新创建日志。
     归档失败（例如会话仍活跃）不得删除文件。
     插件卸载时恢复原方法；另每 2 秒轻量比对一次 `archivedSessionIds` 作为兜底，
     服务对象不可扩展或归档绕过包装方法时也能很快清理。
   - **每小时清理**（`cleanupLogs: true` 且 `persist: true`，启动后约 1 秒先扫一次，之后按
     `cleanupIntervalMs`，默认 1 小时）：
     - 只处理文件名符合会话 id 规则的 `*.jsonl` 及其成对 `.jsonl.idx`；`README.txt`、
       未知文件与 `unattributed.jsonl` 不删除。
     - 文件 `mtime` 距当前时间达到 `retentionMs`（默认 1 小时）时删除；该项不依赖
       会话列表，因此列表暂时不可读时也要继续清理过期文件。
     - 会话不在 live Session / `sessionPersistence`，或处于归档集合时，删除对应文件；
       父会话清理时沿 `parentSession` 链清理子会话。该判定要求权威会话列表可读，
       读不到时跳过，绝不猜测性删除。
     - 所有保留文件总大小超过 `maxTotalBytes`（>0 时）则按 `mtime` 最旧优先删整个会话文件。
     - 进行中捕获（`pending.size > 0`）或该文件仍在写队列时跳过删除；删除后同步失效对应内存桶。
     - 由于每小时扫描，过期文件实际可能在最后写入后 1–2 小时内删除；README 必须说明这一点。

3. **HTTP 路由**（每个都在 `ctx.effect(...)` 中注册并返回 disposer；`requestBody:'buffered'`）。
   所有响应都是 `new Response(JSON.stringify(x), { headers: { 'content-type':
   'application/json; charset=utf-8', 'cache-control': 'no-store' } })`；错误返回 4xx/5xx
   JSON `{ error: string }`。`sessionId` 用 `/^[A-Za-z0-9._-]{1,200}$/` 校验。
   - `GET /api/dsh-plugin-session-http-log/records?sessionId=…&limit=…`
     → `{ sessionId, total, totalBytes, fileBytes, dir, persist, latestTurnOnly,
     retentionMs, cleanupIntervalMs, maxTotalBytes, maxRequestsPerTurn, maxTurnBytes,
     maxLogFileBytes, records: RecordSummary[] }`（最新在后，summary 不含报文；
     `totalBytes` = 估算已存字节，`fileBytes` = JSONL 文件大小或 null，`dir` = 持久化目录，
     `persist` = 是否持久化，`latestTurnOnly` 固定为 true，其余字段回显保留配置）。
     响应带 `ETag`；请求头 `If-None-Match` 与当前值一致时返回 304 空正文。
   - `GET /api/dsh-plugin-session-http-log/record?sessionId=…&id=…` → `{ record: Record }` 或 404；
     支持 `part=summary|meta|requestBody|responseBody`：
     - `summary` 只从索引返回轻量概览，不读正文文件；
     - `meta` 返回概览 + 头部，不含 body；
     - `requestBody` / `responseBody` 只返回对应一侧的 body 载荷。
     省略 `part` 时保持旧的完整详情行为（HAR/兼容调用仍可用）。
   - `POST /api/dsh-plugin-session-http-log/clear` body `{ "sessionId": "…" }` → `{ ok: true, removed: n }`
   - `POST /api/dsh-plugin-session-http-log/clear-all` → `{ ok: true, removedSessions, removedRecords, removedFiles }`：
     清空所有会话内存记录并删除数据目录中所有符合会话 id 规则的 `*.jsonl` 与
     `.jsonl.idx`；保留 `README.txt` 和未知文件。
     删除期间暂停新捕获，避免清理与写入竞态。
   - `GET /api/dsh-plugin-session-http-log/usage` →
     `{ dir, persist, maxTotalBytes, sessions, files, bytes }`：扫描 `dataDir` 统计**所有会话**
     抓包文件的磁盘总大小；口径与每小时清理/`clear-all` 一致，只统计文件名符合会话 id 规则的
     `*.jsonl` 与 `*.jsonl.idx`（`README.txt`、未知文件不计入），`sessions` = 去重后的会话数，
     `files` = 文件数，`bytes` = 总字节。持久化关闭或目录不存在时各项为 0；扫描失败只记录一次
     日志并返回 0，不让面板报错。不再提供“清空不活跃”路由或其统计字段。
   - `POST /api/dsh-plugin-session-http-log/reveal` body 可选 `{ "sessionId": "…" }` →
     `{ ok: true, dir, selected: string[] }`：在系统文件管理器中打开持久化目录（平台默认或
     `openDirectoryCommand`），并在平台支持时**选中该会话的日志文件**。`selected` 为实际请求
     文件管理器选中的路径（最多一个：正文 `.jsonl`；文件不存在时为空数组）。各平台的选择入口
     （macOS `open -R`、Windows/WSL `explorer.exe /select,`、Linux 文件管理器 `--select`）都只能
     可靠地选中**单个**文件，传多个时只有最后一个生效，因此统一只选正文，索引与正文同目录并列
     可见；普通 Linux 依次尝试 `nautilus --select`、`dolphin --select`、`nemo <file>`、
     `thunar --select`，都不可用时回退 `xdg-open <dir>`（只打开目录）。自定义
     `openDirectoryCommand` 保持只传目录的旧行为。
     WSL 下路径必须转换为 Windows 路径（优先 `wslpath -w`，回退到 `/mnt/<drive>` 或
     `\\wsl.localhost\<distro>`）再交给 Windows `explorer.exe`；Explorer 对 UNC 路径的选择支持
     因版本而异，失败时回退打开目录。路由只接受通过会话 id 校验的文件名，绝不打开任意位置；
     失败返回 500 `{ error }`。
   - `GET /api/dsh-plugin-session-http-log/har?sessionId=…` → HAR 1.2 对象
     `{ log: { version: '1.2', creator: { name: 'dsh-plugin-session-http-log', version: '0.1.0' },
     entries: [ … ] } }`；`content-type: application/json`，`content-disposition:
     attachment; filename="dsh-plugin-session-http-log.har"`。HAR entry：`startedDateTime` ISO、
     `time` = 总毫秒、`request` { method, url, httpVersion: 'HTTP/1.1', headers: [{name,value}],
     queryString: [], cookies: [], headersSize: -1, bodySize, postData? { mimeType, text,
     …(base64 body: { encoding: 'base64' }) } }、`response` { status, statusText,
     httpVersion, headers, cookies: [], content: { size, mimeType, text, …(base64: { encoding:
     'base64' }) }, redirectURL: '', headersSize: -1, bodySize }、`cache`: {}、`timings`: {
     send: 0, wait: durationMs ?? 0, receive: 剩余 }。

## 记录结构（精确）

RecordSummary：
```json
{ "id": 3, "sessionId": "...", "startedAt": 1762746000000, "method": "POST",
  "url": "https://api.example/v1/chat/completions", "status": 200, "statusText": "OK",
  "durationMs": 812, "completedMs": 4210, "requestBytes": 5210, "responseBytes": 9021,
  "requestTruncated": false, "responseTruncated": false, "kind": "llm",
  "model": "deepseek-v4.1-flash", "error": null }
```
Record（详情）在其基础上增加：
```json
{ "requestHeaders": [["content-type","application/json"], …],
  "requestBody": "{\"model\":…}", "requestBodyEncoding": "utf8",   // 或 "base64"
  "responseHeaders": [[…]],
  "responseMimeType": "text/event-stream",
  "responseBody": "data: {...}\n\n", "responseBodyEncoding": "utf8" }
```
`id` 是每会话从 1 开始的整数，在列表/详情及持久化文件中保持一致。
`requestBody`/`responseBody` 在无 body 时为 `null`；body 存**抓取到的前缀原文**
（服务端不美化，格式化由 Client 负责）。

## Client 行为（`client.js`）

纯 JS 浏览器模块，无构建步骤：

```js
window.__ModuleLoader__.load({
  id: '@local/dsh-plugin-session-http-log',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    // …单文件实现：字典 + 样式 + 视图…
    return { inject: ['slots','locale','sidebarRightTabs'], apply(ctx) { /* … */ } }
  },
})
```

要求：
- 在命名空间 `dsh-plugin-session-http-log` 下注册 `en` 与 `zh` 字典，所有可见文案都通过
  `ctx.locale.bind(NS)`（用户语言是中文，`zh` 必须完整）；面板内另有中/EN 快捷切换（见下）。
- 按契约中的片段注册 tab 类型与面板 body；`keepMounted: true`。
- 数据流：`props.sessionId`；挂载且面板可见时每约 1.2 秒轮询
  `GET api/dsh-plugin-session-http-log/records?sessionId=…&limit=500`（`credentials: 'same-origin'`，
  带 `If-None-Match`，304 时不更新状态，跳过重叠请求，卸载/不可见时 abort）；刷新按钮；选中时先取
  `part=meta` 详情，正文区块展开时才取 `part=requestBody|responseBody`；清空当前会话按钮 POST
  `api/dsh-plugin-session-http-log/clear`；清空全部按钮在二次确认后 POST
  `api/dsh-plugin-session-http-log/clear-all`；打开目录按钮 POST
  `api/dsh-plugin-session-http-log/reveal` 并带 `{ sessionId }`（尽量选中本会话的日志文件）；
  导出按钮下载 HAR（Blob + 临时 `<a download>`）；
  另以约 8 秒间隔轮询 `GET api/dsh-plugin-session-http-log/usage` 展示所有会话抓包文件的
  总大小（面板不可见时停止；失败时静默保留上一次值；手动刷新、清空当前会话、清空全部后
  立即重取）。
- 布局：紧凑头部（标题、记录数、占用空间、自动刷新、刷新、清空当前会话、导出、打开目录）；
  “清空全部”放在标题栏右侧语言切换旁，其左侧显示**所有会话抓包文件的磁盘总大小**
  （悬停提示文件数、会话数、`maxTotalBytes` 全局上限与目录；持久化关闭时隐藏），
  二次确认后调用 clear-all；
  不再提供“清空不活跃”按钮或对应路由；归档清理完全自动化。标题行允许换行，窄边栏下
  操作组整体换到下一行；持久化开启时，头部必须用加粗、`--dsw-alias-state-warn-primary`
  的警示文字展示保留策略：只保留最新一轮、单轮 `maxLogFileBytes` 上限、`retentionMs`
  过期后的每小时清理，以及归档成功后的即时清理；文案必须说明打开目录、清空当前会话与
  清空全部功能仍然可用，不得把自动清理描述成只影响一个会话。
  筛选输入（按 method/url/status/model 子串）；列表行；详情区。面板可能很窄——不要固定宽度，
  用 `min-width: 0`、换行/省略。空、加载中、错误状态都要有。
- 行：方法 chip、路径（tooltip 为完整 URL）、按状态着色的状态 chip（2xx success、3xx idle、
  4xx warn、5xx error、pending idle）、耗时、大小（请求体 ↑ / 响应体 ↓，tooltip 分别显示两者）、本地 HH:MM:SS。选中行用
  `--dsw-alias-brand-primary` 高亮；点击行展开/再次点击折叠。
- 详情：概览网格、请求头表、请求体、响应头表、响应体、错误行；body 用 `<pre>`（可换行或横向
  滚动，限高）；JSON body 提供原始/美化切换，默认“原始报文”；每个 body/headers/URL 提供复制，
  请求另提供“复制为 cURL”。按记录标记显示 `[body truncated]` / `[binary, base64]`。
  进行中的记录（`status === null && error === null`）显示“进行中…”，并继续自动刷新。
- 文案全部走本地化（`en`、`zh`）；样式只用上面列出的主题 token；CSS 作为视图根节点内的
  React `<style>` 元素注入。除 `react` / `react/jsx-runtime` 外不 require 任何 Harness 包；
  不写 `document.body`。
- 工厂函数不得有副作用：一切都在 `apply`/组件内，用 `ctx.effect` 清理。

## Lead 在两端就绪后运行的验证

1. `node --check index.js client.js`；`JSON.parse` 校验 `package.json` 与 locale JSON。
2. Host 冒烟测试（`test/host-smoke.mjs`，Lead 所有）：伪造 `ctx`，其 `get('agents')` 返回
   `{ currentInitiator: () => ({ id: 'session-test' }) }`，`get('connection')` 记录路由，
   `effect(cb)` 立即执行并保留 cleanup；对本地 `node:http` 服务器安装插件；调用
   `fetch(url, { method:'POST', body: JSON.stringify({model:'m'}), headers })`；断言抓到的记录
   含原始请求/响应文本、请求头、计时、`kind:'llm'`；断言 list/detail/clear/HAR/reveal/usage 路由；
   断言字节预算淘汰、单会话超 `maxLogFileBytes` 后旧文件被重写且保留最近尾部并继续写、
   `turn/start` 后上一轮内存和文件被清空且新轮继续写、摘要索引冷读与 `part` 懒加载详情、
   ETag/304、过期文件清理、`maxTotalBytes` 全局淘汰、`clear-all` 删除全部会话文件但保留
   `README.txt`、`usage` 汇总所有会话文件（关闭持久化时全 0，`clear-all` 后归零且不统计未知文件）、
   `workspaceRegistry.archiveSession()` 成功后 `.jsonl` 与 `.jsonl.idx` 立即成对删除且其它会话保留、
   WSL reveal 把 Windows 路径传给 `explorer.exe` 并在带 `sessionId` 时用 `/select,` 选中正文、
   macOS 的 `open -R` 只接收正文 `.jsonl`、`selected` 只包含真实存在的主文件、
   未知/已归档会话的 JSONL 被清理且有效文件保留；dispose 后
   `globalThis.fetch` 还原。
3. Client 冒烟测试（`test/client-smoke.mjs`）：伪 React + 伪客户端上下文加载真实 `client.js`，
   断言 tab/pane 注册、en/zh 字典完整性、视图渲染、主题 token 使用。
4. `plugin_manager install_bundle` 安装 bundle，再用 `cordis_inspect_query Config.listConfigs`
   与实际 `$DSH_HOME/session-http-log` JSONL 确认真实模型请求被记录。
