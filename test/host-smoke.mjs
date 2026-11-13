/**
 * Lead-owned Host smoke test for the dsh-plugin-session-http-log bundle.
 *
 * Runs the real `index.js` plugin against a fake Cordis context and a local
 * node:http server, then asserts raw capture, latest-turn retention, cleanup,
 * and the authenticated routes from CONTRACT.md.
 *
 *   node test/host-smoke.mjs
 *
 * No Harness package is imported; this test owns its fake context only.
 */
import { createServer } from 'node:http'
import { once } from 'node:events'
import { strict as assert } from 'node:assert'
import { access, chmod, mkdir, mkdtemp, readFile, rename, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const { apply } = await import(new URL('../index.js', import.meta.url).href)

const originalFetch = globalThis.fetch
let initiator = { id: 'session-test' }
const routes = new Map()
const cleanups = []
const sessionEventListeners = new Set()
const warnings = []
let knownSessionIds = new Set(['session-test', 'session-evict', 'session-marker'])
let sessionParents = new Map()
const workspaceRegistry = {
  archivedSessionIds: [],
  async archiveSession(sessionId) {
    if (!this.archivedSessionIds.includes(sessionId)) {
      this.archivedSessionIds = [...this.archivedSessionIds, sessionId]
    }
  },
}
/** Sessions the fake Host currently considers live. */
const liveSessions = []

const connectionFace = {
  fetch: {
    register(route) {
      if (routes.has(route.path)) throw new Error(`duplicate route ${route.path}`)
      routes.set(route.path, route)
      return async () => { routes.delete(route.path) }
    },
  },
}

const fakeCtx = {
  get(name) {
    if (name === 'agents') {
      return {
        currentInitiator() {
          return initiator
        },
      }
    }
    if (name === 'connection') return connectionFace
    if (name === 'sessionPersistence') {
      return {
        async list() {
          return [...knownSessionIds].map((id) => ({
            header: {
              id,
              ...(sessionParents.has(id) ? { parentSession: sessionParents.get(id) } : {}),
            },
          }))
        },
      }
    }
    if (name === 'workspaceRegistry') return workspaceRegistry
    if (name === 'sessions') return { list: () => liveSessions.map((id) => ({ id })) }
    return undefined
  },
  connection: connectionFace,
  on(event, listener) {
    if (event !== 'session/event') return () => {}
    sessionEventListeners.add(listener)
    return () => { sessionEventListeners.delete(listener) }
  },
  effect(callback) {
    const cleanup = callback()
    if (typeof cleanup === 'function') cleanups.push(cleanup)
    return () => {
      if (typeof cleanup === 'function') cleanup()
    }
  },
  inject(names, callback) {
    if (names.every((name) => fakeCtx.get(name) !== undefined)) callback(fakeCtx)
    return () => {}
  },
  logger: {
    info() {},
    warn(...args) { warnings.push(args) },
    error(...args) { warnings.push(args) },
  },
}

const dataDir = await mkdtemp(join(tmpdir(), 'dsh-plugin-session-http-log-smoke-'))
const config = {
  maxRequestsPerSession: 20,
  maxRequestBodyBytes: 64 * 1024,
  maxResponseBodyBytes: 256 * 1024,
  redactSensitiveHeaders: true,
  persist: false,
  dataDir,
  captureUnattributed: false,
  openDirectoryCommand: 'true',
}

// ── local wire target ───────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  req.rawBody = Buffer.concat(chunks).toString('utf8')

  if (req.url.startsWith('/v1/chat/completions')) {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'x-provider-request-id': 'req-123',
    })
    res.write('data: {"choices":[{"delta":{"content":"he"}}]}\n\n')
    setTimeout(() => {
      res.write('data: {"choices":[{"delta":{"content":"llo"}}]}\n\n')
      res.end('data: [DONE]\n\n')
    }, 10)
    return
  }
  if (req.url.startsWith('/v1/messages')) {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write('event: message_start\ndata: {"type":"message_start"}\n\n')
    setTimeout(() => {
      if (!res.writableEnded && !res.destroyed) {
        res.write('event: message_stop\ndata: {"type":"message_stop"}\n\n')
      }
    }, 10)
    setTimeout(() => {
      if (!res.writableEnded) res.end()
    }, 250)
    return
  }
  if (req.url.startsWith('/json')) {
    const body = JSON.stringify({ ok: true, echo: req.rawBody })
    res.writeHead(201, { 'content-type': 'application/json; charset=utf-8' })
    res.end(body)
    return
  }
  if (req.url.startsWith('/binary')) {
    res.writeHead(200, { 'content-type': 'application/octet-stream' })
    res.end(Buffer.from([0, 1, 2, 255, 254]))
    return
  }
  // 大报文样本：用来验证磁盘轮转后内存计数是否跟着收窄。
  if (req.url.startsWith('/blob')) {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ blob: 'b'.repeat(120 * 1024) }))
    return
  }
  if (req.url.startsWith('/slow')) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.write('{"slow":')
    setTimeout(() => res.end('true}'), 80)
    return
  }
  if (req.url.startsWith('/very-slow')) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.write('{"verySlow":')
    setTimeout(() => res.end('true}'), 1200)
    return
  }
  res.writeHead(404).end()
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const base = `http://127.0.0.1:${server.address().port}`

// ── install the plugin under test ───────────────────────────────────────────
apply(fakeCtx, config)
assert.notEqual(globalThis.fetch, originalFetch, 'fetch wrapper installed')
assert.equal(routes.size, 7, `expected 7 routes, got ${[...routes.keys()].join(', ')}`)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const route = (path) => {
  const entry = routes.get(path) ?? routes.get(`/api${path}`)
  assert.ok(entry, `route ${path} registered`)
  return entry
}
const callRoute = async (path, { method = 'GET', query = '', body, headers = {} } = {}) => {
  const entry = route(path)
  const url = `${base}${entry.path}${query}`
  const request = new Request(url, {
    method,
    headers: {
      ...headers,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const response = await entry.fetch(request)
  const text = await response.text()
  return { status: response.status, headers: response.headers, json: text === '' ? null : JSON.parse(text) }
}
const waitFor = async (check, label, timeoutMs = 3000) => {
  const started = Date.now()
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() - started > timeoutMs) throw new Error(`timeout waiting for ${label}`)
    await sleep(25)
  }
}

const emitSessionEvent = (session, event) => {
  for (const listener of [...sessionEventListeners]) listener(session, event)
}

// 1. raw LLM exchange, observed while the caller streams normally.
const llmBody = JSON.stringify({
  model: 'deepseek-test-1',
  messages: [{ role: 'user', content: 'hi' }],
  stream: true,
})
const response = await globalThis.fetch(`${base}/v1/chat/completions`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: 'Bearer top-secret' },
  body: llmBody,
})
assert.equal(response.status, 200)
const streamed = await response.text()
assert.ok(streamed.includes('[DONE]'), 'caller still receives the stream')

