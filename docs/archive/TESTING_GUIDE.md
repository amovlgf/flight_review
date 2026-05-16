# TESTING GUIDE

本文档记录本项目当前建议固定执行的测试流程。目标是让每次开发、回归验证、换线程接手时都能使用同一套检查方法。

## 1. 安装依赖命令

在项目根目录执行：

```bash
cd D:\Desktop\log_dev
npm install
npm install --prefix backend
npm install --prefix frontend
python -m pip install pyulog
```

说明：

- 根目录 `npm install` 用于安装 `concurrently`
- `backend` / `frontend` 各自安装自己的 Node 依赖
- `pyulog` 是 PX4 `.ulg` 日志解析的 Python 依赖

## 2. 启动后端和前端命令

### 推荐：一键联调启动

```bash
cd D:\Desktop\log_dev
npm run dev
```

默认地址：

- 后端：`http://localhost:3001`
- 前端：`http://localhost:5173`

### 分别启动

启动后端：

```bash
cd D:\Desktop\log_dev
npm run dev --prefix backend
```

启动前端：

```bash
cd D:\Desktop\log_dev
npm run dev --prefix frontend
```

## 3. 前端 lint 命令

```bash
cd D:\Desktop\log_dev
npm run lint --prefix frontend
```

用途：

- 检查 ESLint 规则
- 发现明显的 React / TypeScript 代码问题

## 4. 前端 build 命令

```bash
cd D:\Desktop\log_dev
npm run build --prefix frontend
```

用途：

- 检查 TypeScript 构建
- 检查 Vite 生产构建
- 发现类型错误、打包错误、模块引用错误

补充：

当前前端完整检查通常使用：

```bash
cd D:\Desktop\log_dev
npm run check --prefix frontend
```

该命令会依次执行：

- `typecheck`
- `test`
- `build`

## 5. 后端健康检查接口

启动后端后访问：

```text
GET http://localhost:3001/api/health
```

可用命令示例：

```bash
curl.exe http://localhost:3001/api/health
```

预期：

- 返回 HTTP `200`
- 返回 JSON，包含类似 `status: "ok"` 的字段

## 6. 上传 `.ulg` 文件的手动测试流程

### 前端页面手动测试

1. 启动前后端
2. 浏览器打开 `http://localhost:5173`
3. 在上传区域选择一个真实的 `.ulg` 文件
4. 点击上传按钮
5. 观察页面提示

预期结果：

- 上传成功
- 页面保存并显示或内部持有 `logId`
- 页面进入图表模块可继续加载该日志

### 接口手动测试

也可以直接用 `curl` 测试上传接口：

```bash
curl.exe -F "logFile=@D:\path\to\sample.ulg" http://localhost:3001/api/logs/upload
```

预期结果：

- 返回 HTTP `201`
- 返回 JSON
- JSON 中应包含：
  - `logId`
  - `metadata`
  - `topicCharts`
  - `modeSegments`
  - `dataSource`

## 7. 图表显示测试流程

1. 在前端上传 `.ulg` 文件
2. 选择日志
3. 点击“打开图表模块”
4. 先观察默认图表显示模式（当前通常是 `PID 视图`）
5. 确认图表可以正常渲染

当前应重点检查：

### PID 视图

应只显示 3 张派生图：

- `Roll Angle Tracking`
- `Pitch Angle Tracking`
- `Yaw Angle Tracking`

每张图应只有两条线：

- `Actual`
- `Setpoint`

### 常规视图

切换到 `常规视图` 后：

- 应显示原始日志 `topicCharts`
- 图表不应空白
- 不应出现 ECharts disposed 警告循环

异常排查重点：

- 页面空白
- 图表不显示
- 控制台出现 `Instance ... has been disposed`
- 切换图表模式后崩溃

## 8. 角色切换测试流程

### 当前状态说明

前端主 UI 已移除旧的：

- 研发视图
- 客户视图
- 售后视图

因此，**当前前端页面没有角色切换入口，这不是 bug，而是当前产品决策**。

### 当前建议测试方式

如果需要验证后端旧接口兼容性，可以手动测试 `role` 参数：

```bash
curl.exe "http://localhost:3001/api/logs/chart-data?logId=<LOG_ID>&role=customer"
curl.exe "http://localhost:3001/api/logs/chart-data?logId=<LOG_ID>&role=aftersales"
curl.exe "http://localhost:3001/api/logs/chart-data?logId=<LOG_ID>&role=engineer"
```

