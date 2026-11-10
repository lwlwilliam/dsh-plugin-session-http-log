# 会话 HTTP 记录（Session HTTP log）

一个 DeepSeek Harness 插件 bundle：把**某个会话真实发出的 HTTP 报文**原样记录下来，并在右侧边栏提供查看界面。

它不读取已有的 Session log，而是直接包裹宿主进程的 `globalThis.fetch`，抓取线上的原始字节：
请求方法、URL、请求头、请求体；响应状态、响应头、响应体；以及耗时和传输错误。模型 API 调用
（包括流式 SSE 响应体）、联网搜索/抓取，以及 Agent 工作期间发出的其它 HTTP 请求，都会通过
Harness 的 initiator 链归属到对应会话。

## 使用

安装并启用后，**刷新一次 Web GUI 页面**（新安装的浏览器端 bundle 在下次页面加载时生效），
本插件提供**两个入口**，共用同一份数据：

- **主视图 Tab（推荐）**：聊天区顶部的 `对话 / 轨迹 / 统计 / …` 这一行里会多出 **HTTP 记录**
  （宽度不够时在 **…** 菜单里）。这是宽布局：左侧请求列表、右侧详情报文并排，适合深挖大报文。
- **右侧边栏**：打开右侧边栏（`Ctrl/Cmd+Shift+.`，或 guide 菜单）选择 **会话 HTTP 记录**；
  窄布局，适合边聊天边快速瞄一眼请求，不打断当前主视图。

两者功能一致（展开/折叠、定位、占用空间、打开目录、导出 HAR、清空、中/EN 切换）。

### 面板操作

请求会实时出现在列表里：
- **点击一行**展开该请求的请求/响应数据，**再点同一行**折叠；选中行有明显的品牌色高亮，
     列表与详情之间有清晰的分隔；
- 详情顶部固定一条工具条显示当前展开请求的方法、路径与状态，点其中的 **定位** 按钮
     可把请求列表滚动到该记录并聚焦高亮；
- 详情里的“概览 / 请求头 / 请求体 / 响应头 / 响应体”区块也可以点击标题展开或折叠；
- 请求体、响应体默认显示**原始报文**，JSON 可切换美化显示；支持复制、复制为 cURL；
- 请求/响应超过截断阈值、或响应体为二进制（base64）时会显示标记；
- 顶部显示本会话的请求数与**总体占用空间**（鼠标悬停可看磁盘文件大小与保存目录）；
- 顶部 **打开目录** 按钮会在系统文件管理器中打开记录保存目录；
- **筛选** 支持按方法、URL、状态码、模型或类型过滤；
- **导出 HAR** 会下载 HAR 1.2 文件；**清空** 会删除本会话的内存记录与磁盘文件。
- 界面语言跟随 GUI 的全局语言（设置 → 通用 → 语言），同时面板头部有一个 **中 / EN** 快捷切换，只影响本面板，并会记住选择。

## 安装

本插件是一个包含 Host 半与 Client 半的 bundle。推荐通过 **Plugins（插件）页面** 安装：

1. 打开侧边栏的 **Plugins** 页面（或设置中的插件管理）。
2. 选择安装/添加，目标是**本地包目录**（即本仓库根目录、`package.json` 所在目录），或一个 registry
   包规范（如果发布到 registry）。
3. 安装完成后刷新一次 Web GUI 页面；右侧边栏 guide 中会出现 **会话 HTTP 记录**。

命令行等价方式（`npx`/全局安装的 `dsh`、以及项目内 CLI 均可）：

```bash
dsh plugin --profile web add <本包目录绝对路径>
# 或安装 registry 包：dsh plugin --profile web add <package-name>
```

安装会写入当前 profile 的 `package.json`（`dependencies` 与有序的 `dsh.profile.bundles` 列表）、
`pnpm-lock.yaml`，以及 profile 的 `node_modules`（本地目录安装使用 `link:`）。Host 半会立即
尝试通过 HMR 生效，Client 半需要刷新页面。安装前 DSH 会校验 `engines.dsh`，不满足时拒绝安装。

