# 技术决策记录

本文档保留项目中仍然有效的长期技术决策。它不记录临时状态，也不替代 `docs/codex-onboarding.md`。当项目做出架构级调整、替换关键技术方案或正式改变数据契约时，应同步更新本文档。

## 1. 前端使用 React + TypeScript + Vite + ECharts

### 决策

前端继续使用：

- React
- TypeScript
- Vite
- ECharts / `echarts-for-react`

### 原因

- React 适合当前上传、日志选择、图表展示、批量分析、PID 调参等多个状态区块的组合。
- TypeScript 能帮助稳定前后端数据结构，减少字段变化导致的回归。
- ECharts 对飞控日志常见的多时序曲线、缩放、tooltip、markArea、dataZoom 等能力支持成熟。
- Vite 能提供轻量的本地开发体验。

### 影响范围

- `frontend/src/App.tsx`
- `frontend/src/components/*`
- `frontend/src/services/api.ts`
- `frontend/src/types/*`
- `frontend/src/utils/chartOptions.ts`

## 2. 后端使用 Express 作为 API 编排层

### 决策

后端继续使用 Node.js + Express，负责上传接收、接口编排、调用日志解析服务和返回结构化结果。

### 原因

- 当前后端职责主要是 API 聚合和服务编排，Express 足够轻量。
- 与现有前端联调简单，迁移成本低。
- 项目目前更需要稳定解析链路和数据契约，不需要更重的后端框架。

### 影响范围

- `backend/index.js`
- `backend/services/*.js`
- `backend/test/*.js`

## 3. `.ulg` 解析继续复用 Python `pyulog`

### 决策

PX4 `.ulg` 的核心解析继续由 `backend/scripts/parse_ulg.py` 调用 `pyulog` 完成，Node 后端通过服务层调用 Python。

### 原因

- `pyulog` 更贴近 PX4 / ULog 真实格式，兼容性优于在 Node 里手写完整解析器。
- Node 层保持 API 和业务编排职责，Python 层处理日志格式细节。
- 批量解锁分析已使用轻量 unlock summary，避免完整图表解析输出过大造成 `spawnSync python ENOBUFS`。

### 影响范围

- `backend/scripts/parse_ulg.py`
- `backend/services/logParserService.js`
- `backend/services/unlockFlightService.js`
- `backend/ulgParser.js`

## 4. 数据契约优先文档化

### 决策

前后端接口字段需要通过 docs 下的契约文档固定：

- 图表数据契约：`docs/data-contract.md`
- 批量分析契约：`docs/batch-analyze-contract.md`

### 原因

- 图表、诊断、批量分析、调参等模块都依赖稳定字段。
- 明确契约能避免前端猜字段、后端随手改结构。
- 新 Codex 接手时能先看契约，再进入实现文件。

### 维护要求

- 修改接口入参、返回结构或字段含义时，必须同步更新对应文档。
- 不要为了新功能改变原有单文件上传/解析接口结构，除非需求明确要求。

## 5. 单文件解析流程必须保持稳定

### 决策

原有单文件上传和解析流程是主链路，新增功能必须以增量方式实现。

### 原因

- 单文件上传、解析、图表展示是项目最基础的用户路径。
- 批量分析、调参等能力都依赖现有解析链路的稳定性。
- 大范围替换解析流程容易破坏真实 `.ulg` 兼容性。

### 当前原则

- `POST /api/logs/upload` 行为保持兼容。
- `GET /api/logs/chart-data` 行为保持兼容。
- 新能力优先新增接口或新增组件。
- 解析逻辑优先复用 `logParserService` 和 `parse_ulg.py`。

## 6. 解锁飞行判断必须来自日志内容

### 决策

判断某个日志是否发生过解锁飞行时，必须使用日志解析结果，不能根据文件名判断。

### 当前依据

优先使用 Python unlock summary；常见来源包括：

- `actuator_armed.armed`
- `vehicle_status.arming_state`

### 原因

- 文件名不可靠，无法代表真实飞行状态。
- 批量日志筛选必须可解释、可复用、可测试。
- 该判断已由后端测试覆盖，应避免复制多份逻辑。

## 7. 批量分析作为新增链路，不替换单文件链路

### 决策

批量日志分析通过 `POST /api/logs/batch-analyze` 独立实现，前端入口为 `BatchLogUpload`。

### 原因

- 批量分析只需要筛选解锁日志、飞行时间、日志时间和失败列表，不需要完整图表结果。
- 单个文件失败时必须进入 `failedLogs`，不能中断整个请求。
- 使用轻量 summary 可以降低 Python stdout 体积，规避 `ENOBUFS` 风险。

### 当前返回重点

- `total`
- `unlockedLogs`
- `unlockedLogDetails`
- `failedLogs`
- `unlockedCount`
- `failedCount`

## 8. 后续重构坚持小步推进

### 决策

继续按小步闭环拆分，而不是一次性重写。

### 原因

- `backend/index.js` 和 `frontend/src/App.tsx` 仍承载较多编排逻辑。
- 图表交互、批量分析、PID 调参都已有可用链路，重写风险高。
- 小步拆分更容易验证和回滚。

### 当前优先级

1. 先稳定数据契约。
2. 再继续拆 `backend/index.js`。
3. 再继续拆 `frontend/src/App.tsx`。
4. 最后增加持久化和高级图表能力。

## 9. 当前阶段暂不引入数据库

### 决策

当前仍以进程内记录和上传文件为主，不引入数据库。

### 原因

- 当前重点是日志解析、图表展示、批量筛选和调参链路。
- 过早引入数据库会扩大复杂度。
- 持久化需要等元数据结构和索引需求更稳定后再设计。

### 后续候选方向

- SQLite
- 文件索引
- 元数据持久化

## 10. PID 调参只做离线辅助

### 决策

PID 调参能力只做离线日志分析、候选参数建议、风险说明和导出辅助，不直接控制飞控，也不自动写入飞控。

### 原因

- 飞控参数调整属于高风险操作。
- 当前项目定位是分析工具，不是自动控制工具。
- AI / LLM 只能参与解释、审查和风险提示。

### 影响范围

- `frontend/src/components/TuningPanel.tsx`
- `backend/services/tuningMetricsService.js`
- `backend/services/tuningProposalService.js`
- `backend/services/tuningReviewService.js`
