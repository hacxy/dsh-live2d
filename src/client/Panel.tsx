/**
 * Live2D settings section: pick the model URL (and reset to the deployment
 * default). Saves through the host route, which persists into the profile's
 * user patch layer; the profile HMR watcher reloads the `live2d` row, so the
 * panel polls GET until the served config matches, then notifies the widget
 * (via the config-change bus) to reload with the new model.
 *
 * Styling follows the official "Models" settings page design language —
 * `--dsw-alias-*` theme tokens, inline styles, no CSS dependencies.
 *
 * @module dsh-live2d/client/panel
 */

import { useCallback, useEffect, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { publishConfigChange } from './config-events.ts'

/** Config route spelled by the Node half (GET reads, POST persists). */
const CONFIG_ROUTE = '/api/dsh-live2d/config'

/** How long to wait for the host HMR reload to reflect a saved value. */
const APPLY_POLL_MS = 200
const APPLY_POLL_TRIES = 20

interface ConfigPayload {
  ok: boolean
  config?: { modelUrl?: string }
  defaultModelUrl?: string
  message?: string
}

interface SaveState {
  kind: 'saved' | 'error'
  text: string
}

const sectionStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 720,
  color: 'var(--dsw-alias-label-primary)',
}
const titleStyle: React.CSSProperties = {
  margin: 0, fontSize: 16, lineHeight: '24px', fontWeight: 500,
  color: 'var(--dsw-alias-label-primary)',
}
const introStyle: React.CSSProperties = {
  margin: 0, fontSize: 14, lineHeight: '22px', color: 'var(--dsw-alias-label-tertiary)',
}
const fieldStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 6,
}
const fieldLabelStyle: React.CSSProperties = {
  fontSize: 12, lineHeight: '18px', fontWeight: 500, color: 'var(--dsw-alias-label-secondary)',
}
const editorActionsStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'flex-end', gap: 8,
}
const statusStyle: React.CSSProperties = {
  margin: 0, fontSize: 12, lineHeight: '18px',
}

/** Poll GET until the host serves the saved modelUrl (HMR reload is async). */
async function waitForApplied(modelUrl: string): Promise<boolean> {
  for (let i = 0; i < APPLY_POLL_TRIES; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, APPLY_POLL_MS))
    try {
      const response = await fetch(CONFIG_ROUTE, { cache: 'no-store' })
      const payload = await response.json() as ConfigPayload
      if (payload.ok === true && payload.config?.modelUrl === modelUrl) return true
    } catch {
      // transient host state during reload — keep polling
    }
  }
  return false
}

/** The Live2D settings section body. */
export function Live2dPanel(): React.ReactNode {
  const [modelUrl, setModelUrl] = useState('')
  const [defaultModelUrl, setDefaultModelUrl] = useState<string | undefined>(undefined)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<SaveState | null>(null)

  // Seed the editor with the composed config.
  useEffect(() => {
    let cancelled = false
    void fetch(CONFIG_ROUTE, { cache: 'no-store' })
      .then((response) => response.json() as Promise<ConfigPayload>)
      .then((payload) => {
        if (cancelled || payload.ok !== true) return
        setModelUrl(payload.config?.modelUrl ?? '')
        setDefaultModelUrl(payload.defaultModelUrl)
        setLoaded(true)
      })
      .catch(() => {
        if (!cancelled) {
          setStatus({ kind: 'error', text: '无法读取当前配置' })
          setLoaded(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const save = useCallback(async (): Promise<void> => {
    const url = modelUrl.trim()
    if (url.length === 0) {
      setStatus({ kind: 'error', text: '模型地址不能为空' })
      return
    }
    setBusy(true)
    setStatus(null)
    try {
      const response = await fetch(CONFIG_ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ modelUrl: url }),
      })
      const payload = await response.json() as ConfigPayload
      if (payload.ok !== true) throw new Error(payload.message ?? '保存失败')
      if (!await waitForApplied(url)) {
        throw new Error('配置已写入，但尚未生效，请稍后刷新页面')
      }
      publishConfigChange()
      setStatus({ kind: 'saved', text: '已保存，模型正在重新加载' })
    } catch (error) {
      setStatus({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }, [modelUrl])

  const reset = useCallback(async (): Promise<void> => {
    if (defaultModelUrl === undefined) return
    setModelUrl(defaultModelUrl)
    setBusy(true)
    setStatus(null)
    try {
      const response = await fetch(CONFIG_ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reset: true }),
      })
      const payload = await response.json() as ConfigPayload
      if (payload.ok !== true) throw new Error(payload.message ?? '重置失败')
      if (!await waitForApplied(defaultModelUrl)) {
        throw new Error('配置已重置，但尚未生效，请稍后刷新页面')
      }
      publishConfigChange()
      setStatus({ kind: 'saved', text: '已恢复默认模型' })
    } catch (error) {
      setStatus({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }, [defaultModelUrl])

  if (!loaded) {
    return <div style={sectionStyle}><p style={introStyle}>加载中…</p></div>
  }

  return (
    <div style={sectionStyle}>
      <h2 style={titleStyle}>Live2D 角色</h2>
      <p style={introStyle}>
        网页右下角展示的 Live2D 角色模型。支持 <code>.model.json</code>（Cubism 2）与{' '}
        <code>.model3.json</code>（Cubism 6）入口文件。
      </p>
      <div style={fieldStyle}>
        <label style={fieldLabelStyle} htmlFor="dsh-live2d-model-url">模型地址</label>
        <Input
          id="dsh-live2d-model-url"
          value={modelUrl}
          placeholder="https://example.com/model/model3.json"
          onChange={(event) => setModelUrl(event.target.value)}
          disabled={busy}
        />
      </div>
      <div style={editorActionsStyle}>
        <Button variant="ghost" size="sm" onClick={() => void reset()} disabled={busy || defaultModelUrl === undefined}>
          恢复默认
        </Button>
        <Button variant="primary" size="sm" onClick={() => void save()} disabled={busy}>
          {busy ? '保存中…' : '保存'}
        </Button>
      </div>
      {status !== null && (
        <p style={{
          ...statusStyle,
          color: status.kind === 'saved'
            ? 'var(--dsw-alias-state-success-primary)'
            : 'var(--dsw-alias-state-error-primary)',
        }}>
          {status.text}
        </p>
      )}
    </div>
  )
}
