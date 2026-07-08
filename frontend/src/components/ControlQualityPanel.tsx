import { memo, useCallback, useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import { createPortal } from 'react-dom'
import ReactECharts from 'echarts-for-react'
import ChartTimelineScrubber from './ChartTimelineScrubber'
import type {
  ControlQualityLoopParameterTuning,
  ControlQualityParameterTuningItem,
  ControlQualityAxis,
  ControlQualityLoop,
  ControlQualityReport,
} from '../types/log'
import type { ChartSelectionPreview, ChartTimeRange } from './ChartPanel'

type ControlQualityPanelProps = {
  chartKeyPrefix: string
  rangeGroupKey?: string
  selectionBox?: ChartSelectionPreview | null
  timelinePointer?: number | null
  isTimelinePlaying?: boolean
  visibleRange?: {
    startS: number
    endS: number
  }
  report: ControlQualityReport | null
  isLoading: boolean
  errorText: string
  onChartReady?: (
    chartKey: string,
    instance: unknown,
    timeRange: ChartTimeRange,
    rangeGroupKey?: string,
  ) => void
  onChartDispose?: (chartKey: string) => void
  onTimelineSeek?: (timeValue: number) => void
  onToggleTimelinePlayback?: () => void
  onApplyRange: (startS: number | null, endS: number | null) => void
}

const LOOP_LABELS: Record<string, string> = {
  actuator: '1. 执行器输出',
  rate: '2. 角速度环',
  attitude: '3. 姿态环',
  velocity: '4. 速度环',
  position: '5. 位置环',
}

const LOOP_SHORT_LABELS: Record<string, string> = {
  actuator: '执行器输出',
  rate: '角速度环',
  attitude: '姿态环',
  velocity: '速度环',
  position: '位置环',
}

const AXIS_LABELS: Record<string, string> = {
  roll: '横滚',
  pitch: '俯仰',
  yaw: '偏航',
  vx: '北向速度 vx',
  vy: '东向速度 vy',
  vz: '地向速度 vz',
  x: '北向位置 x',
  y: '东向位置 y',
  z: '地向位置 z',
}

const STATUS_LABELS: Record<string, string> = {
  available: '可分析',
  unavailable: '不可用',
  topic_missing: 'topic 缺失',
  field_missing: '字段缺失',
  not_enough_data: '数据不足',
  not_enough_excitation: '激励不足',
  invalid: '无效',
  ok: '正常',
  missing: '缺失',
  low: '低',
  medium: '中',
  high: '高',
}

const SOURCE_LABELS: Record<string, string> = {
  auto_trim_5_percent: '自动排除前后 5%',
  all_available_data: '全部可用数据',
  manual: '手动区间',
  auto: '自动区间',
}

SOURCE_LABELS.chart_selection = '\u6846\u9009\u5206\u6790\u533a\u95f4'

const HINT_LABELS: Record<string, string> = {
  'Position tracking error is more prominent than velocity tracking. Review position setpoint smoothness and local position jumps.':
    '位置跟踪误差相对更明显，建议检查位置期望值是否平滑，以及本地位置反馈是否存在跳变。',
  'Actuator output reaches the reference saturation band in this log. Treat inner-loop conclusions with reduced confidence.':
    '执行器输出触及参考饱和区间，内环结论需要降低可信度。',
  'Feedback jumps or spikes were detected. Control-loop metrics may be affected by estimator or sensor data quality.':
    '反馈数据存在跳变或尖峰，控制环指标可能受到估计器或传感器数据质量影响。',
  'No cross-loop phenomenon hint was generated from the available metrics.':
    '当前可用指标未生成跨环路现象提示。',
}

const LOOP_ORDER = ['actuator', 'rate', 'attitude', 'velocity', 'position'] as const
type LoopName = (typeof LOOP_ORDER)[number]
type LoopHealthState = 'normal' | 'warning' | 'danger' | 'unavailable'
type MetricRow = [string, string, unknown]

const FLOW_NODE_LABELS: Record<LoopName, string> = {
  actuator: '执行器',
  rate: '角度环',
  attitude: '姿态环',
  velocity: '速度环',
  position: '位置环',
}

const FLOW_HEALTH_LABELS: Record<LoopHealthState, string> = {
  normal: '正常',
  warning: '警告',
  danger: '异常',
  unavailable: '不可用',
}

const FLOW_HEALTH_DOTS: Record<LoopHealthState, string> = {
  normal: '🟢',
  warning: '🟡',
  danger: '🔴',
  unavailable: '⚪',
}

const TRACKING_ERROR_HINT =
  'Position tracking error is more prominent than velocity tracking. Review position setpoint smoothness and local position jumps.'

const ACTUATOR_SATURATION_HINT =
  'Actuator output reaches the reference saturation band in this log. Treat inner-loop conclusions with reduced confidence.'

type RegisteredChartProps = {
  chartKey: string
  rangeGroupKey?: string
  selectionBox?: ChartSelectionPreview | null
  timelinePointer?: number | null
  isTimelinePlaying?: boolean
  option: Record<string, unknown>
  style: { height: number }
  timeRange: ChartTimeRange
  onChartReady?: (
    chartKey: string,
    instance: unknown,
    timeRange: ChartTimeRange,
    rangeGroupKey?: string,
  ) => void
  onChartDispose?: (chartKey: string) => void
  onTimelineSeek?: (timeValue: number) => void
  onToggleTimelinePlayback?: () => void
}

type AnalysisRange = {
  startS: number | null
  endS: number | null
}

function getPointTimeRange(points: Array<[number, ...number[]]>): ChartTimeRange {
  let start = Infinity
  let end = -Infinity

  for (const point of points) {
    const time = point[0]
    if (typeof time !== 'number' || !Number.isFinite(time)) {
      continue
    }
    start = Math.min(start, time)
    end = Math.max(end, time)
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return { start: 0, end: 0 }
  }

  return { start, end }
}

function getSeriesTimeRange(
  series: Array<{ points: Array<[number, number]> }>,
): ChartTimeRange {
  let start = Infinity
  let end = -Infinity

  for (const item of series) {
    const range = getPointTimeRange(item.points)
    if (range.end < range.start) {
      continue
    }
    start = Math.min(start, range.start)
    end = Math.max(end, range.end)
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return { start: 0, end: 0 }
  }

  return { start, end }
}

const SHARED_TOOLTIP_OPTION = {
  trigger: 'axis',
  axisPointer: {
    type: 'line',
  },
}

const SHARED_DATA_ZOOM_OPTION = [
  {
    type: 'inside',
    xAxisIndex: 0,
    filterMode: 'none',
    moveOnMouseMove: false,
  },
]

function clampPercent(value: number) {
  return Math.min(Math.max(value, 0), 100)
}

function timeValueToPercent(value: number, timeRange: ChartTimeRange) {
  const span = timeRange.end - timeRange.start
  if (span <= 0) return 0
  return clampPercent(((value - timeRange.start) / span) * 100)
}

function getValidAnalysisRange(range?: AnalysisRange | null) {
  const startS = range?.startS
  const endS = range?.endS
  if (
    typeof startS !== 'number' ||
    typeof endS !== 'number' ||
    !Number.isFinite(startS) ||
    !Number.isFinite(endS) ||
    endS <= startS
  ) {
    return null
  }

  return { startS, endS }
}

function buildDataZoomOption(
  timeRange: ChartTimeRange,
  visibleRange?: AnalysisRange | null,
) {
  const validRange = getValidAnalysisRange(visibleRange)
  if (!validRange) {
    return SHARED_DATA_ZOOM_OPTION
  }

  const start = timeValueToPercent(validRange.startS, timeRange)
  const end = timeValueToPercent(validRange.endS, timeRange)
  return SHARED_DATA_ZOOM_OPTION.map((option) => ({
    ...option,
    start: Math.min(start, end),
    end: Math.max(start, end),
  }))
}

function RegisteredControlChart({
  chartKey,
  rangeGroupKey,
  selectionBox,
  timelinePointer,
  isTimelinePlaying = false,
  option,
  style,
  timeRange,
  onChartReady,
  onChartDispose,
  onTimelineSeek,
  onToggleTimelinePlayback,
}: RegisteredChartProps) {
  const handleChartReady = useCallback(
    (instance: unknown) => {
      onChartReady?.(chartKey, instance, timeRange, rangeGroupKey)
    },
    [chartKey, onChartReady, rangeGroupKey, timeRange],
  )

  useEffect(() => {
    return () => {
      onChartDispose?.(chartKey)
    }
  }, [chartKey, onChartDispose])

  const activeSelectionBox =
    selectionBox?.chartId === chartKey ? selectionBox : null

  return (
    <div className="chart-canvas-shell">
      <ReactECharts
        key={chartKey}
        option={option}
        lazyUpdate
        style={style}
        onChartReady={handleChartReady}
      />
      {activeSelectionBox ? (
        <div
          className="chart-selection-box"
          style={{
            left: activeSelectionBox.left,
            top: activeSelectionBox.top,
            width: activeSelectionBox.width,
            height: activeSelectionBox.height,
          }}
        />
      ) : null}
      <ChartTimelineScrubber
        timeRange={timeRange}
        timelinePointer={timelinePointer ?? null}
        isTimelinePlaying={isTimelinePlaying}
        onTimelineSeek={onTimelineSeek}
        onTogglePlayback={onToggleTimelinePlayback}
      />
    </div>
  )
}

function formatStatus(value: string | null | undefined) {
  if (!value) return '-'
  return STATUS_LABELS[value] || value
}

function formatLoopName(value: string) {
  return LOOP_SHORT_LABELS[value] || value
}

function formatAxisName(value: string) {
  return AXIS_LABELS[value] || value
}

function formatSource(value: string) {
  return SOURCE_LABELS[value] || value
}

function formatHint(value: string) {
  return HINT_LABELS[value] || value
}

function formatLoopList(values: string[]) {
  return values.map(formatLoopName).join('、') || '-'
}

function formatMetric(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.abs(value) >= 100 ? value.toFixed(1) : value.toFixed(4)
  }
  if (typeof value === 'string' && value.length > 0) return formatStatus(value)
  return '-'
}

