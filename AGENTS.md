# 项目开发约定

本约定适用于整个仓库。

- 开发前阅读 `docs/requirements.md`、`docs/architecture.md` 和 `docs/engineering-standards.md`，按已确认的功能范围与工程规范实施。
- 采用 Electron 的 main / preload / renderer 分层；按职责逐步迁移现有模块，不提前建立空目录或整体搬动未拆分的大文件。
- 新增或迁移的手写代码文件默认不超过 400 个物理行，空行和注释计入。按业务职责拆分，不使用压缩长行或无意义的 part 文件规避。
- 运行 `npm run check:lines` 检查行数。`config/file-size-baseline.json` 仅记录现有 4 个待拆分文件，禁止增长；降到限额以内或删除后移除对应记录。迁移完成运行 `npm run check:lines:strict`。
- 保持 TypeScript 严格模式，外部输入使用 schema 校验；不以 any、类型断言或禁用检查掩盖错误。
- 遵守 `.editorconfig` 和 `.prettierrc.json`。不因当前任务进行无关的全仓格式化或重命名。
- 普通模块文件使用 kebab-case，React 组件使用 PascalCase，自定义 hooks 使用 use + camelCase；业务术语保持一致。
- 领域规则不依赖 Electron、Playwright、React、模型 SDK 或数据库。Renderer 仅经受限 preload 使用业务接口。
- 优先使用成熟框架和官方推荐规则，复用现有可用能力；不自行重造状态机、模型 SDK、构建器或浏览器协议。
- 业务改动按影响运行必要验证；纯文档和低影响配置不添加镜像测试。浏览器验证使用隔离数据，保留现有运行连接和订单记录。
