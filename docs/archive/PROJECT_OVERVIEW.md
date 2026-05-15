# PROJECT OVERVIEW

本文件用于在后续切换到新的 ChatGPT Business / Codex 工作空间后，帮助快速接续本项目开发。

## 1. 项目目标

本项目是一个飞控日志分析工具，当前核心目标包括：

- 支持 `.ulg` 飞控日志上传
- 解析 PX4 飞控日志数据
- 以图表方式展示关键 topic 和时序曲线
- 输出基础诊断分析结果
- 在现阶段提供离线 PID 调优辅助能力（仅分析、建议、审查与导出，不写入飞控）

## 2. 技术栈

### Frontend

- React
- TypeScript
- Vite
- ECharts

### Backend

- Node.js
- Express

### Python 解析脚本

- Python
- `pyulog`

### 图表库

- `echarts`
- `echarts-for-react`

## 3. 前端入口文件

前端入口链路：

- `frontend/index.html`
- `frontend/src/main.tsx`
- `frontend/src/App.tsx`

当前主要前端组件和工具还包括：

- `frontend/src/components/UploadPanel.tsx`
- `frontend/src/components/LogSelector.tsx`
- `frontend/src/components/RoleSwitcher.tsx`
- `frontend/src/components/ChartPanel.tsx`
- `frontend/src/components/DiagnosticsPanel.tsx`
- `frontend/src/components/TuningPanel.tsx`
- `frontend/src/services/api.ts`
- `frontend/src/types/log.ts`
- `frontend/src/types/tuning.ts`
- `frontend/src/utils/chartOptions.ts`
- `frontend/src/utils/tuningReport.ts`
- `frontend/src/utils/px4ParamsExport.ts`

## 4. 后端入口文件

- `backend/index.js`

当前后端已实现的主要 API：

- `GET /api/health`
- `GET /api/logs`
- `POST /api/logs/upload`
- `GET /api/logs/chart-data`
- `POST /api/tuning/metrics`
- `POST /api/tuning/propose`
- `POST /api/tuning/review`

## 5. 日志解析相关文件

核心日志解析链路如下：

- `backend/ulgParser.js`
  - ULog 基础校验和头部解析
- `backend/services/logParserService.js`
  - 后端日志解析主流程
- `backend/services/fallbackDataService.js`
  - 解析失败后的 fallback / demo chart data
- `backend/scripts/parse_ulg.py`
  - Python + `pyulog` 解析 PX4 `.ulg` topic 数据
- `backend/services/rolePolicyService.js`
  - 角色可见 topic 策略加载与过滤
- `docs/role-topic-policy.txt`
  - 角色策略配置文件

当前 PID 调优辅助相关后端服务：

- `backend/services/tuningMetricsService.js`
- `backend/services/tuningProposalService.js`
- `backend/services/tuningReviewService.js`

## 6. 图表展示相关文件

图表展示与前端可视化相关文件主要包括：

- `frontend/src/components/ChartPanel.tsx`
- `frontend/src/utils/chartOptions.ts`
- `frontend/src/components/DiagnosticsPanel.tsx`
- `frontend/src/services/api.ts`
- `frontend/src/types/log.ts`

如果需要继续推进 PID 调参专用视图或调参工作流，也应重点查看：

- `frontend/src/components/TuningPanel.tsx`
- `frontend/src/types/tuning.ts`

## 7. 当前启动方式

在项目根目录运行：

```bash
npm run dev
```

该命令会同时启动：

- 后端：`http://localhost:3001`
- 前端：`http://localhost:5173`

也可以分别启动：

```bash
npm run dev --prefix backend
npm run dev --prefix frontend
```

首次准备 Python 解析依赖时，需要安装：

```bash
python -m pip install pyulog
```

## 8. 当前检查方式

前端常用检查：

```bash
npm run lint --prefix frontend
npm run build --prefix frontend
npm run check --prefix frontend
```

后端常用检查：

```bash
npm run test --prefix backend
```

后端运行态健康检查：

```text
GET http://localhost:3001/api/health
```

## 9. 当前数据契约文档位置

- `docs/data-contract.md`

该文档用于说明前后端图表数据结构，尤其是 `GET /api/logs/chart-data` 的返回格式，以及 `topicCharts`、`series`、`diagnostics`、`modeSegments` 等字段约定。

## 10. 新工作空间中的 Codex 应该先阅读哪些文件

建议按下面顺序阅读，能最快建立上下文：

1. `AGENTS.md`
2. `README.md`
3. `docs/data-contract.md`
4. `docs/role-topic-policy.txt`
5. `backend/index.js`
6. `backend/services/logParserService.js`
7. `backend/scripts/parse_ulg.py`
8. `backend/services/tuningMetricsService.js`
9. `backend/services/tuningProposalService.js`
10. `backend/services/tuningReviewService.js`
11. `frontend/src/App.tsx`
12. `frontend/src/components/ChartPanel.tsx`
13. `frontend/src/components/TuningPanel.tsx`
14. `frontend/src/services/api.ts`
15. `frontend/src/types/log.ts`
16. `frontend/src/types/tuning.ts`

## 补充说明

- 本项目当前已经具备离线 PID 调优 MVP，但仍然遵循安全边界：
  - 不实现实机自动写参
  - 不让 LLM 直接生成新的 PID 参数
  - 第一阶段以离线日志分析、本地保守规则引擎和审查说明为主
- 后续若继续开发，建议始终优先核对：
  - 数据契约是否变更
  - 真实 `.ulg` 兼容性是否保持
  - 前端图表交互是否被破坏