function formatParameterValue(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '-'
  }
  return value.toFixed(8).replace(/\.?0+$/, '')
}

function getTuningDisplayParameters(
  tuning: ControlQualityLoopParameterTuning | undefined,
) {
  const displayParameters = tuning?.displayParameters ?? []
  const source = displayParameters.length > 0 ? displayParameters : tuning?.parameters ?? []
  return source.filter(
    (item) =>
      item &&
      item.parameter &&
      item.targetable !== false &&
      item.status !== 'display_only',
  )
}

function formatRecommendationTarget(item: ControlQualityParameterTuningItem) {
  if (
    (item.status === 'target_generated' || item.status === 'manual_candidate') &&
    typeof item.targetValue === 'number' &&
    Number.isFinite(item.targetValue)
  ) {
    return formatParameterValue(item.targetValue)
  }
  if (item.status === 'unchanged') {
    return '保持当前值'
  }
  return '暂不推荐'
}

function formatReferenceLoopName(loopName: string) {
  return (
    {
      rate: '角速度环',
      attitude: '姿态环',
      velocity: '速度环',
      position: '位置环',
    }[loopName] || loopName
  )
}

function formatUpstreamReference(
  reference: ControlQualityParameterTuningItem['upstreamReference'],
) {
  if (!reference) return ''
  const parameters = reference.parameters?.filter(Boolean) ?? []
  const parameterText = parameters.length ? `：${parameters.join('、')}` : ''
  return `先处理上游${formatReferenceLoopName(reference.loop)}推荐${parameterText}`
}

