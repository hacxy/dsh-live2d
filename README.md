# dsh-live2d

DSH Web 插件：在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 Web 页面**右下角**展示一个 Live2D 角色——带加载进度条、支持拖拽，模型地址可在 Web 设置界面随时更换。渲染基于 [l2d](https://github.com/hacxy/l2d) 库（内置 Cubism 2 & 6 运行时，零额外 SDK）。

- 形态：官方 **bundle 插件**（`dsh.bundle` 组合层 + `dsh.client` 浏览器半）
- 依赖：l2d 已打进 client bundle，用户**零额外安装**
- 默认模型：`https://model.hacxy.cn/Mao/Mao.model3.json`（Cubism 6），可在设置界面换成任意 `.model.json` / `.model3.json`

## 安装

### 本地目录（开发验证）

```sh
# 在包目录内构建（产物 lib/ 需已存在）
pnpm install && pnpm run build

# 安装进 web profile（bundle 声明 dsh.bundle → 自动进入 dsh.profile.bundles 层栈）
dsh plugin --profile web add /path/to/dsh-live2d

# 重启 web 后生效
dsh web
```

### Git 源（发布后用户可一行安装）

仓库内已提交构建产物 `lib/`（git 安装不执行构建），因此：

```sh
dsh plugin --profile web add "github:you/dsh-live2d#<commit>"
```

### npm（发布后）

```sh
dsh plugin --profile web add dsh-live2d
```

## Web 设置（模型地址可配）

设置 → **Live2D** 分区：输入模型地址 → 保存。保存会写入 profile 的用户 patch 层（`~/.dsh/profiles/web/cordis.patch.yml`），HMR 热重载 `live2d` 行后挂件自动用新模型重新加载，无需重启；**恢复默认**按钮清除用户覆盖，回到部署默认模型。

## 配置（profile patch）

插件在 bundle 层插入一行 `live2d`，默认值即 `cordis.patch.yml` 中的行配置。除了设置界面，也可以直接在用户 profile 层覆盖（**id 命中的 patch 会整体替换该行 config，需重述所有要保留的字段**）：

`~/.dsh/profiles/web/cordis.patch.yml`：

```yaml
- id: live2d
  config:
    enabled: true
    modelUrl: 'https://model.hacxy.cn/Mao/Mao.model3.json'   # 换成你的模型
    width: 280
    height: 360
    offsetX: 12
    offsetY: 12
    anchor: 'right'       # 'left' | 'right'
    scale: 1
    opacity: 1            # 0 ~ 1
    zIndex: 9999
    draggable: true
    volume: 0             # 0 ~ 1
    logLevel: 'warn'      # 'error' | 'warn' | 'info' | 'trace'
```

改完**重启 web**（bundle 层栈生效）；只改用户 patch 层时 HMR 会热重载 host 半，页面刷新即可看到新配置。

| 字段 | 默认值 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `modelUrl` | Mao（Cubism 6） | 模型入口文件，`.model.json` 或 `.model3.json`；设置界面可改 |
| `width` / `height` | `280` / `360` | 挂件 CSS 尺寸（px） |
| `offsetX` / `offsetY` | `12` / `12` | 距锚定边/底部的间距（px） |
| `anchor` | `'right'` | 锚定右下角或左下角 |
| `scale` | `1` | l2d 模型缩放 |
| `opacity` | `1` | 挂件透明度 |
| `zIndex` | `9999` | 层级 |
| `draggable` | `true` | 可拖拽（拖动后停在指针位置，刷新复位） |
| `volume` | `0` | 动作音效音量 |
| `logLevel` | `'warn'` | l2d 日志级别 |

## 卸载

```sh
dsh plugin --profile web remove dsh-live2d
```

## 工作原理

- **Node half**（`src/index.ts`）：Cordis entry，导出 `Config`（Schemastery schema），在 `ctx.webServer` 注册 `GET/POST /api/dsh-live2d/config`。GET 返回组合后的行配置与部署默认值；POST 把 `modelUrl`（或 `{reset:true}`）写入 profile 的用户 patch 层（保留注释、行级更新，注释-only 文件自动补 `[]` 保持可解析），profile HMR 随即重载 `live2d` 行。之所以用路由：静态 client 插件在浏览器端由内核以 `loader.create({ name })` 挂载、收不到行配置，且第三方 settings 命名空间在 Host api-proxy 白名单之外——自定义 HTTP 路由是第三方 bundle 唯一零改动通道（与社区 plugin-console 同款模式）。
- **Browser half**（`src/client/index.ts` + `Panel.tsx`）：`window.__ModuleLoader__.load({ id: 'dsh-live2d', factory })` 契约的 CJS bundle。`apply(ctx)` 里 `ctx.effect()` 挂载挂件（fetch 配置 → 固定定位容器 + canvas，默认右下角 → `l2d.init(canvas).load()`，监听 `loadstart`/`loadprogress`/`loaded` 驱动进度条 → 卸载时 `destroy()` + 移除 DOM）；`ctx.slots` 向 `settings.section` 注册 **Live2D** 设置分区（React 面板，保存后轮询 GET 直至 host 生效，再通过包内 pub-sub 通知挂件用新模型重载）。
- **构建**：tsdown 两段输出——`lib/index.mjs`（ESM，`@deepseek-ai/*` 保持 external，由 profile pnpm 闭包注入）与 `lib/client.js`（CJS + `__ModuleLoader__` 包装，l2d 内联；`react`/`react/jsx-runtime`/`@deepseek-ai/dsh-client-ui-primitives` 走 shell 模块表保持 external）。

## 开发

```sh
pnpm install
pnpm run typecheck   # tsc --noEmit
pnpm run build       # tsdown → lib/index.mjs + lib/client.js
```

浏览器端到端验证（需要本机装有 Chrome，且已把插件装进 web profile 并 `dsh web --port 3090` 运行）：

```sh
# 启动 headless Chrome（软件 WebGL；Cubism 6 模型在软件渲染下无法出画面属环境限制，
# 验证渲染时先把模型临时换成 Cubism 2，如 https://model.hacxy.cn/shizuku/shizuku.model.json）
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --no-sandbox --disable-gpu --enable-unsafe-swiftshader --use-angle=swiftshader-webgl \
  --disable-dev-shm-usage --no-first-run --no-default-browser-check --disable-crash-reporter \
  --user-data-dir=/tmp/dsh-chrome --remote-debugging-port=9224 about:blank &

DEBUG_PORT=9224 node scripts/e2e-verify-v2.mjs
```

`scripts/e2e-verify-v2.mjs` 覆盖：默认模型/右下角定位、加载进度条、设置面板改模型地址 → 保存 → 挂件重载，并输出页面 console 报错。

## 发布

1. `pnpm run build` 产出 `lib/`。
2. **建议把 `lib/` 提交进仓库**（`.gitignore` 已保留）——git 安装不执行构建，产物入库才是一行安装。
3. 发布到 npm：`npm publish`（`files` 已限定 `lib`、`cordis.patch.yml`、README、LICENSE）。`@deepseek-ai/*` 为 optional peerDependencies，官方运行时会注入，公共 npm 无需安装它们。

## 免责声明

本插件**不包含、不分发任何 Live2D 模型资源**。默认模型 URL 指向模型 CDN，请确认你有权使用所配置的模型（商用需遵循模型许可与 [Live2D Proprietary Software License](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html)）。

## License

[MIT](./LICENSE)
