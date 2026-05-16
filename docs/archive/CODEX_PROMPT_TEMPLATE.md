# CODEX_PROMPT_TEMPLATE

本文件用于保存本项目给 Codex 下发任务时的固定指令模板，方便在长周期开发、切换工作空间、切换线程时保持任务描述稳定、边界清晰、验收一致。

建议原则：

- 每次只发一个小闭环任务。
- 明确允许修改和禁止修改的范围。
- 明确测试命令和手动验证步骤。
- 明确完成后需要反馈哪些内容。
- 如果任务涉及接口、数据结构、图表交互或日志解析，请在提示词中写清边界。

---

## 一、通用任务模板

```markdown
任务背景：
1. 当前项目是一个飞控日志分析工具，支持 `.ulg` 上传、解析、图表展示、诊断分析。
2. 前端技术栈：React + TypeScript + ECharts + Vite。
3. 后端技术栈：Node.js + Express。
4. `.ulg` 解析使用 Python `pyulog`。
5. 前后端数据契约文档位于：`docs/data-contract.md`。

本次目标：
- <在这里写本次具体目标>

请先阅读：
- <列出必须阅读的文件>

允许修改的文件：
- <文件 1>
- <文件 2>
- <文件 3>

禁止修改的内容：
1. 不修改后端接口，除非本任务明确要求。
2. 不修改日志解析逻辑，除非本任务明确要求。
3. 不改变现有已验证通过的主流程，除非本任务明确要求。
4. 不做与本任务无关的大范围重构。
5. 不修改未列入“允许修改的文件”的业务代码。

实现要求：
1. 保持改动尽量小。
2. 优先复用现有工具函数、类型和组件。
3. 不要在 render 中调用 setState。
4. 如涉及前后端接口或类型结构，必须同步更新相关类型或文档。
5. 如涉及空数据、异常数据、无结果情况，必须做防御性处理。
6. 如涉及图表功能，不要破坏现有缩放、拖动、框选、联动能力。

测试命令：
```bash
<测试命令 1>
<测试命令 2>
```

手动验证步骤：
1. <步骤 1>
2. <步骤 2>
3. <步骤 3>

完成后请汇报：
1. 修改了哪些文件。
2. 核心改动是什么。
3. 是否保持原有功能不受影响。
4. 测试结果如何。
5. 如何手动验证。

如果测试失败：
1. 先根据报错定位问题。
2. 仅修复与本任务相关的问题，不要顺手大改其他模块。
3. 修复后重新运行相同测试命令。
4. 如果存在无法安全处理的阻塞点，请明确说明原因和影响范围。

Git 提交建议：
- 分支建议：`codex/<short-task-name>`
- commit message 建议：`feat: <summary>` 或 `refactor: <summary>` 或 `fix: <summary>`
```

---

## 二、适用于“重构一个模块”的示例模板

```markdown
任务背景：
1. 当前项目是一个飞控日志分析工具，支持 `.ulg` 上传、解析、图表展示、诊断分析。
2. 当前某个模块文件过大，影响后续维护和继续开发。
3. 项目要求优先模块化重构，不做一次性整体推翻式改写。

本次目标：
- 将 `<模块 A>` 中与 `<某类职责>` 相关的逻辑抽取到 `<新文件>`。
- 保持现有 API / UI 行为不变。

请先阅读：
- `backend/index.js`
- `frontend/src/App.tsx`
- `<目标模块文件>`
- `docs/data-contract.md`

允许修改的文件：
- `<原模块文件>`
- `<新模块文件>`
- `<相关测试文件>`

禁止修改的内容：
1. 不改变现有接口返回格式。
2. 不改变现有 UI 行为。
3. 不新增数据库。
4. 不重构与本次职责无关的模块。
5. 不顺手改动不相关的业务逻辑。

实现要求：
1. 原模块只保留编排或调用逻辑。
2. 新模块负责具体职责实现。
3. 如果存在 fallback、兜底、兼容逻辑，必须保留。
4. 如果存在类型或数据结构依赖，保持兼容。
5. 如果有现有测试，请补充或更新测试。

测试命令：
```bash
npm run check --prefix frontend
npm run test --prefix backend
```

手动验证步骤：
1. 启动项目：`npm run dev`
2. 验证健康检查接口：`GET /api/health`
3. 验证原模块相关主流程是否仍可使用
4. 如涉及图表或上传流程，手动上传一个 `.ulg` 日志检查结果

完成后请汇报：
1. 修改了哪些文件。
2. 哪些逻辑被抽取到了新模块。
3. 原有行为是否保持不变。
4. 测试是否通过。
5. 还有哪些后续可继续拆分，但本次没有动。

如果测试失败：
1. 优先修复由本次拆分引起的问题。
2. 不为“顺便清理”而扩大改动面。
3. 如果测试失败源于旧问题，请明确区分“既有问题”和“本次引入问题”。

Git 提交建议：
- 分支建议：`codex/refactor-<module-name>`
- commit message 建议：`refactor: extract <module-name> logic into service module`
```

