/* Browser end-to-end verification for the dsh-live2d v2 features:
 *   1. default model is Mao, widget anchored bottom-RIGHT
 *   2. load progress bar exists and becomes visible while loading
 *   3. the Live2D settings section lets the user change the model URL,
 *      persists it, and the widget reloads with the new model
 *
 * Requires headless Chrome on $DEBUG_PORT and the DSH web profile (with
 * dsh-live2d installed) running at $PAGE_URL.
 */
const DEBUG_PORT = Number(process.env.DEBUG_PORT ?? 9224)
const PAGE_URL = process.env.PAGE_URL ?? 'http://127.0.0.1:3090/'
const TEST_MODEL = process.env.TEST_MODEL ?? 'https://model.hacxy.cn/shizuku/shizuku.model.json'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const tab = await (await fetch(
  `http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent(PAGE_URL)}`,
  { method: 'PUT' },
)).json()

const ws = new WebSocket(tab.webSocketDebuggerUrl)
let nextId = 0
const pending = new Map()
const events = []
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(String(event.data))
  if (msg.id !== undefined) {
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    if (msg.error) p.reject(new Error(`${msg.error.message} (${msg.error.code})`))
    else p.resolve(msg.result)
  } else {
    events.push(msg)
  }
})
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve)
  ws.addEventListener('error', reject)
})
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId
  pending.set(id, { resolve, reject })
  ws.send(JSON.stringify({ id, method, params }))
})
const evaluate = async (expression) => {
  const { result, exceptionDetails } = await send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true,
  })
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
  return result.value
}
const poll = async (expression, tries, ms, label) => {
  for (let i = 0; i < tries; i += 1) {
    try {
      const value = await evaluate(expression)
      if (value) return value
    } catch { /* keep polling */ }
    await sleep(ms)
  }
  throw new Error(`timeout waiting for ${label}`)
}

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await send('Emulation.setFocusEmulationEnabled', { enabled: true })
await send('Page.bringToFront')

const report = {}

// 1. widget at bottom-right with the Mao default
await poll(`document.querySelector('#dsh-live2d-widget canvas') !== null`, 90, 300, 'widget mount')
report.widget = await evaluate(`(() => {
  const w = document.querySelector('#dsh-live2d-widget')
  const c = w.querySelector('canvas')
  const s = getComputedStyle(w)
  return {
    position: [s.position, s.left, s.right, s.bottom, s.zIndex],
    canvasAttr: [c.width, c.height],
    hasProgressOverlay: w.children.length >= 2 && w.lastElementChild?.tagName === 'DIV',
  }
})()`)

// 2. progress bar: reload and catch the overlay while the model loads
await send('Page.reload', { ignoreCache: true })
await poll(`document.querySelector('#dsh-live2d-widget canvas') !== null`, 90, 300, 'widget re-mount after reload')
let sawProgress = false
for (let i = 0; i < 40; i += 1) {
  const state = await evaluate(`(() => {
    const w = document.querySelector('#dsh-live2d-widget')
    const overlay = w?.lastElementChild
    return overlay ? { opacity: getComputedStyle(overlay).opacity, barWidth: overlay.firstElementChild?.firstElementChild?.style.width } : null
  })()`)
  if (state && Number(state.opacity) > 0) {
    sawProgress = true
    report.progressDuringLoad = state
    break
  }
  await sleep(100)
}
report.progressVisibleDuringLoad = sawProgress

