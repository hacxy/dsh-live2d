/**
 * In-bundle config-change bus: lets the settings panel tell the widget to
 * reload after a save, without importing the plugin entry (avoids a module
 * cycle between index.ts and Panel.tsx).
 *
 * @module dsh-live2d/client/config-events
 */

type ConfigChangeListener = () => void

const listeners = new Set<ConfigChangeListener>()

/** Subscribe to "the composed config changed; re-read and reload". */
export function subscribeConfigChange(listener: ConfigChangeListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Publish a config change after a settings save has been confirmed. */
export function publishConfigChange(): void {
  for (const listener of [...listeners]) listener()
}
