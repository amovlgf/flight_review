# 测试指南

本文档记录当前项目建议保留的验证流程。它用于开发后回归检查，也用于新 Codex 线程快速判断“改完后该跑什么”。

## 1. 环境准备

首次运行前安装依赖：

```bash
npm install
npm install --prefix backend
npm install --prefix frontend
python -m pip install pyulog
```

PowerShell 中如果 `npm.ps1` 被执行策略拦截，使用 `npm.cmd`：

```bash
npm.cmd run dev
```

## 2. 启动项目

在项目根目录启动前后端：

```bash
npm.cmd run dev
```

默认地址：

- 后端：`http://localhost:3001`
- 前端：`http://localhost:5173`

也可以分别启动：

```bash
npm.cmd run dev --prefix backend
npm.cmd run dev --prefix frontend
```

## 3. 自动化检查

### 后端测试

```bash
npm.cmd test --prefix backend
```

覆盖重点：

- 健康检查接口
- 批量分析结构化失败
- 解锁飞行判断
- Python unlock summary
- 调参 metrics / proposal / review
- fallback 数据结构

### 前端 lint

```bash
npm.cmd run lint --prefix frontend
```

用于发现 TypeScript / React / ESLint 规则问题。

### 前端构建

```bash
npm.cmd run build --prefix frontend
```

用于验证 TypeScript 构建和 Vite 生产构建。

注意：

- Vite 可能提示 chunk size warning，这通常不是构建失败。
- 在 Codex 沙箱里，Vite 写入 `frontend/node_modules/.vite-temp` 可能触发 `EPERM`。这属于环境权限问题，可在获得允许后重跑构建。

### 前端完整检查

```bash
npm.cmd run check --prefix frontend
```

该命令会依次执行 typecheck、test、build。当前修改范围较小时，可以按风险选择 lint/build；涉及图表或工具函数时建议跑完整检查。

## 4. 后端健康检查

启动后端后访问：

```text
GET http://localhost:3001/api/health
```

命令示例：

```bash
curl.exe http://localhost:3001/api/health
```

预期：

- HTTP 200
- 返回 JSON，包含可识别的健康状态字段。

## 5. 单日志上传回归

操作：

1. 启动项目。
2. 打开 `http://localhost:5173`。
3. 在单文件上传入口选择一个真实 `.ulg` 文件。
4. 点击上传。
5. 打开图表模块或选择该日志查看图表。

预期：

- 上传成功。
- 返回并保存 `logId`。
- 图表区域可以正常渲染。
- 诊断、metadata、modeSegments 等原有结构不被破坏。
- 原有单文件接口返回结构保持兼容。

## 6. 批量日志分析回归

操作：

1. 在批量上传区域一次选择多个日志文件。
2. 确认已选文件按上传选择顺序整齐展示。
3. 点击批量分析按钮。
4. 分析过程中页面显示正在解析状态。
5. 分析完成后查看解锁日志列表和失败日志列表。

预期：

- `total` 等于选择文件数量。
- 发生过解锁飞行的日志出现在 `unlockedLogs` / `unlockedLogDetails`。
- 未解锁日志不出现在解锁列表。
- 解锁日志展示文件名和飞行时间。
- 如果日志时间存在，默认按日志时间排序。
- 如果日志时间缺失，默认按上传顺序排序。
- 点击“飞行时间”排序后，按飞行时间从高到低排序。
- 单个文件失败只进入 `failedLogs`，不影响其他文件。

建议覆盖场景：

1. 只上传一个未解锁日志。
2. 只上传一个已解锁日志。
3. 上传多个日志，其中部分已解锁。
4. 上传多个日志，其中包含损坏文件。
5. 所有日志都解析失败。

## 7. 批量分析接口手动检查

接口：

```text
POST /api/logs/batch-analyze
Content-Type: multipart/form-data
field: logFiles
```

示例：

```bash
curl.exe -F "logFiles=@D:\path\to\log1.ulg" -F "logFiles=@D:\path\to\log2.ulg" http://localhost:3001/api/logs/batch-analyze
```

预期返回包含：

- `unlockedLogs`
- `unlockedLogDetails`
- `failedLogs`
- `total`
- `unlockedCount`
- `failedCount`

## 8. 图表交互回归

单日志图表打开后检查：

- 图表不为空。
- 鼠标滚轮或 dataZoom 可以缩放。
- 中键拖动可以平移当前时间窗口。
- 中键双击可以恢复全量时间范围。
- 左键框选可以放大到选中时间段。
- 多图缩放范围保持联动。
- 不出现持续的 disposed instance warning。

## 9. PID 调参回归

在有可用日志和图表数据的情况下检查：

1. 打开 PID 调参面板。
2. 选择或框选一个时间段。
3. 计算 metrics。
4. 生成 proposal。
5. 执行 review。
6. 导出 Markdown 报告或受限 `.params` 文件。

预期：

- 空数据、缺失 setpoint、缺失 actual 等情况有明确提示。
- proposal 不出现 NaN / Infinity。
- review 不直接给出危险写入动作。
- 导出内容与当前面板数据一致。

## 10. 按修改范围选择检查

只改文档：

- 至少检查 `git status`。
- 如果文档涉及接口或流程说明，确认对应实现文件没有相反行为。

只改前端：

```bash
npm.cmd run lint --prefix frontend
npm.cmd run build --prefix frontend
```

只改后端：

```bash
npm.cmd test --prefix backend
```

改了前后端接口、日志解析或批量分析：

```bash
npm.cmd test --prefix backend
npm.cmd run lint --prefix frontend
npm.cmd run build --prefix frontend
```

并手动验证：

- 单文件上传解析
- 批量分析
- 损坏日志失败展示
- 原有图表入口
