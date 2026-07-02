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

When `dataSource` is `header-derived-simulated-series`, the fallback series is
deterministic for the same uploaded file name and ULog header metadata
(`fileSizeBytes`, `version`, and `logStartTimestampUs`). Re-uploading the same
file should therefore return the same fallback chart values even though the
new upload receives a different `logId`.

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
## POST /api/logs/control-quality

This endpoint computes current-log control-loop metrics from the already uploaded
and parsed PX4 ULog topics. It does not use a baseline log, does not compare
different aircraft, and does not output an absolute pass/fail score.

### Request

```http
POST /api/logs/control-quality
Content-Type: application/json
```

```ts
type ControlQualityRequest = {
  logId: string;
  segment?: {
    startS: number | null;
    endS: number | null;
    source?: 'manual' | 'auto' | 'chart_selection' | string;
  };
  parameterBounds?: Record<
    string,
    {
      min: number | string | null;
      max: number | string | null;
      maxStepPercent: number | string | null;
    }
  >;
  format?: 'json' | 'csv';
};
```

When `segment` is omitted, the backend uses the available topic time range and
excludes the first and last 5 percent as a conservative default analysis range.
Frontend chart zoom is only a visual range. It must not change
`analysis_time_range` or trigger recalculation by itself. A recalculation is
requested only by submitting the range form or by applying a chart selection;
chart-selection requests set `segment.source` to `chart_selection`, while range
form requests use `manual` for finite start/end values and `auto` when either
bound is cleared.

### JSON Response

```ts
type ControlQualityReport = {
  log_file: string;
  analysis_time_range: {
    start_s: number | null;
    end_s: number | null;
    source: string;
  };
  summary: {
    available_loops: string[];
    unavailable_loops: string[];
    main_hints: string[];
  };
  loops: {
    actuator?: ControlQualityLoop;
    rate?: ControlQualityLoop;
    attitude?: ControlQualityLoop;
    velocity?: ControlQualityLoop;
    position?: ControlQualityLoop;
  };
  parameterTuning?: ControlQualityParameterTuning;
  estimator_quality: Record<string, number | string | null>;
  missing_topics: string[];
  missing_fields: Array<{
    loop: string;
    axis: string;
    topic: string;
    fields: string[];
  }>;
  warnings: string[];
};
```

`parameterTuning` reports recommended PX4 tuning parameter changes inferred
from the selected control-loop curves. The backend uses the latest effective
logged parameter value at the selected analysis range end. When
`parameterBounds` is omitted for a parameter, the backend uses a conservative
default step limit of 5% and a default minimum of 0; only parameters with a
generated target value different from the current value are returned.

```ts
type ControlQualityParameterTuning = {
  actuatorBlocksIncrease: boolean;
  actuatorSaturationLevel?: 'none' | 'high' | 'severe' | string;
  loops: Record<
    'actuator' | 'rate' | 'attitude' | 'velocity' | 'position' | string,
    {
      status: string;
      blockers?: string[];
      parameters: Array<{
        loop: string;
        axis: string;
        axes: string[];
        gain: string;
        role?: string;
        targetable?: boolean;
        parameter: string;
        description?: string;
        currentValue: number | null;
        currentSource: 'initial' | 'changed' | 'missing' | string;
        currentTimeS: number | null;
        bounds: {
          min: number;
          max: number;
          maxStepPercent: number;
        } | null;
        targetValue: number | null;
        changePercent: number | null;
        phenomenon?: string;
        confidence?: 'low' | 'medium' | 'high' | string;
        evidence?: string[];
        status:
          | 'target_generated'
          | 'bounds_required'
          | 'invalid_bounds'
          | 'missing_current'
          | 'blocked'
          | 'unchanged'
          | 'display_only'
          | string;
        reason: string;
      }>;
      notes: string[];
    }
  >;
  warnings: string[];
};
```

Items with `targetable: false`, unchanged targets, missing current values,
invalid bounds, and blocked gain increases are omitted from the default
recommendation list. `description` is intended for frontend tooltips beside
the parameter name.

