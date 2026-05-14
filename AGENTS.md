# AGENTS.md

本文件是本项目的 Codex 开发规范。后续在本仓库内进行需求分析、代码修改、检查验证时，应优先遵守本文件约定。

## 项目目标

本项目是一个飞控日志分析工具，目标是支持：

- `.ulg` 飞控日志上传
- 日志解析
- 图表展示
- 诊断分析

## 技术栈

### Backend

- Node.js
- Express
- Python
- `pyulog`

后端负责文件接收、ULog 基础校验、调用 Python 解析 PX4 `.ulg` 数据、生成图表数据与诊断结果。

### Frontend

- React
- TypeScript
- ECharts
- Vite

前端负责日志上传、历史日志选择、角色视图切换、图表渲染与诊断结果展示。

## 启动方式

在项目根目录运行：

```bash
npm run dev
```

该命令会同时启动：

- 后端服务：`http://localhost:3001`
- 前端服务：`http://localhost:5173`

## 检查方式

修改后应尽量运行当前项目已有检查命令：

```bash
npm run lint --prefix frontend
npm run build --prefix frontend
```

后端可通过访问健康检查接口确认服务可用：

```text
GET http://localhost:3001/api/health
```

## 开发原则

- 每次修改前先说明计划。
- 不要一次性重构太多文件。
- 涉及前后端接口时，必须同步更新数据结构说明。
- 涉及解析逻辑时，优先保留真实 `.ulg` 兼容性。
- 修改后必须运行可用的检查命令。

## 当前优先级

1. 先稳定数据契约。
2. 再拆 `backend/index.js`。
3. 再拆 `frontend/src/App.tsx`。
4. 最后增加持久化和高级图表能力。
