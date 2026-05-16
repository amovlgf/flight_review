# DECISIONS

本文档记录本项目当前已经形成的重要技术决策，方便后续在长周期开发、多人协作或新线程接手时快速理解“为什么这样做”。

---

## 1. 使用 React + TypeScript + ECharts 做前端图表展示

### 决策内容

前端采用：

- React
- TypeScript
- ECharts（配合 `echarts-for-react`）

作为日志图表展示与交互的基础技术栈。

### 原因

- React 适合承载当前页面中的多模块状态联动，如日志选择、图表切换、PID 调参面板联动等。
- TypeScript 有助于稳定前后端数据契约，减少图表数据结构变化带来的回归。
- ECharts 对时序图、多图缩放、dataZoom、markArea、legend、tooltip 等能力支持较成熟，适合飞控日志分析场景。

### 影响范围

- `frontend/src/main.tsx`
- `frontend/src/App.tsx`
- `frontend/src/components/ChartPanel.tsx`
- `frontend/src/utils/chartOptions.ts`
- `frontend/src/types/log.ts`
- `frontend/src/types/tuning.ts`

### 后续可能调整条件

- 如果前端性能、包体积或复杂交互成为明显瓶颈，可评估图表库分层或按需加载策略。
- 如果未来需要更强的 3D 或高度定制可视化，可局部引入其他可视化方案，但不应轻易整体替换 ECharts。

---

## 2. 使用 Express 作为后端接口服务

### 决策内容

后端采用 Node.js + Express，作为日志上传、图表数据返回、PID 调优相关 API 的服务层。

### 原因

- Express 足够轻量，适合当前以 API 聚合和服务编排为主的场景。
- 现阶段后端职责清晰：接收上传、调 Python 解析、组织图表数据、返回诊断与调参结果，不需要更重的框架。
- 与前端联调简单，便于快速迭代。

### 影响范围

- `backend/index.js`
- `backend/services/*.js`
- `backend/test/*.js`

### 后续可能调整条件

- 如果后端出现更复杂的权限、任务调度、持久化或大规模接口治理需求，可再评估是否引入更完整的服务分层或框架。

---

## 3. 使用 Python pyulog 解析 `.ulg` 日志

### 决策内容

PX4 `.ulg` 日志的核心解析依赖 Python `pyulog`，由 Node 后端通过脚本调用完成。

### 原因

- `pyulog` 是 PX4 / ULog 生态中成熟且贴近真实数据格式的解析工具。
- 相比在 Node 中手写完整解析逻辑，复用 `pyulog` 可以更快获得真实 `.ulg` 兼容性。
- 有利于把“日志解析正确性”与“Web API / 前端展示”解耦。

### 影响范围

- `backend/scripts/parse_ulg.py`
- `backend/services/logParserService.js`
- `backend/ulgParser.js`

### 后续可能调整条件

- 如果未来需要更高吞吐、增量解析、在线流式处理或更细粒度 topic 控制，可考虑继续封装 Python 解析层，或引入更稳定的异步任务模型。
- 但在没有明确收益前，不建议替换 `pyulog` 主链路。

---

## 4. 前后端通过 `docs/data-contract.md` 固定数据契约

### 决策内容

前后端图表数据与调参相关结构，优先通过文档化的数据契约来约束，并以 `docs/data-contract.md` 作为核心参考。

### 原因

- 当前项目前后端交互较多，图表、诊断、mode segments、PID 相关数据都依赖结构稳定。
- 提前固定契约，有助于避免前端“猜字段”、后端“随手改结构”带来的双边回归。
- 也方便新线程 / 新开发者快速建立上下文。

### 影响范围

- `docs/data-contract.md`
- `frontend/src/types/log.ts`
- `frontend/src/services/api.ts`
- `backend/index.js`
- `backend/services/*.js`

### 后续可能调整条件

- 当现有字段命名、错误响应结构、topic 数据组织方式需要正式升级时，应先更新数据契约，再修改前后端实现。

---