const summary = await waitFor(async () => {
  const result = await callRoute('/api/dsh-plugin-session-http-log/records', {
    query: '?sessionId=session-test',
  })
  return result.json.records.find((record) => record.status === 200 && record.kind === 'llm')
}, 'captured LLM record')
assert.equal(summary.method, 'POST')
assert.equal(summary.model, 'deepseek-test-1')
assert.equal(summary.status, 200)
assert.equal(summary.sessionId, 'session-test')
assert.ok(summary.durationMs >= 0, 'headers duration recorded')
assert.ok(summary.responseBytes > 0, 'response bytes recorded')

const feedResponse = await callRoute('/api/dsh-plugin-session-http-log/records', { query: '?sessionId=session-test' })
const feed = feedResponse.json
assert.ok(feed.totalBytes > 0, 'session total stored bytes reported')
assert.equal(feed.fileBytes, null, 'no persisted file size when persistence is off')
assert.equal(feed.dir, dataDir, 'data directory reported')
assert.equal(feed.persist, false, 'persistence flag reported')
assert.equal(feed.maxLogFileBytes, 32 * 1024 * 1024, 'per-turn disk cap reported')
assert.equal(feed.latestTurnOnly, true, 'latest-turn retention reported')
assert.equal(feed.retentionMs, 60 * 60 * 1000, 'hourly retention window reported')
assert.equal(typeof feed.maxTotalBytes, 'number', 'global disk cap reported')

// 1a. aggregate disk usage across sessions; nothing on disk when persistence is off.
const usageOff = await callRoute('/api/dsh-plugin-session-http-log/usage')
assert.equal(usageOff.status, 200, 'usage route responds')
assert.equal(usageOff.json.persist, false, 'usage reports persistence flag')
assert.equal(usageOff.json.bytes, 0, 'no aggregate usage when persistence is off')
assert.equal(usageOff.json.files, 0, 'no capture files counted when persistence is off')
assert.equal(usageOff.json.dir, dataDir, 'usage reports the data directory')
assert.equal('inactiveAvailable' in usageOff.json, false, 'inactive usage fields are no longer exposed')
const feedEtag = feedResponse.headers.get('etag')
assert.ok(typeof feedEtag === 'string' && feedEtag.length > 0, 'records response has an ETag')
const notModified = await callRoute('/api/dsh-plugin-session-http-log/records', {
  query: '?sessionId=session-test',
  headers: { 'if-none-match': feedEtag },
})
assert.equal(notModified.status, 304, 'unchanged records response returns 304')

const detail = await callRoute('/api/dsh-plugin-session-http-log/record', {
  query: `?sessionId=session-test&id=${summary.id}`,
})
const record = detail.json.record
assert.equal(record.requestBody, llmBody, 'raw request body captured verbatim')
assert.equal(record.requestBodyEncoding, 'utf8')
assert.ok(record.responseBody.includes('data: [DONE]'), 'raw SSE response captured')
assert.equal(record.responseBodyEncoding, 'utf8')
assert.equal(record.responseMimeType, 'text/event-stream')
const authHeader = record.requestHeaders.find(([name]) => name === 'authorization')
assert.deepEqual(authHeader, ['authorization', '[redacted]'], 'sensitive header redacted')
const providerHeader = record.responseHeaders.find(([name]) => name === 'x-provider-request-id')
assert.equal(providerHeader?.[1], 'req-123', 'response headers captured')

const metaResponse = await callRoute('/api/dsh-plugin-session-http-log/record', {
  query: `?sessionId=session-test&id=${summary.id}&part=meta`,
})
const metaRecord = metaResponse.json.record
assert.equal(metaRecord.requestBody, undefined, 'meta part omits request body')
assert.equal(metaRecord.responseBody, undefined, 'meta part omits response body')
assert.ok(Array.isArray(metaRecord.requestHeaders), 'meta part keeps headers')
const requestBodyPart = (await callRoute('/api/dsh-plugin-session-http-log/record', {
  query: `?sessionId=session-test&id=${summary.id}&part=requestBody`,
})).json.part
assert.equal(requestBodyPart.body, llmBody, 'request body part loads only that body')
assert.equal(requestBodyPart.encoding, 'utf8')
const responseBodyPart = (await callRoute('/api/dsh-plugin-session-http-log/record', {
  query: `?sessionId=session-test&id=${summary.id}&part=responseBody`,
})).json.part
assert.ok(responseBodyPart.body.includes('data: [DONE]'), 'response body part loads only that body')

// 1b. The model adapter aborts the request right after message_stop. The clone
// reader then fails with AbortError even though the captured stream is complete;
// that must not be reported as truncation.
knownSessionIds.add('session-abort')
initiator = { id: 'session-abort' }
const abortController = new AbortController()
const abortResponse = await globalThis.fetch(`${base}/v1/messages`, { signal: abortController.signal })
const abortReader = abortResponse.body.getReader()
const abortTextDecoder = new TextDecoder()
let abortedStreamText = ''
for (;;) {
  const chunk = await abortReader.read()
  if (chunk.done) break
  abortedStreamText += abortTextDecoder.decode(chunk.value, { stream: true })
  if (abortedStreamText.includes('message_stop')) {
    abortController.abort()
    break
  }
}
const abortSummary = await waitFor(async () => {
  const result = await callRoute('/api/dsh-plugin-session-http-log/records', {
    query: '?sessionId=session-abort',
  })
  return result.json.records.find((candidate) => candidate.kind === 'llm')
}, 'captured caller-aborted SSE record')
assert.equal(abortSummary.responseTruncated, false, 'caller abort after a complete SSE stream is not truncation')
const abortDetail = await callRoute('/api/dsh-plugin-session-http-log/record', {
  query: `?sessionId=session-abort&id=${abortSummary.id}`,
})
assert.ok(
  abortDetail.json.record.responseBody.includes('message_stop'),
  'completed SSE tail is preserved after the caller aborts',
)
initiator = { id: 'session-test' }

