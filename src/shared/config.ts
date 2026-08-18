/**
 * Shared Live2D widget configuration: the pure data contract and defaults
 * used by BOTH halves. Browser-safe on purpose — this module must not import
 * anything (the host half imports it through the Node bundle, the browser
 * half inlines it into the client bundle).
 *
 * The host half additionally exports a Schemastery schema (src/config.ts)
 * so Cordis validates the row config and fills defaults at mount; the
 * resolved row config is then served to the browser over the config route.
 */

/** Anchor side of the widget on the viewport. */
export type WidgetAnchor = 'left' | 'right'

/** l2d log level (mirrors the `logLevel` option of the l2d library). */
export type Live2dLogLevel = 'error' | 'warn' | 'info' | 'trace'

/** One resolved widget configuration. */
export interface Live2dConfig {
  /** Master switch: when false the browser half mounts nothing. */
  enabled: boolean
  /** Model entry file: `.model.json` (Cubism 2) or `.model3.json` (Cubism 6). */
  modelUrl: string
  /** Widget CSS width in px. */
  width: number
  /** Widget CSS height in px. */
  height: number
  /** Horizontal inset from the anchored edge in px. */
  offsetX: number
  /** Bottom inset in px. */
  offsetY: number
  /** Which horizontal edge the widget anchors to. */
  anchor: WidgetAnchor
  /** l2d model scale (1 = original size). */
  scale: number
  /** Widget opacity, 0..1. */
  opacity: number
  /** Stacking order of the widget. */
  zIndex: number
  /** Whether the widget can be dragged around with the pointer. */
  draggable: boolean
  /** Motion/sound volume, 0..1. */
  volume: number
  /** l2d log level. */
  logLevel: Live2dLogLevel
}

/** Defaults shipped with the bundle row; the schema default mirrors these. */
export const DEFAULT_CONFIG: Live2dConfig = {
  enabled: true,
  modelUrl: 'https://model.hacxy.cn/Mao/Mao.model3.json',
  width: 280,
  height: 360,
  offsetX: 12,
  offsetY: 12,
  anchor: 'right',
  scale: 1,
  opacity: 1,
  zIndex: 9999,
  draggable: true,
  volume: 0,
  logLevel: 'warn',
}