## 从 GitHub 安装（发布到 GitHub 之后）

**不是必须发布 Release 包**：DSH 也支持直接把 GitHub 仓库地址作为安装目标（内部先用
`git ls-remote` 校验，再交给 pnpm 拉取）。但用 Release 里的 `.tgz` 更稳：版本固定、不依赖
git、不需要任何构建脚本、可以校验 sha256，因此本仓库自带一个 GitHub Action **每次提交自动
打包并发布 Release**。

把**本包目录本身**作为仓库根目录推送到 GitHub（`package.json`、`index.js`、`client.js`、
`.github/` 都在根上；不要把上层 `tmp/` 一起推），然后：

**方式 A：Release 里的 .tgz（推荐）**

每次 push 到 `main` / `master` 会创建 tag `build-<提交短 SHA>` 的 Release，附：

```
dsh-plugin-session-http-log-<version>-<短SHA>.tgz
dsh-plugin-session-http-log-<version>-<短SHA>.tgz.sha256
```

在 Plugins 的安装框填入该 Release 资产的下载地址，或命令行：

```bash
dsh plugin --profile web add \
  https://github.com/<owner>/<repo>/releases/download/build-<短SHA>/dsh-plugin-session-http-log-0.1.0-<短SHA>.tgz
```

安装前可核对：`sha256sum -c dsh-plugin-session-http-log-0.1.0-<短SHA>.tgz.sha256`。

**方式 B：GitHub 仓库地址**

```bash
dsh plugin --profile web add https://github.com/<owner>/<repo>
```

或在 Plugins 安装框直接填仓库地址。前提是仓库根目录就是插件包根目录，且没有会阻塞安装的
`prepare` 构建脚本（本插件是纯 JS、无构建步骤）。代价是每次安装都走 git 拉取，升级需要重新
安装/指定 commit，不如 release 包可追溯。

### 随附的 GitHub Action

文件：[`.github/workflows/ci-release.yml`](.github/workflows/ci-release.yml)

- `push` 到 `main` / `master`：先跑语法检查和两个冒烟测试（`node test/host-smoke.mjs`、
  `node test/client-smoke.mjs`），通过后 `npm pack` 打包，创建/更新
  `build-<短SHA>` Release，并上传 workflow artifact（Actions 页面可直接下载）。
- `pull_request`：只跑测试，不发布。
- 手动 `workflow_dispatch`：同样为当前提交发布。
- 重跑同一提交会复用已有 Release 并覆盖资产（不会因 tag 已存在而失败）。
- 若不想每个提交都产生 Release，把 release job 的 `if:` 改成 tag 触发即可
  （workflow 注释里写了具体改法）。

## 发布到 npm（可选）

**不是“开个账号 + 填 GitHub 地址”就行**：npm 发布需要 npm 账号与一个**可发布的包名**，
认证通过 `npm login` 或 Access Token（CI 里是仓库 Secret）；GitHub 地址只是 npm 包的
`repository` 元数据/来源关联，不是认证或安装配置。

### 发布前必须改的字段

| 字段 | 当前值 | 发布前 |
|---|---|---|
| `name` | `@local/dsh-plugin-session-http-log` | `@local` 是本地占位 scope，不能发布。改成未被占用的名字，例如 `dsh-plugin-session-http-log`（查询 npm registry 时可用），或你自己的 scope `@<你的npm用户名>/dsh-plugin-session-http-log`（scoped 包需先在 npm 创建 scope/org，并设 `"publishConfig": { "access": "public" }`）。 |
| `private` | `true` | 删除该字段（或设为 `false`），否则 `npm publish` 会直接拒绝。 |
| `repository` | 未设置 | 建议补上 GitHub 仓库地址（`{"type":"git","url":"git+https://github.com/<owner>/<repo>.git"}`）。它也是 npm `--provenance` 生效的前提；缺省时发布 workflow 会跳过 provenance。 |
| `license` / `keywords` / `homepage` | 未设置 | 可选，但公开包建议补齐。 |

`files`、`exports`、`dsh.bundle.patch`、`engines.dsh` 已经就绪，`npm pack` 只会带
`index.js`、`client.js`、`cordis.patch.yml`、`locale/*`、`icon.svg`、`README.md`、`package.json`。