## 5. 优先模块化 `backend/index.js`，而不是直接重写后端

### 决策内容

后端演进策略采用“从入口文件逐步抽服务”的方式，优先模块化 `backend/index.js`，而不是一次性重写后端。

### 原因

- 当前后端已经承担实际业务能力，直接重写风险高，容易破坏已打通的上传、解析、图表与 PID API 链路。
- 渐进式拆分更利于保留既有行为和真实 `.ulg` 兼容性。
- 便于每次修改后做小范围验证。

### 影响范围

- `backend/index.js`
- `backend/services/logParserService.js`
- `backend/services/fallbackDataService.js`
- `backend/services/rolePolicyService.js`
- `backend/services/tuningMetricsService.js`
- `backend/services/tuningProposalService.js`
- `backend/services/tuningReviewService.js`

### 后续可能调整条件

- 当入口文件只剩路由编排与参数校验，且服务边界已经稳定后，可再考虑进一步抽路由层或 controller 层。

---

## 6. 优先拆分 `frontend/src/App.tsx`，而不是一次性重构整个前端

### 决策内容

前端演进策略采用“先从 `App.tsx` 中逐步抽离组件与工具函数”的方式，不做一次性大重构。

### 原因

- 当前前端已经有真实交互链路：日志上传、图表显示、PID 视图、调参面板、导出功能等。
- 一次性重构容易打断图表交互、segment 联动、PID 工作流等已稳定能力。
- 逐步抽离组件和工具函数更有利于保持可运行状态。

### 影响范围

- `frontend/src/App.tsx`
- `frontend/src/components/UploadPanel.tsx`
- `frontend/src/components/LogSelector.tsx`
- `frontend/src/components/ChartPanel.tsx`
- `frontend/src/components/TuningPanel.tsx`
- `frontend/src/utils/*.ts`

### 后续可能调整条件

- 当图表交互、PID 状态和视图切换逻辑进一步稳定后，可继续抽自定义 hooks 或状态边界。
- 但应继续遵守“小步拆分、每次闭环验证”的原则。

---

## 7. 当前阶段先不引入复杂数据库，后续再考虑 SQLite 或文件索引

### 决策内容

当前阶段不引入复杂数据库，日志索引与上传文件先以现有轻量方式支撑；后续再视需求考虑 SQLite 或文件索引。

### 原因

- 当前核心目标仍是打磨日志解析、图表视图和离线 PID 调优主链路。
- 过早引入数据库会扩大复杂度，分散对数据契约和前后端交互稳定性的关注。
- SQLite 或文件索引更符合后续“轻量持久化”的方向。

### 影响范围

- `backend/index.js`
- `backend/uploads/`
- 后续潜在持久化模块

### 后续可能调整条件

- 当日志数量、检索需求、重启恢复需求或多用户管理需求明显上升时，应优先引入轻量持久化方案。
- 预计候选方向为：
  - SQLite
  - 文件索引 / 元数据索引

---

## 8. Codex 每次只执行一个小闭环任务，避免一次性大范围修改

### 决策内容

开发方式采用“小闭环推进”：

- 一次只做一个明确步骤
- 尽量少改文件
- 每步都要有可验证结果

### 原因

- 当前项目前后端耦合点较多，大范围修改很容易引入回归。
- 小闭环更适合持续验证图表交互、调参链路和导出能力。
- 也更适合长周期开发中上下文可能丢失的现实情况。

### 影响范围

- 所有需求分析、代码修改与验证流程
- `AGENTS.md` 中的开发原则
- 归档文档与阶段性任务拆分方式

### 后续可能调整条件

- 如果未来某个模块边界已经非常稳定、测试覆盖足够完整，可以适当增大单次改动范围。
- 但对于图表交互、PID 调参主链路和日志解析主链路，仍建议保持谨慎节奏。

---

## 维护说明

后续每出现以下情况之一，建议更新本文件：

- 做出新的架构级取舍
- 替换关键技术方案
- 明确放弃某条路线
- 进入新的长期开发阶段