function formatNextAction(action: string) {
  const value = action.trim()
  if (!value) return ''
  if (/diagnostic first|mechanical vibration|propellers|frame stiffness|mount|filter settings/i.test(value)) {
    return '诊断优先：先检查桨叶、电机、机架刚性、飞控安装、减震、传感器和滤波配置。'
  }
  if (/only conservative decreases are allowed/i.test(value)) {
    return '当前震动证据偏高，禁止增加增益，仅允许有控制证据时保守降低。'
  }
  if (/manual review|required|risk-limited/i.test(value)) {
    return '需人工复核后再应用，不建议直接套用。'
  }
  if (/upstream/i.test(value)) {
    const parameterMatch = value.match(/:\s*([A-Z0-9_,\s]+)\.?$/)
    const parameterText = parameterMatch?.[1]
      ?.split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .join('、')
    return parameterText
      ? `先处理上游控制环推荐：${parameterText}`
      : '先处理上游控制环推荐。'
  }
  if (/clear setpoint movement|setpoint movement|excitation/i.test(value)) {
    return '请重新框选包含明显指令变化的片段后再生成推荐。'
  }
  if (/longer analysis range|enough samples/i.test(value)) {
    return '请重新框选更长且样本充足的分析片段。'
  }
  if (/parameter stays unchanged/i.test(value)) {
    return '请选择参数未发生变化的分析区间。'
  }
  if (/current PX4 parameters/i.test(value)) {
    return '请先导入或保留当前 PX4 参数值。'
  }
  if (/safety bounds/i.test(value)) {
    return '请先检查并补全安全边界。'
  }
  if (/actuator saturation/i.test(value)) {
    return '请先处理执行器饱和或控制余量问题。'
  }
  if (/estimator|feedback signal/i.test(value)) {
    return '请先处理估计器或反馈信号异常。'
  }
  return '请先处理阻断条件后再生成推荐。'
}

function formatTuningReason(reason: string, status?: string) {
  const value = reason.trim()
  if (!value) {
    return status === 'target_generated'
      ? '已根据当前控制环指标生成保守推荐值。'
      : '当前条件不满足自动推荐要求，暂不生成 PID 推荐。'
  }

  const unhealthyLoopMatch = value.match(
    /^(rate|attitude|velocity|position) loop is not healthy enough for downstream tuning\.?$/i,
  )
  if (unhealthyLoopMatch) {
    const loopLabel =
      {
        rate: '上游角速度环',
        attitude: '上游姿态环',
        velocity: '上游速度环',
        position: '位置环',
      }[unhealthyLoopMatch[1].toLowerCase()] || '上游控制环'
    return `${loopLabel}状态不健康，暂不生成下游 PID 推荐。`
  }

  const unavailableLoopMatch = value.match(
    /^(rate|attitude|velocity|position) loop is not available for downstream tuning\.?$/i,
  )
  if (unavailableLoopMatch) {
    const loopLabel =
      {
        rate: '角速度环',
        attitude: '姿态环',
        velocity: '速度环',
        position: '位置环',
      }[unavailableLoopMatch[1].toLowerCase()] || '控制环'
    return `${loopLabel}数据不可用，暂不生成下游 PID 推荐。`
  }

  if (/setpoint excitation is too low/i.test(value)) {
    return '当前片段期望指令激励不足，暂不生成 PID 推荐。'
  }
  if (/severe oscillation requires manual inspection/i.test(value)) {
    return '检测到严重振荡，需要人工检查后再评估 PID。'
  }
  if (/severe vibration|severe oscillation is present/i.test(value)) {
    return '检测到严重振荡或严重震动，诊断优先，暂不生成 PID 推荐。'
  }
  if (/mechanical or IMU noise/i.test(value)) {
    return '检测到机械震动或 IMU 高频噪声，但缺少控制振荡证据；暂不推荐 PID，优先检查机械、安装、传感器和滤波。'
  }
  if (/D-term or actuator high-frequency noise/i.test(value)) {
    return '检测到 D-term 或执行器高频抖动，优先保守降低 RATE_D，不优先调整 RATE_P。'
  }
  if (/Moderate vibration is present/i.test(value)) {
    return '检测到中度震动，禁止增加增益，仅允许有控制证据时保守降低。'
  }
  if (/estimator or feedback signal anomalies/i.test(value)) {
    return '估计器或反馈信号存在异常，暂不生成 PID 推荐。'
  }
  if (/severe actuator saturation/i.test(value)) {
    return '执行器严重饱和，暂不生成常规 PID 推荐。'
  }
  if (/actuator saturation is high/i.test(value)) {
    return '执行器输出接近饱和，暂不增加 PID 增益。'
  }
  if (/changed inside the analysis window/i.test(value)) {
    return '该参数在分析区间内发生变化，暂不生成 PID 推荐。'
  }
  if (/current parameter value was not found/i.test(value)) {
    return '日志中未找到当前参数值，暂不生成推荐值。'
  }
  if (/fill min, max, and max step percent/i.test(value)) {
    return '缺少安全边界，暂不生成推荐值。'
  }
  if (/safety bounds are invalid/i.test(value)) {
    return '安全边界无效，暂不生成推荐值。'
  }
  if (/not enough data samples/i.test(value)) {
    return '当前片段样本数量不足，暂不生成 PID 推荐。'
  }
  if (/analysis window is too short/i.test(value)) {
    return '当前分析区间过短，暂不生成 PID 推荐。'
  }
  if (/delay estimate is/i.test(value)) {
    return '延迟估计状态不满足自动推荐要求，暂不生成 PID 推荐。'
  }
  if (/requested change is constrained/i.test(value)) {
    return '当前值或安全边界限制了本次调整，建议保持当前值。'
  }
  if (/no strong metric evidence/i.test(value)) {
    return '当前指标没有足够证据支持调整，建议保持当前值。'
  }
  if (/overshoot/i.test(value)) {
    return '检测到超调偏高，建议按保守步长调整该参数。'
  }
  if (/oscillation/i.test(value) || /noise evidence/i.test(value)) {
    return '检测到振荡或噪声偏高，建议按保守步长调整该参数。'
  }
  if (/tracking error|response is slow|phase delay/i.test(value)) {
    return '跟随误差或响应延迟偏高，建议按保守步长调整该参数。'
  }

  if (status === 'target_generated') {
    return '已根据当前控制环指标生成保守推荐值。'
  }
  if (status === 'unchanged') {
    return '当前指标没有足够证据支持调整，建议保持当前值。'
  }
  return '当前条件不满足自动推荐要求，暂不生成 PID 推荐。'
}