---

## 三、适用于“新增前端功能”的示例模板

```markdown
任务背景：
1. 当前项目前端基于 React + TypeScript + ECharts。
2. 现有页面已经具备日志上传、图表显示和 PID 调优基础能力。
3. 本次只做前端功能增强，不改后端接口。

本次目标：
- 在 `<页面 / 组件>` 中新增 `<功能名>`。
- 保持现有图表、上传、调参等主流程不受影响。

请先阅读：
- `frontend/src/App.tsx`
- `frontend/src/components/<相关组件>.tsx`
- `frontend/src/services/api.ts`
- `frontend/src/types/log.ts`
- `frontend/src/types/tuning.ts`

允许修改的文件：
- `frontend/src/App.tsx`
- `frontend/src/components/<相关组件>.tsx`
- `frontend/src/utils/<相关工具>.ts`
- `frontend/src/types/<相关类型>.ts`
- `frontend/src/App.css`

禁止修改的内容：
1. 不修改后端接口。
2. 不修改日志解析逻辑。
3. 不改动无关图表行为。
4. 不引入新的状态管理库。
5. 不做无关的大范围样式重构。

实现要求：
1. 尽量在现有组件结构内扩展。
2. props 和类型定义要清晰。
3. 空状态、错误状态、loading 状态要完整。
4. 如果涉及图表，不要破坏缩放、框选、拖动、联动。
5. 如果涉及导出或计算功能，先优先做前端纯函数与单元测试。

测试命令：
```bash
npm run check --prefix frontend
```

手动验证步骤：
1. 启动项目：`npm run dev`
2. 打开前端页面：`http://localhost:5173`
3. 上传一个可用 `.ulg` 日志
4. 进入对应页面或功能区域
5. 验证新增功能的正常状态、空状态、错误状态
6. 验证现有图表和调参链路未被破坏

完成后请汇报：
1. 修改了哪些文件。
2. 新增功能的行为是什么。
3. 是否影响原有图表、上传、调参流程。
4. `npm run check --prefix frontend` 是否通过。
5. 手动验证时应如何操作。

如果测试失败：
1. 优先修复类型错误、测试错误或构建错误。
2. 如失败与本次功能直接相关，应继续修复直到通过。
3. 如失败是旧问题，请明确指出，不要把旧问题误写成本次引入。

Git 提交建议：
- 分支建议：`codex/feat-<feature-name>`
- commit message 建议：`feat: add <feature-name> to frontend`
```

---

## 四、使用建议

1. 如果任务涉及后端 API，请在“请先阅读”中加入：
   - `backend/index.js`
   - `docs/data-contract.md`

2. 如果任务涉及 PID 调优链路，请在“请先阅读”中加入：
   - `frontend/src/components/TuningPanel.tsx`
   - `frontend/src/types/tuning.ts`
   - `backend/services/tuningMetricsService.js`
   - `backend/services/tuningProposalService.js`
   - `backend/services/tuningReviewService.js`

3. 如果任务涉及图表显示，请在“请先阅读”中加入：
   - `frontend/src/components/ChartPanel.tsx`
   - `frontend/src/utils/chartOptions.ts`
   - `frontend/src/utils/pidAttitudeTracking.ts`

4. 如果任务只想让 Codex 做文档整理，请明确写：
   - “请不要修改业务代码。”
   - “只允许修改以下文档文件：...”

5. 如果任务存在强边界，例如：
   - 不改后端
   - 不改 metrics / proposal / review
   - 不改导出逻辑
   - 不改 ChartPanel

   请直接在“禁止修改的内容”里逐条写明，效果会更稳定。