// 2. JSON exchange + binary response + POST route with a body.
await (await globalThis.fetch(`${base}/json`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{"q":1}',
})).text()
await (await globalThis.fetch(`${base}/binary`)).arrayBuffer()
await waitFor(async () => {
  const result = await callRoute('/api/dsh-plugin-session-http-log/records', { query: '?sessionId=session-test' })
  return result.json.records.length >= 3
}, 'all exchanges captured')

const all = (await callRoute('/api/dsh-plugin-session-http-log/records', { query: '?sessionId=session-test&limit=10' })).json
assert.equal(all.total, 3)
const binarySummary = all.records.find((item) => item.url.endsWith('/binary'))
const binaryDetail = (await callRoute('/api/dsh-plugin-session-http-log/record', {
  query: `?sessionId=session-test&id=${binarySummary.id}`,
})).json.record
assert.equal(binaryDetail.responseBodyEncoding, 'base64', 'binary body stored as base64')
assert.equal(Buffer.from(binaryDetail.responseBody, 'base64').toString('hex'), '000102fffe')

// 3. attribution: no initiator means no record.
initiator = undefined
await (await globalThis.fetch(`${base}/json`)).text()
await sleep(150)
assert.equal((await callRoute('/api/dsh-plugin-session-http-log/records', { query: '?sessionId=session-test' })).json.total, 3)

// 4. HAR export shape.
const har = (await callRoute('/api/dsh-plugin-session-http-log/har', { query: '?sessionId=session-test' })).json
assert.equal(har.log.version, '1.2')
assert.equal(har.log.entries.length, 3)
const entry = har.log.entries[0]
assert.ok(entry.startedDateTime.endsWith('Z'))
assert.equal(typeof entry.request.headers[0].name, 'string')
assert.ok(entry.response.content.mimeType.length > 0)
assert.equal(typeof entry.timings.wait, 'number')

// 5. bad session id rejected.
assert.ok((await callRoute('/api/dsh-plugin-session-http-log/records', { query: '?sessionId=../etc/passwd' })).status >= 400)

// 5b. reveal the persisted-records directory (command overridden to `true` in the test).
const revealed = await callRoute('/api/dsh-plugin-session-http-log/reveal', { method: 'POST' })
assert.equal(revealed.status, 200)
assert.equal(revealed.json.ok, true)
assert.equal(revealed.json.dir, dataDir)

// 6. clear.
const cleared = await callRoute('/api/dsh-plugin-session-http-log/clear', {
  method: 'POST',
  body: { sessionId: 'session-test' },
})
assert.equal(cleared.json.ok, true)
assert.ok(cleared.json.removed >= 3)
assert.equal((await callRoute('/api/dsh-plugin-session-http-log/records', { query: '?sessionId=session-test' })).json.total, 0)

// 7. dispose restores fetch and removes routes.
for (const cleanup of cleanups.splice(0)) cleanup()
assert.equal(globalThis.fetch, originalFetch, 'fetch restored on dispose')
assert.equal(routes.size, 0, 'routes removed on dispose')

// 7b. WSL reveal: convert the Linux data directory to a Windows path and
// launch Windows Explorer, even though process.platform is linux.
const wslRoot = await mkdtemp(join(tmpdir(), 'dsh-plugin-session-http-log-wsl-'))
const fakeBin = join(wslRoot, 'bin')
const wslDataDir = join(wslRoot, 'records')
const revealCapture = join(wslRoot, 'explorer-args.txt')
const windowsDir = String.raw`\\wsl.localhost\Ubuntu\home\go\.dsh\session-http-log`
await mkdir(fakeBin, { recursive: true })
await mkdir(wslDataDir, { recursive: true })
await writeFile(join(wslDataDir, 'session-wsl.jsonl'), '{}\n', 'utf8')
await writeFile(join(wslDataDir, 'session-wsl.jsonl.idx'), '{"id":1}\n', 'utf8')
const fakeWslpath = join(fakeBin, 'wslpath')
const fakeExplorer = join(fakeBin, 'explorer.exe')
await writeFile(fakeWslpath, '#!/bin/sh\nprintf \'%s\\n\' "$DSH_TEST_WINDOWS_DIR"\n', 'utf8')
await writeFile(fakeExplorer, '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$DSH_TEST_REVEAL_CAPTURE"\n', 'utf8')
await chmod(fakeWslpath, 0o755)
await chmod(fakeExplorer, 0o755)
const savedEnv = {
  PATH: process.env.PATH,
  WSL_DISTRO_NAME: process.env.WSL_DISTRO_NAME,
  WSL_INTEROP: process.env.WSL_INTEROP,
  DSH_TEST_WINDOWS_DIR: process.env.DSH_TEST_WINDOWS_DIR,
  DSH_TEST_REVEAL_CAPTURE: process.env.DSH_TEST_REVEAL_CAPTURE,
}
process.env.PATH = `${fakeBin}:${savedEnv.PATH ?? ''}`
process.env.WSL_DISTRO_NAME = 'Ubuntu'
process.env.WSL_INTEROP = '/run/WSL/1_interop'
process.env.DSH_TEST_WINDOWS_DIR = windowsDir
process.env.DSH_TEST_REVEAL_CAPTURE = revealCapture
try {
  apply(fakeCtx, { ...config, persist: false, dataDir: wslDataDir, openDirectoryCommand: '' })
  assert.notEqual(globalThis.fetch, originalFetch, 'fetch wrapper installed for WSL reveal run')
  const wslRevealed = await callRoute('/api/dsh-plugin-session-http-log/reveal', { method: 'POST' })
  assert.equal(wslRevealed.status, 200)
  assert.equal(wslRevealed.json.dir, wslDataDir)
  const openedTarget = await waitFor(async () => {
    try {
      return (await readFile(revealCapture, 'utf8')).trim()
    } catch {
      return ''
    }
  }, 'WSL explorer launch')
  assert.equal(openedTarget, windowsDir, 'WSL reveal passes a Windows path to explorer.exe')
  // With a session id the handler should ask Explorer to select the session log.
  const wslSelected = await callRoute('/api/dsh-plugin-session-http-log/reveal', {
    method: 'POST',
    body: { sessionId: 'session-wsl' },
  })
  assert.equal(wslSelected.status, 200, 'WSL selection reveal responds')
  assert.deepEqual(
    wslSelected.json.selected,
    [join(wslDataDir, 'session-wsl.jsonl')],
    'WSL selection reveal reports the body file (Explorer selects one item)',
  )
  const selectedTarget = await waitFor(async () => {
    try {
      const text = (await readFile(revealCapture, 'utf8')).trim()
      return text.startsWith('/select,') ? text : ''
    } catch {
      return ''
    }
  }, 'WSL explorer file selection')
  assert.equal(selectedTarget, `/select,${windowsDir}`, 'WSL reveal asks explorer.exe to select the session log')
} finally {
  for (const cleanup of cleanups.splice(0)) cleanup()
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await rm(wslRoot, { recursive: true, force: true })
}
assert.equal(globalThis.fetch, originalFetch, 'fetch restored after WSL reveal run')
assert.equal(routes.size, 0, 'routes removed after WSL reveal run')