function formatParameterReason(item: ControlQualityParameterTuningItem) {
  const rawReasons = [...(item.blockers ?? []), item.reason]
    .map((reason) => String(reason || '').trim())
    .filter(Boolean)
  const reasons = rawReasons.length ? rawReasons : ['']
  const upstreamReference = formatUpstreamReference(item.upstreamReference)
  const nextAction = item.nextAction ? formatNextAction(item.nextAction) : ''
  const riskReason = item.riskReason ? formatTuningReason(item.riskReason, item.status) : ''
  const stepReason =
    typeof item.stepLimitPercent === 'number' && Number.isFinite(item.stepLimitPercent)
      ? `本次最大步长限制为 ${formatParameterValue(item.stepLimitPercent)}%。`
      : ''
  return Array.from(
    new Set([
      ...reasons.map((reason) => formatTuningReason(reason, item.status)),
      riskReason,
      stepReason,
      upstreamReference,
      nextAction,
    ].filter(Boolean)),
  ).join('；')
}

function formatRangeInputValue(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return ''
  }
  return Number(value.toFixed(3)).toString()
}

function getLoopAnchorId(chartKeyPrefix: string, loopName: string) {
  return `${chartKeyPrefix}__${loopName}__control-quality-anchor`
}

function getMetricNumber(metrics: ControlQualityLoop['metrics'], key: string) {
  const value = metrics?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function getMaxAxisMetric(loop: ControlQualityLoop | undefined, key: string) {
  const values = Object.values(loop?.axis || {})
    .map((axis) => getMetricNumber(axis.metrics, key))
    .filter((value): value is number => value !== null)

  return values.length > 0 ? Math.max(...values) : null
}

function getLoopHealth(
  loopName: LoopName,
  loop: ControlQualityLoop | undefined,
  hints: string[],
): { state: LoopHealthState; detail: string } {
  if (!loop || loop.status !== 'available') {
    return { state: 'unavailable', detail: formatStatus(loop?.status || 'missing') }
  }

  if (loopName === 'actuator') {
    const satHighRatio = getMetricNumber(loop.metrics, 'sat_high_ratio') ?? 0
    const satLowRatio = getMetricNumber(loop.metrics, 'sat_low_ratio') ?? 0
    if (
      hints.includes(ACTUATOR_SATURATION_HINT) ||
      Math.max(satHighRatio, satLowRatio) >= 0.02
    ) {
      return { state: 'danger', detail: '触发饱和' }
    }
    return { state: 'normal', detail: '输出余量正常' }
  }

  const maxNrmse = getMaxAxisMetric(loop, 'nrmse')
  const maxRmse = getMaxAxisMetric(loop, 'rmse')

  if (loopName === 'position' && hints.includes(TRACKING_ERROR_HINT)) {
    return { state: 'warning', detail: '跟踪误差明显' }
  }

  if (maxNrmse !== null) {
    if (maxNrmse >= 0.35) return { state: 'danger', detail: 'NRMSE 偏高' }
    if (maxNrmse >= 0.18) return { state: 'warning', detail: '跟踪误差偏高' }
    return { state: 'normal', detail: `NRMSE ${formatMetric(maxNrmse)}` }
  }

  if (maxRmse !== null) {
    return { state: 'normal', detail: `RMSE ${formatMetric(maxRmse)}` }
  }

  return { state: 'normal', detail: '指标可用' }
}

function buildTrackingErrorOption(
  title: string,
  unit: string,
  points: Array<[number, number, number]>,
  errorPoints: Array<[number, number]>,
  timeRange: ChartTimeRange,
  visibleRange?: AnalysisRange | null,
) {
  const valueUnit = unit || '数值'

  return {
    backgroundColor: '#ffffff',
    tooltip: SHARED_TOOLTIP_OPTION,
    legend: { top: 8, data: ['期望值', '实际值', '误差'] },
    grid: { left: 58, right: 72, top: 58, bottom: 44 },
    xAxis: { type: 'value', name: '时间 (s)' },
    yAxis: [
      { type: 'value', name: valueUnit },
      {
        type: 'value',
        name: `误差 ${valueUnit}`,
        position: 'right',
        show: false,
        axisLine: { show: true, lineStyle: { color: '#dc2626' } },
        axisLabel: { color: '#b91c1c' },
        nameTextStyle: { color: '#b91c1c' },
      },
    ],
    dataZoom: buildDataZoomOption(timeRange, visibleRange),
    title: { text: title, left: 8, top: 8, textStyle: { fontSize: 13 } },
    series: [
      {
        name: '期望值',
        type: 'line',
        yAxisIndex: 0,
        showSymbol: false,
        data: points.map((point) => [point[0], point[1]]),
        lineStyle: { color: '#f97316', width: 2.3 },
      },
      {
        name: '实际值',
        type: 'line',
        yAxisIndex: 0,
        showSymbol: false,
        data: points.map((point) => [point[0], point[2]]),
        lineStyle: { color: '#1d4ed8', width: 2.3 },
      },
      {
        name: '误差',
        type: 'line',
        yAxisIndex: 0,
        showSymbol: false,
        data: errorPoints,
        lineStyle: { color: '#dc2626', width: 2 },
        areaStyle: { color: 'rgba(220, 38, 38, 0.12)' },
        markLine: {
          silent: true,
          symbol: 'none',
          data: [{ yAxis: 0 }],
          lineStyle: { color: '#64748b', type: 'dashed' },
        },
      },
    ],
  }
}

function buildActuatorOutputOption(
  title: string,
  series: Array<{ name: string; points: Array<[number, number]> }>,
  timeRange: ChartTimeRange,
  visibleRange?: AnalysisRange | null,
) {
  return {
    backgroundColor: '#ffffff',
    tooltip: SHARED_TOOLTIP_OPTION,
    legend: {
      type: 'scroll',
      top: 8,
      data: series.map((item) => item.name),
    },
    grid: { left: 58, right: 24, top: 58, bottom: 44 },
    xAxis: { type: 'value', name: '时间 (s)' },
    yAxis: { type: 'value', name: '输出值' },
    dataZoom: buildDataZoomOption(timeRange, visibleRange),
    title: { text: title, left: 8, top: 8, textStyle: { fontSize: 13 } },
    series: series.map((item) => ({
      name: item.name,
      type: 'line',
      showSymbol: false,
      data: item.points,
      lineStyle: { width: 1.8 },
    })),
  }
}

function CollapsibleMetricTable({
  rows,
  title = '指标表',
}: {
  rows: MetricRow[]
  title?: string
}) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="control-quality-metrics">
      <button
        type="button"
        className="button control-quality-collapse-button"
        onClick={() => setIsOpen((current) => !current)}
        aria-expanded={isOpen}
      >
        {isOpen ? `收起${title}` : `展开${title}`}
      </button>
      {isOpen ? (
        <table className="control-quality-table">
          <thead>
            <tr>
              <th>指标</th>
              <th>中文含义</th>
              <th>数值</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, description, value]) => (
              <tr key={label}>
                <th>{label}</th>
                <td>{description}</td>
                <td>{formatMetric(value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  )
}

function MetricsTable({ axis }: { axis: ControlQualityAxis | null }) {
  const metrics = axis?.metrics || {}
  const rows: MetricRow[] = [
    ['分析状态', '当前轴是否具备足够的期望值和实际值用于计算。', axis?.status],
    ['平均绝对误差 MAE', '期望值与实际值偏差绝对值的平均水平，越小表示跟随越贴近。', metrics.mae],
    ['均方根误差 RMSE', '对较大误差更敏感的整体跟随误差，越小越好。', metrics.rmse],
    ['归一化均方根误差 NRMSE', '按信号幅度归一化后的 RMSE，便于不同轴或不同环路比较。', metrics.nrmse],
    ['最大误差', '分析区间内出现过的最大瞬时跟随偏差。', metrics.max_error],
    ['P95 误差', '95% 样本不超过的误差水平，用于观察大部分时间的跟随质量。', metrics.p95_error],
    ['P99 误差', '99% 样本不超过的误差水平，用于观察少量尖峰误差。', metrics.p99_error],
    ['估计延迟 (s)', '通过期望值与实际值相关性估算的响应滞后时间。', metrics.delay_s],
    ['延迟状态', '延迟估算是否可信，例如数据不足或激励不足时会标记不可用。', metrics.delay_status],
    ['期望值变化范围', '分析区间内期望值的最大变化幅度，用于判断激励是否充分。', metrics.setpoint_range],
    ['误差过零次数', '误差符号切换次数，过多可能说明震荡或超调较明显。', metrics.zero_crossing_count],
    ['误差变化标准差', '相邻误差变化量的离散程度，用于观察误差抖动。', metrics.error_diff_std],
  ]

  return <CollapsibleMetricTable rows={rows} />
}

type TooltipPosition = {
  left: number
  top: number
  width: number
  placement: 'top' | 'bottom'
}

const PARAMETER_TOOLTIP_MARGIN = 12
const PARAMETER_TOOLTIP_MAX_WIDTH = 360

function InlineTooltip({
  description,
  ariaLabel,
  className = 'control-parameter-tooltip-trigger',
  triggerLabel = '!',
}: {
  description: string
  ariaLabel: string
  className?: string
  triggerLabel?: string
}) {
  const tooltipId = useId()
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const [position, setPosition] = useState<TooltipPosition | null>(null)

  const updatePosition = useCallback(() => {
    if (typeof window === 'undefined') return
    const trigger = triggerRef.current
    if (!trigger) return

    const rect = trigger.getBoundingClientRect()
    const viewportWidth =
      window.innerWidth || document.documentElement.clientWidth
    const availableWidth = Math.max(
      0,
      viewportWidth - PARAMETER_TOOLTIP_MARGIN * 2,
    )
    const tooltipWidth = Math.min(
      PARAMETER_TOOLTIP_MAX_WIDTH,
      availableWidth,
    )
    const halfWidth = tooltipWidth / 2
    const left = Math.min(
      Math.max(
        rect.left + rect.width / 2,
        PARAMETER_TOOLTIP_MARGIN + halfWidth,
      ),
      viewportWidth - PARAMETER_TOOLTIP_MARGIN - halfWidth,
    )
    const placement = rect.top < 96 ? 'bottom' : 'top'
    const top =
      placement === 'top'
        ? rect.top - PARAMETER_TOOLTIP_MARGIN
        : rect.bottom + PARAMETER_TOOLTIP_MARGIN

    setPosition({
      left,
      top,
      width: tooltipWidth,
      placement,
    })
  }, [])

  const showTooltip = useCallback(() => {
    updatePosition()
  }, [updatePosition])

  const hideTooltip = useCallback(() => {
    setPosition(null)
  }, [])

  useEffect(() => {
    if (!position) return undefined

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        hideTooltip()
      }
    }

    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [hideTooltip, position, updatePosition])

  const tooltipStyle: CSSProperties | undefined = position
    ? {
        left: position.left,
        top: position.top,
        width: position.width,
      }
    : undefined

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={className}
        aria-label={ariaLabel}
        aria-describedby={tooltipId}
        aria-expanded={position ? true : false}
        onBlur={hideTooltip}
        onFocus={showTooltip}
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
      >
        {triggerLabel}
      </button>
      {position && typeof document !== 'undefined'
        ? createPortal(
            <span
              id={tooltipId}
              className="control-parameter-tooltip"
              role="tooltip"
              data-placement={position.placement}
              style={tooltipStyle}
            >
              {description}
            </span>,
            document.body,
          )
        : null}
    </>
  )
}

