/**
 * Lead-owned Client smoke test for the session-http-log bundle.
 *
 * Loads the real `client.js` bundle factory in Node against a tiny React stub
 * and a fake Client context, then asserts the tab/pane registration and that
 * the view renders for an empty and a live Session. This catches runtime
 * mistakes that `node --check` cannot; it is not a browser/visual check.
 *
 *   node test/client-smoke.mjs
 */
import { strict as assert } from 'node:assert'

const react = {
  Fragment: Symbol.for('react.fragment'),
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children }
  },
  useState(initial) {
    const value = typeof initial === 'function' ? initial() : initial
    return [value, () => {}]
  },
  useEffect() {},
  useMemo(factory) {
    return factory()
  },
  useRef(initial) {
    return { current: initial }
  },
}

const timers = []
const windowStub = {
  location: { href: 'http://127.0.0.1:3080/' },
  setTimeout: (...args) => {
    const id = setTimeout(...args)
    timers.push(id)
    return id
  },
  clearTimeout: (id) => clearTimeout(id),
  setInterval: (...args) => {
    const id = setInterval(...args)
    timers.push(id)
    return id
  },
  clearInterval: (id) => clearInterval(id),
}
let loadedId = null
let plugin = null
windowStub.__ModuleLoader__ = {
  load({ id, factory }) {
    loadedId = id
    plugin = factory((name) => {
      if (name === 'react') return react
      throw new Error(`client.js required an unexpected module: ${name}`)
    })
  },
}
globalThis.window = windowStub
// `fetch` is only reached from mounted effects; this test never runs them.
globalThis.fetch = async () => {
  throw new Error('client smoke test: unexpected network access')
}

await import(new URL('../client.js', import.meta.url).href)

assert.equal(loadedId, '@local/session-http-log', 'module-loader id')
assert.ok(plugin !== null && typeof plugin.apply === 'function', 'factory returns a plugin')
assert.deepEqual(plugin.inject, ['slots', 'locale', 'sidebarRightTabs'], 'service dependencies')

// ── fake Client context ─────────────────────────────────────────────────────
const locales = []
const tabs = []
const slots = []
const slotInjects = []
const cleanups = []
const dictionaries = new Map()

const fanout = (key) => (params) =>
  String(key).replace(/\{([a-zA-Z0-9_]+)\}/g, (whole, name) =>
    params != null && Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
  )

const ctx = {
  effect(callback) {
    const cleanup = callback()
    if (typeof cleanup === 'function') cleanups.push(cleanup)
    return () => {}
  },
  locale: {
    register(namespace, dicts) {
      dictionaries.set(namespace, dicts)
      locales.push({ namespace, dicts })
      return () => {}
    },
    bind(namespace) {
      return (key) => `${namespace}:${key}`
    },
  },
  sidebarRightTabs: {
    register(definition) {
      tabs.push(definition)
      return () => {}
    },
  },
  slots: {
    inject(name, callback) {
      slotInjects.push(name)
      callback()
      return () => {}
    },
    register(options, component) {
      slots.push({ options, component })
      return () => {}
    },
  },
}

plugin.apply(ctx)
const t = fanout('session-http-log')

// ── registration assertions ─────────────────────────────────────────────────
assert.equal(locales.length, 1, 'one locale namespace registered')
assert.equal(locales[0].namespace, 'session-http-log')
assert.equal(typeof locales[0].dicts.en, 'object')
assert.equal(typeof locales[0].dicts.zh, 'object')
const enKeys = Object.keys(locales[0].dicts.en)
const zhKeys = Object.keys(locales[0].dicts.zh)
assert.ok(enKeys.length > 40, `expected a real dictionary, got ${enKeys.length} keys`)
assert.deepEqual(zhKeys.sort(), enKeys.sort(), 'zh dictionary is complete')

assert.equal(tabs.length, 1, 'one right-Sidebar tab type registered')
const tab = tabs[0]
assert.equal(tab.id, '@local/session-http-log')
assert.equal(tab.kind, 'session-http-log')
assert.equal(tab.keepMounted, true)
assert.equal(typeof tab.title, 'function')
assert.equal(tab.guide.length, 1)
assert.equal(typeof tab.guide[0].title, 'function')
assert.equal(typeof tab.guide[0].description, 'function')
assert.ok(tab.guide[0].description().length > 0)

assert.deepEqual(slotInjects.slice().sort(), ['conversation.view', 'sidebar.right.pane.tab'], 'both entry points injected')
assert.equal(slots.length, 2, 'right-Sidebar body and main-view tab registered')
const slot = slots.find((entry) => entry.options.name === 'sidebar.right.pane.tab')
assert.ok(slot, 'right-Sidebar pane body registered')
assert.equal(slot.options.key, '@local/session-http-log', 'slot key equals the tab type id')
assert.equal(slot.options.locale, 'session-http-log')
assert.equal(typeof slot.options.inject, 'function')
assert.deepEqual(slot.options.inject({ sessionId: 'session-abc' }), { sessionId: 'session-abc' })

const view = slots.find((entry) => entry.options.name === 'conversation.view')
assert.ok(view, 'main conversation-view tab registered')
assert.equal(view.options.id, 'session-http-log')
assert.equal(view.options.order, 50)
assert.equal(typeof view.options.label, 'function')
assert.equal(view.options.label(), 'session-http-log:view.tab')
const mainProps = view.options.inject({ sessionId: 'session-abc' })
assert.deepEqual(mainProps.sessionId, 'session-abc')
assert.equal(mainProps.variant, 'page')
const mainTree = view.component({ ...mainProps, t })
assert.ok(mainTree != null && typeof mainTree === 'object', 'main view renders')
const mainPanel = typeof mainTree.type === 'function' ? mainTree.type({ ...mainTree.props }) : mainTree
assert.ok(mainPanel != null && typeof mainPanel === 'object', 'main view body renders')

// ── render assertions (React stub: trees are plain descriptors) ─────────────
const View = slot.component

const noSessionTree = View({ sessionId: '', t })
assert.ok(noSessionTree != null && typeof noSessionTree === 'object', 'renders without a Session')

const liveTree = View({ sessionId: 'session-abc', t })
assert.ok(liveTree != null && typeof liveTree === 'object', 'renders for a live Session')
const panelTree = liveTree.type({ ...liveTree.props })
assert.equal(panelTree.type, 'div')
assert.equal(panelTree.props.className, 'shl-root')
const styleNode = panelTree.children.find((child) => child != null && child.type === 'style')
assert.ok(styleNode != null, 'injects a <style> element in the view root')
const css = String(styleNode.children.join(''))
assert.ok(css.includes('--dsw-alias-'), 'stylesheet uses theme tokens')
assert.ok(!/var\(--(?!dsw-alias-)/.test(css), 'no non-theme CSS variables')
assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(css), 'no literal hex colors in the stylesheet')

for (const cleanup of cleanups.splice(0)) cleanup()
for (const timer of timers.splice(0)) clearTimeout(timer)
console.log('PASS session-http-log client smoke test (registration, dictionaries, view render, theme tokens)')
