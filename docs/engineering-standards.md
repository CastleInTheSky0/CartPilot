# 工程与代码规范

版本：1.1  
更新日期：2026-10-15  
适用范围：本仓库新增代码、迁移模块与维护改动。

采用 Electron 常见的 main / preload / renderer 目录分层，结合 TypeScript 严格检查、ESLint、Prettier 和 EditorConfig。目录、命名和依赖边界在本项目内保持统一；功能范围见 [需求文档](./requirements.md)，完整迁移布局见 [技术方案](./architecture.md)。

## 1. 目录与模块职责

```text
src/
  main/
    app/                    # 应用入口、组合依赖、窗口与进程生命周期
    ipc/                    # 主进程业务命令、事件与来源校验
    domain/                 # 商品、任务、配额、订单与纯业务规则
    application/            # 用例和基础设施接口
    automation/             # 状态机、调度、订单执行与平台适配器
    infrastructure/         # 浏览器、模型、数据库和通知实现
    workers/                # 工作进程入口
  preload/                  # 最小化、类型明确的桥接接口
  renderer/
    app/                    # 页面路由、布局与应用级组合
    features/               # tasks、connections、models、history
    components/             # 多个功能确实复用的组件
    styles/                 # 设计变量与基础样式
  shared/
    contracts/              # 跨进程、模型和持久化边界的 schema
    types/                  # 跨进程使用的基础类型
config/                     # 检查工具的项目级配置与迁移基线
scripts/                    # 短小的开发与检查入口
tests/
  unit/
  integration/
  fixtures/
  packaging/
resources/                  # 随应用分发的必要资源
migrations/                 # 数据库迁移
docs/
```

- 先按运行环境分层，再按业务功能组织；不按文件大小机械拆出大量无明确职责的目录。
- `domain` 不依赖 Electron、Playwright、React、模型 SDK 或数据库。
- `application` 通过接口使用页面、存储、模型、时钟等能力，基础设施实现接口，在应用入口完成组合。
- Renderer 通过 preload 调用有类型的业务命令，不直接访问 Node、数据库或浏览器执行器。
- `shared` 仅保存确实共享的契约与基础类型，不能成为任意业务代码的堆放处。
- 平台适配器分别归入 `automation/adapters/{平台}`，共用的解析工具按具体职责命名；不继承 Apple 的业务实现来表示其他商城。
- 功能组件、hooks 和样式就近放在所属 feature；真正被多个 feature 使用后再提取共享组件。
- 不为尚未实现的功能预建大量空目录；迁移前保留现有可运行结构，按模块逐步移动。

## 2. 文件大小与拆分

手写代码默认每个文件不超过 **400 个物理行**，空行和注释计入；文件末尾的换行符不额外算一行。构建产物、锁文件、生成代码、测试快照、静态数据和文档不属于手写代码限额。

当前行数检查覆盖 TypeScript、JavaScript、JSX、CSS、SCSS、HTML、SQL、PowerShell、CMD / BAT 等代码文件。测试中的执行逻辑同样受限；大段页面样本放到独立 fixture 或静态数据文件。

拆分时优先考虑：

| 文件内容 | 推荐拆分方式 |
| --- | --- |
| 页面组件 | 页面组合、业务组件、表单、弹窗、状态 hooks |
| 执行服务 | 用例、状态机、调度、资源管理和结果处理 |
| 平台适配 | 商品读取、规格选择、结账读取、结果识别 |
| 样式 | 基础变量、布局、feature 或组件的 CSS Modules |
| 契约 | 按任务、浏览器连接、模型配置、订单等业务领域组织 |
| 测试 | 按行为分组，fixtures 与辅助工具单独存放 |

不使用压缩长行、删除必要注释或改成晦涩缩写来满足行数；不制造缺乏含义的 `part1`、`part2`、`misc` 模块。

