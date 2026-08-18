import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import Schema from "@deepseek-ai/schemastery";
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
/**
* dsh-live2d Node half: a Cordis entry that serves the composed widget
* configuration to the browser over `webServer` routes, and persists the
* model URL the user picks in the Web settings into the profile's user patch
* layer (`profiles/web/cordis.patch.yml`).
*
* Why routes: static client plugins are mounted by the browser kernel with
* `loader.create({ name })` and receive NO entry config, and third-party
* settings namespaces are behind the Host api-proxy allowlist. Owning HTTP
* routes is the zero-patch channel a third-party bundle can use (same pattern
* as the community plugin-console reference).
*
* Persistence model: the profile's `cordis.patch.yml` IS the official user
* config surface — the profile HMR watcher recomposes the tree on change, the
* `live2d` row reloads with the new config, and `--dump-config` shows it.
* The Web settings panel writes an id-targeted patch entry for `live2d` that
* restates only `modelUrl` (schema defaults fill every other field), then the
* browser polls GET until the resolved config reflects the new value.
*
* @module dsh-live2d
*/
/** Cordis plugin name (the host Loader entry name). */
const name = "dsh-live2d";
/** Schemastery schema: Cordis validates the entry config and fills defaults. */
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
/** Required services: the web HTTP route registry (web composition provides it). */
const inject = ["webServer"];
/** Config route path, also spelled in the browser half. */
const CONFIG_ROUTE = "/api/dsh-live2d/config";
/** The web profile whose user patch layer this plugin persists into. */
const PROFILE_NAME = "web";
/** Resolve the Harness home (mirrors @deepseek-ai/dsh-home-paths). */
function resolveDshHome() {
	return process.env.DSH_HOME?.trim() !== "" && process.env.DSH_HOME !== void 0 ? process.env.DSH_HOME : join(homedir(), ".dsh");
}
/** The web profile's user patch layer path (the official user config surface). */
function profilePatchPath() {
	return join(resolveDshHome(), "profiles", PROFILE_NAME, "cordis.patch.yml");
}
/** Single-quote a YAML scalar value ('' escapes a quote, per YAML). */
function quoteYaml(value) {
	return `'${value.replaceAll("'", "''")}'`;
}
/** Read the patch file lines; a missing or empty-list template yields a fresh list. */
function readPatchLines() {
	try {
		return readFileSync(profilePatchPath(), "utf8").split("\n");
	} catch {
		return ["[]"];
	}
}
/**
* Set (or insert) `modelUrl` on the top-level `live2d` patch entry, preserving
* every other line. The patch replaces the whole row config at mount, and the
* schema fills the remaining fields, so a single-key entry is sufficient.
*/
function setModelUrlInPatch(lines, modelUrl) {
	const entryIdx = lines.findIndex((line) => /^- id:\s*live2d\s*$/.test(line));
	if (entryIdx === -1) {
		const significant = lines.filter((line) => line.trim() !== "" && line.trim() !== "[]");
		if (significant.length === 0) return [
			"- id: live2d",
			"  config:",
			`    modelUrl: ${quoteYaml(modelUrl)}`,
			""
		];
		return [
			...significant,
			"- id: live2d",
			"  config:",
			`    modelUrl: ${quoteYaml(modelUrl)}`,
			""
		];
	}
	let configIdx = -1;
	for (let i = entryIdx + 1; i < lines.length; i += 1) {
		const line = lines[i] ?? "";
		if (/^- /.test(line)) break;
		if (/^  config:\s*$/.test(line)) {
			configIdx = i;
			break;
		}
	}
	if (configIdx === -1) {
		lines.splice(entryIdx + 1, 0, "  config:", `    modelUrl: ${quoteYaml(modelUrl)}`);
		return lines;
	}
	for (let i = configIdx + 1; i < lines.length; i += 1) {
		const line = lines[i] ?? "";
		if (/^    \S/.test(line)) {
			if (/^    modelUrl:/.test(line)) {
				lines[i] = `    modelUrl: ${quoteYaml(modelUrl)}`;
				return lines;
			}
			continue;
		}
		if (/^\s*\S/.test(line)) {
			lines.splice(i, 0, `    modelUrl: ${quoteYaml(modelUrl)}`);
			return lines;
		}
	}
	lines.push(`    modelUrl: ${quoteYaml(modelUrl)}`);
	return lines;
}
/** Remove the whole `live2d` entry from the user patch layer (reset to bundle default). */
function removeLive2dEntry(lines) {
	const entryIdx = lines.findIndex((line) => /^- id:\s*live2d\s*$/.test(line));
	if (entryIdx === -1) return lines;
	let end = entryIdx + 1;
	while (end < lines.length) {
		const line = lines[end] ?? "";
		if (line.trim() === "" || /^\s/.test(line)) end += 1;
		else break;
	}
	return [...lines.slice(0, entryIdx), ...lines.slice(end)];
}
/**
* A profile patch that is empty or comments-only parses to nothing, which the
* DSH include parser rejects ("disable the layer with []") — so after a reset
* that leaves no entry, keep the file parseable with the empty-list marker.
*/
function ensureParseablePatch(lines) {
	if (lines.some((line) => {
		const trimmed = line.trim();
		return trimmed !== "" && trimmed !== "[]" && !trimmed.startsWith("#");
	})) return lines;
	return [...lines.filter((line) => line.trim() !== "[]"), "[]"];
}
/** Validate a user-supplied model URL (absolute http(s) or relative path). */
function isValidModelUrl(value) {
	if (typeof value !== "string") return false;
	const trimmed = value.trim();
	if (trimmed.length === 0 || trimmed.length > 2048) return false;
	if (/^https?:\/\//i.test(trimmed)) return true;
	return /^[^"'<>\\]+\.[a-zA-Z0-9]+(\?.*)?$/.test(trimmed);
}
/** Read the POST body as JSON. */
function readJsonBody(req) {
	return new Promise((resolve, reject) => {
		let body = "";
		req.on("data", (chunk) => {
			body += chunk.toString("utf8");
			if (body.length > 65536) {
				reject(/* @__PURE__ */ new Error("request body too large"));
				req.destroy();
			}
		});
		req.on("end", () => {
			try {
				resolve(body.length === 0 ? {} : JSON.parse(body));
			} catch (error) {
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
		req.on("error", reject);
	});
}
/** Plugin body: register the config routes for the composed row config. */
function apply(ctx, config) {
	ctx.effect(() => {
		const webServer = ctx.webServer;
		if (webServer === void 0) return () => {};
		const json = (res, status, body) => {
			res.statusCode = status;
			res.setHeader("content-type", "application/json");
			res.setHeader("cache-control", "no-store");
			res.end(JSON.stringify(body));
		};
		const dispose = webServer.register({
			kind: "exact",
			path: CONFIG_ROUTE,
			handler: async (req, res) => {
				if ((req.method ?? "GET").toUpperCase() !== "POST") {
					json(res, 200, {
						ok: true,
						config,
						defaultModelUrl: DEFAULT_CONFIG.modelUrl
					});
					return;
				}
				let payload;
				try {
					payload = await readJsonBody(req);
				} catch (error) {
					json(res, 400, {
						ok: false,
						message: `invalid JSON body: ${error instanceof Error ? error.message : String(error)}`
					});
					return;
				}
				const body = payload ?? {};
				try {
					let lines = readPatchLines();
					if (body.reset === true) lines = ensureParseablePatch(removeLive2dEntry(lines));
					else if (isValidModelUrl(body.modelUrl)) lines = setModelUrlInPatch(lines, body.modelUrl.trim());
					else {
						json(res, 400, {
							ok: false,
							message: "modelUrl must be a non-empty http(s) URL or relative path"
						});
						return;
					}
					writeFileSync(profilePatchPath(), lines.join("\n"));
					json(res, 200, {
						ok: true,
						modelUrl: body.reset === true ? null : body.modelUrl
					});
				} catch (error) {
					json(res, 500, {
						ok: false,
						message: `failed to persist config: ${error instanceof Error ? error.message : String(error)}`
					});
				}
			}
		});
		return () => {
			dispose();
		};
	}, "dsh-live2d: config route");
}
//#endregion
export { CONFIG_ROUTE, Config, apply, inject, name };