检查点：

- 接口返回 `200`
- `topicCharts` 会随 `role` 变化
- `availableRoles` 返回合理

注意：

- 这属于**后端兼容测试**
- 不属于当前前端主流程测试

## 9. 搜索和分页测试流程

1. 上传多份日志，确保列表里有多条数据
2. 在日志选择区域输入文件名关键词
3. 点击搜索
4. 使用“上一页 / 下一页”翻页

预期结果：

- 搜索结果会更新
- 分页页码变化正常
- 切换页码后列表数据变化正确
- 重新选择日志后，仍可打开图表

重点检查：

- 搜索后 `selectedLogId` 是否被错误清空
- 翻页后是否还能正常加载图表
- 无结果时页面是否稳定

## 10. 图表缩放、拖动、多图联动相关测试流程

### 缩放测试

1. 打开图表模块
2. 在任一图表使用滚轮或 dataZoom 缩放
3. 观察时间窗口变化

预期：

- 图表缩放正常
- 时间范围变化合理

### 左键框选测试

1. 在任一图表按住鼠标左键拖动
2. 观察是否出现实时框选矩形
3. 松开鼠标

预期：

- 拖动过程中能看到半透明框选矩形
- 松开后图表放大到所选时间段
- `TuningPanel` 中的 `startS / endS` 跟随更新

### 小范围拖动测试

1. 左键拖动一个很短的像素距离

预期：

- 不应产生有效框选
- 不应更新片段时间段

### 中键拖动测试

1. 缩放后按住鼠标中键左右拖动

预期：

- 当前时间窗口左右平移
- 不影响左键框选逻辑

### 双击中键恢复测试

1. 缩放后快速双击鼠标中键

预期：

- 恢复全量时间范围

### 多图联动测试

1. 在一张图缩放
2. 观察其他图

预期：

- 多张图保持时间范围联动
- 不应出现异常抖动
- 不应出现 disposed instance 循环 warning

## 11. 每次 Codex 修改后至少应该执行哪些检查

### 只改前端时

至少执行：

```bash
cd D:\Desktop\log_dev
npm run check --prefix frontend
```

### 改了后端时

至少执行：

```bash
cd D:\Desktop\log_dev
npm run test --prefix backend
```

并补充：

```bash
curl.exe http://localhost:3001/api/health
```

### 改了前后端接口或主流程交互时

建议执行完整最小闭环：

1. `npm run check --prefix frontend`
2. `npm run test --prefix backend`
3. 手动上传一份 `.ulg`
4. 手动打开图表模块
5. 手动验证：
   - 图表显示
   - 框选
   - TuningPanel
   - metrics / proposal / review 主流程

## 12. 如果测试失败，应如何让 Codex 修复

建议把失败信息尽量具体地交给 Codex，至少包括：

### A. 失败命令

例如：

```text
npm run check --prefix frontend
```

### B. 失败输出

直接贴：

- TypeScript 报错
- 测试失败堆栈
- 控制台错误
- 浏览器 Network / Console 关键报错

### C. 失败场景

例如：

- “上传成功后打开图表为空白”
- “左键框选后 TuningPanel 没更新”
- “生成 proposal 后按钮状态不对”

### D. 期望行为

例如：

- “应只修复 typecheck，不改业务逻辑”
- “只修复 PID 视图，不动常规视图”
- “不要改后端，只修前端”

### 推荐提问方式

可以直接这样要求 Codex：

```text
请不要大改，只修这个报错。
请先阅读以下文件：
- ...
问题：
- ...
要求：
1. ...
2. ...
完成后运行：
npm run check --prefix frontend
```

### 修复策略建议

优先让 Codex：

1. 先定位最小改动点
2. 只修当前失败链路
3. 保持现有功能不变
4. 修完后重新跑对应检查

不建议一上来就让 Codex：

- 一次性大重构
- 顺手改多个无关模块
- 在没有证据时重写整段业务逻辑

---

## 附：当前最常用检查命令汇总

```bash
cd D:\Desktop\log_dev
npm run dev
npm run lint --prefix frontend
npm run build --prefix frontend
npm run check --prefix frontend
npm run test --prefix backend
curl.exe http://localhost:3001/api/health
```
