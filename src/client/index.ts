/**
 * dsh-live2d browser half: mounts the Live2D widget at the bottom corner of
 * the DSH web page, shows a load progress bar, and contributes a Live2D
 * section to Web settings for picking the model URL.
 *
 * Contract notes:
 * - The bundle is a `window.__ModuleLoader__.load({ id, factory })` artifact;
 *   `apply(ctx)` runs in the browser cordis root.
 * - Static client plugins receive no entry config, so the composed config is
 *   fetched from the host route registered by the Node half; on any failure
 *   the widget still mounts with {@link DEFAULT_CONFIG}.
 * - `l2d` and the settings panel are inlined into this bundle at build time;
 *   `react` / `react/jsx-runtime` / `@deepseek-ai/dsh-client-ui-primitives`
 *   resolve from the shell's module table (see tsdown.config.ts).
 * - After the settings panel saves a new model URL, the host persists it into
 *   the profile patch layer and HMR reloads the row; the panel polls GET until
 *   the served config matches, then notifies this module's listeners so the
 *   widget reloads with the new model.
 *
 * @module dsh-live2d/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the slots Context merge (ctx.slots) through the runtime's client assembly.
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the SlotMap merge declaring `settings.section` (ui-settings' contract).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { init, type L2D } from 'l2d'
import type { Live2dConfig } from '../shared/config.ts'
import { DEFAULT_CONFIG } from '../shared/config.ts'
import { subscribeConfigChange } from './config-events.ts'
import { Live2dPanel } from './Panel.tsx'

/** Client plugin name (visible in the browser loader entry). */
export const name = 'dsh-live2d-client'

/** Required services: the slot registry (settings section) — the widget is pure DOM. */
export const inject = ['slots']

/** Config route spelled by the Node half. */
const CONFIG_ROUTE = '/api/dsh-live2d/config'

/** Widget container id, stable for debugging and user CSS. */
const CONTAINER_ID = 'dsh-live2d-widget'

/** How far the pointer must move before a press becomes a drag. */
const DRAG_THRESHOLD_PX = 4

/** Fetch the composed config from the host; falls back to defaults. */
async function fetchConfig(): Promise<Live2dConfig> {
  try {
    const response = await fetch(CONFIG_ROUTE, { cache: 'no-store' })
    if (!response.ok) return DEFAULT_CONFIG
    const payload = await response.json() as { ok?: boolean; config?: Partial<Live2dConfig> }
    if (payload.ok !== true || payload.config === undefined) return DEFAULT_CONFIG
    return { ...DEFAULT_CONFIG, ...payload.config }
  } catch (error) {
    console.warn('[dsh-live2d] config fetch failed, using defaults:', error)
    return DEFAULT_CONFIG
  }
}

/* ---------------- widget ---------------------------------------------------- */

/** Apply inline positioning for the anchored corner. */
function positionContainer(container: HTMLDivElement, config: Live2dConfig, x: number | null, y: number | null): void {
  if (config.anchor === 'right') container.style.right = `${x ?? config.offsetX}px`
  else container.style.left = `${x ?? config.offsetX}px`
  container.style.bottom = `${y ?? config.offsetY}px`
}

/** After a drag the widget sticks to the pointer's spot (left-anchored). */
function stickContainer(container: HTMLDivElement, left: number, bottom: number): void {
  container.style.left = `${left}px`
  container.style.bottom = `${Math.max(0, bottom)}px`
  container.style.right = 'auto'
}

/**
 * Pointer-based drag: the widget keeps its anchored-corner position until the
 * pointer moves it; after a drag it sticks to the pointer's place until the
 * next page reload. A press without movement stays a tap (l2d hit areas keep
 * working — drag only starts after {@link DRAG_THRESHOLD_PX} of travel).
 */
function attachDrag(container: HTMLDivElement, canvas: HTMLCanvasElement): void {
  let startX = 0
  let startY = 0
  let dragging = false
  let moved = false

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return
    startX = event.clientX
    startY = event.clientY
    moved = false
    dragging = true
    canvas.setPointerCapture(event.pointerId)
    canvas.style.cursor = 'grabbing'
  }

  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging) return
    const dx = event.clientX - startX
    const dy = event.clientY - startY
    if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
    moved = true
    const rect = container.getBoundingClientRect()
    const nextLeft = rect.left + dx
    const nextBottom = window.innerHeight - (rect.top + dy) - rect.height
    stickContainer(container, nextLeft, nextBottom)
    startX = event.clientX
    startY = event.clientY
  }

  const onPointerUp = (event: PointerEvent): void => {
    if (!dragging) return
    dragging = false
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
    canvas.style.cursor = 'grab'
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerUp)
  container.dataset.draggable = 'true'
}

/** The mounted widget handle: model + DOM, disposed together. */
interface WidgetHandle {
  dispose(): void
}

