# 前后端数据契约

本文档记录当前前后端已实现的数据结构，重点覆盖 `GET /api/logs/chart-data` 返回给前端的图表数据契约。

> 当前文档只描述现状与建议，不代表已经完成接口重构。

## GET /api/logs/chart-data

### 请求

```http
GET /api/logs/chart-data?logId=<logId>&role=<role>
```

### Query 参数

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `logId` | `string` | 是 | 上传日志后由后端返回的日志 ID。 |
| `role` | `string` | 否 | 角色视图。当前支持 `customer`、`aftersales`、`engineer`，缺省或非法值会回退到 `aftersales`。 |

### 成功响应

```ts
type ChartDataResponse = {
  message: string;
  dataSource: 'header-derived-simulated-series' | 'px4-topics-derived' | string;
  role: string;
  availableRoles: string[];
  logId: string;
  fileName: string;
  uploadedAt: string;
  metadata: LogMetadata;
  usedTopics: string[];
  modeSegments: ModeSegment[];
  series: ChartSeries[];
  topicCharts: TopicChart[];
  diagnostics: DiagnosticItem[];
};
```

### 字段说明

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `message` | `string` | 接口说明文案。当前固定为图表数据生成提示。 |
| `dataSource` | `string` | 数据来源。`header-derived-simulated-series` 表示解析失败后使用基于头部信息生成的演示时序；`px4-topics-derived` 表示来自 PX4 topic 解析。 |
| `role` | `string` | 实际使用的角色。非法角色会被后端替换为 `aftersales`。 |
| `availableRoles` | `string[]` | 当前后端可用角色列表。 |
| `logId` | `string` | 当前日志 ID。 |
| `fileName` | `string` | 上传时的原始文件名。 |
| `uploadedAt` | `string` | 上传时间，ISO 字符串。 |
| `metadata` | `LogMetadata` | ULog 头部元数据。 |
| `usedTopics` | `string[]` | 当前角色过滤后实际返回的 topic 名称列表。 |
| `modeSegments` | `ModeSegment[]` | 飞控模式时间段，用于图表背景标注。 |
| `series` | `ChartSeries[]` | 顶层扁平曲线列表，来源于过滤后的 `topicCharts.flatMap(item => item.series)`。 |
| `topicCharts` | `TopicChart[]` | 按 topic 分组后的图表数据，是当前前端主要渲染来源。 |
| `diagnostics` | `DiagnosticItem[]` | 诊断结果列表。 |

### 错误响应

缺少 `logId` 时：

```ts
type MissingLogIdResponse = {
  message: 'logId is required.';
  series: [];
};
```

日志不存在时：

```ts
type LogNotFoundResponse = {
  message: 'Log not found. Please upload first.';
  logId: string;
  series: [];
};
```

当前错误响应只保证包含 `message` 与空 `series`，不保证包含 `topicCharts`、`diagnostics`、`modeSegments` 等字段。

## LogMetadata

```ts
type LogMetadata = {
  fileSizeBytes: number;
  version: number;
  logStartTimestampUs: number;
};
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `fileSizeBytes` | `number` | 文件大小，单位 byte。 |
| `version` | `number` | ULog 版本号。 |
| `logStartTimestampUs` | `number` | 日志开始时间戳，单位微秒。 |

## TopicChart

`topicCharts` 是按 PX4 topic 分组的图表数据。前端当前优先使用该字段渲染多个图表。

```ts
type TopicChart = {
  topic: string;
  title: string;
  series: ChartSeries[];
};
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `topic` | `string` | topic 唯一标识，用于角色过滤、React key、图表交互绑定。示例：`vehicle_local_position`、`battery_status`、`actuator_outputs_0`。 |
| `title` | `string` | 图表标题。当前通常与 `topic` 相同。 |
| `series` | `ChartSeries[]` | 当前 topic 下的曲线列表。 |

### 示例

```json
{
  "topic": "vehicle_local_position",
  "title": "vehicle_local_position",
  "series": [
    {
      "name": "altitude",
      "unit": "m",
      "points": [[0, 42.1], [1, 42.4]]
    },
    {
      "name": "speed",
      "unit": "m/s",
      "points": [[0, 9.2], [1, 9.5]]
    }
  ]
}
```

