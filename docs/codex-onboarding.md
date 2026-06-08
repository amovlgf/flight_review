# Codex 项目快速上手指南

本文档用于让新的 Codex 线程快速熟悉本项目。开始任何开发前，先阅读仓库根目录的 `AGENTS.md`，再按本文档建立上下文。

## 1. 项目一句话说明

本项目是一个 PX4 `.ulg` 飞控日志分析工具：

- 前端使用 React、TypeScript、Vite、ECharts 展示上传、日志选择、图表和调参辅助界面。
- 后端使用 Node.js、Express 接收日志文件、组织 API，并调用 Python `pyulog` 解析真实 `.ulg` 数据。
- 当前重点是稳定数据契约、保持真实日志兼容性，并以小步方式继续拆分 `backend/index.js` 和 `frontend/src/App.tsx`。

## 2. 新 Codex 推荐阅读顺序

1. `AGENTS.md`：项目内 Codex 开发规范，优先级最高。
2. `README.md`：项目启动方式和基础说明。
3. `docs/codex-onboarding.md`：本文档，快速建立当前项目地图。
4. `docs/batch-analyze-contract.md`：批量日志解锁分析接口契约。
5. `docs/data-contract.md`：图表数据契约，当前存在历史编码乱码，阅读时以字段结构为主。
6. `docs/role-topic-policy.txt`：角色 topic 过滤配置。
7. `backend/index.js`：后端路由入口和仍待拆分的编排逻辑。
8. `backend/services/logParserService.js`：单日志解析主服务。
9. `backend/scripts/parse_ulg.py`：Python `pyulog` 解析脚本。
10. `frontend/src/App.tsx`：前端主状态和图表交互编排。
11. `frontend/src/components/BatchLogUpload.tsx`：批量上传和解锁日志筛选入口。
12. `frontend/src/components/ChartPanel.tsx`：ECharts 图表展示。
13. `frontend/src/components/TuningPanel.tsx`：PID 调参辅助面板。

## 3. 主要业务流程

### 单日志上传与解析

1. 前端 `UploadPanel` 选择单个 `.ulg` 文件。
2. `frontend/src/services/api.ts` 调用 `POST /api/logs/upload`。
3. 后端 `backend/index.js` 接收 multipart 文件。
4. 后端调用 `buildParsedLog`，复用 `backend/services/logParserService.js`。
5. `logParserService` 先做 ULog 基础校验，再通过 `backend/scripts/parse_ulg.py` 调用 `pyulog`。
6. 解析结果进入内存日志列表，并返回 metadata、topicCharts、diagnostics、modeSegments 等数据。

### 图表数据加载

1. 前端选择历史日志后，请求 `GET /api/logs/chart-data`。
2. 后端按 logId 找到已上传日志，并确保已经解析。
3. `rolePolicyService` 可按角色过滤 topic。
4. 前端 `ChartPanel` 与 `chartOptions` 渲染 ECharts 图表。

### 批量解锁日志分析

1. 前端 `BatchLogUpload` 支持一次选择多个文件。
2. `frontend/src/services/api.ts` 调用 `POST /api/logs/batch-analyze`。
3. 后端逐个文件独立解析，单个文件失败只进入 `failedLogs`，不让整个请求失败。
4. 批量分析使用 Python unlock summary，避免完整图表解析输出过大造成 `spawnSync python ENOBUFS`。
5. 解锁判断必须来自日志内容，主要依据 `actuator_armed.armed` 或 `vehicle_status.arming_state`，不能根据文件名判断。
6. 返回 `unlockedLogs`、`unlockedLogDetails`、`failedLogs`、`total`、`unlockedCount`、`failedCount`。
7. 前端默认按日志时间排序；如果日志时间缺失，则按上传顺序排序；也可按飞行时间从高到低排序。

### PID 调参辅助

1. 前端 `TuningPanel` 读取当前日志图表数据和用户选择的时间段。
2. 后端调参服务分为 metrics、proposal、review。
3. 当前调参能力只做离线分析、候选参数建议和风险说明，不直接写入飞控。

## 4. docs 目录文件作用

### 现行文档

- `docs/codex-onboarding.md`：新 Codex 快速上手文档，集中说明项目地图、主流程、文档作用和注意事项。
- `docs/batch-analyze-contract.md`：批量日志分析接口契约，说明请求字段、响应结构、失败处理、解锁判断和排序字段。
- `docs/data-contract.md`：图表数据接口契约，描述 `GET /api/logs/chart-data`、metadata、topicCharts、diagnostics、modeSegments 等结构；当前有历史编码乱码，修改前要格外谨慎。
- `docs/role-topic-policy.txt`：角色 topic 白名单配置。`customer`、`aftersales`、`engineer` 使用不同 topic 范围，`engineer` 当前为 `*`。

### 归档文档

`docs/archive` 只保留仍有长期参考价值的文档。旧的上下文快照、阶段状态和提示词模板已被本文档取代，不再保留。

- `docs/archive/DECISIONS.md`：当前仍有效的技术决策记录，解释为何使用 React、Express、Python `pyulog`、文档契约、小步重构、批量分析独立链路等策略。
- `docs/archive/TESTING_GUIDE.md`：当前建议的测试与回归检查指南，包含启动、自动化检查、健康检查、单日志上传、批量分析、图表交互和 PID 调参验证。

## 5. 常用命令

在 PowerShell 中如果 `npm.ps1` 被策略拦截，可以使用 `npm.cmd`。

```bash
npm.cmd run dev
npm.cmd test --prefix backend
npm.cmd run lint --prefix frontend
npm.cmd run build --prefix frontend
```

健康检查：

```text
GET http://localhost:3001/api/health
```

## 6. 当前开发注意事项

- 不要改坏原有单文件上传和解析接口；新增能力优先新增入口或新增接口。
- 涉及前后端接口字段时，同步更新 `docs/batch-analyze-contract.md` 或 `docs/data-contract.md`。
- 涉及日志解析时，优先复用 `logParserService` 和 `parse_ulg.py`，保留真实 `.ulg` 兼容性。
- 解锁飞行判断必须来自日志内容，不能根据文件名判断。
- 批量分析要捕获单文件失败，不能因为一个坏日志让整个请求返回 500。
- `backend/index.js` 和 `frontend/src/App.tsx` 仍然偏重，后续拆分要小步进行，每步都验证。
- 归档文档和部分旧前端文案存在乱码，修正文案应单独做，不要和业务逻辑修改混在一起。
- 前端 build 可能出现 Vite chunk size warning，这通常不是构建失败。

## 7. 给新 Codex 的推荐开场提示

可以直接使用下面这段作为新线程开场：

```text
请先阅读 AGENTS.md、docs/codex-onboarding.md、docs/batch-analyze-contract.md。
本项目是 PX4 .ulg 飞控日志分析工具，前端为 React + TypeScript + Vite + ECharts，后端为 Node.js + Express，并通过 Python pyulog 解析日志。
请保持小步修改，不要破坏现有单文件上传/解析流程；如果涉及接口字段，请同步更新 docs 下的数据契约文档。
```