### 认证方式（二选一）

1. **NPM_TOKEN（最通用）**：npmjs → Access Tokens 创建 Granular Access Token（对该包
   read/write），在 GitHub 仓库 Settings → Secrets and variables → Actions 添加 `NPM_TOKEN`。
   仓库自带的 `.github/workflows/publish.yml` 会把它作为 `NODE_AUTH_TOKEN` 使用。
2. **Trusted Publishing / OIDC（无需长期 token，推荐后续使用）**：在 npmjs 该包的
   Settings → Trusted Publishing 里绑定本 GitHub 仓库与 workflow；workflow 已声明
   `id-token: write`。首次发布通常仍需要一次 token 或本地 `npm publish` 把包建出来。

### 发布

```bash
npm version patch            # 或 minor/major，生成 vX.Y.Z tag
git push && git push --tags  # 触发 .github/workflows/publish.yml
```

`publish.yml` 只由 `v*` tag（或手动 Run workflow）触发，会先做 preflight（检查 private、
占位包名、tag 与 version 是否一致）、跑冒烟测试，再 `npm publish --access public`
（有 `repository` 时加 `--provenance`）。手动运行时默认只做 `--dry-run`，可在输入里关掉。

发布后安装：

```bash
dsh plugin --profile web add dsh-plugin-session-http-log   # 或 @<scope>/dsh-plugin-session-http-log
```

之后 Plugin Manager 会把它当作可检查更新的 registry 包。注意：**registry 包名与本地占位的
`@local/dsh-plugin-session-http-log` 是不同包名**；本机若还装着改名前的 `@local/session-http-log`，
需要先卸载旧包再安装（抓包数据目录不受影响）。

`package.json` 已经使用 `@local/dsh-plugin-session-http-log`，发布前只需按上表去掉 `@local`
占位 scope 并移除 `"private": true`。

## 卸载

**Plugins 页面**：找到 **会话 HTTP 记录**，选择 **卸载**。命令行等价方式：

```bash
dsh plugin --profile web remove @local/dsh-plugin-session-http-log
```

> 两种方式**效果完全一致**：Web 页面的“卸载”和 `dsh plugin remove` 都走同一个
> `pluginManager.removeBundle` 服务与共享的 package 操作实现（bundle 列表移除 → 运行期卸载 →
> pnpm remove），不是两套逻辑。
>
> 通用卸载确认框（“卸载后它提供的功能会消失。”）是 DSH 统一提供的，**插件无法插入自定义
> 卸载警告**。因此本插件用三个地方提醒“抓包数据不会随卸载删除”：
> ① Plugins 页面里本插件的描述文字；② 面板中“打开目录”和占用空间悬停提示；③ 数据目录内自动
> 写入的 `README.txt` 说明。建议卸载前先在面板点 **清空**，或卸载后手动删除数据目录。

卸载会按顺序：从 `dsh.profile.bundles` 的 bundle 选择中移除 → 卸载运行中的插件（还原
`globalThis.fetch` 包装、移除 HTTP 路由）→ `pnpm remove` 删除依赖与包。下表说明会被清理和
不会被清理的内容：

| 内容 | 卸载时 | 说明 |
|---|---|---|
| profile `package.json` 的依赖与 bundle 列表 | ✅ 自动清理 | 回到安装前的选择，不留“核心配置修改记录”。 |
| `pnpm-lock.yaml`、profile `node_modules` 中的包 | ✅ 自动清理 | 本地目录安装是 `link:` 链接；实测 pnpm 可能残留一个失效符号链接（升级/改名前的旧包名，如 `profile/node_modules/@local/session-http-log`），不影响启动，可手动删除或忽略。 |
| profile `cordis.patch.yml`、`~/.dsh` 下的 home patch / `settings.yaml` | — 从未写入 | 本插件的安装与卸载都不修改这些文件（已检查：它们中始终没有本插件条目）。 |
| 运行中的插件实例 | ✅ 随卸载释放 | 还原 fetch 包装、移除 `/api/dsh-plugin-session-http-log/*` 路由；页面中的面板在刷新后消失。 |
| HTTP 记录数据（`$DSH_HOME/session-http-log/`） | ❌ **保留** | 这是用户的抓包数据，卸载不删除。彻底清理请手动删除该目录（或自定义的 `dataDir`）。 |
| Plugin Manager 操作日志（`profile/.plugin-manager/logs`） | ❌ 保留 | 运维日志，可手动清理或忽略。 |
| 插件源码目录（本地 `link:` 安装时） | ❌ 保留 | 本地安装只是链接，删除链接不会删除源码；不需要时手动删除包目录。 |
| 版本豁免（`profile/compatibility.json`） | — 正常使用不会产生 | 仅当曾为某个 DSH 版本手工授予豁免时才有，可用 `plugin_manager` 撤销。 |

