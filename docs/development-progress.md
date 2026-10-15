# 开发进展

2026-10-15 用户授权按 Trellis PRD 开始实施。分支：`codex/generic-purchase-desktop`。

## M1：桌面技术验证

- 已接入 Electron 44.7.2、electron-vite 6.0.0、electron-builder 26.15.3 和 Zod 4.6.7，锁定具体版本。
- 新增 main / preload / renderer 分层入口，分别执行 Node 与无 Node 全局类型的 renderer 严格检查。
- Renderer 使用受限 preload；主进程校验 IPC 来源、主 frame 和输入，启用 sandbox、contextIsolation，限制导航、新窗口和权限。
- 单实例按用户数据目录管理；桌面数据默认在 Electron userData，测试用 `CARTPILOT_DATA_DIR` 指定独立绝对路径。
- 命令：`npm run desktop:dev`、`npm run desktop:build`、`npm run desktop:start`、`npm run desktop:test`。
- 旧网页入口按渐进迁移保留，现有 4 个大文件基线没有增长。

验证：`npm run desktop:build`、`npm run desktop:test`（2 项）、`npm run build` 通过。真实 Electron 启动测试确认无 Node 全局、preload 可用、sandbox 与 contextIsolation 生效，外部新窗口被拒绝。首次运行下载 Electron 耗时超出测试时限，下载完成后重跑通过。

### 扩展桥与连接验证

- 提取现有连接、端点校验和官方中继模块，旧服务使用兼容入口，保留固定 Playwright 1.64.1 与 `noDefaults` 语义。
- Electron 使用 utilityProcess 管理连接，官方中继通过随包 Electron 的 Node 模式运行，不要求用户安装 Node 或 tsx。
- 桌面支持安装入口、授权等待与取消、平台标签列表、显式接入、只读登录检测及定位页面。导航、关闭和断开会废弃接入状态；断开保留浏览器页面。
- 主进程、preload 和工作进程的消息均经 schema 校验，不暴露脚本、Cookie、任意 URL 或购买接口。
- `npm test` 72 项通过；`npm run desktop:test` 5 项通过；桌面和旧网页构建、行数检查通过。桌面测试覆盖真实 utilityProcess → Node 中继的扩展缺失回报；离线 Browser.bind → chromium.connect 覆盖接入、去跟踪、登录、互斥和断开。截图：`output/playwright/desktop.png`。
- 为保持现有运行连接，未在用户日常 Chrome 中发起新授权；真实官方扩展授权与安装后的接入仍待实机记录，不以离线验证替代。

### SQLite 与持久化验证

- 固定 better-sqlite3 13.0.3、Drizzle ORM 0.45.4、Drizzle Kit 0.31.11；使用稳定版本，未采用官网当前示例的 RC。
- 接入官方 Drizzle 迁移，数据库保存在 Electron userData，启用 WAL、FULL 同步、外键和 busy timeout。启动校验数据库及设置，退出关闭连接。
- 保存 Chrome 资料目录偏好与安装标识；不保存令牌、标签页 ID 或浏览器会话，不读写旧 `.data`。
- `postinstall` 使用 electron-builder 为 Electron ABI 重建原生依赖，已在 Windows x64 成功装载。
- `npm run desktop:build` 和 `npm run desktop:test` 6 项通过，新增真实 Electron 原生模块迁移、关闭、重启、设置持久化及不重复迁移测试；重启保持未连接，不自动授权浏览器。

### Windows 安装包验证

- 已生成 `release/CartPilot-2.1.0-x64-Setup.exe`，Windows x64 NSIS 安装包，约 122 MiB；随包包含 Electron，不依赖用户另外安装 Node 或 tsx。
- 使用 ASAR 打包；执行工作进程、Playwright、Zod 和 SQLite 原生文件按需要解包，Drizzle 迁移作为资源分发。
- 首次实际安装发现 worker 无法加载 ASAR 内的 Zod，补充解包配置后通过。验证安装在仓库外的独立临时目录，避免源仓库依赖掩盖漏包。
- `npm run desktop:verify-package` 使用 PowerShell 7 检查已有安装，隔离安装、运行 3 项真实安装后测试并卸载。覆盖 renderer 隔离、utilityProcess 与官方中继缺失扩展回报、SQLite 迁移与重启持久化、单实例拒绝重复启动；卸载保留用户数据。
- 实际安装包验证通过，测试副本已卸载。记录保存在 `output/packaging/*/verification.json`，截图保存在 `output/playwright/installed-desktop.png`。
- 开发构建的桌面测试共 7 项通过；旧版 72 项回归通过；新代码满足 400 行，4 个历史文件仍按原基线待后续拆分。

M1 尚缺用户日常 Chrome 中的官方扩展授权、接入与断开实机记录；为保留现有运行连接未发起该操作。M1 与 PRD 整体验收仍未勾选，M2–M6 尚未实施。当前安装包是连接与存储验证版，未启用购买任务。

### 桌面界面沿用原网页版视觉

- 按用户反馈，恢复原网页版的炭黑底色、荧光绿强调色、固定侧栏、面包屑和编号工作区，延续现有字体与 Lucide 图标体系。
- 工作台集中展示扩展连接、标签页选择、准备状态与五平台登录列表；运行环境和数据库信息移入应用设置，接入说明单独展示。页面切换保留连接状态、平台选择和资料目录输入。
- 标签页长标题与 URL 在表格内截断，操作保留可访问名称；分别显示需要登录、待验证和检测过期，未提供购买任务执行入口。
- `npm run desktop:build`、`npm run desktop:test`（7 项）、新增与修改文件的 Prettier 检查及行数检查通过。4 个历史超限文件未增长。
- 真实 Electron 检查 1280、1120、760 宽度，无页面横向溢出；隔离 renderer fixture 补充已连接、长标题、登录异常及 390 宽度，刷新、接入、重新检测、定位和断开操作正常。未向用户日常 Chrome 发起授权。
- 截图与隔离检查报告位于 `output/playwright/workspace-*.png`、`connected-fixture.png`、`ui-review.json`。本次更新本地桌面构建，之前的 M1 安装包未重新生成。

## M2：通用任务与订单内核（实施中）

### 通用契约与数量规则

- 新增通用商品规格、候选详情链接、两种数量模式、单笔数量、人民币整数分预算与含时区计划的严格 schema；新建任务必须显式选择提交方式，减量默认关闭。
- 详情链接按平台校验并去除跟踪参数，Apple 商品入口覆盖非手机商品；这些属于目标契约，不代表相应页面流程已经适配。
- 纯领域规则按商品件数汇总已确认、未决与预留数量和金额；合计模式共享额度，分平台模式共享本平台额度，所有平台共享任务总预算。库存、限购或剩余配额不足时遵守减量开关。
- `npm run desktop:check`、6 项新增单元测试及 `npm run check:lines` 通过；未触发浏览器操作，4 个历史大文件未增长。
- M1 的真实 Chrome 授权接入仍待验收；本阶段继续可独立验证的离线内核，不将 M1 标为完成。事务预留、提交幂等、状态机与旧数据迁移继续实施。

## 后续阶段

完成 M2 通用任务与订单内核 → M3 工作台 → M4 平台适配 → M5 模型协助 → M6 迁移交付。以 PRD 的已确认范围和各阶段退出条件为准。
