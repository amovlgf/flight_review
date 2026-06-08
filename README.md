# 飞行日志网站项目骨架

当前仓库已完成前后端基础框架搭建，并打通基础流程：

1. 上传飞行日志
2. 展示指定日志信息（图表形式）

## 项目结构

- `frontend/`：React + Vite 前端项目
- `backend/`：Express 后端项目

## 已实现内容

- 前端页面流程控制：
  - 功能 1 上传成功后，功能 2 才可打开
  - 上传后会保存后端返回的 `logId`
- 后端 API：
  - `POST /api/logs/upload`（支持 `.ulg` 上传并解析头部元数据）
  - `GET /api/logs/chart-data?logId=...&role=...`（按日志与角色查询图表数据）
  - `GET /api/logs?q=...&page=...&pageSize=...`（获取历史日志列表，支持搜索与分页）
  - `GET /api/health`（健康检查）
- `.ulg` 解析范围（当前版本）：
  - 校验 ULog 魔数
  - 读取版本号
  - 读取日志起始时间戳（微秒）
  - 优先提取 PX4 常见主题数据（`vehicle_local_position`、`battery_status`、`vehicle_attitude`、`vehicle_gps_position`、`actuator_outputs`）
  - 若主题提取失败则自动回退演示时序，保证功能可用
  - 前端按“一个主题一个图表”展示，单图尽量包含该主题内可提取字段
  - 基于 `vehicle_status.nav_state` 为图表叠加飞控模式背景色
- 前端 API 调用：`frontend/src/services/api.ts`
- 角色话题策略文件：`docs/role-topic-policy.txt`（修改后重启后端生效）

## 启动方式

### 推荐：一键联调启动（免重复手动开两个终端）

```bash
cd d:\Desktop\log_dev
npm run dev
```

- 会同时启动后端（`3001`）和前端（`5173`）
- 前端改代码会热更新
- 后端改代码会自动重启（`nodemon`）

### 解析依赖（首次）

后端使用 Python 的 `pyulog` 解析 PX4 `.ulg` 主题数据，请确保已安装：

```bash
python -m pip install pyulog
```

### 1) 启动后端

```bash
cd backend
npm run dev
```

默认运行在：`http://localhost:3001`

### 2) 启动前端

```bash
cd frontend
npm run dev
```

默认运行在：`http://localhost:5173`

## 后续可继续实现

- 深入解析 `.ulg` 数据消息（姿态、高度、速度、电池等）
- 日志持久化存储（数据库）与索引
- 按时间范围与字段条件查询日志数据
- 折线图/柱状图等可视化组件接入（如 ECharts/Recharts）

## 测试步骤（当前版本）

1. 启动后端服务
   ```bash
   cd backend
   npm run dev
   ```
2. 启动前端服务
   ```bash
   cd frontend
   npm run dev
   ```
3. 浏览器打开前端地址（默认 `http://localhost:5173`）
4. 在功能 1 选择一个 `.ulg` 文件并点击“上传文件”
5. 观察上传成功提示（会显示 `logId`）
6. 点击功能 2 的“打开图表模块”
7. 预期结果：
   - 显示三条曲线：高度、速度、电压
   - 显示诊断卡片（中文文案）
   - 图表区域提示当前数据来源（当前版本为演示时序）
8. 历史日志测试：
   - 在功能 2 的“日志下拉框”选择不同历史日志
   - 点击“打开图表模块”，可切换查看对应日志图表
9. 搜索与分页测试：
   - 在功能 2 输入文件名关键词并点击“搜索”
   - 使用“上一页/下一页”翻页查看日志
10. 局部放大测试：
   - 在任一主题图内使用鼠标滚轮或拖动进行区间缩放
   - 可通过图表底部缩放条选择时间范围
   - 点击图表工具栏“还原”可恢复全量视图
11. 中键交互测试：
   - 按住鼠标中键拖动可左右平移当前缩放窗口
   - 双击鼠标中键可快速恢复到全量时间范围
12. 左键框选放大测试：
   - 在图表中按住鼠标左键拖拽一个时间区间
   - 松开后会自动放大到该区间
13. 角色视图测试：
   - 在功能 2 顶部切换“客户视图 / 售后视图 / 研发视图”
   - 重新点击“打开图表模块”，确认可见话题数量与内容随角色变化

## Control Loop Quality Analysis

The app now includes a Control Loop Quality panel for one uploaded PX4 `.ulg` log. This feature only computes metrics for the current log. It does not use a baseline log, does not compare different aircraft, and does not turn fixed thresholds into absolute pass/fail conclusions.

Workflow:

1. Upload one `.ulg` log from the upload page.
2. Open the chart module after upload.
3. Review the Control Loop Quality panel in inner-to-outer order: actuator, rate, attitude, velocity, position.
4. Enter `start_s` and `end_s`, then click `Recalculate` to recompute all metrics for a selected time range.
5. Export the current log metrics as JSON, CSV, or HTML.

Core metrics:

- `RMSE`: overall tracking error.
- `NRMSE`: range-normalized error for manual comparison across logs from the same aircraft.
- `Max Error`, `P95 Error`, `P99 Error`: peak and high-percentile tracking error.
- `Delay`: estimated setpoint-to-feedback time offset from normalized cross-correlation.
- `Zero Crossing`: error sign-change count for oscillation observation.
- `Setpoint Range`: command amplitude in the selected range.

The exported CSV is intended for Excel or external-table review of logs from the same aircraft, for example before and after parameter changes.