// 7c. Same-platform selection: macOS reveals (-R) the body and index together.
if (process.platform === 'darwin') {
  const selectRoot = await mkdtemp(join(tmpdir(), 'dsh-plugin-session-http-log-select-'))
  const selectBin = join(selectRoot, 'bin')
  const selectDataDir = join(selectRoot, 'records')
  const openCapture = join(selectRoot, 'open-args.txt')
  const fakeOpen = join(selectBin, 'open')
  await mkdir(selectBin, { recursive: true })
  await mkdir(selectDataDir, { recursive: true })
  const selectBody = join(selectDataDir, 'session-open.jsonl')
  const selectIndex = join(selectDataDir, 'session-open.jsonl.idx')
  await writeFile(selectBody, '{}\n', 'utf8')
  await writeFile(selectIndex, '{"id":1}\n', 'utf8')
  await writeFile(fakeOpen, '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$DSH_TEST_OPEN_CAPTURE"\n', 'utf8')
  await chmod(fakeOpen, 0o755)
  const savedSelectEnv = {
    PATH: process.env.PATH,
    DSH_TEST_OPEN_CAPTURE: process.env.DSH_TEST_OPEN_CAPTURE,
  }
  process.env.PATH = `${selectBin}:${savedSelectEnv.PATH ?? ''}`
  process.env.DSH_TEST_OPEN_CAPTURE = openCapture
  try {
    apply(fakeCtx, { ...config, persist: true, dataDir: selectDataDir, openDirectoryCommand: '', cleanupLogs: false })
    assert.notEqual(globalThis.fetch, originalFetch, 'fetch wrapper installed for macOS selection run')
    const selected = await callRoute('/api/dsh-plugin-session-http-log/reveal', {
      method: 'POST',
      body: { sessionId: 'session-open' },
    })
    assert.equal(selected.status, 200, 'macOS selection reveal responds')
    assert.deepEqual(selected.json.selected, [selectBody], 'selection reveal reports the body file')
    const argv = await waitFor(async () => {
      try {
        const text = (await readFile(openCapture, 'utf8')).trim()
        return text === '' ? null : text.split('\n')
      } catch {
        return null
      }
    }, 'macOS open -R launch')
    assert.equal(argv[0], '-R', 'macOS reveal requests Finder selection')
    assert.deepEqual(argv.slice(1), [selectBody], 'macOS reveal selects the body file (open -R selects one item)')
  } finally {
    for (const cleanup of cleanups.splice(0)) cleanup()
    for (const [key, value] of Object.entries(savedSelectEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(selectRoot, { recursive: true, force: true })
  }
  assert.equal(globalThis.fetch, originalFetch, 'fetch restored after macOS selection run')
  assert.equal(routes.size, 0, 'routes removed after macOS selection run')
}

// 8. byte budget: oldest records are evicted once stored body bytes exceed maxSessionBytes.
apply(fakeCtx, { ...config, maxTurnBytes: 2048, maxRequestsPerTurn: 50 })
assert.notEqual(globalThis.fetch, originalFetch, 'fetch wrapper installed again')
initiator = { id: 'session-evict' }
const payload = 'x'.repeat(512)
for (let index = 0; index < 3; index += 1) {
  await (await globalThis.fetch(`${base}/json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ index, payload }),
  })).text()
}
const evictFeed = await waitFor(async () => {
  const result = await callRoute('/api/dsh-plugin-session-http-log/records', { query: '?sessionId=session-evict' })
  return result.json.records.some((item) => item.id === 3) ? result.json : null
}, 'eviction session captured')
assert.ok(evictFeed.total <= 2, `byte budget evicts oldest records (kept ${evictFeed.total})`)
const ids = evictFeed.records.map((item) => item.id)
assert.equal(ids[ids.length - 1], 3, 'newest record survives eviction')
assert.deepEqual(ids.slice().sort((a, b) => a - b), ids, 'surviving ids stay ordered and monotonic')

for (const cleanup of cleanups.splice(0)) cleanup()
assert.equal(globalThis.fetch, originalFetch, 'fetch restored after eviction run')
assert.equal(routes.size, 0, 'routes removed after eviction run')

// 9. persistence marker: a persist-enabled run explains the data directory.
const markerDir = await mkdtemp(join(tmpdir(), 'dsh-plugin-session-http-log-marker-'))
apply(fakeCtx, { ...config, persist: true, dataDir: markerDir })
assert.notEqual(globalThis.fetch, originalFetch, 'fetch wrapper installed for marker run')
const markerPath = join(markerDir, 'README.txt')
await waitFor(async () => {
  try {
    await access(markerPath)
    return true
  } catch {
    return false
  }
}, 'data-directory marker')
const markerText = await readFile(markerPath, 'utf8')
const markerKeep = join(markerDir, 'keep-me.txt')
await writeFile(markerKeep, 'keep\n', 'utf8')
assert.ok(markerText.includes('@local/dsh-plugin-session-http-log'), 'marker names the plugin')
assert.ok(/uninstall|卸载/i.test(markerText), 'marker explains that uninstalling keeps the data')
await callRoute('/api/dsh-plugin-session-http-log/clear', { method: 'POST', body: { sessionId: 'session-marker' } })
await access(markerPath)
assert.ok(true, 'clearing a session keeps the marker')

// 9b. clear-all removes every session capture file but keeps the directory marker.
knownSessionIds.add('session-marker-other')
initiator = { id: 'session-marker' }
await (await globalThis.fetch(`${base}/json`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{"marker":"main"}',
})).text()
initiator = { id: 'session-marker-other' }
await (await globalThis.fetch(`${base}/json`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{"marker":"other"}',
})).text()
await waitFor(async () => {
  try {
    await access(join(markerDir, 'session-marker.jsonl'))
    await access(join(markerDir, 'session-marker-other.jsonl'))
    return true
  } catch {
    return false
  }
}, 'clear-all fixture files')
const usageBefore = (await callRoute('/api/dsh-plugin-session-http-log/usage')).json
assert.equal(usageBefore.persist, true, 'folder usage reports persistence')
assert.equal(usageBefore.dir, markerDir, 'folder usage reports the data directory')
assert.equal(usageBefore.maxTotalBytes, 512 * 1024 * 1024, 'folder usage reports the global cap')
assert.ok(usageBefore.bytes > 0, 'folder usage sums every session capture file')
assert.ok(usageBefore.files >= 2, `folder usage counts capture files (got ${usageBefore.files})`)
assert.ok(usageBefore.sessions >= 2, `folder usage counts sessions (got ${usageBefore.sessions})`)
const [clearedAll, clearedAllAgain] = await Promise.all([
  callRoute('/api/dsh-plugin-session-http-log/clear-all', { method: 'POST' }),
  callRoute('/api/dsh-plugin-session-http-log/clear-all', { method: 'POST' }),
])
assert.equal(clearedAll.status, 200)
assert.equal(clearedAllAgain.status, 200)
assert.equal(clearedAll.json.ok, true)
assert.equal(clearedAllAgain.json.ok, true)
assert.ok(clearedAll.json.removedSessions >= 2, 'clear-all reports sessions')
assert.ok(clearedAll.json.removedFiles >= 2, 'clear-all reports files')
for (const id of ['session-marker', 'session-marker-other']) {
  try {
    await access(join(markerDir, `${id}.jsonl`))
    assert.fail(`${id} capture file should be deleted by clear-all`)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}
await access(markerPath)
await access(markerKeep)
assert.equal((await callRoute('/api/dsh-plugin-session-http-log/records', { query: '?sessionId=session-marker' })).json.total, 0)
// clear-all empties the aggregate while README.txt and unknown files stay.
const usageAfter = (await callRoute('/api/dsh-plugin-session-http-log/usage')).json
assert.equal(usageAfter.bytes, 0, 'clear-all empties the aggregate disk usage')
assert.equal(usageAfter.files, 0, 'clear-all removes every counted capture file')
assert.equal(usageAfter.sessions, 0, 'clear-all leaves no counted sessions')

for (const cleanup of cleanups.splice(0)) cleanup()
assert.equal(globalThis.fetch, originalFetch, 'fetch restored after marker run')
assert.equal(routes.size, 0, 'routes removed after marker run')
await rm(markerDir, { recursive: true, force: true })

// 9b-2. archiving a session immediately deletes its JSONL body and index,
// while captures belonging to other sessions remain on disk.
const archiveDir = await mkdtemp(join(tmpdir(), 'dsh-plugin-session-http-log-archive-'))
knownSessionIds.add('session-archive-view')
knownSessionIds.add('session-archive-log')
knownSessionIds.add('session-watch-log')
knownSessionIds.add('session-pending-archive')
workspaceRegistry.archivedSessionIds = []
liveSessions.length = 0
apply(fakeCtx, {
  ...config,
  persist: true,
  dataDir: archiveDir,
  retentionMs: 60 * 60 * 1000,
  cleanupLogs: true,
  cleanupIntervalMs: 60 * 60 * 1000,
})
assert.notEqual(globalThis.fetch, originalFetch, 'fetch wrapper installed for archive run')
assert.equal(
  routes.has('/api/dsh-plugin-session-http-log/clear-inactive'),
  false,
  'clear-inactive route was removed',
)
for (const [sessionId, body] of [
  ['session-archive-view', '{"archive":"view"}'],
  ['session-archive-log', '{"archive":"archived"}'],
  ['session-watch-log', '{"archive":"watched"}'],
]) {
  initiator = { id: sessionId }
  await (await globalThis.fetch(`${base}/json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  })).text()
}
await waitFor(async () => {
  try {
    await access(join(archiveDir, 'session-archive-view.jsonl'))
    await access(join(archiveDir, 'session-archive-view.jsonl.idx'))
    await access(join(archiveDir, 'session-archive-log.jsonl'))
    await access(join(archiveDir, 'session-archive-log.jsonl.idx'))
    await access(join(archiveDir, 'session-watch-log.jsonl'))
    await access(join(archiveDir, 'session-watch-log.jsonl.idx'))
    return true
  } catch {
    return false
  }
}, 'archive fixture files')
await workspaceRegistry.archiveSession('session-archive-log')
assert.ok(workspaceRegistry.archivedSessionIds.includes('session-archive-log'), 'session archive recorded')
await waitFor(async () => {
  for (const suffix of ['.jsonl', '.jsonl.idx']) {
    try {
      await access(join(archiveDir, `session-archive-log${suffix}`))
      return false
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  return true
}, 'archived session capture and index removal')
// Simulate an archive path that bypasses the wrapped method: the watcher must
// still discover the new archived id and remove both files.
workspaceRegistry.archivedSessionIds = [...workspaceRegistry.archivedSessionIds, 'session-watch-log']
await waitFor(async () => {
  for (const suffix of ['.jsonl', '.jsonl.idx']) {
    try {
      await access(join(archiveDir, `session-watch-log${suffix}`))
      return false
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  return true
}, 'archive watcher fallback removal', 5000)

// Archive while a response body is still being captured: the first cleanup
// attempt must not lose the retry, otherwise the late persistence recreates
// the files after the archive promise resolves.
initiator = { id: 'session-pending-archive' }
const pendingArchiveResponse = await globalThis.fetch(`${base}/very-slow`)
await workspaceRegistry.archiveSession('session-pending-archive')
await pendingArchiveResponse.text()
await waitFor(async () => {
  for (const suffix of ['.jsonl', '.jsonl.idx']) {
    try {
      await access(join(archiveDir, `session-pending-archive${suffix}`))
      return false
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  return true
}, 'archive cleanup retry after late persistence', 7000)

await access(join(archiveDir, 'session-archive-view.jsonl'))
await access(join(archiveDir, 'session-archive-view.jsonl.idx'))
const usageAfterArchive = (await callRoute('/api/dsh-plugin-session-http-log/usage')).json
assert.ok(usageAfterArchive.bytes > 0, 'the non-archived session capture remains counted')
assert.equal(usageAfterArchive.sessions, 1, 'only the non-archived session remains')
assert.equal('inactiveAvailable' in usageAfterArchive, false, 'usage omits removed inactive fields')

for (const cleanup of cleanups.splice(0)) cleanup()
assert.equal(globalThis.fetch, originalFetch, 'fetch restored after archive run')
assert.equal(routes.size, 0, 'routes removed after archive run')
workspaceRegistry.archivedSessionIds = []
liveSessions.length = 0
await rm(archiveDir, { recursive: true, force: true })

// 9c. cold list reads the lightweight index; detail is loaded lazily by offset.
const lazyDir = await mkdtemp(join(tmpdir(), 'dsh-plugin-session-http-log-lazy-'))
knownSessionIds.add('session-lazy')
workspaceRegistry.archivedSessionIds = []
apply(fakeCtx, {
  ...config,
  persist: true,
  dataDir: lazyDir,
  cleanupLogs: false,
})
assert.notEqual(globalThis.fetch, originalFetch, 'fetch wrapper installed for lazy-index run')
initiator = { id: 'session-lazy' }
for (const body of ['{"lazy":1}', '{"lazy":2}']) {
  await (await globalThis.fetch(`${base}/json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  })).text()
}
const lazyFile = join(lazyDir, 'session-lazy.jsonl')
const lazyIndex = join(lazyDir, 'session-lazy.jsonl.idx')
await waitFor(async () => {
  try {
    const indexText = await readFile(lazyIndex, 'utf8')
    return indexText.trim().split('\n').length === 2 ? true : null
  } catch {
    return null
  }
}, 'lazy index written')
const lazyIndexText = await readFile(lazyIndex, 'utf8')
assert.ok(!lazyIndexText.includes('requestBody'), 'index does not duplicate raw request bodies')
assert.ok(!lazyIndexText.includes('responseBody'), 'index does not duplicate raw response bodies')
const lazyFirstFeed = (await callRoute('/api/dsh-plugin-session-http-log/records', { query: '?sessionId=session-lazy' })).json
const lazyFirstId = lazyFirstFeed.records[0].id
for (const cleanup of cleanups.splice(0)) cleanup()
assert.equal(globalThis.fetch, originalFetch, 'fetch restored after lazy-index capture')
assert.equal(routes.size, 0, 'routes removed after lazy-index capture')

const savedBody = join(lazyDir, 'session-lazy.body.saved')
await rename(lazyFile, savedBody)
apply(fakeCtx, {
  ...config,
  persist: true,
  dataDir: lazyDir,
  cleanupLogs: false,
})
assert.notEqual(globalThis.fetch, originalFetch, 'fetch wrapper installed for cold lazy-index run')
const lazyColdFeed = (await callRoute('/api/dsh-plugin-session-http-log/records', { query: '?sessionId=session-lazy' })).json
assert.equal(lazyColdFeed.total, 2, 'cold list loads summaries without the body file')
assert.deepEqual(lazyColdFeed.records.map((record) => record.id), [lazyFirstId, lazyFirstId + 1])
await rename(savedBody, lazyFile)
const lazyDetail = (await callRoute('/api/dsh-plugin-session-http-log/record', {
  query: `?sessionId=session-lazy&id=${lazyFirstId}`,
})).json.record
assert.equal(lazyDetail.requestBody, '{"lazy":1}', 'detail is read lazily from its indexed byte offset')
for (const cleanup of cleanups.splice(0)) cleanup()
assert.equal(globalThis.fetch, originalFetch, 'fetch restored after cold lazy-index run')
assert.equal(routes.size, 0, 'routes removed after cold lazy-index run')
await rm(lazyDir, { recursive: true, force: true })

// 9d. a legacy JSONL without an index is parsed once, then gets an index.
const legacyDir = await mkdtemp(join(tmpdir(), 'dsh-plugin-session-http-log-legacy-'))
knownSessionIds.add('session-legacy')
workspaceRegistry.archivedSessionIds = []
const legacyRecords = [1, 2].map((id) => ({
  id,
  sessionId: 'session-legacy',
  turn: 1,
  startedAt: Date.now(),
  method: 'POST',
  url: `${base}/json`,
  status: 201,
  statusText: 'Created',
  durationMs: 1,
  completedMs: 2,
  requestBytes: 10,
  responseBytes: 20,
  requestTruncated: false,
  responseTruncated: false,
  kind: 'http',
  model: null,
  error: null,
  requestHeaders: [],
  requestBody: JSON.stringify({ legacy: id }),
  requestBodyEncoding: 'utf8',
  responseHeaders: [],
  responseMimeType: 'application/json',
  responseBody: JSON.stringify({ ok: id }),
  responseBodyEncoding: 'utf8',
  completedAt: Date.now(),
}))
await writeFile(
  join(legacyDir, 'session-legacy.jsonl'),
  legacyRecords.map((record) => JSON.stringify(record)).join('\n') + '\n',
  'utf8',
)
apply(fakeCtx, {
  ...config,
  persist: true,
  dataDir: legacyDir,
  cleanupLogs: false,
})
assert.notEqual(globalThis.fetch, originalFetch, 'fetch wrapper installed for legacy-index run')
const legacyFeed = (await callRoute('/api/dsh-plugin-session-http-log/records', { query: '?sessionId=session-legacy' })).json
assert.equal(legacyFeed.total, 2, 'legacy JSONL is readable')
const legacyIndexPath = join(legacyDir, 'session-legacy.jsonl.idx')
await access(legacyIndexPath)
const legacyDetail = (await callRoute('/api/dsh-plugin-session-http-log/record', {
  query: '?sessionId=session-legacy&id=2',
})).json.record
assert.equal(legacyDetail.requestBody, '{"legacy":2}', 'legacy detail is served by indexed offset')
for (const cleanup of cleanups.splice(0)) cleanup()
assert.equal(globalThis.fetch, originalFetch, 'fetch restored after legacy-index run')
assert.equal(routes.size, 0, 'routes removed after legacy-index run')
await rm(legacyDir, { recursive: true, force: true })

// 10. maxLogFileBytes rotates only the oversized session file, retaining a
// recent tail instead of discarding every prior in-memory record.
const trimDir = await mkdtemp(join(tmpdir(), 'dsh-plugin-session-http-log-trim-'))
knownSessionIds.add('session-trim')
workspaceRegistry.archivedSessionIds = []
const trimPath = join(trimDir, 'session-trim.jsonl')
const sentinel = 'old-log-sentinel-' + 'x'.repeat(16384)
await writeFile(trimPath, sentinel + '\n', 'utf8')
apply(fakeCtx, {
  ...config,
  persist: true,
  dataDir: trimDir,
  maxLogFileBytes: 8192,
  orphanSweepIntervalMs: 60_000,
})
assert.notEqual(globalThis.fetch, originalFetch, 'fetch wrapper installed for trim run')
initiator = { id: 'session-trim' }
for (let index = 0; index < 12; index += 1) {
  await (await globalThis.fetch(`${base}/json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ q: `trim-${index}` }),
  })).text()
}
const trimmedText = await waitFor(async () => {
  try {
    const text = await readFile(trimPath, 'utf8')
    return text.includes('trim-11') && !text.includes('old-log-sentinel-') ? text : null
  } catch {
    return null
  }
}, 'per-session log rotation')
assert.ok(Buffer.byteLength(trimmedText, 'utf8') < Buffer.byteLength(sentinel, 'utf8'), 'old oversized file was replaced')
const retainedLines = trimmedText.trim().split('\n').map((line) => JSON.parse(line))
assert.ok(retainedLines.length >= 2, `rotation keeps a recent tail (kept ${retainedLines.length})`)
assert.ok(retainedLines.some((line) => JSON.stringify(line).includes('trim-10')), 'rotation keeps a pre-rotation record')
const retainedIds = retainedLines.map((line) => line.id)
assert.deepEqual(retainedIds.slice().sort((a, b) => a - b), retainedIds, 'retained log ids stay ordered')

// 10b. 轮转必须同时收窄内存计数：否则面板上的“占用”会贴着每轮上限，而磁盘
// 已经被轮转削小，看上去像“占用比全部还大”。一条大报文就到单轮文件上限，
// 因此轮转后内存里只应剩下刚重写进去的那一两条记录。
const ROTATED_MEMORY_LIMIT = 400 * 1024
for (let index = 0; index < 6; index += 1) {
  await (await globalThis.fetch(`${base}/blob`)).text()
}
const syncedFeed = await waitFor(async () => {
  const feed = (await callRoute('/api/dsh-plugin-session-http-log/records', {
    query: '?sessionId=session-trim',
  })).json
  const settled = feed.records.every((record) => record.completedMs != null)
  return settled && feed.totalBytes < ROTATED_MEMORY_LIMIT ? feed : null
}, 'rotation to trim in-memory accounting')
assert.ok(
  syncedFeed.totalBytes < ROTATED_MEMORY_LIMIT,
  `rotated session keeps only the retained tail in memory (got ${syncedFeed.totalBytes})`,
)
// 等待排队中的落盘结束，避免 rm 与追加写竞争。
await Promise.allSettled(cleanups.splice(0).map((cleanup) => cleanup()))
assert.equal(globalThis.fetch, originalFetch, 'fetch restored after trim run')
assert.equal(routes.size, 0, 'routes removed after trim run')
await rm(trimDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })

// 11. latest-turn retention clears the previous turn on turn/start.
const turnDir = await mkdtemp(join(tmpdir(), 'dsh-plugin-session-http-log-turn-'))
knownSessionIds.add('session-turn')
workspaceRegistry.archivedSessionIds = []
apply(fakeCtx, {
  ...config,
  persist: true,
  dataDir: turnDir,
  cleanupLogs: false,
})
assert.notEqual(globalThis.fetch, originalFetch, 'fetch wrapper installed for turn run')
initiator = { id: 'session-turn' }
await (await globalThis.fetch(`${base}/json`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{"turn":"first"}',
})).text()
await waitFor(async () => {
  const result = await callRoute('/api/dsh-plugin-session-http-log/records', { query: '?sessionId=session-turn' })
  return result.json.records.length === 1
}, 'first turn captured')
emitSessionEvent({ id: 'session-turn' }, { type: 'turn/start', data: { turn: 2 } })
await waitFor(async () => {
  const result = await callRoute('/api/dsh-plugin-session-http-log/records', { query: '?sessionId=session-turn' })
  return result.json.total === 0
}, 'previous turn cleared from memory')
await (await globalThis.fetch(`${base}/json`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{"turn":"second"}',
})).text()
const turnFeed = await waitFor(async () => {
  const result = await callRoute('/api/dsh-plugin-session-http-log/records', { query: '?sessionId=session-turn' })
  return result.json.total === 1 ? result.json : null
}, 'second turn captured')
assert.equal(turnFeed.records[0].status, 201)
const turnFile = join(turnDir, 'session-turn.jsonl')
const turnText = await waitFor(async () => {
  const text = await readFile(turnFile, 'utf8')
  return text.includes('second') ? text : null
}, 'second turn persisted')
assert.ok(!turnText.includes('first'), 'previous turn is not present in the rewritten file')

// A response still streaming when the next turn starts must not reappear.
const staleResponse = globalThis.fetch(`${base}/slow`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{"turn":"stale"}',
})
await sleep(20)
emitSessionEvent({ id: 'session-turn' }, { type: 'turn/start', data: { turn: 3 } })
assert.equal(await (await staleResponse).text(), '{"slow":true}')
await sleep(120)
const staleFeed = (await callRoute('/api/dsh-plugin-session-http-log/records', { query: '?sessionId=session-turn' })).json
assert.equal(staleFeed.total, 0, 'in-flight capture from the previous turn is discarded')
await waitFor(async () => {
  const text = await readFile(turnFile, 'utf8')
  return text === '' ? true : null
}, 'turn reset truncates persisted file')
for (const cleanup of cleanups.splice(0)) cleanup()
assert.equal(globalThis.fetch, originalFetch, 'fetch restored after turn run')
assert.equal(routes.size, 0, 'routes removed after turn run')
await rm(turnDir, { recursive: true, force: true })

