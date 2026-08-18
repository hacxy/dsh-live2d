# dsh-live2d

DSH Web 插件：在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 Web 页面**右下角**展示一个 Live2D 角色——带加载进度条、支持拖拽，挂件的**全部行为都可在 Web 设置界面配置**（无需手动编辑任何配置文件）。渲染基于 [l2d](https://github.com/hacxy/l2d) 库（内置 Cubism 2 & 6 运行时，零额外 SDK）。

- 形态：官方 **bundle 插件**（`dsh.bundle` 组合层 + `dsh.client` 浏览器半）
- 配置：走**官方 settings 通道**（`@deepseek-ai/dsh-settings`），Web 设置写入 `~/.dsh/settings.yaml`，零手写 YAML
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

## Web 设置（全部行为可配，零配置文件编辑）

设置 → **Live2D** 分区：**13 个字段全部可编辑**，保存即生效（无需重启）。

| 分组 | 字段 | 说明 |
|---|---|---|
| 开关 | `enabled` | 总开关：关闭后右下角不再显示角色 |
| 模型 | `modelUrl` | 模型入口文件，`.model.json`（Cubism 2）或 `.model3.json`（Cubism 6） |
| 外观 | `width` / `height` | 挂件 CSS 尺寸（px） |
| 外观 | `opacity` | 挂件透明度 0~1 |
| 外观 | `zIndex` | 层级 |
| 位置 | `anchor` | 锚定右下角或左下角（`right` / `left`） |
| 位置 | `offsetX` / `offsetY` | 距锚定边/底部的间距（px） |
| 渲染 | `scale` | l2d 模型缩放 0.01~10 |
| 渲染 | `volume` | 动作音效音量 0~1 |
| 渲染 | `logLevel` | `error` / `warn` / `info` / `trace` |
| 交互 | `draggable` | 可拖拽（拖动后停在指针位置，刷新复位） |

保存与生效语义：

- 保存 = 把**发生变化的字段**经官方 `settings` RPC 逐个写入（通道为单字段写、无事务；保存期间挂件不重新加载，全部落定后按字段类型应用——尺寸/位置/开关等**布局字段**原地更新 DOM，模型地址/缩放/音量/日志级别等**渲染字段**才会重载模型）。
- **恢复默认** = 清除用户层覆盖，全部字段回到部署默认（schema 默认 → bundle 组合配置）。
- 外部对 `~/.dsh/settings.yaml` 的手动编辑会被 settings provider 监听并热更——同一 namespace 下所有已打开页面（含挂件与设置面板）自动刷新。
- 冲突保护：任何写入都带 `expectedRevision`；你的配置被外部修改后，面板会提示并自动刷新为最新值，不会静默覆盖。

## 配置分层（理解优先级）

配置不是"一个文件"，而是三层按序解析：

1. **schema 默认**（内置 `DEFAULT_CONFIG`）
2. **base 层**：插件组合配置（bundle 的 `cordis.patch.yml` 里的 `live2d` 行）——部署者想改默认值时在这里改
3. **user 层**：`~/.dsh/settings.yaml` 的 `dsh-live2d` 段——Web 设置界面写入的覆盖，优先级最高

```yaml
# ~/.dsh/settings.yaml（Web 设置面板写入，不要手改——面板会替你管理）
dsh-live2d:
  modelUrl: 'https://model.hacxy.cn/xxx/xxx.model3.json'
  width: 320
```

> 历史说明：早期版本（v0.1.x）用自建 HTTP 路由把 `modelUrl` 直接写进 `profiles/web/cordis.patch.yml`。v0.2.0 迁移到官方 settings 通道后已删除该通道；若你的用户 patch 层仍有手写的 `live2d` 行，它继续作为 **base 层**生效（无需迁移），settings 面板的值只在你通过 UI 保存后才会被 user 层覆盖。

## 卸载

```sh
dsh plugin --profile web remove dsh-live2d
```

## 工作原理

- **Node half**（`src/index.ts`）：Cordis entry，导出 `Config`（Schemastery schema，同时充当持久层校验 schema）。`apply` 调用 `installSettingsSection(ctx, NAMESPACE, Config, config, hooks)` 把插件自己的组合配置注册为 `dsh-live2d` namespace 的 **base 层**（`installSettingsSection` 来自 `@deepseek-ai/dsh-settings`，rides 插件 fiber，settings 服务未挂载时插件按组合配置原样工作）。用户层（`~/.dsh/settings.yaml`）由官方 settings provider 落盘、监听与校验：解析序为 schema 默认 → base → user，任何写坏 user 层的编辑都会被拒并保留最后好值。
- **Browser half**（`src/client/index.ts` + `Panel.tsx`）：`window.__ModuleLoader__.load({ id, factory })` 契约的 CJS bundle。`apply(ctx)` 里 `ctx.settingsScope.bind({ namespace: 'dsh-live2d' })` 绑定同一 namespace（settingsScope 由官方 `dsh-client-ui-settings` 提供，transport 经 connection RPC，loopback-only）：
  - **挂件**：`ctx.effect()` 挂载（固定定位容器 + canvas + 进度条，默认右下角 → `l2d.init(canvas).load()`，监听 `loadstart`/`loadprogress`/`loaded` 驱动进度条 → 卸载时 `destroy()` + 移除 DOM）。**订阅 scope 快照**：每次配置提交（本面板保存、外部编辑、其它 tab）都会 diff 新旧值——布局字段原地更新容器样式（不重载模型），渲染字段整体重建挂件。
  - **设置面板**：`ctx.slots` 向 `settings.section` 注册 **Live2D** 分区（React，`useSyncExternalStore` 订阅 scope 快照）。保存 = 校验（校验规则镜像 schema 的范围）后逐字段 `scope.set()`；恢复默认 = 按 user 层的字段 `scope.unset()`（回到 base）。
- **构建**：tsdown 两段输出——`lib/index.mjs`（ESM，`@deepseek-ai/*` 保持 external，由 profile pnpm 闭包注入）与 `lib/client.js`（CJS + `__ModuleLoader__` 包装，l2d 内联；`react`/`react/jsx-runtime`/`@deepseek-ai/dsh-client-ui-primitives` 走 shell 模块表保持 external；settings 契约类型 type-only）。

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

`scripts/e2e-verify-v2.mjs` 覆盖：默认模型/右下角定位、加载进度条、设置面板改模型地址 → 保存 → 挂件重载、改尺寸/锚定/总开关 → 保存 → 原地生效，并输出页面 console 报错。测试结束后自动恢复默认配置。

## 发布

1. `pnpm run build` 产出 `lib/`。
2. **建议把 `lib/` 提交进仓库**（`.gitignore` 已保留）——git 安装不执行构建，产物入库才是一行安装。
3. 发布到 npm：`npm publish`（`files` 已限定 `lib`、`cordis.patch.yml`、README、LICENSE）。`@deepseek-ai/*` 为 optional peerDependencies，官方运行时会注入，公共 npm 无需安装它们（其中 `@deepseek-ai/dsh-settings` 是配置通道依赖）。

## 免责声明

本插件**不包含、不分发任何 Live2D 模型资源**。默认模型 URL 指向模型 CDN，请确认你有权使用所配置的模型（商用需遵循模型许可与 [Live2D Proprietary Software License](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html)）。

## License

[MIT](./LICENSE)