现有 4 个超限文件记录在 `config/file-size-baseline.json`。普通检查暂时允许现有上限，禁止继续增长；文件降到 400 行以内或删除后必须移除相应基线，避免遗留豁免。迁移完成以严格检查无超限为验收条件。

## 3. 命名与导入

| 对象 | 约定 | 示例 |
| --- | --- | --- |
| 普通目录和模块文件 | 小写 kebab-case | `order-evidence.ts`、`task-service.ts` |
| React 组件与文件 | PascalCase | `TaskList.tsx` |
| 自定义 hook 与文件 | use + camelCase | `useTaskProgress.ts` |
| 类型、接口、schema | PascalCase，schema 加 Schema | `PurchaseTask`、`TaskSchema` |
| 变量、函数、参数 | camelCase，含义具体 | `remainingQuantity`、`reserveBudget` |
| 固定常量 | UPPER_SNAKE_CASE | `MAX_FILE_LINES` |
| 布尔值 | is / has / can / should 等语义前缀 | `isConnected`、`canSubmit` |
| 测试文件 | 与被测职责一致，使用 .test 后缀 | `order-evidence.test.ts` |

- 标识符使用英文，用户界面和业务说明使用清晰中文；平台或协议固定名称按原定义。
- 不增加含义不明确的 `I` 类型前缀；项目内对同一业务概念使用同一名称。
- 优先具名导出；框架入口和工具配置遵循工具自身约定。仅在需要公开模块接口时使用 `index.ts`。
- 导入按 Node 内置模块、第三方依赖、内部模块排列；类型使用 `import type`。
- 禁止循环依赖和跨运行环境反向导入。具体业务代码不从其他 feature 的内部文件随意取用实现。

## 4. TypeScript 与函数设计

- 保持 `strict: true`；迁移时按 main / preload / renderer 区分编译环境，避免把 Node 全局类型泄露到 renderer。
- 外部输入先用 `unknown` 接收并通过 schema 校验，禁止用 `any` 或强制断言代替实际校验。
- 导出服务、IPC 命令、适配器和持久化接口明确输入输出；不要求对可直接推断的局部变量重复标注类型。
- 函数与类职责集中，优先提前返回；重复规则集中在业务模块，避免在 UI、AI 和平台适配器各实现一份。
- 共享业务约束用明确的领域对象或枚举表达，避免散落的字符串、时间间隔和金额常量。
- 金额以整数分存储和计算，数量使用正整数；时间包含时区，在展示层转换。
- 避免隐藏的全局可变状态；可变状态由任务、资源管理器或存储组件明确拥有。
- 不为满足形式而引入复杂继承、通用工厂或过度抽象；优先组合与明确接口。

## 5. 异步、状态与错误

- 所有 Promise 有明确的等待或错误处理路径；购买动作按依赖顺序执行，只并行互不冲突的操作。
- 长任务接受取消信号，退出时清理计时器、监听器和进程；禁止用固定延时推断网页动作已经成功。
- 预期业务状态用明确的结果和状态表达；技术异常保留上下文，不静默吞掉。
- 重试只针对可重试操作，必须设次数和退避；可能生成订单的操作遵循持久化意图与结果核对规则。
- 日志使用结构化字段标识任务、运行、候选和错误；不记录 Key、Cookie、地址或支付内容。
- UI、AI 与执行器均以同一任务状态和订单证据为准，避免维护互相矛盾的成功标记。

## 6. React 与样式

- 使用函数组件和 hooks；组件负责展示与交互，购买判断、预算和配额规则留在业务层。
- 表单、派生状态、网络订阅和定时器按职责拆 hooks；能从现有状态计算的值不重复保存。
- 组件参数使用明确的 Props 类型，列表使用稳定业务 ID，订阅和 effect 必须清理。
- Feature 和组件样式优先 CSS Modules；全局样式仅保存基础样式、布局规范和设计变量。
- 基于统一变量管理颜色、间距和字体，不继续扩大全局样式文件。
- 常见交互组件优先复用合适的成熟组件，保留键盘操作、焦点和可访问名称。

