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

实际安装包尚待验证，M1 及 PRD 验收项均未标为完成。

## 后续阶段

M2 通用任务与订单内核 → M3 工作台 → M4 平台适配 → M5 模型协助 → M6 迁移交付。以 PRD 的已确认范围和各阶段退出条件为准。
