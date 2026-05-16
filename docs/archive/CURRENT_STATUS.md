# CURRENT STATUS

本文档用于在长周期开发中保存“当前真实状态”，减少新线程 / 新工作空间接手时的上下文丢失。

## 1. 当前项目目标

本项目是一个面向 PX4 `.ulg` 飞控日志的网页分析工具，当前目标包括：

- 上传并解析 `.ulg` 飞控日志
- 展示日志图表与基础诊断结果
- 提供离线 PID 调优辅助能力
- 生成保守候选参数、审查结果和导出报告

当前 PID 调优能力明确限定为：

- 只做离线日志分析
- 不自动写入飞控
- 不让 LLM 直接控制飞控
- 候选 PID 参数由本地保守规则引擎生成
- AI / LLM 只负责审查、解释和风险说明

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

### Python 解析脚本

- Python
- `pyulog`

### 关键目录

- 前端：`frontend/`
- 后端：`backend/`
- 解析脚本：`backend/scripts/`
- 文档：`docs/`

## 3. 当前已完成的功能

### 日志上传与列表

- `.ulg` 文件上传：`frontend/src/components/UploadPanel.tsx`
- 历史日志列表、搜索、分页：`frontend/src/components/LogSelector.tsx`
- 后端日志接口：
  - `GET /api/health`
  - `GET /api/logs`
  - `POST /api/logs/upload`
  - `GET /api/logs/chart-data`

### 日志解析与图表数据

- ULog 基础头部解析：`backend/ulgParser.js`
- Node -> Python 调用解析：`backend/services/logParserService.js`
- `pyulog` topic 解析：`backend/scripts/parse_ulg.py`
- 解析失败 fallback/demo 数据：`backend/services/fallbackDataService.js`
- 角色 topic 策略兼容层：`backend/services/rolePolicyService.js`

### 图表展示

- 图表主组件：`frontend/src/components/ChartPanel.tsx`
- ECharts option 构造：`frontend/src/utils/chartOptions.ts`
- 图表交互保留：
  - 左键框选放大
  - 缩放同步
  - 中键平移
  - 双击中键恢复
  - `modeSegments` 背景显示

### PID Tuning Assistant

- 前端面板：`frontend/src/components/TuningPanel.tsx`
- 前端类型：`frontend/src/types/tuning.ts`
- 后端接口：
  - `POST /api/tuning/metrics`
  - `POST /api/tuning/propose`
  - `POST /api/tuning/review`
- 后端服务：
  - `backend/services/tuningMetricsService.js`
  - `backend/services/tuningProposalService.js`
  - `backend/services/tuningReviewService.js`

### PID 调参工作流（MVP）

已打通以下流程：

1. 选择日志
2. 计算跟随指标
3. 生成保守候选 PID 参数
4. 执行 Safety / AI Review
5. 导出 Markdown 报告
6. 受限导出 PX4 `.params` 文件

### PID 专用视图

当前前端图表模式已经收敛为：

- `PID 视图`
- `常规视图`

其中 `PID 视图` 当前只显示三张派生图：

- `pid_roll_angle_tracking`
- `pid_pitch_angle_tracking`
- `pid_yaw_angle_tracking`

这些图由前端从姿态四元数 / 姿态期望四元数派生：

- 工具：`frontend/src/utils/attitudeEuler.ts`
- 工具：`frontend/src/utils/pidAttitudeTracking.ts`

每张图只包含两条曲线：

- `Actual`
- `Setpoint`

### PID 视图交互增强

当前已经完成：

- TuningPanel 的 `axis` 与 PID 三张图高亮联动
- 图表框选时间段同步到 TuningPanel `startS / endS`
- PID 视图下不再显示旧诊断卡片
- 新增框选矩形工具与质量评分工具：
  - `frontend/src/utils/selectionBox.ts`
  - `frontend/src/utils/segmentQuality.ts`

## 4. 当前已经完成的重构阶段

### 后端重构

已完成的拆分：

