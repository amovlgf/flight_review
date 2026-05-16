# GPT_CONTEXT

本文件用于在新的 ChatGPT 对话、ChatGPT Business 工作空间或新的 Codex 线程中，快速恢复本项目的核心上下文。内容尽量短，但保留继续开发所需的关键信息与边界。

## 1. 项目一句话目标

这是一个面向 PX4 `.ulg` 飞控日志的网页分析工具：支持日志上传、解析、图表展示、诊断分析，并在当前阶段提供**离线 PID 调优辅助**能力，但**不自动写参、不直接控制飞控**。

## 2. 当前技术栈

### 前端

- React
- TypeScript
- Vite
- ECharts
- `echarts-for-react`

### 后端

- Node.js
- Express

### 日志解析

- Python
- `pyulog`

### 文档与归档

- `docs/data-contract.md`
- `docs/archive/*.md`

## 3. 当前架构和关键文件

### 前端入口与主链路

- `frontend/index.html`
- `frontend/src/main.tsx`
- `frontend/src/App.tsx`

### 前端关键组件

- `frontend/src/components/UploadPanel.tsx`
- `frontend/src/components/LogSelector.tsx`
- `frontend/src/components/ChartPanel.tsx`
- `frontend/src/components/DiagnosticsPanel.tsx`
- `frontend/src/components/TuningPanel.tsx`

### 前端关键工具 / 类型

- `frontend/src/services/api.ts`
- `frontend/src/types/log.ts`
- `frontend/src/types/tuning.ts`
- `frontend/src/utils/chartOptions.ts`
- `frontend/src/utils/attitudeEuler.ts`
- `frontend/src/utils/pidAttitudeTracking.ts`
- `frontend/src/utils/selectionBox.ts`
- `frontend/src/utils/segmentQuality.ts`
- `frontend/src/utils/tuningReport.ts`
- `frontend/src/utils/px4ParamsExport.ts`

### 后端入口与服务

- `backend/index.js`
- `backend/ulgParser.js`
- `backend/services/logParserService.js`
- `backend/services/fallbackDataService.js`
- `backend/services/rolePolicyService.js`
- `backend/services/tuningMetricsService.js`
- `backend/services/tuningProposalService.js`
- `backend/services/tuningReviewService.js`
- `backend/scripts/parse_ulg.py`

### 契约与策略

- `docs/data-contract.md`
- `docs/role-topic-policy.txt`

## 4. 当前已完成内容

### 日志与图表主流程

- `.ulg` 上传、日志列表、搜索、分页已经可用。
- 后端可解析 PX4 topic，解析失败时有 fallback/demo 数据兜底。
- 图表模块支持：
  - 缩放
  - 左键框选
  - 中键拖动
  - 双击中键恢复
  - 多图时间窗联动
  - `modeSegments` 背景区间显示

### 视图体系整理

- 前端已经移除旧的“研发 / 客户 / 售后”角色切换 UI。
- 当前图表显示模式只有：
  - `PID 视图`
  - `常规视图`
- 后端 `rolePolicyService` 仍保留，仅作为兼容层，前端主流程不再依赖它。

### PID Tuning Assistant MVP

已经完成整条离线调参辅助链路：

1. 计算跟随性能指标：`POST /api/tuning/metrics`
2. 本地保守规则引擎生成候选参数：`POST /api/tuning/propose`
3. Safety / AI Review：`POST /api/tuning/review`
4. Markdown 报告导出
5. 受限 PX4 `.params` 导出

约束已经落实：

- 不自动写入飞控
- 不让 LLM 直接生成新的 PID 数值
- 所有候选参数都先走本地规则与边界检查

### PID 视图优化

当前 `PID 视图` 不再显示大量原始 topic，而是只显示三张派生图：

- `Roll Angle Tracking`
- `Pitch Angle Tracking`
- `Yaw Angle Tracking`

每张图只包含两条曲线：

- `Actual`
- `Setpoint`

数据来源：

- `vehicle_attitude/q*` -> 四元数转欧拉角 -> 实际姿态
- `vehicle_attitude_setpoint/q_d*` -> 四元数转欧拉角 -> 期望姿态

### PID 交互增强

- 图表框选的 `startS / endS` 会同步到 `TuningPanel`
- `TuningPanel` 里的 `axis` 切换会高亮对应的 PID 图
- PID 视图下已隐藏旧诊断卡片
- Step 15 已新增：
  - 左键拖动实时框选矩形
  - 片段质量评分工具与卡片

## 5. 当前正在进行的阶段

当前处于 **Phase 2 Step 15：PID 视图交互增强与片段质量评估**。

本阶段核心是：

- 让图表框选更直观
- 判断当前框选片段是否适合 PID 分析
- 将片段质量反馈展示给用户

最近一次修复已经完成：

- `normalizeSelectionBox(...)` 可能返回 `null` 的类型问题已修复
- `npm run check --prefix frontend` 已重新通过

## 6. 当前下一步任务

由于 `docs/archive/TODO_NEXT.md` 当前不存在，下一步以 `docs/archive/CURRENT_STATUS.md` 为准。建议的最近下一步是：

1. 手动联调验证 Step 15 的真实 UI 体验：
   - 左键拖动时的框选矩形是否稳定
   - 鼠标移出或外部 `mouseup` 时是否能清理
   - 多图场景下是否仍稳定
2. 验证 `TuningPanel` 里的片段质量卡片：
   - 切换 `roll / pitch / yaw` 时是否重新评分
   - 重新框选后是否正确刷新
