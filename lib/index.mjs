import Schema from "@deepseek-ai/schemastery";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
//#region src/shared/config.ts
/** Defaults shipped with the bundle row; the schema default mirrors these. */
const DEFAULT_CONFIG = {
	enabled: true,
	modelUrl: "https://model.hacxy.cn/Mao/Mao.model3.json",
	width: 280,
	height: 360,
	offsetX: 12,
	offsetY: 12,
	anchor: "right",
	scale: 1,
	opacity: 1,
	zIndex: 9999,
	draggable: true,
	volume: 0,
	logLevel: "warn"
};
//#endregion
//#region src/index.ts
/** Cordis plugin name (the host Loader entry name). */
const name = "dsh-live2d";
/** Schemastery schema: validates the entry config, fills defaults, and doubles
* as the settings namespace's persisted-section schema (the settings provider
* rejects any write the schema cannot resolve). */
const Config = Schema.object({
	enabled: Schema.boolean().default(DEFAULT_CONFIG.enabled),
	modelUrl: Schema.string().default(DEFAULT_CONFIG.modelUrl),
	width: Schema.number().min(1).max(4096).default(DEFAULT_CONFIG.width),
	height: Schema.number().min(1).max(4096).default(DEFAULT_CONFIG.height),
	offsetX: Schema.number().min(0).max(4096).default(DEFAULT_CONFIG.offsetX),
	offsetY: Schema.number().min(0).max(4096).default(DEFAULT_CONFIG.offsetY),
	anchor: Schema.union(["left", "right"]).default(DEFAULT_CONFIG.anchor),
	scale: Schema.number().min(.01).max(10).default(DEFAULT_CONFIG.scale),
	opacity: Schema.number().min(0).max(1).default(DEFAULT_CONFIG.opacity),
	zIndex: Schema.number().min(0).default(DEFAULT_CONFIG.zIndex),
	draggable: Schema.boolean().default(DEFAULT_CONFIG.draggable),
	volume: Schema.number().min(0).max(1).default(DEFAULT_CONFIG.volume),
	logLevel: Schema.union([
		"error",
		"warn",
		"info",
		"trace"
	]).default(DEFAULT_CONFIG.logLevel)
});
/** Settings namespace owned by this plugin; the browser half binds the same. */
const NAMESPACE = settingsNamespace("dsh-live2d");
/**
* Plugin body: register the settings namespace. While the settings service
* exists (always, in the official web composition), the resolved namespace
* section is `schema defaults → composed entry config (base) → user document`.
* `installSettingsSection` rides the plugin fiber, so tear-down removes the
* registration; no settings service mounted means nothing runs and the plugin
* behaves exactly as composed.
*/
function apply(ctx, config) {
	installSettingsSection(ctx, NAMESPACE, Config, config, {
		setSource: () => {},
		onChange: () => {}
	});
}
//#endregion
export { Config, NAMESPACE, apply, name };
