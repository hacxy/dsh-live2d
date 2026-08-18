/**
 * dsh-live2d Node half: registers the `dsh-live2d` settings namespace with the
 * DSH settings service and designates this plugin's composed row config as its
 * `base` layer.
 *
 * How configuration flows:
 * - The browser half binds the SAME namespace through `ctx.settingsScope` and
 *   reads the resolved section, so the widget always sees the authoritative
 *   value: schema defaults → base (this composed row config, i.e. the bundle's
 *   `cordis.patch.yml`) → user layer (`~/.dsh/settings.yaml`, written by the
 *   Web settings panel).
 * - User changes made in the Web settings persist into the official settings
 *   document via `settings.update`/`mutate` RPCs — no hand-written YAML patch
 *   editing, no self-owned HTTP routes. External edits to `settings.yaml` are
 *   picked up by the settings provider and pushed to every bound browser.
 *
 * @module dsh-live2d
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { Live2dConfig, Live2dLogLevel, WidgetAnchor } from './shared/config.ts'
import { DEFAULT_CONFIG } from './shared/config.ts'

/** Cordis plugin name (the host Loader entry name). */
export const name = 'dsh-live2d'

/** Re-export the config contract for consumers. */
export type { Live2dConfig, Live2dLogLevel, WidgetAnchor } from './shared/config.ts'

/** Row config surface; defaults mirror {@link DEFAULT_CONFIG}. */
export interface Config {
  enabled: boolean
  modelUrl: string
  width: number
  height: number
  offsetX: number
  offsetY: number
  anchor: WidgetAnchor
  scale: number
  opacity: number
  zIndex: number
  draggable: boolean
  volume: number
  logLevel: Live2dLogLevel
}

/** Schemastery schema: validates the entry config, fills defaults, and doubles
 * as the settings namespace's persisted-section schema (the settings provider
 * rejects any write the schema cannot resolve). */
export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(DEFAULT_CONFIG.enabled),
  modelUrl: Schema.string().default(DEFAULT_CONFIG.modelUrl),
  width: Schema.number().min(1).max(4096).default(DEFAULT_CONFIG.width),
  height: Schema.number().min(1).max(4096).default(DEFAULT_CONFIG.height),
  offsetX: Schema.number().min(0).max(4096).default(DEFAULT_CONFIG.offsetX),
  offsetY: Schema.number().min(0).max(4096).default(DEFAULT_CONFIG.offsetY),
  anchor: Schema.union(['left', 'right']).default(DEFAULT_CONFIG.anchor),
  scale: Schema.number().min(0.01).max(10).default(DEFAULT_CONFIG.scale),
  opacity: Schema.number().min(0).max(1).default(DEFAULT_CONFIG.opacity),
  zIndex: Schema.number().min(0).default(DEFAULT_CONFIG.zIndex),
  draggable: Schema.boolean().default(DEFAULT_CONFIG.draggable),
  volume: Schema.number().min(0).max(1).default(DEFAULT_CONFIG.volume),
  logLevel: Schema.union(['error', 'warn', 'info', 'trace']).default(DEFAULT_CONFIG.logLevel),
})

/** Settings namespace owned by this plugin; the browser half binds the same. */
export const NAMESPACE = settingsNamespace('dsh-live2d')

/**
 * Plugin body: register the settings namespace. While the settings service
 * exists (always, in the official web composition), the resolved namespace
 * section is `schema defaults → composed entry config (base) → user document`.
 * `installSettingsSection` rides the plugin fiber, so tear-down removes the
 * registration; no settings service mounted means nothing runs and the plugin
 * behaves exactly as composed.
 */
export function apply(ctx: Context, config: Config): void {
  installSettingsSection(ctx, NAMESPACE, Config, config, {
    // Nobody on the host consumes the authoritative source — the widget lives
    // in the browser and reads the same namespace through `settingsScope`.
    setSource: () => {},
    onChange: () => {},
  })
}
