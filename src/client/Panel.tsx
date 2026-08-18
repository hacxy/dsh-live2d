/**
 * Live2D settings section: full widget-behavior editor. Every field of the
 * widget configuration is editable here — model URL, size, position, anchor,
 * scale, opacity, z-index, drag, volume, log level, master switch — so users
 * never need to hand-edit `cordis.patch.yml`.
 *
 * Persistence goes through the official settings channel: the panel binds the
 * `dsh-live2d` namespace scope (Host: `@deepseek-ai/dsh-settings`), edits are
 * written as one `set` per changed field (the channel is single-field, no
 * transactions), and "restore defaults" `unset`s the user-overridden fields so
 * they re-inherit the deployment defaults (schema → bundle `base`). The Host
 * validates every write against the plugin's Config schema; an external edit
 * revokes the revision and the panel's snapshot refreshes automatically.
 *
 * Styling follows the official "Models" settings page design language —
 * `--dsw-alias-*` theme tokens, inline styles, no CSS dependencies.
 *
 * @module dsh-live2d/client/panel
 */

import { useCallback, useEffect, useSyncExternalStore, useState, type CSSProperties, type ReactNode } from "react";
import { Button, Input } from "@deepseek-ai/dsh-client-ui-primitives";
import type { SettingsScope } from "@deepseek-ai/dsh-client-runtime/client";
import type {
  Live2dConfig,
  Live2dLogLevel,
  WidgetAnchor,
} from "../shared/config.ts";
import { DEFAULT_CONFIG } from "../shared/config.ts";

/* ---------------- field table ------------------------------------------------- */

type FieldKind = "text" | "number" | "checkbox" | "select";

interface FieldDef {
  key: keyof Live2dConfig;
  label: string;
  group: string;
  kind: FieldKind;
  options?: readonly string[];
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
}

/** One source of truth for the whole form: order, labels, groups, constraints.
 * Ranges mirror the Schemastery schema in src/index.ts. */
const FIELD_DEFS: readonly FieldDef[] = [
  // 开关
  { key: "enabled", label: "启用挂件", group: "开关", kind: "checkbox", hint: "关闭后右下角不再显示 Live2D 角色" },
  // 模型
  { key: "modelUrl", label: "模型地址", group: "模型", kind: "text", hint: ".model.json（Cubism 2）或 .model3.json（Cubism 6）入口文件" },
  // 外观
  { key: "width", label: "宽度", group: "外观", kind: "number", min: 1, max: 4096, step: 1 },
  { key: "height", label: "高度", group: "外观", kind: "number", min: 1, max: 4096, step: 1 },
  { key: "opacity", label: "透明度", group: "外观", kind: "number", min: 0, max: 1, step: 0.05 },
  { key: "zIndex", label: "层级 (z-index)", group: "外观", kind: "number", min: 0, max: 2147483647, step: 1 },
  // 位置
  { key: "anchor", label: "锚定边", group: "位置", kind: "select", options: ["right", "left"] as const },
  { key: "offsetX", label: "水平间距", group: "位置", kind: "number", min: 0, max: 4096, step: 1 },
  { key: "offsetY", label: "底部间距", group: "位置", kind: "number", min: 0, max: 4096, step: 1 },
  // 渲染
  { key: "scale", label: "模型缩放", group: "渲染", kind: "number", min: 0.01, max: 10, step: 0.05 },
  { key: "volume", label: "动作音量", group: "渲染", kind: "number", min: 0, max: 1, step: 0.05 },
  { key: "logLevel", label: "日志级别", group: "渲染", kind: "select", options: ["error", "warn", "info", "trace"] as const },
  // 交互
  { key: "draggable", label: "可拖拽", group: "交互", kind: "checkbox", hint: "拖动后停留在指针位置，刷新页面复位" },
];

/** Groups in display order. */
const GROUPS = ["开关", "模型", "外观", "位置", "渲染", "交互"];

/* ---------------- ids ---------------------------------------------------------- */

/** Stable kebab-case input id per field (`modelUrl` → `dsh-live2d-model-url`). */
function fieldId(key: keyof Live2dConfig): string {
  return `dsh-live2d-${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`;
}

/* ---------------- validation --------------------------------------------------- */

/** Validate a user-supplied model URL (absolute http(s) or relative path). */
function isValidModelUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 2048) return false;
  if (/^https?:\/\//i.test(trimmed)) return true;
  return /^[^"'<>\\]+\.[a-zA-Z0-9]+(\?.*)?$/.test(trimmed);
}

/** Client-side validation mirroring the Schema constraints. Returns an error
 * message, or null when the config is acceptable. */
function validateConfig(config: Live2dConfig): string | null {
  for (const def of FIELD_DEFS) {
    const value = config[def.key];
    if (def.kind === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return `${def.label} 必须是数字`;
      }
      if (def.min !== undefined && value < def.min) {
        return `${def.label} 不能小于 ${def.min}`;
      }
      if (def.max !== undefined && value > def.max) {
        return `${def.label} 不能大于 ${def.max}`;
      }
    }
    if (def.kind === "select" && def.options !== undefined) {
      if (!def.options.includes(String(value))) {
        return `${def.label} 取值无效`;
      }
    }
  }
  if (!isValidModelUrl(config.modelUrl)) {
    return "模型地址必须是 http(s) URL 或相对路径";
  }
  return null;
}