// 3. open settings → Live2D section → change model URL → save → widget reloads
// (the settings entry lives in the sidebar, which starts collapsed)
await evaluate(`[...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '打开侧边栏')?.click()`)
await sleep(500)
await evaluate(`(() => {
  const label = [...document.querySelectorAll('span')].find((s) => (s.textContent ?? '').trim() === '设置')
  const btn = label?.closest('button')
  if (btn) btn.click()
  return btn !== undefined
})()`)
await poll(`[...document.querySelectorAll('button')].some((b) => (b.textContent ?? '').trim() === 'Live2D')`, 40, 200, 'settings modal with Live2D nav')
await evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Live2D')
  btn.click()
})()`)
await poll(`document.querySelector('#dsh-live2d-model-url') !== null`, 40, 200, 'Live2D settings panel')
report.settingsPanel = await evaluate(`(() => {
  const input = document.querySelector('#dsh-live2d-model-url')
  return {
    inputPresent: input !== null,
    currentValue: input?.value,
    defaultButton: [...document.querySelectorAll('button')].some((b) => (b.textContent ?? '').trim() === '恢复默认'),
    saveButton: [...document.querySelectorAll('button')].some((b) => (b.textContent ?? '').trim() === '保存'),
  }
})()`)

// capture the current canvas identity so we can prove the widget re-mounted
const canvasBefore = await evaluate(`(() => {
  const c = document.querySelector('#dsh-live2d-widget canvas')
  const marker = Math.random().toString(36).slice(2)
  c.dataset.probe = marker
  return marker
})()`)

await evaluate(`(() => {
  const input = document.querySelector('#dsh-live2d-model-url')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(input, ${JSON.stringify(TEST_MODEL)})
  input.dispatchEvent(new Event('input', { bubbles: true }))
  const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === '保存')
  btn.click()
})()`)

await poll(`(document.querySelector('#dsh-live2d-model-url')?.value ?? '') === ${JSON.stringify(TEST_MODEL)} && ![...document.querySelectorAll('button')].some((b) => (b.textContent ?? '').trim() === '保存中…')`, 40, 300, 'save to complete')
await sleep(2000)
report.afterSave = await evaluate(`(() => {
  const input = document.querySelector('#dsh-live2d-model-url')
  const canvas = document.querySelector('#dsh-live2d-widget canvas')
  return {
    inputValue: input?.value,
    widgetReMounted: canvas?.dataset.probe !== ${JSON.stringify('__PROBE__')},
    statusTexts: [...document.querySelectorAll('p')].map((p) => p.textContent).filter((t) => t?.includes('已保存') || t?.includes('生效') || t?.includes('加载')),
  }
})()`)
// fix the probe comparison (dataset cleared on re-mount → undefined !== marker)
report.afterSave.widgetReMounted = await evaluate(`document.querySelector('#dsh-live2d-widget canvas')?.dataset.probe === undefined || document.querySelector('#dsh-live2d-widget canvas')?.dataset.probe !== ${JSON.stringify(canvasBefore)}`)

// 4. width (layout field): save → widget updates in place, no model reload
await evaluate(`(() => {
  const input = document.querySelector('#dsh-live2d-width')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(input, '200')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === '保存')
  btn.click()
})()`)
await poll(`document.querySelector('#dsh-live2d-width')?.value === '200' && ![...document.querySelectorAll('button')].some((b) => (b.textContent ?? '').trim() === '保存中…')`, 40, 300, 'width save to complete')
await sleep(800)
report.afterWidth = await evaluate(`(() => {
  const w = document.querySelector('#dsh-live2d-widget')
  return { widthStyle: w?.style.width ?? null }
})()`)

// 5. anchor (layout field): right → left
await evaluate(`(() => {
  const sel = document.querySelector('#dsh-live2d-anchor')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
  setter.call(sel, 'left')
  sel.dispatchEvent(new Event('change', { bubbles: true }))
  const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === '保存')
  btn.click()
})()`)
await poll(`document.querySelector('#dsh-live2d-anchor')?.value === 'left' && ![...document.querySelectorAll('button')].some((b) => (b.textContent ?? '').trim() === '保存中…')`, 40, 300, 'anchor save to complete')
await sleep(800)
report.afterAnchor = await evaluate(`(() => {
  const w = document.querySelector('#dsh-live2d-widget')
  const s = w ? getComputedStyle(w) : null
  return s ? { left: s.left, right: s.right } : null
})()`)

// 6. enabled off → widget unmounts (panel stays reachable)
// (checkbox: React's onChange rides the native click, not a synthetic change)
await evaluate(`(() => {
  const input = document.querySelector('#dsh-live2d-enabled')
  if (!input.checked) input.click()
  input.click()
  const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === '保存')
  btn.click()
})()`)
await poll(`document.querySelector('#dsh-live2d-widget') === null && ![...document.querySelectorAll('button')].some((b) => (b.textContent ?? '').trim() === '保存中…')`, 40, 300, 'disable save to complete')
report.widgetHiddenWhenDisabled = await evaluate(`document.querySelector('#dsh-live2d-widget') === null`)

// 7. reset → user overrides cleared → widget returns with deployment defaults
await evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === '恢复默认')
  if (btn) btn.click()
  return btn !== undefined
})()`)
await poll(`document.querySelector('#dsh-live2d-widget') !== null && ![...document.querySelectorAll('button')].some((b) => (b.textContent ?? '').trim() === '保存中…')`, 60, 300, 'reset to re-mount widget')
report.afterReset = await evaluate(`(() => {
  const w = document.querySelector('#dsh-live2d-widget')
  return {
    widgetBack: w !== null,
    widthValue: document.querySelector('#dsh-live2d-width')?.value ?? null,
    anchorValue: document.querySelector('#dsh-live2d-anchor')?.value ?? null,
    modelUrlValue: document.querySelector('#dsh-live2d-model-url')?.value ?? null,
  }
})()`)
report.resetRestoredWidget = report.widgetHiddenWhenDisabled === true && report.afterReset.widgetBack === true

const errors = events
  .filter((e) => e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')
  .map((e) => e.params.args.map((a) => a.value ?? a.description ?? '').join(' '))
  .slice(0, 6)

report.consoleErrors = errors
console.log(JSON.stringify(report, null, 2))

ws.close()
await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/close/${tab.id}`).catch(() => {})
process.exit(0)