## 7. 格式与检查工具

| 工具 | 职责 | 当前状态 |
| --- | --- | --- |
| EditorConfig | UTF-8、缩进、换行与文件结尾 | 已新增 `.editorconfig` |
| Prettier | 统一格式，不负责业务正确性 | M1 已安装 CLI，用于新增与迁移模块；不做无关的全仓格式化 |
| TypeScript | 严格类型检查 | 现有项目已启用 |
| ESLint + typescript-eslint | 常见错误、React hooks、异步与导入约束 | 在迁移工具链阶段接入，采用官方推荐规则 |
| 行数检查 | 全部受支持代码文件的统一计数、旧文件增长限制 | 已新增 `npm run check:lines` |

默认格式为 2 空格、双引号、分号、尾逗号、100 字符目标行宽。目标行宽属于格式偏好，不能用于压缩代码规避物理行数限制。文本以 UTF-8 和 LF 为默认；Windows CMD / BAT 使用 CRLF，Markdown 保留有意义的行末空格。

ESLint 使用 flat config 和成熟推荐规则，类型相关规则按各编译环境配置。Prettier 统一管理格式，两者有冲突时使用 eslint-config-prettier 解除格式规则冲突，不重复手工维护格式规则。

行数脚本仅负责不依赖语法的物理行统计和现有迁移基线；不自行实现 TypeScript、React 或 ESLint 的语义规则。生成代码的例外必须明确记录实际路径，不能通过随意命名目录豁免手写文件。

## 8. 开发验证与迁移约束

当前可直接运行：

```powershell
npm run check:lines
npm run check:lines:strict
npm run build
npm test
```

`npm run build` 通过 prebuild 自动运行行数检查。`check:lines:strict` 忽略旧文件临时上限，当前会报告尚待拆分的历史大文件。后续完整检查入口将组合 ESLint、格式检查、类型检查与行数检查；尚未接入的命令不描述为已经通过。

- 修改与职责相关的最小范围，不进行与当前任务无关的全仓格式化或重命名。
- 对购买约束、并发、取消、恢复和页面解析等有行为影响的改动运行必要测试；纯文档和格式配置不编写镜像测试。
- 运行浏览器测试使用隔离配置与离线 fixtures，不触发真实购买；内存紧张时按现有约定串行运行。
- 新模块立即遵守规范，现有大文件在各自迁移阶段拆分；完成迁移时严格行数检查无历史豁免。
- 框架、库和版本继续复用成熟实现；不得为基础设施重复实现已有可靠工具。

## 9. Git 提交规范

- 每完成并通过必要验证的一个功能点，立即创建一次独立提交，不累积到整个任务结束。
- 同一功能点相关的代码、必要测试和文档放在同一提交中；不同功能点分别提交。
- 使用 Conventional Commits，格式为 `<type>(<scope>): <中文描述>`；`scope` 可选，省略时为 `<type>: <中文描述>`。
- `type` 使用 `feat`、`fix`、`docs`、`refactor`、`test`、`build`、`ci`、`chore` 等常用英文类型，`scope` 使用对应模块的英文标识。标题中的描述和填写的正文说明使用中文，代码标识符与工具固定字段保留原形式。

示例：

```text
feat(tasks): 支持按平台设置购买数量
fix(jd): 修复已登录状态识别
docs(trellis): 补充功能点提交与中文描述规范
```

## 10. 参考依据

- [electron-vite 项目与构建约定](https://electron-vite.org/guide/)：main / preload / renderer 分层依据。
- [TypeScript strict](https://www.typescriptlang.org/tsconfig/strict.html)：严格类型检查配置。
- [ESLint max-lines](https://eslint.org/docs/latest/rules/max-lines)：文件行数约束，以及空行和注释计数选项。
- [Prettier 配置](https://prettier.io/docs/configuration)：项目统一格式配置。
- [EditorConfig](https://editorconfig.org/)：跨编辑器的基础文本规范。