// 12. hourly cleanup removes expired files, keeps fresh files, and enforces the global cap.
const ttlDir = await mkdtemp(join(tmpdir(), 'dsh-plugin-session-http-log-ttl-'))
knownSessionIds = new Set(['session-fresh', 'session-expired', 'session-newer', 'session-older'])
workspaceRegistry.archivedSessionIds = []
const ttlExpired = join(ttlDir, 'session-expired.jsonl')
const ttlFresh = join(ttlDir, 'session-fresh.jsonl')
await writeFile(ttlExpired, '{}\n', 'utf8')
await writeFile(ttlFresh, '{}\n', 'utf8')
await writeFile(`${ttlFresh}.idx`, '{"id":1}\n', 'utf8')
// Orphan index without a body must be reclaimed; a paired index must survive.
await writeFile(join(ttlDir, 'session-orphan.jsonl.idx'), '{"id":1}\n', 'utf8')
const oldMtime = new Date(Date.now() - 60 * 60 * 1000)
const freshAtime = new Date()
await utimes(ttlExpired, freshAtime, oldMtime)
apply(fakeCtx, {
  ...config,
  persist: true,
  dataDir: ttlDir,
  retentionMs: 1000,
  cleanupLogs: true,
  cleanupIntervalMs: 25,
  maxTotalBytes: 0,
})
await waitFor(async () => {
  try {
    await access(ttlExpired)
    return false
  } catch {
    return true
  }
}, 'expired capture cleanup')
await access(ttlFresh)
await access(`${ttlFresh}.idx`)
try {
  await access(join(ttlDir, 'session-orphan.jsonl.idx'))
  assert.fail('orphan index without a body should be removed by cleanup')
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}
for (const cleanup of cleanups.splice(0)) cleanup()
assert.equal(globalThis.fetch, originalFetch, 'fetch restored after TTL run')
assert.equal(routes.size, 0, 'routes removed after TTL run')
await rm(ttlDir, { recursive: true, force: true })

