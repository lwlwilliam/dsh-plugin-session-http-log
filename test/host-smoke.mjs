/**
 * Lead-owned Host smoke test for the dsh-plugin-session-http-log bundle.
 *
 * Runs the real `index.js` plugin against a fake Cordis context and a local
 * node:http server, then asserts the raw-capture behavior and the four
 * authenticated routes from CONTRACT.md.
 *
 *   node test/host-smoke.mjs
 *
 * No Harness package is imported; this test owns its fake context only.
 */
import { createServer } from 'node:http'
import { once } from 'node:events'
import { strict as assert } from 'node:assert'
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const { apply } = await import(new URL('../index.js', import.meta.url).href)

const originalFetch = globalThis.fetch
let initiator = { id: 'session-test' }
const routes = new Map()
const cleanups = []
const warnings = []
let knownSessionIds = new Set(['session-test', 'session-evict', 'session-marker'])
let sessionParents = new Map()
const workspaceRegistry = { archivedSessionIds: [] }

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
    if (name === 'sessions') return { list: () => [] }
    return undefined
  },
  connection: connectionFace,
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
  res.writeHead(404).end()
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const base = `http://127.0.0.1:${server.address().port}`

// ── install the plugin under test ───────────────────────────────────────────
apply(fakeCtx, config)
assert.notEqual(globalThis.fetch, originalFetch, 'fetch wrapper installed')
assert.equal(routes.size, 5, `expected 5 routes, got ${[...routes.keys()].join(', ')}`)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const route = (path) => {
  const entry = routes.get(path) ?? routes.get(`/api${path}`)
  assert.ok(entry, `route ${path} registered`)
  return entry
}
const callRoute = async (path, { method = 'GET', query = '', body } = {}) => {
  const entry = route(path)
  const url = `${base}${entry.path}${query}`
  const request = new Request(url, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  })
  const response = await entry.fetch(request)
  return { status: response.status, headers: response.headers, json: await response.json() }
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

const feed = (await callRoute('/api/dsh-plugin-session-http-log/records', { query: '?sessionId=session-test' })).json
assert.ok(feed.totalBytes > 0, 'session total stored bytes reported')
assert.equal(feed.fileBytes, null, 'no persisted file size when persistence is off')
assert.equal(feed.dir, dataDir, 'data directory reported')
assert.equal(feed.persist, false, 'persistence flag reported')
assert.equal(feed.maxLogFileBytes, 8 * 1024 * 1024, 'per-session disk cap reported')

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

// 8. byte budget: oldest records are evicted once stored body bytes exceed maxSessionBytes.
apply(fakeCtx, { ...config, maxSessionBytes: 2048, maxRequestsPerSession: 50 })
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
assert.ok(markerText.includes('@local/dsh-plugin-session-http-log'), 'marker names the plugin')
assert.ok(/uninstall|卸载/i.test(markerText), 'marker explains that uninstalling keeps the data')
await callRoute('/api/dsh-plugin-session-http-log/clear', { method: 'POST', body: { sessionId: 'session-marker' } })
await access(markerPath)
assert.ok(true, 'clearing a session keeps the marker')

for (const cleanup of cleanups.splice(0)) cleanup()
assert.equal(globalThis.fetch, originalFetch, 'fetch restored after marker run')
assert.equal(routes.size, 0, 'routes removed after marker run')
await rm(markerDir, { recursive: true, force: true })

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
for (const cleanup of cleanups.splice(0)) cleanup()
assert.equal(globalThis.fetch, originalFetch, 'fetch restored after trim run')
assert.equal(routes.size, 0, 'routes removed after trim run')
await rm(trimDir, { recursive: true, force: true })

// 11. orphan sweep removes unknown + archived session files, keeps valid ones.
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
console.log('PASS dsh-plugin-session-http-log host smoke test (capture, routes, redaction, HAR, totals, reveal, clear, eviction, rotation, orphan cleanup, dispose)')