- 日志解析主流程从 `backend/index.js` 抽到 `backend/services/logParserService.js`
- fallback/demo 数据生成抽到 `backend/services/fallbackDataService.js`
- role policy 读取与过滤抽到 `backend/services/rolePolicyService.js`
- PID metrics / proposal / review 各自独立为单独 service

### 前端重构

已完成的拆分与整理：

- 日志类型独立：`frontend/src/types/log.ts`
- 调参类型独立：`frontend/src/types/tuning.ts`
- 图表 option 生成抽离：`frontend/src/utils/chartOptions.ts`
- 上传区抽离：`frontend/src/components/UploadPanel.tsx`
- 调参面板独立：`frontend/src/components/TuningPanel.tsx`
- PID 视图派生工具独立：`frontend/src/utils/pidAttitudeTracking.ts`

### 图表视图体系重构

前端已移除旧的“研发 / 客户 / 售后”展示逻辑，主 UI 已切换为：

- `PID 视图`
- `常规视图`

后端 `rolePolicyService` 仍保留，主要用于兼容旧接口和历史逻辑，但前端主流程不再暴露旧角色切换。

## 5. 当前正在进行的开发阶段

当前处于 **Phase 2 Step 15：PID 视图交互增强**。

这一阶段的重点是：

- 增加左键拖动时的可视化框选矩形
- 增加基于当前轴的“框选片段质量评分”
- 在 TuningPanel 中展示片段质量、原因、建议与基础指标

最近已完成的修正：

- `normalizeSelectionBox(...)` 为空时的类型保护已补齐
- `npm run check --prefix frontend` 已重新通过

## 6. 当前尚未完成的重要任务

以下任务仍然重要，但尚未完成或尚未进入稳定阶段：

### A. 完成并验证 Step 15 的完整 UI 效果

- 浏览器里手动验证左键拖动时框选矩形是否表现稳定
- 验证 `mouse leave` / `mouseup` 在图表外时是否始终能清理 selection box
- 验证 TuningPanel 的片段质量卡片在不同轴切换时是否实时更新

### B. 清理中文乱码 / 文案编码问题

当前前端部分文件仍存在历史遗留乱码文案，尤其是：

- `frontend/src/components/TuningPanel.tsx`
- `frontend/src/components/ChartPanel.tsx`
- 部分归档/说明文档在控制台查看时也可能出现乱码

这类问题需要单独做一轮“只清文案不改逻辑”的修整。

### C. 优化 `frontend/src/App.tsx`

虽然已经完成多轮拆分，但图表交互注册、框选、缩放同步、PID 视图派生、segment 质量计算仍集中在 `frontend/src/App.tsx`。  
后续可以继续收敛为：

- 自定义 hook
- 图表交互工具
- PID segment 状态管理工具

### D. 优化常规视图

当前常规视图仍基本显示原始 topic 数据，尚未完成：

- 分类
- 布局优化
- 更清晰的图表优先级

### E. 持久化

当前日志仍以进程内内存 / 临时上传文件为主，后端重启后的体验与治理能力仍有限。  
后续可考虑：

- SQLite
- 文件索引
- 更稳定的元数据管理

## 7. 当前已知问题或风险

### 1. 前端仍有乱码风险

虽然已经修过部分文案，但 `frontend/src/components/TuningPanel.tsx`、`frontend/src/components/ChartPanel.tsx` 里仍有历史遗留乱码字符串。  
这类问题不一定影响编译，但会影响真实 UI 文案质量。

### 2. `frontend/src/App.tsx` 仍然偏重

当前它负责：

- 图表数据加载
- 图表交互绑定
- 缩放同步
- 框选 segment 同步
- PID 视图派生
- 片段质量计算

这块逻辑可用，但维护成本较高，是后续的重要风险点。

### 3. 图表交互较复杂，容易出现回归

当前图表同时支持：

- 左键框选
- 中键平移
- 中键双击恢复
- 多图同步缩放
- PID 三轴高亮
- segment 同步
- selection box 预览