The recommendation engine is conservative and ordered inner-to-outer. A rate
loop issue blocks attitude, velocity, and position recommendations; an attitude
issue blocks velocity and position recommendations; a velocity issue blocks
position recommendations. `blockers` explains why a loop has no recommendation,
for example insufficient excitation, parameter changes inside the selected
analysis window, estimator/feedback anomalies, upstream loop instability, or
severe actuator saturation. `phenomenon`, `confidence`, and `evidence` describe
the metric reason behind generated targets. The backend keeps single-step
changes small: default maximum `±5%`, weak evidence `±2.5%`, and no ordinary
target generation for severe oscillation or severe actuator saturation.

For the `actuator` loop, `ControlQualityLoop` also returns `chart`, a list of
executor output channels for the full available curve. Metric fields and
`channels` are calculated from the selected `analysis_time_range`; the chart
points are intentionally not clipped so the frontend can keep the user's zoom
context and highlight the active analysis interval.

```ts
type ControlQualityLoop = {
  status: string;
  metrics?: Record<string, number | string | null>;
  channels?: Array<Record<string, number | string | null>>;
  chart?: Array<{
    name: string;
    points: [number, number][];
  }>;
};
```

For trackable loops (`rate`, `attitude`, `velocity`, `position`), `charts`
follows the same rule: `setpointFeedback` and `error` contain full aligned
curves, while `axis.*.metrics` is computed from `analysis_time_range`.

Loop order is always inner-to-outer:

```text
actuator -> rate -> attitude -> velocity -> position -> estimator_quality -> hints
```

The `position` loop exposes real trackable axes only: `x`, `y`, and `z`.
It does not include a synthetic horizontal `xy` axis.

Each available axis exposes at least:

```text
mae, rmse, max_error, p95_error, p99_error, signal_scale, nrmse,
delay_s, delay_status, zero_crossing_count, error_diff_std,
setpoint_range, setpoint_diff_std, overshoot_ratio, overshoot_status
```

Unavailable data is represented by status strings such as:

```text
topic_missing, field_missing, not_enough_data, not_enough_excitation
```

### CSV Response

Set `format` to `csv` to receive a flat metric table suitable for Excel-based
manual comparison across logs from the same aircraft:

```text
log_file,time_start_s,time_end_s,loop,axis,unit,mae,rmse,nrmse,...
```

The CSV is intended for manual review. It is not a ranking table and does not
contain baseline thresholds.

### Multi-log Control Comparison

`POST /api/logs/control-quality/batch` accepts multiple files in one multipart
request:

```text
Content-Type: multipart/form-data
logFiles: File[]
```

The response contains one report item per successfully parsed `.ulg` and one
failure item per rejected file:

```ts
type BatchControlQualityResponse = {
  reports: Array<{
    logId: string;
    fileName: string;
    uploadedAt: string;
    metadata: LogMetadata;
    report: ControlQualityReport;
  }>;
  failedLogs: Array<{
    fileName: string;
    reason: string;
  }>;
  total: number;
  successCount: number;
  failedCount: number;
};
```

Each comparison column renders one `ControlQualityReport`. Recalculating an
analysis range or exporting CSV is scoped to that column's `logId` through the
single-log `/api/logs/control-quality` endpoint.

## POST /api/logs/:logId/incident-analysis

V3.0 uses the separate incident-analysis entry point introduced in V1.1. It does not change
`POST /api/logs/upload` or `GET /api/logs/chart-data`, and it does not use the
fallback simulated chart data as accident evidence.

### Request

```http
POST /api/logs/:logId/incident-analysis
Content-Type: application/json
```

The V3.0 implementation accepts an empty JSON body. Future versions may use
`segment`, `detectorProfile`, or AI review flags, but V3.0 does not run AI,
does not return cause candidates, and does not return probability fields.

### Response