const quotaDir = await mkdtemp(join(tmpdir(), 'dsh-plugin-session-http-log-quota-'))
knownSessionIds = new Set(['session-older', 'session-newer'])
workspaceRegistry.archivedSessionIds = []
const quotaOlder = join(quotaDir, 'session-older.jsonl')
const quotaNewer = join(quotaDir, 'session-newer.jsonl')
await writeFile(quotaOlder, 'x'.repeat(64) + '\n', 'utf8')
await writeFile(quotaNewer, 'y'.repeat(64) + '\n', 'utf8')
const oldQuota = new Date(Date.now() - 60 * 1000)
const newQuota = new Date(Date.now() - 30 * 1000)
await utimes(quotaOlder, oldQuota, oldQuota)
await utimes(quotaNewer, newQuota, newQuota)
apply(fakeCtx, {
  ...config,
  persist: true,
  dataDir: quotaDir,
  retentionMs: 60 * 60 * 1000,
  cleanupLogs: true,
  cleanupIntervalMs: 25,
  maxTotalBytes: 80,
})
await waitFor(async () => {
  try {
    await access(quotaOlder)
    return false
  } catch {
    return true
  }
}, 'global quota eviction')
await access(quotaNewer)
for (const cleanup of cleanups.splice(0)) cleanup()
assert.equal(globalThis.fetch, originalFetch, 'fetch restored after quota run')
assert.equal(routes.size, 0, 'routes removed after quota run')
await rm(quotaDir, { recursive: true, force: true })

