/**
 * dsh-live2d browser half: mounts the Live2D widget at the bottom corner of
 * the DSH web page, shows a load progress bar, and contributes a Live2D
 * section to Web settings that controls the WHOLE widget behavior.
 *
 * Contract notes:
 * - The bundle is a `window.__ModuleLoader__.load({ id, factory })` artifact;
 *   `apply(ctx)` runs in the browser cordis root.
 * - Configuration comes from the `dsh-live2d` settings namespace bound through
 *   `ctx.settingsScope` (registered host-side by the Node half). The widget
 *   subscribes to the scope snapshot — every committed change (settings panel
 *   save, external edit of `settings.yaml`, another tab) is reflected live.
 *   While the namespace is not yet ready (or remote browsers without a
 *   loopback settings transport), the widget mounts with {@link DEFAULT_CONFIG}.
 * - Field changes are applied by kind: layout fields (size, position, opacity,
 *   z-index, anchor, enabled, draggable) update the DOM in place without
 *   touching the model; render fields (modelUrl, scale, volume, logLevel)
 *   rebuild the widget so l2d reloads with the new options.
 * - `l2d` and the settings panel are inlined into this bundle at build time;
 *   `react` / `react/jsx-runtime` / `@deepseek-ai/dsh-client-ui-primitives`
 *   resolve from the shell's module table (see tsdown.config.ts). Settings
 *   contract types come from `dsh-client-runtime/client` (type-only).
 *
 * @module dsh-live2d/client
 */