彻底清空所有痕迹（含抓包数据）示例：

```bash
dsh plugin --profile web remove @local/dsh-plugin-session-http-log   # 或使用 Plugins 页面移除
rm -rf "$DSH_HOME/session-http-log"                       # 删掉抓包数据（若是自定义 dataDir 则换路径）
rm -rf <本包目录>                                         # 如不再需要插件源码
```

### npx 安装 vs 桌面版

两者共用同一套 profile 机制（`$DSH_HOME/profiles/<name>`：`package.json` + bundle 层 +
`cordis.patch.yml`），因此**卸载的清理范围和顺序一致**：

- **npx / CLI 安装的 dsh**：用 `dsh plugin --profile <profile> add|remove ...`，或应用内
  Plugins 页面；默认 Web profile 名为 `web`。
- **桌面版**：`desktop` 这个 profile 名由 Electron 应用保留，npm CLI 会拒绝对它做插件管理；
  请在桌面版应用内的 **Plugins** 页面操作（或使用桌面版自带的 dsh 命令）。它同样是
  “从 bundle 列表移除 → 卸载运行中的插件 → 删除依赖/包”，不会改 home patch。
  桌面版由应用拥有其 profile 目录，建议只通过界面操作，不要手工改它的 profile 文件。
- 抓包数据按**该安装的 Harness home**（通常是同一个 `~/.dsh`）定位；如果桌面版使用独立的
  home，则数据在它自己的 `$DSH_HOME/session-http-log` 下。卸载同样不会删除这些数据。

## 记录保存在哪

- **这是插件额外保存的独立数据，不是复用已有 Session log，也不修改 Session 本身。**
  原有 Session log 只保存会话事件，不保存 HTTP 原始报文；本插件另外抓取并另外存储。
- 默认每个会话一个 JSONL 文件：`$DSH_HOME/session-http-log/<sessionId>.jsonl`
  （通常为 `~/.dsh/session-http-log/`），每行是一条完整记录（含原始报文）。
- 目录名固定为 `session-http-log`，**不随插件包名 / 插件 id 改名**：这样改名后历史抓包数据
  仍在面板里可见，不会被“搬空”。
- 该目录内还会自动生成一个 `README.txt`，说明这目录的用途以及“卸载插件不会删除本目录”。
- 面板里的“占用空间”是本会话记录在内存中的估算大小；悬停提示里的“磁盘”是上述 JSONL 的
  实际大小；点击 **打开目录** 可直接定位。
- 也可以设置 `persist: false` 只保留内存记录；此时悬停提示会显示“未持久化”。
- 单个会话文件超过 `maxLogFileBytes`（默认 64 MiB）后停止继续写盘并只告警一次，但内存中的
  记录、面板列表与 HTTP 路由仍然正常；此时“占用空间”与“磁盘”可能不一致。

## 配置

在 bundle patch 的 `dsh-plugin-session-http-log` 行 `config` 中修改（profile 的 patch 层会实时生效）：