```ts
type IncidentAnalysisV30Response = {
  contractVersion: 'incident-analysis.v3.0';
  analysisId: string;
  logId: string;
  fileName: string;
  dataQuality: DataQualityReport;
  analysisCapability: AnalysisCapability;
  signalMappingReport: SignalMappingReport[];
  flightSummary: FlightSummary;
  phases: IncidentFlightPhase[];
  timeline: IncidentTimelineEvent[];
  eventGroups?: IncidentEventGroup[];
  flightProcess?: FlightProcessReport;
  anomalySummary: IncidentAnomalySummary;
  incidentPropagation: IncidentPropagation;
  chartGroups: DiagnosticChartGroup[];
  warnings: AnalysisWarning[];
  missingSignals: MissingSignal[];
};
```

V3.0 covers parsing, unified log time, standard signal availability, data
quality, coarse flight phases, deterministic timeline events, warnings, and
missing signals. It also adds evidence links so a frontend can jump from a
timeline event to the relevant chart window. V3.0 additionally enriches
`anomalySummary.findings[]` with supporting evidence, counter/context evidence,
missing evidence, timeline relation, and propagation role. It also returns
`incidentPropagation` for temporal ordering of anomaly phenomena. It still does
not output root causes, hardware fault claims, cause candidates, AI reports, or
accident probabilities.

Frontend code should continue to accept older `incident-analysis.v1.3` and
`incident-analysis.v2.0` responses where V3 fields are absent.

`anomalySummary` is feature-one only. The current V3.0 implementation reports
detector availability, confirmed logged flags, conservative battery voltage
drop phenomena, failsafe windows, suspected airborne log end, and V3 evidence
assessment. It does not infer root causes, hardware failures, or accident
probability.

```ts
type FlightSummary = {
  // Full raw-log span measured from the global raw-signal timestamp origin.
  durationS: number | null;
  // Total unlocked/armed time reported by the unlock summary.
  armedFlightTimeS: number | null;
  // Seconds to subtract from global event/chart times for flight-relative UI.
  displayTimeOffsetS: number | null;
  // Preferred visible flight window. Falls back to log.timeS when armed data is unavailable.
  flightWindow: {
    startS: number;
    endS: number;
    durationS: number;
    source: 'vehicle.armed' | 'log.timeS' | string;
  } | null;
  unlockCount: number | null;
};

type IncidentFlightPhase = {
  phase:
    | 'ground_preflight'
    | 'takeoff'
    | 'airborne'
    | 'landing'
    | 'landed_postflight'
    | 'ground'
    | string;
  startS: number;
  endS: number;
  source: string;
  confidence: 'confirmed' | 'derived' | string;
};

type IncidentTimelineEvent = {
  id: string;
  code: string;
  type: string;
  timeS: number;
  severity: 'info' | 'warning' | 'error' | string;
  title: string;
  detail: string;
  confidence: 'confirmed' | 'derived' | string;
  evidence: string[];
  evidenceLinks: IncidentEvidenceLink[];
};

type IncidentEvidenceLink = {
  id: string;
  eventId: string;
  standardSignal: string;
  chartGroupId: string;
  seriesId: string;
  chartTopic: string;
  targetTimeS: number;
  timeWindow: {
    startS: number;
    endS: number;
  };
  source: {
    topic: string;
    instance: number;
    field: string;
  };
};

type IncidentAnomalySummary = {
  version: 'incident-anomaly.v2.0' | string;
  status: 'not_available' | 'no_critical_detected' | 'needs_review' | string;
  severity: 'none' | 'info' | 'warning' | 'critical' | string;
  earliestAnomalyTimeS: number | null;
  findings: IncidentAnomalyFinding[];
  detectorResults: IncidentAnomalyDetectorResult[];
  limitations: string[];
};

type IncidentAnomalyFinding = {
  id: string;
  detectorId: string;
  category: string;
  severity: 'info' | 'warning' | 'critical' | string;
  title: string;
  summary: string;
  startTimeS: number;
  endTimeS: number | null;
  confidence: 'confirmed' | 'derived' | string;
  evidenceSignals: string[];
  missingSignals: string[];
  source: {
    topic: string;
    instance: number;
    field: string;
  } | null;
  thresholds: Array<{
    id: string;
    source: 'logged_flag' | 'static' | 'adaptive' | string;
    comparator: string;
    value: number | string | null;
  }>;
  evidenceLinks: IncidentEvidenceLink[];
  supportingEvidence: IncidentEvidenceAssessment[];
  counterEvidence: IncidentEvidenceAssessment[];
  missingEvidence: IncidentEvidenceAssessment[];
  timelineRelation: {
    phase: string;
    nearestPreviousEventId: string | null;
    nearestNextEventId: string | null;
    nearbyEventIds: string[];
    summary: string;
  };
  propagationRole:
    | 'primary_suspect_event'
    | 'contributing_event'
    | 'consequence_event'
    | 'context_event'
    | 'unknown'
    | string;
  limitations: string[];
};

type IncidentEvidenceAssessment = {
  id: string;
  type:
    | 'supporting_signal'
    | 'nearby_timeline_event'
    | 'counter_or_context_signal'
    | 'missing_signal'
    | string;
  signal: string;
  timeWindow: {
    startS: number;
    endS: number;
  };
  summary: string;
  confidence: 'confirmed' | 'derived' | 'low' | 'medium' | 'high' | string;
  evidenceLinks: IncidentEvidenceLink[];
};

type IncidentAnomalyDetectorResult = {
  id: string;
  category: string;
  version: string;
  status: 'unavailable' | 'not_triggered' | 'triggered' | 'not_run' | string;
  severity: 'info' | 'warning' | 'critical' | string;
  title: string;
  summary: string;
  evidenceSignals: string[];
  missingSignals: string[];
  thresholds: IncidentAnomalyFinding['thresholds'];
  findings: IncidentAnomalyFinding[];
  limitations: string[];
};

type IncidentPropagation = {
  version: 'incident-propagation.v3.0' | string;
  status: 'built' | 'no_anomalies' | 'not_available' | string;
  events: Array<{
    id: string;
    findingId: string;
    title: string;
    startTimeS: number;
    endTimeS: number | null;
    severity: 'info' | 'warning' | 'critical' | string;
    role: string;
    phase: string;
    summary: string;
    previousEventId: string | null;
    nextEventId: string | null;
    relatedTimelineEventIds: string[];
  }>;
  links: Array<{
    id: string;
    sourceFindingId: string;
    targetFindingId: string;
    relation: 'temporal_sequence' | string;
    confidence: 'low' | 'medium' | 'high' | string;
    summary: string;
  }>;
  limitations: string[];
};
```