3. 单独做一轮前端中文乱码清理，只修文案，不改逻辑
4. 后续再考虑：
   - 是否让 `bad` 质量片段影响“生成候选参数”的提示或可用性
   - 常规视图的分类与布局优化

## 7. 重要技术决策

当前已经确认的关键决策如下：

1. 前端使用 **React + TypeScript + ECharts**
   - 原因：适合复杂图表交互与类型约束
2. 后端使用 **Express**
   - 原因：当前 API 编排足够轻量直接
3. `.ulg` 解析使用 **Python `pyulog`**
   - 原因：优先保证真实 PX4 日志兼容性
4. 前后端以 **`docs/data-contract.md` 固定数据契约**
   - 原因：减少结构漂移和前后端互猜
5. 优先**模块化拆分 `backend/index.js`**
   - 不做一次性重写
6. 优先**逐步拆分 `frontend/src/App.tsx`**
   - 不做整体翻新式重构
7. 当前阶段**不引入复杂数据库**
   - 后续再评估 SQLite 或文件索引
8. Codex 开发节奏采用**一个小闭环一个小闭环推进**
   - 避免一次性大范围改动引入回归

详细决策见：`docs/archive/DECISIONS.md`

## 8. 固定测试方式

### 安装依赖

```bash
cd D:\Desktop\log_dev
npm install
npm install --prefix backend
npm install --prefix frontend
python -m pip install pyulog
```

### 启动

```bash
npm run dev
```

或分别启动：

```bash
npm run dev --prefix backend
npm run dev --prefix frontend
```

### 固定检查

前端：

```bash
npm run lint --prefix frontend
npm run build --prefix frontend
npm run check --prefix frontend
```

后端：

```bash
npm run test --prefix backend
curl.exe http://localhost:3001/api/health
```

### 主流程手动验证

1. 上传一个真实 `.ulg`
2. 打开图表模块
3. 验证 PID / 常规视图切换
4. 在 PID 图中框选片段
5. 验证 `TuningPanel` 的 `startS / endS`
6. 继续验证 metrics / proposal / review / 导出链路

详细测试流程见：`docs/archive/TESTING_GUIDE.md`

## 9. Codex 指令生成模板摘要

给 Codex 下任务时，建议固定包含这些部分：

1. 任务背景
2. 本次目标
3. 允许修改的文件
4. 禁止修改的内容
5. 实现要求
6. 测试命令
7. 手动验证步骤
8. 完成后需要汇报的内容
9. 如果测试失败的处理方式
10. Git 提交建议

推荐做法：

- 每次只发一个小任务
- 明确“不改后端 / 不改 ChartPanel / 不改导出逻辑”等边界
- 让 Codex 先读相关文件再改
- 完成后必须跑对应测试命令

详细模板见：`docs/archive/CODEX_PROMPT_TEMPLATE.md`

## 10. 新 ChatGPT 接手时应该如何协作

建议新线程先按这个顺序阅读：

1. `AGENTS.md`
2. `README.md`
3. `docs/data-contract.md`
4. `docs/archive/PROJECT_OVERVIEW.md`
5. `docs/archive/CURRENT_STATUS.md`
6. `docs/archive/DECISIONS.md`
7. `docs/archive/TESTING_GUIDE.md`
8. `frontend/src/App.tsx`
9. `frontend/src/components/ChartPanel.tsx`
10. `frontend/src/components/TuningPanel.tsx`
11. `frontend/src/utils/attitudeEuler.ts`
12. `frontend/src/utils/pidAttitudeTracking.ts`
13. `frontend/src/utils/selectionBox.ts`
14. `frontend/src/utils/segmentQuality.ts`
15. `backend/index.js`
16. `backend/services/logParserService.js`
17. `backend/services/tuningMetricsService.js`
18. `backend/services/tuningProposalService.js`
19. `backend/services/tuningReviewService.js`

协作建议：

- 先复述当前阶段和本次边界，再动手
- 默认做“小步修改 + 测试闭环”
- 文档整理任务明确写“不要修改业务代码”
- 如果发现测试失败，先确认是旧问题还是本次引入问题

## 11. 当前禁止或不建议随意修改的部分

以下部分当前已经打通，除非有明确 bug 或任务要求，否则不建议随意改：

### 后端调参主链路

- `backend/services/tuningMetricsService.js`
- `backend/services/tuningProposalService.js`
- `backend/services/tuningReviewService.js`

原因：这三块直接关系到离线 PID 主链路，且已有测试覆盖。

### PID 姿态派生核心

- `frontend/src/utils/attitudeEuler.ts`
- `frontend/src/utils/pidAttitudeTracking.ts`

原因：PID 视图三张 tracking 图依赖这里稳定产出。

### 图表交互主链路

- `frontend/src/App.tsx` 中的图表交互绑定
- `frontend/src/components/ChartPanel.tsx`
- `frontend/src/utils/chartOptions.ts`

原因：这里历史上修过 stack overflow、disposed instance、框选联动等问题，继续修改时必须非常局部、非常谨慎。

### 导出链路

- `frontend/src/utils/tuningReport.ts`
- `frontend/src/utils/px4ParamsExport.ts`

原因：Markdown 与受限 `.params` 导出当前可用，且已经有测试。

### 不要轻易推进的方向

- 不要在当前阶段直接引入数据库重构
- 不要重写整个前端或整个后端
- 不要让 LLM 直接生成可应用的 PID 参数
- 不要实现自动写参或实机自动控制