| 字段 | 默认值 | 含义 |
|---|---:|---|
| `maxRequestsPerSession` | `500` | 每个会话在内存中保留的记录条数上限，超出后先淘汰最旧的。 |
| `maxSessionBytes` | `33554432`（32 MiB） | 内存安全阀：本会话已存报文字节超过该值后淘汰最旧记录。 |
| `maxRequestBodyBytes` | `2097152`（2 MiB） | 抓取的请求体前缀上限。 |
| `maxResponseBodyBytes` | `4194304`（4 MiB） | 抓取的响应体前缀上限。 |
| `redactSensitiveHeaders` | `true` | 把凭据类请求头的值替换为 `[redacted]`（如 `authorization`、`cookie`、`x-api-key`）。 |
| `persist` | `true` | 是否把完成的记录追加写入 `dataDir` 下的 JSONL。 |
| `dataDir` | `$DSH_HOME/session-http-log` | 记录保存目录（无 `DSH_HOME` 时回退到 `~/.dsh/session-http-log`）。 |
| `maxLogFileBytes` | `67108864`（64 MiB） | 单个会话日志文件超过该大小时停止继续写入并只告警一次。 |
| `captureUnattributed` | `false` | 为 `true` 时，无法归属到会话的请求也会记录到 `unattributed` 桶。 |
| `openDirectoryCommand` | `''` | “打开目录”使用的命令；留空按平台选择（macOS `open`、Windows `explorer.exe`、其它 `xdg-open`）。 |

## 兼容性与版本约束

插件在 `package.json` 中声明了运行版本要求：

```json
"engines": { "dsh": "^0.2.2-rc.1" }
```

即兼容 `>=0.2.2-rc.1 <0.3.0`。DSH 在启动和每次 profile 重新组合时会校验该范围：不满足时
**不会静默加载**，而是跳过该 bundle 并报告不满足的版本要求，避免接口变化后插件以损坏状态运行。
未来若升级到新的预发布版本（例如 `0.2.3-rc.1`）而被拒绝，更新该范围，或在
Plugin Manager 中为“包名@版本 + 运行时版本”这一精确组合授予版本豁免后重试。

## 文件

| 文件 | 作用 |
|---|---|
| `index.js` | Host 半：fetch 观测器、按会话存储、JSONL 持久化、`/api/dsh-plugin-session-http-log/*` 鉴权路由。 |
| `client.js` | 浏览器半：右侧边栏 tab 类型与面板、中/英字典、主题 token 样式、面板内语言切换。 |
| `locale/*.json` | Plugin Manager 的显示元数据（标题/描述），不是运行期词典。 |
| `icon.svg` | 插件图标。 |
| `test/host-smoke.mjs` | Host 冒烟测试：真实插件 + 伪造 Cordis 上下文 + 本地 HTTP 服务器。 |
| `test/client-smoke.mjs` | Client 冒烟测试：真实 bundle 工厂 + 伪造客户端上下文，断言注册与渲染。 |
| `CONTRACT.md` | 本插件的实现契约（构建时使用）。 |
| `.github/workflows/ci-release.yml` | CI：跑冒烟测试，并为每次提交打包发布 GitHub Release。 |
| `.github/workflows/publish.yml` | 可选：推 `v*` tag 时发布到 npmjs（带 preflight、测试与 provenance）。 |

## 安全与限制

- 原始报文包含对话内容与提供方元数据；`persist: true` 时正文会未脱敏写入会话 JSONL（凭据类
  请求头默认打码）。如不需要，请在面板中点“清空”或配置 `persist: false`。
- HTTP 路由挂在 Harness 已鉴权的 Connection 通道上，只有拥有该 Host 的浏览器会话可读取。
- 仅观测 `globalThis.fetch` 的流量；绕过 fetch 的传输（原生 socket、子进程、浏览器自身请求）
  不会被记录。
- 报文按配置上限抓取前缀，超限时取消抓取副本，**不会延迟或截断调用方自己的响应流**。
- 观测器会串联此前已安装的 fetch 包装器（Developer tools 的 Inspector 也会包装 fetch），
  卸载时只还原自己那一层。

## 验证

```bash
cd <本包目录>
node --check index.js && node --check client.js
node test/host-smoke.mjs
node test/client-smoke.mjs
```

两个冒烟测试均通过。真实页面中的视觉效果需要在打开会话后展开右侧边栏查看。