`flightProcess` is the process-oriented layer for flight-state inspection. It
does not replace `timeline` or `eventGroups`; it summarizes continuous
localization source validity, failsafe trigger windows, and local/vision
position comparison series.

```ts
type FlightProcessReport = {
  localizationSources: Array<{
    id: string;
    label: string;
    signal: string;
    available: boolean;
    activeIntervals: Array<{ startS: number; endS: number }>;
    changes: Array<{ timeS: number; active: boolean }>;
    source: { topic: string; instance: number; field: string } | null;
  }>;
  failsafeEvents: Array<{
    id: string;
    startS: number;
    endS: number | null;
    durationS: number | null;
    navState: string | null;
    navStateUserIntention: string | null;
    activeFlags: Array<{
      id: string;
      label: string;
      signal: string;
      value: number;
      source: { topic: string; instance: number; field: string } | null;
    }>;
    source: { topic: string; instance: number; field: string } | null;
  }>;
  positionComparison: Array<{
    axis: 'x' | 'y' | 'z' | string;
    label: string;
    unit: 'm' | string;
    series: Array<{
      kind: 'setpoint' | 'actual' | 'vision' | string;
      label: string;
      signal: string;
      unit: string;
      points: Array<[number, number]>;
      source: { topic: string; instance: number; field: string } | null;
    }>;
  }>;
  missingSignals: Array<{ signal: string; label: string }>;
};
```