/* ---------------- panel --------------------------------------------------------- */

interface SaveState {
  kind: "saved" | "error";
  text: string;
}

const sectionStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
  maxWidth: 720,
  color: "var(--dsw-alias-label-primary)",
};
const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: 16,
  lineHeight: "24px",
  fontWeight: 500,
  color: "var(--dsw-alias-label-primary)",
};
const introStyle: CSSProperties = {
  margin: 0,
  fontSize: 14,
  lineHeight: "22px",
  color: "var(--dsw-alias-label-tertiary)",
};
const groupStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: "12px 14px",
  border: "1px solid var(--dsw-alias-border-l2)",
  borderRadius: 8,
  background: "var(--dsw-alias-bg-layer-1)",
};
const groupTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: 13,
  lineHeight: "20px",
  fontWeight: 600,
  color: "var(--dsw-alias-label-secondary)",
};
const fieldStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};
const fieldLabelStyle: CSSProperties = {
  fontSize: 12,
  lineHeight: "18px",
  fontWeight: 500,
  color: "var(--dsw-alias-label-secondary)",
};
const hintStyle: CSSProperties = {
  margin: 0,
  fontSize: 12,
  lineHeight: "18px",
  color: "var(--dsw-alias-label-tertiary)",
};
const selectStyle: CSSProperties = {
  width: "100%",
  minHeight: 30,
  padding: "4px 8px",
  fontSize: 13,
  color: "var(--dsw-alias-label-primary)",
  background: "var(--dsw-alias-bg-layer-1)",
  border: "1px solid var(--dsw-alias-border-l2)",
  borderRadius: 6,
};
const checkboxRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
};
const editorActionsStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
};
const statusStyle: CSSProperties = {
  margin: 0,
  fontSize: 12,
  lineHeight: "18px",
};

/** Controlled field renderer (each field gets a stable id for e2e hooks). */
function FieldControl({
  def,
  value,
  disabled,
  onChange,
}: {
  def: FieldDef;
  value: Live2dConfig[keyof Live2dConfig];
  disabled: boolean;
  onChange(next: Live2dConfig[keyof Live2dConfig]): void;
}): ReactNode {
  const id = fieldId(def.key);
  if (def.kind === "select") {
    return (
      <select
        id={id}
        style={selectStyle}
        value={String(value)}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as Live2dLogLevel | WidgetAnchor)}
      >
        {(def.options ?? []).map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    );
  }
  return (
    <Input
      id={id}
      type={def.kind === "number" ? "number" : "text"}
      value={String(value)}
      min={def.min}
      max={def.max}
      step={def.step}
      disabled={disabled}
      onChange={(event) => {
        const raw = event.target.value;
        if (def.kind === "number") {
          onChange(raw === "" ? Number.NaN : Number(raw));
        } else {
          onChange(raw);
        }
      }}
    />
  );
}