import { createElement } from 'react'
import type { ClientContext, SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the slots Context merge (ctx.slots) through the runtime's client assembly.
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the SlotMap merge declaring `settings.section` and the
// `ctx.settingsScope` service merge (ui-settings' contract).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { init, type L2D } from 'l2d'
import type { Live2dConfig } from '../shared/config.ts'
import { DEFAULT_CONFIG } from '../shared/config.ts'
import { Live2dPanel } from './Panel.tsx'

/** Client plugin name (visible in the browser loader entry). */
export const name = 'dsh-live2d-client'

/** Required services: the settings scope binding needs the connection
 * transport and the remote event bus (dsh-client-connection); the panel and
 * widget ride the slots registry and the settingsScope service. */
export const inject = ['slots', 'settingsScope', 'connection', 'remote']

/** Settings namespace spelled by the Node half. */
export const NAMESPACE = 'dsh-live2d'

/** Widget container id, stable for debugging and user CSS. */
const CONTAINER_ID = 'dsh-live2d-widget'

/** How far the pointer must move before a press becomes a drag. */
const DRAG_THRESHOLD_PX = 4

/** Fields whose change requires rebuilding the l2d instance (reload the model). */
const RENDER_FIELDS: (keyof Live2dConfig)[] = ['modelUrl', 'scale', 'volume', 'logLevel']

/** Resolve one scope snapshot to a full widget config (defaults on absence). */
function resolveConfig(snapshot: ReturnType<SettingsScope<Live2dConfig>['getSnapshot']>): Live2dConfig {
  if (snapshot.status === 'ready' && snapshot.value !== undefined) {
    return { ...DEFAULT_CONFIG, ...snapshot.value }
  }
  return { ...DEFAULT_CONFIG }
}

/* ---------------- widget ---------------------------------------------------- */

/** Apply inline positioning for the anchored corner; the opposite side is
 * cleared so an anchor flip never leaves the box stretched both ways. */
function positionContainer(container: HTMLDivElement, config: Live2dConfig, x: number | null, y: number | null): void {
  if (config.anchor === 'right') {
    container.style.right = `${x ?? config.offsetX}px`
    container.style.left = 'auto'
  } else {
    container.style.left = `${x ?? config.offsetX}px`
    container.style.right = 'auto'
  }
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
 * Returns a detacher so the drag can be re-attached when `draggable` flips.
 */
function attachDrag(container: HTMLDivElement, canvas: HTMLCanvasElement): () => void {
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

  return () => {
    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('pointerup', onPointerUp)
    canvas.removeEventListener('pointercancel', onPointerUp)
    delete container.dataset.draggable
  }
}

/** The mounted widget handle: model + DOM + drag, disposed together. */
interface WidgetHandle {
  container: HTMLDivElement
  canvas: HTMLCanvasElement
  setDraggable(draggable: boolean): void
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
  bar.style.cssText = 'height:100%;width:0%;border-radius:2px;background:var(--dsw-alias-brand-primary);transition:width .15s ease'
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

/** Apply layout fields onto an already-mounted widget, in place (no reload). */
function applyLayout(handle: WidgetHandle, config: Live2dConfig): void {
  const { container } = handle
  container.style.width = `${config.width}px`
  container.style.height = `${config.height}px`
  container.style.opacity = String(config.opacity)
  container.style.zIndex = String(config.zIndex)
  positionContainer(container, config, null, null)
  handle.setDraggable(config.draggable)
}

/**
 * Mount the widget DOM (container, canvas, progress overlay) and start the
 * model load. Returns a handle whose `dispose()` releases WebGL and DOM.
 */
function mountWidget(config: Live2dConfig): WidgetHandle {
  const container = document.createElement('div')
  container.id = CONTAINER_ID
  container.style.position = 'fixed'
  container.style.pointerEvents = 'none'
  // Only the canvas is interactive; the box must not block the UI underneath.
  document.body.appendChild(container)

  const canvas = document.createElement('canvas')
  canvas.style.display = 'block'
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  canvas.style.pointerEvents = 'auto'
  canvas.style.cursor = 'grab'
  container.appendChild(canvas)

  const progress = buildProgressOverlay()
  container.appendChild(progress.overlay)

  let l2d: L2D | null = null
  let errorTimer: ReturnType<typeof setTimeout> | undefined
  let detachDrag: (() => void) | null = null

  const setDraggable = (draggable: boolean): void => {
    if (draggable && detachDrag === null) {
      detachDrag = attachDrag(container, canvas)
    } else if (!draggable && detachDrag !== null) {
      detachDrag()
      detachDrag = null
      canvas.style.cursor = 'default'
    }
  }

  const showError = (message: string): void => {
    progress.overlay.querySelector('div')?.style.setProperty('width', '100%')
    const label = progress.overlay.lastElementChild as HTMLDivElement
    label.textContent = message
    label.style.color = 'var(--dsw-alias-state-error-primary,#e5484d)'
    progress.show()
    if (errorTimer !== undefined) clearTimeout(errorTimer)
    errorTimer = setTimeout(() => progress.hide(), 4000)
  }

  // Initial layout including the anchored-corner position.
  applyLayout({ container, canvas, setDraggable, dispose: () => {} }, config)

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
      if (detachDrag !== null) canvas.style.cursor = 'grab'
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

  return {
    container,
    canvas,
    setDraggable,
    dispose() {
      if (errorTimer !== undefined) clearTimeout(errorTimer)
      detachDrag?.()
      detachDrag = null
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
 * Client plugin body: bind the settings namespace, mount the widget and keep
 * it in sync with the namespace snapshot, and register the Live2D settings
 * section.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // The scope rides this plugin's fiber: disposal unbinds the controller.
  const scope: SettingsScope<Live2dConfig> = ctx.settingsScope.bind({ namespace: NAMESPACE })

  // Widget lifecycle: sync on every committed snapshot (mount → classify →
  // in-place layout or rebuild), tear down on disposal.
  ctx.effect(() => {
    let widget: WidgetHandle | null = null
    let last: Live2dConfig | null = null

    const sync = (): void => {
      const config = resolveConfig(scope.getSnapshot())
      if (!config.enabled) {
        widget?.dispose()
        widget = null
        last = null
        return
      }
      const prev = last
      const current = widget
      if (prev === null) {
        widget = mountWidget(config)
      } else if (RENDER_FIELDS.some((field) => !Object.is(prev[field], config[field]))) {
        current?.dispose()
        widget = mountWidget(config)
      } else if (current !== null) {
        applyLayout(current, config)
      }
      last = config
    }

    sync()
    const unsubscribe = scope.subscribe(sync)
    return () => {
      unsubscribe()
      widget?.dispose()
      widget = null
      last = null
    }
  }, 'dsh-live2d: widget')

  // Settings section: full widget-behavior editor, contributed to the settings UI.
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register({
      name: 'settings.section',
      id: 'dsh-live2d',
      order: 70,
      label: () => 'Live2D',
      inject: () => ({}),
    }, () => createElement(Live2dPanel, { scope })))
}