任何继续修改这部分逻辑，都需要特别小心 `disposed instance`、重复绑定、状态回环这类问题。

### 4. PID 片段质量评分仍是前端本地启发式规则

当前规则实现于：

- `frontend/src/utils/segmentQuality.ts`

它用于帮助用户选片段，但不等于后端正式指标，也不能替代真正的飞控控制分析。

### 5. 前端打包体积偏大

`npm run build --prefix frontend` 当前会出现 Vite chunk size warning。  
不影响构建通过，但后续可考虑拆包或按需加载。

## 8. 最近一次建议的下一步

最近一次更自然的建议下一步是：

**继续完成 Phase 2 Step 15 的浏览器侧联调与文案收尾。**

更具体地说：

1. 手动验证 selection box 在真实页面中的体验
2. 检查 segment quality 卡片是否在不同 `axis` 下稳定更新
3. 单独做一轮 PID 面板与图表区域的乱码清理

在这之后，再考虑：

- Step 15.2：是否让质量较差片段影响“生成候选参数”按钮提示
- 下一阶段常规视图整理

## 9. 当前建议优先不要动的部分

以下部分当前已经跑通，除非有明确 bug，否则建议优先不要动：

### 后端调参链路

- `backend/services/tuningMetricsService.js`
- `backend/services/tuningProposalService.js`
- `backend/services/tuningReviewService.js`

原因：这几块已经有测试覆盖，且直接关系到离线调参主链路。

### PID 三轴派生图核心逻辑

- `frontend/src/utils/attitudeEuler.ts`
- `frontend/src/utils/pidAttitudeTracking.ts`

原因：PID 视图已经依赖它们稳定产出三张 tracking 图。

### 图表交互主链路

- `frontend/src/App.tsx` 中的图表交互绑定
- `frontend/src/components/ChartPanel.tsx`

原因：这里已经修过多轮问题，包括 stack overflow、disposed instance、PID 视图联动等。继续改时要尽量局部。

### 导出链路

- `frontend/src/utils/tuningReport.ts`
- `frontend/src/utils/px4ParamsExport.ts`

原因：当前 Markdown 报告导出和 guarded `.params` 导出已可用且已有测试。

## 10. 新的 ChatGPT / Codex 线程接手时应该先阅读哪些文件

建议按下面顺序阅读，最快建立上下文：

1. `AGENTS.md`
2. `README.md`
3. `docs/data-contract.md`
4. `docs/archive/PROJECT_OVERVIEW.md`
5. `docs/archive/CURRENT_STATUS.md`

然后进入当前主链路文件：

6. `frontend/src/App.tsx`
7. `frontend/src/components/ChartPanel.tsx`
8. `frontend/src/components/TuningPanel.tsx`
9. `frontend/src/services/api.ts`
10. `frontend/src/types/log.ts`
11. `frontend/src/types/tuning.ts`

再看 PID 视图和交互工具：

12. `frontend/src/utils/chartOptions.ts`
13. `frontend/src/utils/attitudeEuler.ts`
14. `frontend/src/utils/pidAttitudeTracking.ts`
15. `frontend/src/utils/selectionBox.ts`
16. `frontend/src/utils/segmentQuality.ts`

最后看后端调参主链路：

17. `backend/index.js`
18. `backend/services/logParserService.js`
19. `backend/services/fallbackDataService.js`
20. `backend/services/tuningMetricsService.js`
21. `backend/services/tuningProposalService.js`
22. `backend/services/tuningReviewService.js`
23. `backend/scripts/parse_ulg.py`

## 补充说明

- 当前前端 `check` 最近一次已通过：
  - `typecheck`
  - `vitest`
  - `build`
- 当前后端测试此前已通过，但这轮归档没有改后端代码
- 如果新线程接手时要继续推进 Step 15，优先先看 `selectionBox` 与 `segmentQuality` 相关代码和测试，再动 UI