/** The Live2D settings section body. */
export function Live2dPanel({ scope }: { scope: SettingsScope<Live2dConfig> }): ReactNode {
  // Snapshot-driven: any committed change (this panel, another tab, an
  // external edit of settings.yaml) re-renders the form from server truth.
  // Bind the methods: uSES invokes them bare, so unbound references would
  // lose `this` inside the controller (strict mode throws on this.store).
  const snapshot = useSyncExternalStore(
    (listener) => scope.subscribe(listener),
    () => scope.getSnapshot(),
  );
  const serverValue: Live2dConfig =
    snapshot.status === "ready" && snapshot.value !== undefined
      ? { ...DEFAULT_CONFIG, ...snapshot.value }
      : { ...DEFAULT_CONFIG };

  // Local edit buffer; null means "show server truth". Cleared on every
  // committed snapshot so the form never drifts from the stored document.
  const [draft, setDraft] = useState<Live2dConfig | null>(null);
  useEffect(() => {
    setDraft(null);
  }, [snapshot]);

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<SaveState | null>(null);

  const shown = draft ?? serverValue;

  const updateField = useCallback(
    (key: keyof Live2dConfig, next: Live2dConfig[keyof Live2dConfig]) => {
      setStatus(null);
      setDraft((current) => ({ ...(current ?? serverValue), [key]: next }));
    },
    [serverValue],
  );

  const save = useCallback(async (): Promise<void> => {
    const base = serverValue;
    const target = draft ?? base;
    const error = validateConfig(target);
    if (error !== null) {
      setStatus({ kind: "error", text: error });
      return;
    }
    const changed = FIELD_DEFS
      .map((def) => def.key)
      .filter((key) => !Object.is(base[key], target[key]));
    if (changed.length === 0) {
      setStatus({ kind: "saved", text: "当前没有需要保存的更改" });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      // Single-field channel: one `set` per changed field, in order. The
      // widget watches the same snapshot, so each commit applies live; the
      // final document is consistent by the time this settles.
      for (const key of changed) {
        await scope.set(key, target[key]);
      }
      setDraft(null);
      setStatus({ kind: "saved", text: `已保存 ${changed.length} 项更改，设置已生效` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const conflicted = /SETTINGS_CONFLICT|conflict/i.test(message);
      setStatus({
        kind: "error",
        text: conflicted
          ? "配置已被外部修改，已自动刷新为最新值，请重新保存"
          : `保存失败：${message}`,
      });
      // The scope reloads the Host state on a rejected write, so the form
      // already shows the freshest values.
      setDraft(null);
    } finally {
      setBusy(false);
    }
  }, [draft, scope, serverValue]);

  const reset = useCallback(async (): Promise<void> => {
    setBusy(true);
    setStatus(null);
    try {
      // Clear exactly the fields the user overrode (presence in the raw user
      // section), so every field re-inherits deployment defaults.
      const userSection = snapshot.user;
      const keys =
        userSection !== undefined && typeof userSection === "object"
          ? Object.keys(userSection as object).filter((key) =>
              FIELD_DEFS.some((def) => def.key === key),
            )
          : [];
      if (keys.length === 0) {
        setStatus({ kind: "saved", text: "当前没有用户自定义配置，无需恢复" });
        return;
      }
      for (const key of keys) {
        await scope.unset(key);
      }
      setDraft(null);
      setStatus({ kind: "saved", text: "已恢复为部署默认配置" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus({
        kind: "error",
        text: /SETTINGS_CONFLICT|conflict/i.test(message)
          ? "配置已被外部修改，已自动刷新为最新值，请重试"
          : `重置失败：${message}`,
      });
      setDraft(null);
    } finally {
      setBusy(false);
    }
  }, [scope, snapshot.user]);

  if (snapshot.status === "loading") {
    return (
      <div style={sectionStyle}>
        <p style={introStyle}>加载中…</p>
      </div>
    );
  }

  if (snapshot.status === "unavailable") {
    return (
      <div style={sectionStyle}>
        <h2 style={titleStyle}>Live2D 角色</h2>
        <p style={introStyle}>
          当前浏览器无法访问配置服务（设置仅在本地浏览器可持久化），挂件使用部署默认配置。
        </p>
      </div>
    );
  }

  return (
    <div style={sectionStyle}>
      <h2 style={titleStyle}>Live2D 角色</h2>
      <p style={introStyle}>网页右下角展示的 Live2D 角色，全部行为均在此配置。</p>
      {GROUPS.map((group) => {
        const fields = FIELD_DEFS.filter((def) => def.group === group);
        if (group === "模型") {
          // 模型组仅 modelUrl（文本框），常规 field 渲染。
        }
        return (
          <div key={group} style={groupStyle}>
            <h3 style={groupTitleStyle}>{group}</h3>
            {fields.map((def) => (
              <div key={def.key} style={fieldStyle}>
                {def.kind === "checkbox" ? (
                  <>
                    <div style={checkboxRowStyle}>
                      <input
                        id={fieldId(def.key)}
                        type="checkbox"
                        checked={Boolean(shown[def.key])}
                        disabled={busy}
                        onChange={(event) => updateField(def.key, event.target.checked)}
                        style={{ margin: 0, accentColor: "var(--dsw-alias-brand-primary)" }}
                      />
                      <label style={fieldLabelStyle} htmlFor={fieldId(def.key)}>
                        {def.label}
                      </label>
                    </div>
                    {def.hint !== undefined && <p style={hintStyle}>{def.hint}</p>}
                  </>
                ) : (
                  <>
                    <label style={fieldLabelStyle} htmlFor={fieldId(def.key)}>
                      {def.label}
                    </label>
                    <FieldControl
                      def={def}
                      value={shown[def.key]}
                      disabled={busy}
                      onChange={(next) => updateField(def.key, next)}
                    />
                    {def.hint !== undefined && <p style={hintStyle}>{def.hint}</p>}
                  </>
                )}
              </div>
            ))}
          </div>
        );
      })}
      <div style={editorActionsStyle}>
        <Button variant="ghost" size="sm" onClick={() => void reset()} disabled={busy}>
          恢复默认
        </Button>
        <Button variant="primary" size="sm" onClick={() => void save()} disabled={busy}>
          {busy ? "保存中…" : "保存"}
        </Button>
      </div>
      {status !== null && (
        <p
          style={{
            ...statusStyle,
            color:
              status.kind === "saved"
                ? "var(--dsw-alias-state-success-primary)"
                : "var(--dsw-alias-state-error-primary)",
          }}
        >
          {status.text}
        </p>
      )}
    </div>
  );
}
