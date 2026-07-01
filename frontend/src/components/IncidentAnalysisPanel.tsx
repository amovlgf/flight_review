import { useCallback, useEffect, useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import type {
  IncidentEvidenceAssessment,
  IncidentAnomalyFinding,
  IncidentEventGroup,
  IncidentAnalysisResponse,
  IncidentTimelineEvent,
  ModeSegment,
} from '../types/log'
import ChartTimelineScrubber from './ChartTimelineScrubber'
import type { ChartSelectionPreview, ChartTimeRange } from './ChartPanel'
import { buildTopicChartOption } from '../utils/chartOptions'
import {
  alignModeSegmentsToEvidenceTime,
  getEvidenceChart,
  getEvidenceDisplayRange,
  getEvidenceTimelineRange,
} from '../utils/incidentEvidenceChart'
import {
  anomalyFindingToTimelineEvent,
  evidenceAssessmentToTimelineEvent,
} from '../utils/incidentAnomalyView'

type IncidentAnalysisPanelProps = {
  selectedLogId: string
  report: IncidentAnalysisResponse | null
  isLoading: boolean
  errorText: string
  onRun: () => void
  modeSegments?: ModeSegment[]
  selectionBox?: ChartSelectionPreview | null
  onChartReady?: (
    chartKey: string,
    instance: unknown,
    timeRange: ChartTimeRange,
  ) => void
  onChartDispose?: (chartKey: string) => void
  onEventFocus?: (event: IncidentTimelineEvent) => void
}

const capabilityLabels: Array<
  [Exclude<keyof IncidentAnalysisResponse['analysisCapability'], 'reasons'>, string]
> = [
  ['timeline', '时间轴'],
  ['phaseDetection', '阶段识别'],
  ['eventExtraction', '事件提取'],
  ['batteryAnalysis', '电池数据'],
  ['estimatorAnalysis', '估计器数据'],
  ['attitudeAnalysis', '姿态分析'],
  ['rateAnalysis', '角速度分析'],
  ['actuatorAnalysis', '执行器分析'],
]

const qualityLevelLabels: Record<string, string> = {
  complete: '完整',
  partial: '部分可用',
  insufficient: '数据不足',
  invalid: '无效',
}

const mappingStatusLabels: Record<string, string> = {
  mapped: '已映射',
  missing: '缺失',
}

const anomalyStatusLabels: Record<string, string> = {
  not_available: '不可运行',
  no_critical_detected: '未检测到严重异常',
  needs_review: '需要复核',
}

const anomalySeverityLabels: Record<string, string> = {
  none: '无',
  info: '信息',
  warning: '警告',
  critical: '严重',
}

const detectorStatusLabels: Record<string, string> = {
  unavailable: '不可运行',
  not_triggered: '未触发',
  triggered: '已触发',
  not_run: '未运行',
}

const propagationRoleLabels: Record<string, string> = {
  primary_suspect_event: '首个疑似异常现象',
  contributing_event: '促成现象',
  consequence_event: '后续结果',
  context_event: '上下文事件',
  unknown: '未分类',
}

const evidenceTypeLabels: Record<string, string> = {
  supporting_signal: '支持信号',
  nearby_timeline_event: '邻近事件',
  counter_or_context_signal: '反证/上下文',
  missing_signal: '缺失证据',
}

const reasonLabels: Record<string, string> = {
  'vehicle.armed or vehicle.landed missing':
    '缺少解锁或落地状态，无法可靠识别基础飞行阶段',
  'vehicle.navState or vehicle.failsafe missing':
    '缺少飞行模式或 failsafe 状态，事件提取能力受限',
  'battery.voltage missing': '缺少电池电压数据',
  'battery information missing': '缺少电池信息数据',
  'estimator.flags missing': '缺少估计器状态数据',
}

const warningMessageLabels: Record<string, string> = {
  'ULog raw signal parsing failed.': 'ULog 原始信号解析失败。',
  'Incident analysis cannot run without valid parsed log data.':
    '缺少有效解析结果，无法运行日志质量检查。',
  'The log is missing required V1.1 signals.': '该日志缺少必需信号。',
  'The log is missing required V1.2 signals.': '该日志缺少必需信号。',
  'The log is missing required V1.3 signals.': '该日志缺少必需信号。',
  'Some optional V1.1 signals are unavailable.': '部分可选信号不可用。',
  'Some optional V1.2 signals are unavailable.': '部分可选信号不可用。',
  'Some optional V1.3 signals are unavailable.': '部分可选信号不可用。',
}

const missingReasonLabels: Record<string, string> = {
  'source topic or field is unavailable': '来源 topic 或字段不可用',
  'raw signal parser did not return a usable time axis':
    '原始信号解析器未返回可用时间轴',
  'no valid timestamp axis': '缺少有效时间轴',
}

const phaseLabels: Record<string, string> = {
  ground_preflight: '地面准备',
  ground_standby: '地面待机',
  armed_waiting_takeoff: '已上锁待起飞',
  takeoff_process: '起飞过程',
  liftoff_confirmed: '离地确认',
  takeoff_complete: '起飞完成',
  normal_flight: '正常飞行',
  landing_process: '降落过程',
  ground_contact_process: '接地过程',
  landed_complete: '落地完成',
  auto_disarmed_after_landing: '自动解锁/上锁',
  disarmed_airborne_suspected: '疑似空中上锁',
  takeoff: '起飞',
  airborne: '空中飞行',
  arming: '解锁',
  flight: '飞行',
  flight_mode: '飞行模式',
  disarming: '上锁',
  command: '命令',
  failsafe: 'Failsafe',
  flight_process: '飞行过程',
  estimator: '估计器',
  mission: '任务 / Offboard',
  landing: '降落',
  landed_postflight: '落地后',
  ground: '地面',
  unknown: '未分类',
}

const eventTitleLabels: Record<string, string> = {
  ARMED: '解锁',
  DISARMED: '上锁',
  TAKEOFF_DETECTED: '离地确认',
  LANDED_DETECTED: '落地确认',
  TAKEOFF_STATE_CHANGED: '起飞状态变化',
  TAKEOFF_COMPLETED: '起飞完成',
  GROUND_CONTACT_STARTED: '接地过程',
  MAYBE_LANDED_STARTED: '可能落地',
  AT_REST_STARTED: '静止确认',
  LANDING_STARTED: '降落过程开始',
  EKF_PRIMARY_INSTANCE_CHANGED: 'EKF 主实例切换',
  VEHICLE_COMMAND_REQUESTED: '命令请求',
  MODE_CHANGED: '模式切换',
  FAILSAFE_STARTED: 'Failsafe 触发',
  FAILSAFE_ENDED: 'Failsafe 解除',
  ESTIMATOR_FLAGS_CHANGED: '估计器状态变化',
  ESTIMATOR_FLAGS_SUMMARY: '估计器状态变化摘要',
  FLIGHT_PROCESS_LOCALIZATION: '定位源',
  FLIGHT_PROCESS_FAILSAFE: '飞行故障保护',
  FLIGHT_PROCESS_POSITION_COMPARISON: '位置对比',
  LOG_ENDED_WHILE_AIRBORNE_SUSPECTED: '日志疑似在空中结束',
}

function formatSeconds(value: number | null) {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${value.toFixed(2)} s`
    : '不可用'
}

function translateReason(reason: string) {
  return reasonLabels[reason] ?? reason
}

function translateWarningMessage(message: string) {
  return warningMessageLabels[message] ?? message
}

function translateMissingReason(reason: string) {
  return missingReasonLabels[reason] ?? reason
}

function formatQualityLevel(level: string) {
  return qualityLevelLabels[level] ?? level
}

function formatMappingStatus(status: string) {
  return mappingStatusLabels[status] ?? status
}

function formatAnomalyStatus(status: string) {
  return anomalyStatusLabels[status] ?? status
}

function formatAnomalySeverity(severity: string) {
  return anomalySeverityLabels[severity] ?? severity
}

function formatDetectorStatus(status: string) {
  return detectorStatusLabels[status] ?? status
}

function formatPropagationRole(role: string) {
  return propagationRoleLabels[role] ?? role
}

function formatEvidenceType(type: string) {
  return evidenceTypeLabels[type] ?? type
}

function formatPhase(phase: string) {
  return phaseLabels[phase] ?? phase
}

function formatEventTitle(code: string, fallback: string) {
  return eventTitleLabels[code] ?? fallback
}

function canShowEvidenceChart(event: IncidentTimelineEvent) {
  return event.code !== 'FLIGHT_PROCESS_LOCALIZATION' && Boolean(event.evidenceLinks?.length)
}

function shouldHideEvidenceChartControls(event: IncidentTimelineEvent) {
  return event.code === 'FLIGHT_PROCESS_LOCALIZATION'
}

function findNearestPoint(
  series: Array<{ points: Array<[number, number]> }>,
  targetTimeS: number,
) {
  const points = series.flatMap((item) => item.points)
  if (points.length === 0) return null

  return points.reduce((closest, point) =>
    Math.abs(point[0] - targetTimeS) < Math.abs(closest[0] - targetTimeS)
      ? point
      : closest,
  )
}

function getValueBounds(series: Array<{ points: Array<[number, number]> }>) {
  const values = series
    .flatMap((item) => item.points.map((point) => point[1]))
    .filter((value) => Number.isFinite(value))
  if (values.length === 0) return null

  return {
    min: Math.min(...values),
    max: Math.max(...values),
  }
}

function buildVisibleYAxis(
  option: ReturnType<typeof buildTopicChartOption>,
  series: Array<{ points: Array<[number, number]> }>,
) {
  const bounds = getValueBounds(series)
  if (!bounds) return option.yAxis

  const span = bounds.max - bounds.min
  const padding = span > 0 ? Math.max(span * 0.12, 0.08) : Math.max(Math.abs(bounds.max) * 0.12, 0.2)
  return option.yAxis.map((axis, index) =>
    index === 0
      ? {
          ...axis,
          min: bounds.min - padding,
          max: bounds.max + padding,
        }
      : axis,
  )
}

function getVisibleModeSegments(
  modeSegments: ModeSegment[],
  range: { start: number; end: number },
) {
  return modeSegments.filter(
    (segment) =>
      Number.isFinite(segment.start) &&
      Number.isFinite(segment.end) &&
      segment.end >= range.start &&
      segment.start <= range.end,
  )
}

function formatModeBackgroundSummary(
  visibleModeSegments: ModeSegment[],
  allModeSegments: ModeSegment[],
) {
  if (visibleModeSegments.length > 0) {
    const modes = Array.from(
      new Set(visibleModeSegments.map((segment) => segment.mode || 'UNKNOWN')),
    )

    return `飞行模式背景：${modes.join(' / ')}（来自 vehicle_status.nav_state）`
  }

  return allModeSegments.length > 0
    ? '当前窗口无飞行模式背景'
    : '无飞行模式背景：未解析到 vehicle_status.nav_state'
}

function EventCriteriaTooltip({
  event,
}: {
  event: IncidentTimelineEvent
}) {
  const evidenceMessages = event.evidenceDetails
    ?.map((item) => item.message || item.signal)
    .filter(Boolean)

  return (
    <span className="incident-criteria">
      <button
        type="button"
        className="incident-criteria-button"
        aria-label="查看判断标准"
      >
        !
      </button>
      <span className="incident-criteria-popover" role="tooltip">
        <strong>判断标准</strong>
        <span>阶段：{formatPhase(event.phase ?? 'unknown')}</span>
        <span>置信度：{event.confidence}</span>
        {event.source_topic || event.source_field ? (
          <span>{`来源：${event.source_topic ?? ''}.${event.source_field ?? ''}`}</span>
        ) : null}
        {evidenceMessages?.length ? (
          <span>{`证据：${evidenceMessages.join('；')}`}</span>
        ) : null}
        {event.evidence.length > 0 ? (
          <span>{`信号：${event.evidence.join(', ')}`}</span>
        ) : null}
      </span>
    </span>
  )
}

function EventEvidenceChart({
  report,
  event,
  modeSegments = [],
  selectionBox,
  onChartReady,
  onChartDispose,
}: {
  report: IncidentAnalysisResponse
  event: IncidentTimelineEvent
  modeSegments?: ModeSegment[]
  selectionBox?: ChartSelectionPreview | null
  onChartReady?: (
    chartKey: string,
    instance: unknown,
    timeRange: ChartTimeRange,
  ) => void
  onChartDispose?: (chartKey: string) => void
}) {
  const chart = useMemo(() => getEvidenceChart(report, event), [event, report])
  const evidenceTimeS = chart?.targetTimeS ?? event.timeS
  const chartKey = `incident-evidence__${event.id}`
  const [timelineState, setTimelineState] = useState({
    eventId: event.id,
    value: evidenceTimeS,
  })
  const timelinePointer =
    timelineState.eventId === event.id ? timelineState.value : evidenceTimeS
  const handleTimelineSeek = (value: number) => {
    setTimelineState({ eventId: event.id, value })
  }
  const timeRange = useMemo(() => {
    return chart ? getEvidenceTimelineRange(chart) : { start: 0, end: 0 }
  }, [chart])
  const activeSelectionBox =
    selectionBox?.chartId === chartKey ? selectionBox : null
  const handleChartReady = useCallback(
    (instance: unknown) => {
      onChartReady?.(chartKey, instance, timeRange)
    },
    [chartKey, onChartReady, timeRange],
  )

  useEffect(() => {
    return () => {
      onChartDispose?.(chartKey)
    }
  }, [chartKey, onChartDispose])
  const visibleModeSegments = useMemo(() => {
    if (!chart) return []

    const displayRange = getEvidenceDisplayRange(chart, timelinePointer)
    const alignedModeSegments = alignModeSegmentsToEvidenceTime(
      modeSegments,
      chart.timeOffsetS,
    )

    return getVisibleModeSegments(alignedModeSegments, displayRange)
  }, [chart, modeSegments, timelinePointer])
  const modeBackgroundSummary = useMemo(
    () => formatModeBackgroundSummary(visibleModeSegments, modeSegments),
    [modeSegments, visibleModeSegments],
  )
  const option = useMemo(() => {
    if (!chart) return null
    const displayRange = getEvidenceDisplayRange(chart, timelinePointer)
    const nextOption = buildTopicChartOption(
      {
        topic: event.id,
        title: chart.title,
        series: chart.series,
      },
      visibleModeSegments,
      { showModeTrack: false },
    )
    const keyPoint = findNearestPoint(chart.series, timelinePointer)
    const yAxis = buildVisibleYAxis(nextOption, chart.series)
    const xAxis = nextOption.xAxis.map((axis, index) =>
      index === 0
        ? {
            ...axis,
            min: displayRange.start,
            max: displayRange.end,
          }
        : axis,
    )
    const seriesWithMarker = nextOption.series.map((item, index) =>
      index === 0
        ? {
            ...item,
            showSymbol: true,
            markLine: {
              silent: true,
              symbol: ['none', 'none'],
              lineStyle: {
                color: '#2563eb',
                width: 1.4,
                type: 'dashed',
              },
              label: {
                formatter: `${timelinePointer.toFixed(2)}s`,
                color: '#1d4ed8',
              },
              data: [{ xAxis: timelinePointer }],
            },
            markPoint: keyPoint
              ? {
                  symbol: 'circle',
                  symbolSize: 10,
                  itemStyle: {
                    color: '#2563eb',
                  },
                  label: {
                    show: false,
                  },
                  data: [{ coord: keyPoint }],
                }
              : undefined,
          }
        : item,
    )
    return {
      ...nextOption,
      xAxis,
      yAxis,
      series: seriesWithMarker,
      dataZoom: nextOption.dataZoom.map((item) => ({
        ...item,
        start: 0,
        end: 100,
        startValue: displayRange.start,
        endValue: displayRange.end,
      })),
    }
  }, [chart, event.id, timelinePointer, visibleModeSegments])

  if (!chart || !option) {
    return <div className="incident-inline-chart-empty">暂无可展示的证据图表</div>
  }

  return (
    <div className="incident-inline-chart">
      <div className="incident-inline-chart-head">
        <strong>{chart.title}</strong>
        <span>{`${chart.source} @ ${chart.targetTimeS.toFixed(2)}s`}</span>
      </div>
      <div className="series-selector series-selector-focused">
        <span className="series-selector-label">证据聚焦字段：</span>
        <span className="series-focus-pill">{chart.focusLabel}</span>
      </div>
      <div className="incident-mode-background-note">{modeBackgroundSummary}</div>
      <div className="chart-canvas-shell">
        <ReactECharts
          key={chartKey}
          option={option}
          lazyUpdate
          style={{ height: 360 }}
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
          timelinePointer={timelinePointer}
          isTimelinePlaying={false}
          onTimelineSeek={handleTimelineSeek}
        />
      </div>
    </div>
  )
}

function getGroupRangeLabel(group: IncidentEventGroup) {
  return group.startTimeS === group.endTimeS
    ? formatSeconds(group.startTimeS)
    : `${formatSeconds(group.startTimeS)} - ${formatSeconds(group.endTimeS)}`
}

function groupToTimelineEvent(group: IncidentEventGroup): IncidentTimelineEvent {
  const firstEvent = group.primaryEvents[0] ?? group.rawEvents[0]

  return {
    id: group.id,
    code: `GROUP_${group.phase.toUpperCase()}`,
    type: group.phase,
    timeS: group.startTimeS,
    severity: group.severity,
    title: group.title,
    detail: group.summary,
    phase: group.phase,
    rawEvent: null,
    confidence: firstEvent?.confidence ?? 'derived',
    evidence: group.evidenceSignals,
    evidenceDetails: [],
    evidenceLinks: group.evidenceLinks,
  }
}

function EvidenceAssessmentList({
  title,
  finding,
  evidenceItems,
  report,
  modeSegments,
  selectionBox,
  expandedEvidenceEventIds,
  onToggleEvidenceChart,
  onChartReady,
  onChartDispose,
}: {
  title: string
  finding: IncidentAnomalyFinding
  evidenceItems: IncidentEvidenceAssessment[]
  report: IncidentAnalysisResponse
  modeSegments: ModeSegment[]
  selectionBox?: ChartSelectionPreview | null
  expandedEvidenceEventIds: string[]
  onToggleEvidenceChart: (eventId: string) => void
  onChartReady?: IncidentAnalysisPanelProps['onChartReady']
  onChartDispose?: IncidentAnalysisPanelProps['onChartDispose']
}) {
  if (evidenceItems.length === 0) return null

  return (
    <div className="incident-evidence-detail-block">
      <strong>{title}</strong>
      <ul className="compact-list">
        {evidenceItems.map((evidence) => {
          const event = evidenceAssessmentToTimelineEvent(finding, evidence)
          const isExpanded = expandedEvidenceEventIds.includes(evidence.id)

          return (
            <li key={evidence.id}>
              <span>
                {formatEvidenceType(evidence.type)}
                {evidence.signal ? `：${evidence.signal}` : ''}
                {'；'}
                {evidence.summary}
              </span>
              {evidence.evidenceLinks.length > 0 ? (
                <div className="incident-group-actions">
                  <button
                    type="button"
                    className="incident-evidence-button"
                    onClick={() => onToggleEvidenceChart(evidence.id)}
                    aria-expanded={isExpanded}
                  >
                    显示证据图
                  </button>
                </div>
              ) : null}
              {isExpanded ? (
                <EventEvidenceChart
                  report={report}
                  event={event}
                  modeSegments={modeSegments}
                  selectionBox={selectionBox}
                  onChartReady={onChartReady}
                  onChartDispose={onChartDispose}
                />
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function TimelineEventItem({
  event,
  report,
  modeSegments,
  selectionBox,
  onChartReady,
  onChartDispose,
  expandedEvidenceEventIds,
  onToggleEvidenceChart,
  compact = false,
}: {
  event: IncidentTimelineEvent
  report: IncidentAnalysisResponse
  modeSegments: ModeSegment[]
  selectionBox?: ChartSelectionPreview | null
  onChartReady?: (
    chartKey: string,
    instance: unknown,
    timeRange: ChartTimeRange,
  ) => void
  onChartDispose?: (chartKey: string) => void
  expandedEvidenceEventIds: string[]
  onToggleEvidenceChart: (eventId: string) => void
  compact?: boolean
}) {
  const hideEvidenceChartControls = shouldHideEvidenceChartControls(event)
  const showEvidenceChart = canShowEvidenceChart(event)

  return (
    <li
      className={`incident-timeline-item incident-event-${event.severity}${
        showEvidenceChart ? ' incident-timeline-clickable' : ''
      }${compact ? ' incident-timeline-item-compact' : ''}`}
    >
      <time>{formatSeconds(event.timeS)}</time>
      <div>
        <div className="incident-event-title-row">
          <strong>{formatEventTitle(event.code, event.title)}</strong>
          <EventCriteriaTooltip event={event} />
        </div>
        <p>{event.detail}</p>
        <small>
          阶段：{formatPhase(event.phase ?? 'unknown')}；置信度：{event.confidence}
          {event.source_topic || event.source_field
            ? `；来源：${event.source_topic ?? ''}.${event.source_field ?? ''}`
            : ''}
        </small>
        {event.evidenceDetails?.length ? (
          <small>
            证据：
            {event.evidenceDetails.map((item) => item.message || item.signal).join('；')}
          </small>
        ) : null}
        {event.evidence.length > 0 ? <small>{event.evidence.join(', ')}</small> : null}
        {hideEvidenceChartControls ? null : showEvidenceChart ? (
          <button
            type="button"
            className="incident-evidence-button"
            onClick={() => onToggleEvidenceChart(event.id)}
            aria-expanded={expandedEvidenceEventIds.includes(event.id)}
          >
            定位证据图表
          </button>
        ) : (
          <small>暂无可定位图表信号</small>
        )}
        {showEvidenceChart && expandedEvidenceEventIds.includes(event.id) ? (
          <EventEvidenceChart
            report={report}
            event={event}
            modeSegments={modeSegments}
            selectionBox={selectionBox}
            onChartReady={onChartReady}
            onChartDispose={onChartDispose}
          />
        ) : null}
      </div>
    </li>
  )
}

function IncidentAnalysisPanel({
  selectedLogId,
  report,
  isLoading,
  errorText,
  onRun,
  modeSegments = [],
  selectionBox,
  onChartReady,
  onChartDispose,
}: IncidentAnalysisPanelProps) {
  const [expandedEvidenceEventIds, setExpandedEvidenceEventIds] = useState<
    string[]
  >([])
  const [expandedRawGroupIds, setExpandedRawGroupIds] = useState<string[]>([])
  const toggleEvidenceChart = (eventId: string) => {
    setExpandedEvidenceEventIds((current) =>
      current.includes(eventId)
        ? current.filter((item) => item !== eventId)
        : [...current, eventId],
    )
  }
  const toggleRawGroup = (groupId: string) => {
    setExpandedRawGroupIds((current) =>
      current.includes(groupId)
        ? current.filter((item) => item !== groupId)
        : [...current, groupId],
    )
  }

  return (
    <section className="incident-panel">
      <div className="incident-panel-head">
        <div>
          <h3>功能 1：常规日志分析</h3>
          <p className="hint">
            默认展示日志概览、飞行事件时间线和证据图表；不判断根因、硬件故障或事故概率。
          </p>
        </div>
        <button
          type="button"
          className="button"
          onClick={onRun}
          disabled={!selectedLogId || isLoading}
        >
          {isLoading ? '分析中...' : report ? '重新分析' : '运行日志分析'}
        </button>
      </div>

      {errorText ? <p className="incident-error">{errorText}</p> : null}

      {report ? (
        <div className="incident-result">
          <div className="incident-section incident-overview-section">
            <h4>日志概览</h4>
            <div className="incident-summary-grid">
              <div>
                <span>数据质量</span>
                <strong className={`quality-level quality-${report.dataQuality.level}`}>
                  {formatQualityLevel(report.dataQuality.level)}
                </strong>
              </div>
              <div>
                <span>日志时长</span>
                <strong>{formatSeconds(report.flightSummary.durationS)}</strong>
              </div>
              <div>
                <span>解锁飞行时长</span>
                <strong>{formatSeconds(report.flightSummary.armedFlightTimeS)}</strong>
              </div>
              <div>
                <span>解锁次数</span>
                <strong>{report.flightSummary.unlockCount ?? '不可用'}</strong>
              </div>
            </div>
          </div>

          <div className="incident-section">
            <h4>当前分析能力</h4>
            <div className="capability-grid">
              {capabilityLabels.map(([key, label]) => (
                <span
                  key={key}
                  className={`capability-pill ${
                    report.analysisCapability[key] ? 'capability-on' : ''
                  }`}
                >
                  {label}
                </span>
              ))}
            </div>
            {report.analysisCapability.reasons.length > 0 ? (
              <ul className="compact-list">
                {report.analysisCapability.reasons.map((reason) => (
                  <li key={reason}>{translateReason(reason)}</li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="incident-section">
            <h4>飞行阶段</h4>
            {report.phases.length > 0 ? (
              <div className="incident-phase-list">
                {report.phases.map((phase) => (
                  <div
                    className="incident-phase-item"
                    key={`${phase.phase}-${phase.startS}-${phase.endS}`}
                  >
                    <strong>{formatPhase(phase.phase)}</strong>
                    <span>
                      {formatSeconds(phase.startS)} - {formatSeconds(phase.endS)}
                    </span>
                    <small>{phase.confidence}</small>
                  </div>
                ))}
              </div>
            ) : (
              <p className="hint">当前数据不足以可靠识别飞行阶段。</p>
            )}
          </div>

          {report.anomalySummary ? (
            <div className="incident-section">
              <h4>异常提示</h4>
              <p className="hint">
                仅汇总日志明确记录的异常旗标和保守检测结果，不输出根因、硬件故障或事故概率。
              </p>
              <div className="incident-summary-grid">
                <div>
                  <span>检测状态</span>
                  <strong>{formatAnomalyStatus(report.anomalySummary.status)}</strong>
                </div>
                <div>
                  <span>最高等级</span>
                  <strong>{formatAnomalySeverity(report.anomalySummary.severity)}</strong>
                </div>
                <div>
                  <span>最早异常</span>
                  <strong>{formatSeconds(report.anomalySummary.earliestAnomalyTimeS)}</strong>
                </div>
              </div>

              {report.anomalySummary.findings.length > 0 ? (
                <ul className="compact-list">
                  {report.anomalySummary.findings.map((finding) => {
                    const event = anomalyFindingToTimelineEvent(finding)
                    const isChartExpanded = expandedEvidenceEventIds.includes(finding.id)

                    return (
                      <li key={finding.id}>
                        <strong>{finding.title}</strong>
                        {'：'}
                        {finding.summary}
                        {'；时间：'}
                        {formatSeconds(finding.startTimeS)}
                        {' - '}
                        {formatSeconds(finding.endTimeS)}
                        {'；证据信号：'}
                        {finding.evidenceSignals.join(', ')}
                        {finding.missingSignals.length > 0
                          ? `；缺失：${finding.missingSignals.join(', ')}`
                          : ''}
                        {(finding.evidenceLinks?.length ?? 0) > 0 ? (
                          <div className="incident-group-actions">
                            <button
                              type="button"
                              className="incident-evidence-button"
                              onClick={() => toggleEvidenceChart(finding.id)}
                              aria-expanded={isChartExpanded}
                            >
                              显示异常证据图
                            </button>
                          </div>
                        ) : null}
                        {isChartExpanded ? (
                          <EventEvidenceChart
                            report={report}
                            event={event}
                            modeSegments={modeSegments}
                            selectionBox={selectionBox}
                            onChartReady={onChartReady}
                            onChartDispose={onChartDispose}
                          />
                        ) : null}
                        {finding.timelineRelation ? (
                          <small>
                            阶段：{formatPhase(finding.timelineRelation.phase)}；关系：
                            {finding.timelineRelation.summary}
                          </small>
                        ) : null}
                        {finding.propagationRole ? (
                          <small>传播角色：{formatPropagationRole(finding.propagationRole)}</small>
                        ) : null}
                        {finding.supportingEvidence ||
                        finding.counterEvidence ||
                        finding.missingEvidence ? (
                          <details>
                            <summary>证据详情</summary>
                            <EvidenceAssessmentList
                              title="支持证据"
                              finding={finding}
                              evidenceItems={finding.supportingEvidence ?? []}
                              report={report}
                              modeSegments={modeSegments}
                              selectionBox={selectionBox}
                              expandedEvidenceEventIds={expandedEvidenceEventIds}
                              onToggleEvidenceChart={toggleEvidenceChart}
                              onChartReady={onChartReady}
                              onChartDispose={onChartDispose}
                            />
                            <EvidenceAssessmentList
                              title="反证 / 上下文"
                              finding={finding}
                              evidenceItems={finding.counterEvidence ?? []}
                              report={report}
                              modeSegments={modeSegments}
                              selectionBox={selectionBox}
                              expandedEvidenceEventIds={expandedEvidenceEventIds}
                              onToggleEvidenceChart={toggleEvidenceChart}
                              onChartReady={onChartReady}
                              onChartDispose={onChartDispose}
                            />
                            <EvidenceAssessmentList
                              title="缺失证据"
                              finding={finding}
                              evidenceItems={finding.missingEvidence ?? []}
                              report={report}
                              modeSegments={modeSegments}
                              selectionBox={selectionBox}
                              expandedEvidenceEventIds={expandedEvidenceEventIds}
                              onToggleEvidenceChart={toggleEvidenceChart}
                              onChartReady={onChartReady}
                              onChartDispose={onChartDispose}
                            />
                            {finding.limitations.length > 0 ? (
                              <ul className="compact-list">
                                {finding.limitations.map((limitation) => (
                                  <li key={limitation}>{limitation}</li>
                                ))}
                              </ul>
                            ) : null}
                          </details>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="hint">当前未检测到严重异常。</p>
              )}

              <details>
                <summary>检测器运行状态</summary>
                <ul className="compact-list">
                  {report.anomalySummary.detectorResults.map((detector) => (
                    <li key={detector.id}>
                      <strong>{detector.title}</strong>
                      {'：'}
                      {formatDetectorStatus(detector.status)}
                      {detector.missingSignals.length > 0
                        ? `；缺失：${detector.missingSignals.join(', ')}`
                        : ''}
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          ) : null}

          {report.incidentPropagation ? (
            <div className="incident-section">
              <h4>证据关系</h4>
              <p className="hint">
                仅按时间顺序和飞行阶段组织异常现象，帮助判断先后关系，不推断根因或硬件故障。
              </p>
              {report.incidentPropagation.events.length > 0 ? (
                <ol className="incident-timeline">
                  {report.incidentPropagation.events.map((event) => (
                    <li className="incident-timeline-item" key={event.id}>
                      <time>{formatSeconds(event.startTimeS)}</time>
                      <div>
                        <strong>{event.title}</strong>
                        <p>{event.summary}</p>
                        <small>
                          角色：{formatPropagationRole(event.role)}；阶段：
                          {formatPhase(event.phase)}
                        </small>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="hint">当前没有可组成传播链的异常现象。</p>
              )}
            </div>
          ) : null}

          <div className="incident-section">
            <h4>飞行事件时间线</h4>
            {report.eventGroups?.length ? (
              <ol className="incident-timeline incident-event-group-list">
                {report.eventGroups.map((group) => {
                  const groupEvent = groupToTimelineEvent(group)
                  const isRawExpanded = expandedRawGroupIds.includes(group.id)
                  const isChartExpanded = expandedEvidenceEventIds.includes(group.id)

                  return (
                    <li
                      className={`incident-timeline-item incident-event-group incident-event-${group.severity}${
                        group.evidenceLinks?.length ? ' incident-timeline-clickable' : ''
                      }`}
                      key={group.id}
                    >
                      <time>{getGroupRangeLabel(group)}</time>
                      <div>
                        <div className="incident-event-title-row">
                          <strong>{group.title}</strong>
                          <span className="incident-group-count">
                            {group.rawEvents.length} 条事件
                          </span>
                        </div>
                        <p>{group.summary}</p>
                        <small>
                          分组：{formatPhase(group.phase)}；证据信号：
                          {group.evidenceSignals.length > 0
                            ? group.evidenceSignals.join(', ')
                            : '暂无'}
                        </small>
                        <div className="incident-group-actions">
                          {group.evidenceLinks?.length ? (
                            <button
                              type="button"
                              className="incident-evidence-button"
                              onClick={() => toggleEvidenceChart(group.id)}
                              aria-expanded={isChartExpanded}
                            >
                              显示阶段证据图
                            </button>
                          ) : (
                            <small>暂无可定位图表信号</small>
                          )}
                          <button
                            type="button"
                            className="incident-evidence-button incident-secondary-button"
                            onClick={() => toggleRawGroup(group.id)}
                            aria-expanded={isRawExpanded}
                          >
                            {isRawExpanded ? '收起原始事件' : '展开原始事件'}
                          </button>
                        </div>
                        {isChartExpanded ? (
                          <EventEvidenceChart
                            report={report}
                            event={groupEvent}
                            modeSegments={modeSegments}
                            selectionBox={selectionBox}
                            onChartReady={onChartReady}
                            onChartDispose={onChartDispose}
                          />
                        ) : null}
                        {isRawExpanded ? (
                          <ol className="incident-timeline incident-raw-event-list">
                            {group.rawEvents.map((event) => (
                              <TimelineEventItem
                                key={event.id}
                                event={event}
                                report={report}
                                modeSegments={modeSegments}
                                selectionBox={selectionBox}
                                onChartReady={onChartReady}
                                onChartDispose={onChartDispose}
                                expandedEvidenceEventIds={expandedEvidenceEventIds}
                                onToggleEvidenceChart={toggleEvidenceChart}
                                compact
                              />
                            ))}
                          </ol>
                        ) : null}
                      </div>
                    </li>
                  )
                })}
              </ol>
            ) : report.timeline.length > 0 ? (
              <ol className="incident-timeline">
                {report.timeline.map((event) => (
                  <TimelineEventItem
                    key={event.id}
                    event={event}
                    report={report}
                    modeSegments={modeSegments}
                    selectionBox={selectionBox}
                    onChartReady={onChartReady}
                    onChartDispose={onChartDispose}
                    expandedEvidenceEventIds={expandedEvidenceEventIds}
                    onToggleEvidenceChart={toggleEvidenceChart}
                  />
                ))}
              </ol>
            ) : (
              <p className="hint">当前没有可展示的确定性事件。</p>
            )}
          </div>

          {report.warnings.length > 0 ? (
            <div className="incident-section">
              <h4>提示</h4>
              <ul className="compact-list">
                {report.warnings.map((warning) => (
                  <li key={warning.code}>
                    <strong>{warning.code}</strong>
                    {'：'}
                    {translateWarningMessage(warning.message)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="incident-section">
            <h4>缺失信号</h4>
            {report.missingSignals.length > 0 ? (
              <ul className="compact-list">
                {report.missingSignals.map((signal) => (
                  <li key={signal.id}>
                    <strong>{signal.id}</strong>
                    {signal.required ? '（必需）' : '（可选）'}
                    {'：'}
                    {translateMissingReason(signal.reason)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint">标准信号均已映射。</p>
            )}
          </div>

          <details className="incident-section incident-advanced-details">
            <summary>高级诊断细节：标准信号映射</summary>
            <p className="hint">
              契约版本：{report.contractVersion}
              {report.anomalySummary?.version
                ? `；异常检测版本：${report.anomalySummary.version}`
                : ''}
              {report.incidentPropagation?.version
                ? `；证据关系版本：${report.incidentPropagation.version}`
                : ''}
            </p>
            <div className="incident-mapping-table">
              <div className="incident-mapping-row incident-mapping-header">
                <span>标准信号</span>
                <span>状态</span>
                <span>来源</span>
                <span>样本</span>
              </div>
              {report.signalMappingReport.map((item) => (
                <div className="incident-mapping-row" key={item.standardSignal}>
                  <span>{item.standardSignal}</span>
                  <span>{formatMappingStatus(item.status)}</span>
                  <span>
                    {item.source
                      ? `${item.source.topic}[${item.source.instance}].${item.source.field}`
                      : '无'}
                  </span>
                  <span>{item.sampleCount}</span>
                </div>
              ))}
            </div>
          </details>
        </div>
      ) : null}
    </section>
  )
}

export default IncidentAnalysisPanel