/** Build the load-progress overlay (slim bar + percentage at the widget foot). */
function buildProgressOverlay(): { overlay: HTMLDivElement; set(loaded: number, total: number): void; show(): void; hide(): void } {
  const overlay = document.createElement('div')
  overlay.style.cssText = [
    'position:absolute', 'inset:0', 'display:flex', 'flex-direction:column',
    'justify-content:flex-end', 'align-items:center', 'padding-bottom:6px',
    'pointer-events:none', 'opacity:0', 'transition:opacity .2s ease',
  ].join(';')

  const track = document.createElement('div')
  track.style.cssText = 'width:70%;height:4px;border-radius:2px;background:rgba(127,127,127,.35);overflow:hidden'
  const bar = document.createElement('div')
  bar.style.cssText = 'height:100%;width:0%;border-radius:2px;background:var(--dsw-alias-accent-primary,#5b8cff);transition:width .15s ease'
  track.appendChild(bar)

  const label = document.createElement('div')
  label.style.cssText = 'margin-top:4px;font-size:10px;line-height:14px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary,#9aa0a8)'

  overlay.appendChild(track)
  overlay.appendChild(label)

  return {
    overlay,
    set(loaded, total) {
      const percent = total > 0 ? Math.round((loaded / total) * 100) : 0
      bar.style.width = `${Math.min(100, Math.max(0, percent))}%`
      label.textContent = `${percent}%`
    },
    show() {
      overlay.style.opacity = '1'
    },
    hide() {
      overlay.style.opacity = '0'
    },
  }
}

/**
 * Mount the widget DOM (container, canvas, progress overlay) and start the
 * model load. Returns a handle whose `dispose()` releases WebGL and DOM.
 */
function mountWidget(config: Live2dConfig): WidgetHandle {
  const container = document.createElement('div')
  container.id = CONTAINER_ID
  container.style.position = 'fixed'
  container.style.width = `${config.width}px`
  container.style.height = `${config.height}px`
  container.style.opacity = String(config.opacity)
  container.style.zIndex = String(config.zIndex)
  // Only the canvas is interactive; the box must not block the UI underneath.
  container.style.pointerEvents = 'none'
  positionContainer(container, config, null, null)

  const canvas = document.createElement('canvas')
  canvas.style.display = 'block'
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  canvas.style.pointerEvents = 'auto'
  canvas.style.cursor = 'grab'
  container.appendChild(canvas)

  const progress = buildProgressOverlay()
  container.appendChild(progress.overlay)
  document.body.appendChild(container)

  let l2d: L2D | null = null
  let errorTimer: ReturnType<typeof setTimeout> | undefined

  const showError = (message: string): void => {
    progress.overlay.querySelector('div')?.style.setProperty('width', '100%')
    const label = progress.overlay.lastElementChild as HTMLDivElement
    label.textContent = message
    label.style.color = 'var(--dsw-alias-state-error-primary,#e5484d)'
    progress.show()
    if (errorTimer !== undefined) clearTimeout(errorTimer)
    errorTimer = setTimeout(() => progress.hide(), 4000)
  }

  l2d = init(canvas)
  if (l2d !== null) {
    // Listeners must be registered before load() (l2d contract).
    l2d.on('loadstart', (total) => {
      progress.set(0, total)
      progress.show()
    })
    l2d.on('loadprogress', (loaded, total) => {
      progress.set(loaded, total)
    })
    l2d.on('loaded', () => {
      progress.hide()
      canvas.style.cursor = config.draggable ? 'grab' : 'default'
    })
    void l2d.load({
      path: config.modelUrl,
      scale: config.scale,
      volume: config.volume,
      logLevel: config.logLevel,
    }).catch((error: unknown) => {
      showError('模型加载失败')
      console.warn('[dsh-live2d] model load failed:', error)
    })
  }

  if (config.draggable) attachDrag(container, canvas)

  return {
    dispose() {
      if (errorTimer !== undefined) clearTimeout(errorTimer)
      try {
        l2d?.destroy()
      } catch (error) {
        console.warn('[dsh-live2d] destroy failed:', error)
      }
      l2d = null
      container.remove()
    },
  }
}

/**
 * Client plugin body: mount the widget on activation (and reload it when the
 * settings panel changes the model), and register the Live2D settings section.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // Widget lifecycle: mount → re-mount on config change → tear down on disposal.
  ctx.effect(() => {
    let disposed = false
    let widget: WidgetHandle | null = null

    const start = async (): Promise<void> => {
      if (disposed) return
      const config = await fetchConfig()
      if (disposed || !config.enabled) return
      widget = mountWidget(config)
    }

    const onChange = (): void => {
      widget?.dispose()
      widget = null
      void start()
    }

    void start()
    const unsubscribe = subscribeConfigChange(onChange)

    return () => {
      disposed = true
      unsubscribe()
      widget?.dispose()
      widget = null
    }
  }, 'dsh-live2d: widget')

  // Settings section: the model URL editor, contributed to the settings UI.
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register({
      name: 'settings.section',
      id: 'dsh-live2d',
      order: 70,
      label: () => 'Live2D',
      inject: () => ({}),
    }, Live2dPanel))
}