function ParameterDescriptionTooltip({
  description,
}: {
  description: string
}) {
  return (
    <InlineTooltip
      description={description}
      ariaLabel={`查看 PID 参数说明：${description}`}
    />
  )
}

function ParameterReasonTooltip({ reason }: { reason: string }) {
  return (
    <InlineTooltip
      description={reason}
      ariaLabel={`查看 PID 推荐说明：${reason}`}
      className="control-parameter-tooltip-trigger control-parameter-reason-tooltip-trigger"
      triggerLabel="i"
    />
  )
}

function ParameterTuningSection({
  tuning,
}: {
  tuning?: ControlQualityLoopParameterTuning
}) {
  const blockers = tuning?.blockers?.filter(Boolean) ?? []
  const blockerSummary = blockers.length
    ? blockers.map((blocker) => formatTuningReason(blocker, 'blocked')).join('；')
    : ''
  const parameters = getTuningDisplayParameters(tuning)
  const hasAnyParameters = parameters.length > 0

  if (!tuning) {
    return (
      <div className="control-parameter-panel">
        <h5 className="tuning-subtitle">PID 推荐参数</h5>
        <p className="hint">
          当前控制环报告还没有参数推荐数据，请重新计算当前区间。
        </p>
      </div>
    )
  }

  if (!hasAnyParameters) {
    return (
      <div className="control-parameter-panel">
        <h5 className="tuning-subtitle">PID 推荐参数</h5>
        {blockers.length ? (
          <ul className="tuning-alert-list">
            {blockers.map((blocker) => (
              <li key={blocker}>{formatTuningReason(blocker, 'blocked')}</li>
            ))}
          </ul>
        ) : (
          <p className="hint">当前区间未发现需要调整的 PID 参数。</p>
        )}
      </div>
    )
  }

  return (
    <div className="control-parameter-panel">
      <h5 className="tuning-subtitle">PID 推荐参数</h5>
      {blockerSummary ? (
        <div
          className="tuning-alert tuning-alert-muted control-parameter-blocker-summary"
          role="note"
        >
          <strong>诊断阻断/限制原因：</strong>
          <span>{blockerSummary}</span>
        </div>
      ) : null}
      <div className="control-parameter-table-wrap">
        <table className="control-quality-table control-parameter-table control-parameter-unified-table">
          <thead>
            <tr>
              <th>参数</th>
              <th>当前值</th>
              <th>推荐/候选值</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            {parameters.map((item) => (
              <tr key={`${item.loop}-${item.parameter}`}>
                <th>
                  <span className="control-parameter-name">
                    {item.parameter}
                    {item.description ? (
                      <ParameterDescriptionTooltip description={item.description} />
                    ) : null}
                  </span>
                </th>
                <td>{formatParameterValue(item.currentValue)}</td>
                <td>
                  <span className="control-parameter-target">
                    {formatRecommendationTarget(item)}
                  </span>
                </td>
                <td className="control-parameter-reason">
                  <ParameterReasonTooltip reason={formatParameterReason(item)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ControlFlowNodes({
  chartKeyPrefix,
  report,
  onNodeClick,
}: {
  chartKeyPrefix: string
  report: ControlQualityReport
  onNodeClick: (loopName: LoopName) => void
}) {
  return (
    <div className="control-flow" aria-label="控制环路串联流程">
      {LOOP_ORDER.map((loopName, index) => {
        const health = getLoopHealth(
          loopName,
          report.loops[loopName],
          report.summary.main_hints,
        )

        return (
          <div className="control-flow-step" key={loopName}>
            <button
              type="button"
              className={`control-flow-node control-flow-node-${health.state}`}
              onClick={() => onNodeClick(loopName)}
              aria-describedby={getLoopAnchorId(chartKeyPrefix, loopName)}
            >
              <span className="control-flow-node-title">
                {FLOW_NODE_LABELS[loopName]}
              </span>
              <span className="control-flow-node-status">
                <span aria-hidden="true">{FLOW_HEALTH_DOTS[health.state]}</span>
                <span>{FLOW_HEALTH_LABELS[health.state]}</span>
              </span>
              <span className="control-flow-node-detail">{health.detail}</span>
            </button>
            {index < LOOP_ORDER.length - 1 ? (
              <span className="control-flow-arrow" aria-hidden="true">
                →
              </span>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function ControlLoopCard({
  chartKeyPrefix,
  rangeGroupKey,
  selectionBox,
  timelinePointer,
  isTimelinePlaying,
  visibleRange,
  loopName,
  loop,
  parameterTuning,
  isHighlighted,
  onChartReady,
  onChartDispose,
  onTimelineSeek,
  onToggleTimelinePlayback,
}: {
  chartKeyPrefix: string
  rangeGroupKey?: string
  selectionBox?: ChartSelectionPreview | null
  timelinePointer?: number | null
  isTimelinePlaying?: boolean
  visibleRange?: AnalysisRange | null
  loopName: string
  loop: ControlQualityLoop | undefined
  parameterTuning?: ControlQualityLoopParameterTuning
  isHighlighted: boolean
  onChartReady?: (
    chartKey: string,
    instance: unknown,
    timeRange: ChartTimeRange,
    rangeGroupKey?: string,
  ) => void
  onChartDispose?: (chartKey: string) => void
  onTimelineSeek?: (timeValue: number) => void
  onToggleTimelinePlayback?: () => void
}) {
  const axisNames = Object.keys(loop?.axis || {})
  const [selectedAxis, setSelectedAxis] = useState(axisNames[0] || '')
  const resolvedAxis = selectedAxis && loop?.axis ? loop.axis[selectedAxis] : null
  const chart = loop?.charts?.find((item) => item.axis === selectedAxis)
  const trackingChartKey = `${chartKeyPrefix}__${loopName}__${selectedAxis}__tracking`
  const trackingTimeRange = chart
    ? getPointTimeRange([...chart.setpointFeedback, ...chart.error])
    : { start: 0, end: 0 }

  return (
    <section className="control-quality-loop">
      <div className="control-quality-loop-head">
        <h4>{LOOP_LABELS[loopName] || loopName}</h4>
        <span className={`control-status control-status-${loop?.status || 'missing'}`}>
          {formatStatus(loop?.status || 'missing')}
        </span>
      </div>
      {axisNames.length > 0 ? (
        <label className="tuning-field control-quality-axis">
          <span className="tuning-subtitle">分析轴</span>
          <select
            className="select tuning-select"
            value={selectedAxis}
            onChange={(event) => setSelectedAxis(event.target.value)}
          >
            {axisNames.map((axisName) => (
              <option key={axisName} value={axisName}>
                {formatAxisName(axisName)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {resolvedAxis ? <MetricsTable axis={resolvedAxis} /> : null}
      <ParameterTuningSection tuning={parameterTuning} />
      {chart ? (
        <div
          id={getLoopAnchorId(chartKeyPrefix, loopName)}
          className={`control-quality-charts${
            isHighlighted ? ' control-quality-chart-highlight' : ''
          }`}
        >
          <RegisteredControlChart
            chartKey={trackingChartKey}
            rangeGroupKey={rangeGroupKey}
            selectionBox={selectionBox}
            timelinePointer={timelinePointer}
            isTimelinePlaying={isTimelinePlaying}
            option={buildTrackingErrorOption(
              `${formatAxisName(selectedAxis)} 期望值 / 实际值 / 误差`,
              chart.unit,
              chart.setpointFeedback,
              chart.error,
              trackingTimeRange,
              visibleRange,
            )}
            style={{ height: 300 }}
            timeRange={trackingTimeRange}
            onChartReady={onChartReady}
            onChartDispose={onChartDispose}
            onTimelineSeek={onTimelineSeek}
            onToggleTimelinePlayback={onToggleTimelinePlayback}
          />
        </div>
      ) : (
        <p
          id={getLoopAnchorId(chartKeyPrefix, loopName)}
          className={`hint${
            isHighlighted ? ' control-quality-chart-highlight' : ''
          }`}
        >
          当前分析轴没有可用曲线。
        </p>
      )}
    </section>
  )
}

function ActuatorSummary({
  chartKeyPrefix,
  rangeGroupKey,
  selectionBox,
  timelinePointer,
  isTimelinePlaying,
  visibleRange,
  loop,
  parameterTuning,
  isHighlighted,
  onChartReady,
  onChartDispose,
  onTimelineSeek,
  onToggleTimelinePlayback,
}: {
  chartKeyPrefix: string
  rangeGroupKey?: string
  selectionBox?: ChartSelectionPreview | null
  timelinePointer?: number | null
  isTimelinePlaying?: boolean
  visibleRange?: AnalysisRange | null
  loop: ControlQualityLoop | undefined
  parameterTuning?: ControlQualityLoopParameterTuning
  isHighlighted: boolean
  onChartReady?: (
    chartKey: string,
    instance: unknown,
    timeRange: ChartTimeRange,
    rangeGroupKey?: string,
  ) => void
  onChartDispose?: (chartKey: string) => void
  onTimelineSeek?: (timeValue: number) => void
  onToggleTimelinePlayback?: () => void
}) {
  if (!loop) return null
  const metrics = loop.metrics || {}
  const outputSeries = (loop.chart || []).filter((series) => series.points.length > 0)
  const outputTimeRange = getSeriesTimeRange(outputSeries)
  const rows: MetricRow[] = [
    ['分析状态', '执行器输出 topic 是否存在且包含可用输出通道。', loop.status],
    ['上限饱和比例', '输出接近上限的样本比例，越高说明执行器余量越小。', metrics.sat_high_ratio],
    ['下限饱和比例', '输出接近下限的样本比例，越高说明低端饱和越明显。', metrics.sat_low_ratio],
    ['平均输出', '所有可用执行器通道的平均输出水平。', metrics.mean_output],
    ['最大输出', '分析区间内执行器输出的最大值。', metrics.max_output],
    ['最小输出', '分析区间内执行器输出的最小值。', metrics.min_output],
    ['输出标准差', '执行器输出波动程度，数值越大表示变化越剧烈。', metrics.output_std],
    ['电机平均输出差异比例', '不同电机平均输出的相对差异，用于观察负载或配平不均。', metrics.motor_mean_spread_ratio],
  ]

  return (
    <section className="control-quality-loop">
      <div className="control-quality-loop-head">
        <h4>{LOOP_LABELS.actuator}</h4>
        <span className={`control-status control-status-${loop.status}`}>
          {formatStatus(loop.status)}
        </span>
      </div>
      <CollapsibleMetricTable rows={rows} />
      <ParameterTuningSection tuning={parameterTuning} />
      {outputSeries.length > 0 ? (
        <div
          id={getLoopAnchorId(chartKeyPrefix, 'actuator')}
          className={`control-quality-charts${
            isHighlighted ? ' control-quality-chart-highlight' : ''
          }`}
        >
          <RegisteredControlChart
            chartKey={`${chartKeyPrefix}__actuator__output`}
            rangeGroupKey={rangeGroupKey}
            selectionBox={selectionBox}
            timelinePointer={timelinePointer}
            isTimelinePlaying={isTimelinePlaying}
            option={buildActuatorOutputOption(
              '执行器输出通道',
              outputSeries,
              outputTimeRange,
              visibleRange,
            )}
            style={{ height: 280 }}
            timeRange={outputTimeRange}
            onChartReady={onChartReady}
            onChartDispose={onChartDispose}
            onTimelineSeek={onTimelineSeek}
            onToggleTimelinePlayback={onToggleTimelinePlayback}
          />
        </div>
      ) : (
        <p
          id={getLoopAnchorId(chartKeyPrefix, 'actuator')}
          className={`hint${
            isHighlighted ? ' control-quality-chart-highlight' : ''
          }`}
        >
          当前分析区间没有可用执行器输出曲线。
        </p>
      )}
    </section>
  )
}

function ControlQualityPanel({
  chartKeyPrefix,
  rangeGroupKey,
  selectionBox,
  timelinePointer,
  isTimelinePlaying = false,
  visibleRange,
  report,
  isLoading,
  errorText,
  onChartReady,
  onChartDispose,
  onTimelineSeek,
  onToggleTimelinePlayback,
  onApplyRange,
}: ControlQualityPanelProps) {
  const initialStart = report?.analysis_time_range.start_s ?? null
  const initialEnd = report?.analysis_time_range.end_s ?? null
  const initialStartValue = formatRangeInputValue(initialStart)
  const initialEndValue = formatRangeInputValue(initialEnd)
  const rangeKey = `${initialStartValue}-${initialEndValue}`
  const visibleAnalysisRange = visibleRange
    ? {
        startS: visibleRange.startS,
        endS: visibleRange.endS,
      }
    : null
  const [highlightedLoop, setHighlightedLoop] = useState<LoopName | null>(null)
  const highlightTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current !== null) {
        window.clearTimeout(highlightTimerRef.current)
      }
    }
  }, [])

  if (!report && !isLoading && !errorText) {
    return null
  }

  const handleApplyRange = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const start = Number(formData.get('startS'))
    const end = Number(formData.get('endS'))
    onApplyRange(
      Number.isFinite(start) ? start : null,
      Number.isFinite(end) ? end : null,
    )
  }

  const handleControlFlowNodeClick = (loopName: LoopName) => {
    const target = document.getElementById(getLoopAnchorId(chartKeyPrefix, loopName))

    target?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    })

    setHighlightedLoop(loopName)
    if (highlightTimerRef.current !== null) {
      window.clearTimeout(highlightTimerRef.current)
    }
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightedLoop(null)
      highlightTimerRef.current = null
    }, 1500)
  }

  return (
    <section className="control-quality-panel">
      <div className="page-title-row">
        <div>
          <h3>控制环质量</h3>
          {report ? (
            <p className="hint">
              {`分析区间：${formatMetric(report.analysis_time_range.start_s)}s - ${formatMetric(report.analysis_time_range.end_s)}s / ${formatSource(report.analysis_time_range.source)}`}
            </p>
          ) : null}
        </div>
      </div>

      <form
        key={rangeKey}
        className="control-quality-range"
        onSubmit={handleApplyRange}
      >
        <label className="tuning-field">
          <span className="tuning-subtitle">开始时间 (s)</span>
          <input
            name="startS"
            className="input tuning-input control-quality-range-input"
            defaultValue={initialStartValue}
          />
        </label>
        <label className="tuning-field">
          <span className="tuning-subtitle">结束时间 (s)</span>
          <input
            name="endS"
            className="input tuning-input control-quality-range-input"
            defaultValue={initialEndValue}
          />
        </label>
        <button className="button control-quality-refresh-button" type="submit">
          <span className="control-quality-refresh-icon" aria-hidden="true">↻</span>
          <span>重新计算</span>
        </button>
      </form>

      {isLoading ? <p className="hint">正在计算控制环指标...</p> : null}
      {errorText ? <p className="hint control-quality-error">{errorText}</p> : null}

      {report ? (
        <>
          <div className="control-quality-summary">
            <div>
              <strong>可分析环路</strong>
              <p>{formatLoopList(report.summary.available_loops)}</p>
            </div>
            <div>
              <strong>不可用环路</strong>
              <p>{formatLoopList(report.summary.unavailable_loops)}</p>
            </div>
          </div>
          <ul className="control-quality-hints">
            {report.summary.main_hints.map((hint) => (
              <li key={hint}>{formatHint(hint)}</li>
            ))}
          </ul>
          <ControlFlowNodes
            chartKeyPrefix={chartKeyPrefix}
            report={report}
            onNodeClick={handleControlFlowNodeClick}
          />
          <div className="control-quality-loop-list">
            <ActuatorSummary
              chartKeyPrefix={chartKeyPrefix}
              rangeGroupKey={rangeGroupKey}
              selectionBox={selectionBox}
              timelinePointer={timelinePointer}
              isTimelinePlaying={isTimelinePlaying}
              visibleRange={visibleAnalysisRange}
              loop={report.loops.actuator}
              parameterTuning={report.parameterTuning?.loops.actuator}
              isHighlighted={highlightedLoop === 'actuator'}
              onChartReady={onChartReady}
              onChartDispose={onChartDispose}
              onTimelineSeek={onTimelineSeek}
              onToggleTimelinePlayback={onToggleTimelinePlayback}
            />
            {LOOP_ORDER.filter((loopName) => loopName !== 'actuator').map((loopName) => (
              <ControlLoopCard
                key={loopName}
                chartKeyPrefix={chartKeyPrefix}
                rangeGroupKey={rangeGroupKey}
                selectionBox={selectionBox}
                timelinePointer={timelinePointer}
                isTimelinePlaying={isTimelinePlaying}
                visibleRange={visibleAnalysisRange}
                loopName={loopName}
                loop={report.loops[loopName]}
                parameterTuning={report.parameterTuning?.loops[loopName]}
                isHighlighted={highlightedLoop === loopName}
                onChartReady={onChartReady}
                onChartDispose={onChartDispose}
                onTimelineSeek={onTimelineSeek}
                onToggleTimelinePlayback={onToggleTimelinePlayback}
              />
            ))}
          </div>
        </>
      ) : null}
    </section>
  )
}

export default memo(ControlQualityPanel)