Localization sources are primarily mapped from `estimator_status_flags`
boolean control-status fields such as `cs_gnss_pos`, `cs_ev_pos`,
`cs_opt_flow`, `cs_baro_hgt`, `cs_rng_hgt`, `cs_gps_hgt`, `cs_ev_hgt`, and
`cs_ev_vel`. Failsafe events use `vehicle_status.failsafe` for trigger windows
and add specific `failsafe_flags` fields when present. Position comparison uses
`trajectory_setpoint` or `vehicle_local_position_setpoint` for setpoint,
`vehicle_local_position` for actual local position, and
`vehicle_visual_odometry` or `vehicle_odometry` for vision input.

`eventGroups` is the compact deterministic-event layer. It keeps the original
`timeline` intact for traceability while grouping nearby field changes into
human-readable flight-process blocks. The frontend should prefer `eventGroups`
for the timeline UI and fall back to `timeline` when the grouped field is
unavailable.

```ts
type IncidentEventGroup = {
  id: string;
  phase:
    | 'arming'
    | 'takeoff'
    | 'flight'
    | 'flight_mode'
    | 'landing'
    | 'disarming'
    | 'command'
    | 'failsafe'
    | 'estimator'
    | 'mission'
    | 'unknown'
    | string;
  severity: 'info' | 'notice' | 'warning' | 'critical' | string;
  startTimeS: number;
  endTimeS: number;
  title: string;
  summary: string;
  primaryEvents: IncidentTimelineEvent[];
  evidenceEvents: IncidentTimelineEvent[];
  rawEvents: IncidentTimelineEvent[];
  evidenceSignals: string[];
  evidenceLinks?: IncidentEvidenceLink[];
  chartPreset:
    | 'takeoffEvidence'
    | 'landingEvidence'
    | 'modeTimeline'
    | 'commandAck'
    | 'failsafeWindow'
    | 'estimatorFlags'
    | null
    | string;
};
```

Grouping rules are intentionally conservative:

- nearby events in the same phase are merged within a 5 second window;
- takeoff groups may absorb nearby estimator or mode-change evidence;
- landing groups may absorb nearby estimator, command, disarming, and mode-change
  evidence;
- failsafe and suspected-risk events keep their own high-priority groups;
- all grouped records still retain `rawEvents`, so no original deterministic
  event is lost.

V1.3 timeline events include arming/disarming, takeoff/landing transitions,
navigation mode changes, failsafe state changes, one estimator flag summary
event, and the conservative warning `LOG_ENDED_WHILE_AIRBORNE_SUSPECTED` when
the final landed state is false. The estimator summary reports that raw
`estimator.flags` changed without repeating every bitmask transition as a
separate timeline item. The airborne warning is a suspected state only, not an
accident-cause conclusion.

Each mapped standard signal is traceable to the original PX4 `topic`,
`instance`, and `field` through `signalMappingReport` and `chartGroups[].series`.
Each timeline event with chartable evidence also exposes `evidenceLinks[]`.
Frontend V1.3 uses the first available link to set the timeline pointer, zoom
charts to `timeWindow`, and highlight the matching chart. It should prefer
`chartGroupId` for grouped V1.3 evidence charts and fall back to `chartTopic`
for raw-topic charts.

Takeoff and landing are deterministic state transitions from the standard
signal `vehicle.landed`, mapped from PX4 `vehicle_land_detected.landed`.
`TAKEOFF_DETECTED` is emitted when `vehicle.landed` changes from true (`> 0.5`)
to false (`<= 0.5`). `LANDED_DETECTED` is emitted when it changes from false to
true. These events do not infer cause; they only report the logged landed-state
transition.

Estimator status is mapped from `estimator_status_flags.control_status_flags`
when available, then falls back to older estimator bitmask fields. V1.3 exposes
only the estimator flag bits that actually changed as 0/1 chart series, and the
timeline emits one `ESTIMATOR_FLAGS_SUMMARY` item listing the changed state
names instead of repeating every raw bitmask transition.

### V1.3 Flight Phase And Raw Event Unification

Incident timeline events now keep two layers:

- `rawEvent`: the direct field transition or field-change summary, for example
  `vehicle_land_detected.landed true -> false`,
  `vehicle_status.nav_state AUTO_TAKEOFF -> AUTO_MISSION`,
  `estimator_selector_status.primary_instance 0 -> 1`, or decoded
  `estimator_status_flags.cs_in_air=false -> true`.
- `phase`: the inferred flight phase at that time, derived from multiple
  available signals where possible. Supported phase names include
  `ground_standby`, `armed_waiting_takeoff`, `takeoff_process`,
  `liftoff_confirmed`, `takeoff_complete`, `normal_flight`,
  `landing_process`, `ground_contact_process`, `landed_complete`, and
  `auto_disarmed_after_landing`.

Each `IncidentTimelineEvent` remains backward-compatible with `code`, `title`,
`detail`, `evidence`, and `evidenceLinks`, and additionally exposes:

```ts
type IncidentTimelineEvent = {
  phase: string;
  description: string;
  rawEvent: {
    kind: 'field_change' | 'field_change_summary' | string;
    signal?: string;
    previous?: number | string | boolean | null;
    current?: number | string | boolean | null;
    previousLabel?: string;
    currentLabel?: string;
    stableDurationS?: number;
    changedFields?: string[];
  } | null;
  confidence: 'high' | 'medium' | 'low' | string;
  evidenceDetails: Array<{
    signal: string;
    message: string;
    source_topic: string;
    source_field: string;
  }>;
  source_topic: string;
  source_field: string;
  chart_hint: {
    chartGroupId: string;
    seriesId: string;
    chartTopic: string;
    targetTimeS: number;
    timeWindow: { startS: number; endS: number };
  } | null;
};
```

`landed`, `maybe_landed`, `ground_contact`, and `at_rest` transitions are
debounced with a default stability window of 0.5 seconds before they are used as
confirmed phase events. Short bounces are ignored, and repeated events from the
same source field are suppressed within a 1.0 second window.

Confidence rules:

- `high`: multiple independent signals support the same result, such as
  `landed=false` plus `takeoff_status=FLIGHT`, or EKF primary instance change
  plus `instance_changed_count`.
- `medium`: one core state field changed and remained stable.
- `low`: only a request was observed, such as `vehicle_command.command`, without
  `vehicle_status.nav_state` confirmation.

Flight mode changes are confirmed only by `vehicle_status.nav_state`.
`vehicle_command` is treated as a command request, `vehicle_command_ack.result`
as acceptance evidence, and `nav_state_user_intention` as supporting context
that may differ from actual `nav_state` during failsafe.

EKF instance switching is confirmed only by
`estimator_selector_status.primary_instance` changes. `instance_changed_count`
is supporting evidence. `estimator_status_flags` changes are summarized as human
readable changed fields and are not treated as EKF instance switches.

### V1.3 Standard Signals

Required:

```text
log.timeS
vehicle.armed
vehicle.landed
vehicle.navState
vehicle.failsafe
```

Optional:

```text
position.altitudeRelative
battery.voltage
battery.current
battery.remaining
estimator.flags
```

Missing required signals downgrade `dataQuality.level` to `insufficient` or
`invalid`. Missing optional signals are reported in `missingSignals` and may
downgrade the result to `partial`, but they are not treated as anomaly events.
`analysisCapability.batteryAnalysis` is true when at least one battery
information signal is available: voltage, current, or remaining capacity.

## V1.3 Chart Data Contract Stability

V1.3 stabilizes `GET /api/logs/chart-data` so both success and error responses
share the same top-level shape. This lets the frontend safely read array fields
without special-case fallback logic for `400` or `404` responses.

All chart-data responses now include:

```ts
type ChartDataV13Base = {
  contractVersion: 'chart-data.v1.3';
  message: string;
  code: string;
  dataSource: string;
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

When `logId` is missing, the endpoint returns HTTP `400` with `code:
'LOG_ID_REQUIRED'`. When the log is not found, it returns HTTP `404` with
`code: 'LOG_NOT_FOUND'`. In both cases, `series`, `topicCharts`, `diagnostics`,
`modeSegments`, and `usedTopics` are empty arrays.
