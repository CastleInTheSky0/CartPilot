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

扩展工作进程、SQLite 与实际安装包尚待验证，M1 及 PRD 验收项均未标为完成。

## 后续阶段

M2 通用任务与订单内核 → M3 工作台 → M4 平台适配 → M5 模型协助 → M6 迁移交付。以 PRD 的已确认范围和各阶段退出条件为准。