// 13. orphan sweep removes unknown + archived session files, keeps valid ones.
const orphanDir = await mkdtemp(join(tmpdir(), 'dsh-plugin-session-http-log-orphan-'))
knownSessionIds = new Set(['session-keep', 'session-archived', 'session-team-child'])
sessionParents = new Map([['session-team-child', 'session-archived']])
workspaceRegistry.archivedSessionIds = ['session-archived']
for (const id of ['session-keep', 'session-archived', 'session-team-child', 'session-orphan', 'unattributed']) {
  await writeFile(join(orphanDir, `${id}.jsonl`), '{}\n', 'utf8')
}
apply(fakeCtx, {
  ...config,
  persist: true,
  dataDir: orphanDir,
  cleanupOrphans: true,
  orphanSweepIntervalMs: 25,
})
await waitFor(async () => {
  const missing = []
  for (const id of ['session-archived', 'session-team-child', 'session-orphan']) {
    try {
      await access(join(orphanDir, `${id}.jsonl`))
    } catch {
      missing.push(id)
    }
  }
  return missing.length === 3
}, 'orphan sweep')
await access(join(orphanDir, 'session-keep.jsonl'))
await access(join(orphanDir, 'unattributed.jsonl'))
assert.ok(true, 'orphan sweep keeps valid and unattributed capture files')
for (const cleanup of cleanups.splice(0)) cleanup()
assert.equal(globalThis.fetch, originalFetch, 'fetch restored after orphan run')
assert.equal(routes.size, 0, 'routes removed after orphan run')
await rm(orphanDir, { recursive: true, force: true })

server.close()
await once(server, 'close')
await rm(dataDir, { recursive: true, force: true })
console.log('PASS dsh-plugin-session-http-log host smoke test (capture, routes, redaction, HAR, totals, reveal, clear, eviction, latest-turn, lazy-index, ETag, TTL, quota, clear-all, rotation, archive cleanup, orphan cleanup, dispose)')