## ChartSeries

`series` 表示一条可绘制曲线。

```ts
type ChartPoint = [number, number];

type ChartSeries = {
  name: string;
  unit: string;
  points: ChartPoint[];
};
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `name` | `string` | 曲线字段名。可能是原始字段名，也可能是后端派生字段名。示例：`altitude`、`speed`、`voltage_v`、`roll`。 |
| `unit` | `string` | 单位。没有明确单位时当前会返回空字符串。 |
| `points` | `[number, number][]` | 时序点数组，格式为 `[timeSeconds, value]`。 |

### points 约定

- 第 1 项为相对时间，单位秒。
- 第 2 项为数值。
- Python 解析出的 topic 数据会以各自数据集第一条 `timestamp` 作为 0 秒。
- 演示兜底数据会使用自然序号作为时间值。
- 后端会过滤 `NaN`、`Infinity` 等不可绘制数值。

## Diagnostics

`diagnostics` 是诊断卡片数据。

```ts
type DiagnosticItem = {
  level: 'ok' | 'warning' | 'info';
  ruleCode: string;
  title: string;
  detail: string;
};
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `level` | `'ok' \| 'warning' \| 'info'` | 诊断级别。前端用它决定样式。 |
| `ruleCode` | `string` | 诊断规则编码。前端当前会根据部分编码转换中文文案。 |
| `title` | `string` | 后端诊断标题。当前多为英文。 |
| `detail` | `string` | 后端诊断详情。当前多为英文，且可能包含单位文本。 |

### 当前已知 ruleCode

| ruleCode | 说明 |
| --- | --- |
| `LOW_BATTERY` | 最低电压低于阈值。 |
| `BATTERY_NORMAL` | 电池电压正常。 |
| `HIGH_SPEED` | 最大速度高于阈值。 |
| `SPEED_NORMAL` | 速度正常。 |
| `ALTITUDE_SUMMARY` | 最大高度摘要。 |

## ModeSegment

`modeSegments` 用于在图表上叠加飞控模式背景区间。

```ts
type ModeSegment = {
  start: number;
  end: number;
  mode: string;
  mode_code: number;
  color: string;
};
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `start` | `number` | 区间开始时间，单位秒。 |
| `end` | `number` | 区间结束时间，单位秒。 |
| `mode` | `string` | 飞控模式名称。示例：`MANUAL`、`ALTCTL`、`POSCTL`、`AUTO_MISSION`、`UNKNOWN`。 |
| `mode_code` | `number` | PX4 `vehicle_status.nav_state` 原始数值。 |
| `color` | `string` | 前端标注背景色，当前为十六进制颜色字符串。 |

## 当前前端消费方式

- 前端通过 `fetchChartData(logId, role)` 请求该接口。
- 如果 `topicCharts.length > 0`，前端按 `topicCharts` 渲染多个图表。
- 如果 `topicCharts` 为空但顶层 `series` 非空，前端会渲染默认图表。
- `modeSegments` 会叠加到每个 topic 图表的第一条曲线上作为 `markArea`。
- `diagnostics` 会渲染为诊断卡片。

## 命名与结构建议

以下只是建议，当前不做重构：

1. 建议后续统一字段命名风格。当前 `modeSegments` 使用 camelCase，但子字段 `mode_code` 使用 snake_case，可考虑统一为 `modeCode`，或明确保留 `mode_code` 对齐 PX4 原始字段。
2. 建议明确 `series` 与 `topicCharts` 的主次关系。当前 `series` 是 `topicCharts` 的扁平派生字段，容易造成重复数据；后续可考虑仅保留 `topicCharts`，或将 `series` 标记为兼容字段。
3. 建议让错误响应也返回稳定结构，例如固定包含 `topicCharts: []`、`diagnostics: []`、`modeSegments: []`，减少前端兜底判断。
4. 建议将 `dataSource` 收敛为固定枚举，避免前端对任意字符串做判断。
5. 建议诊断文案分离为结构化字段，例如 `params` 保存数值与单位，前端负责国际化展示，避免通过字符串替换生成中文。
6. 建议明确所有 topic 的时间轴基准。当前不同 topic 可能各自从 0 秒开始，后续做多图联动时需要确认是否要统一到日志全局时间。
