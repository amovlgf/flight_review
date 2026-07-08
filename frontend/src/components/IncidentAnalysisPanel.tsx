import type {
  IncidentAnalysisResponse,
  IncidentEventGroup,
  IncidentTimelineEvent,
} from '../types/log'

type IncidentAnalysisPanelProps = {
  selectedLogId: string
  report: IncidentAnalysisResponse | null
  isLoading: boolean
  errorText: string
  onRun: () => void
}

type TimelineItem =
  | {
      kind: 'group'
      group: IncidentEventGroup
    }
  | {
      kind: 'event'
      event: IncidentTimelineEvent
    }

const phaseLabels: Record<string, string> = {
  arming: '解锁',
  takeoff: '起飞',
  flight: '飞行',
  flight_mode: '飞行模式',
  landing: '降落',
  disarming: '上锁',
  command: '命令',
  failsafe: 'Failsafe',
  flight_process: '飞行过程',
  estimator: '估计器',
  mission: '任务 / Offboard',
  takeoff_complete: '起飞完成',
  normal_flight: '正常飞行',
  landed_complete: '落地完成',
  unknown: '未分类',
}

const eventTitleLabels: Record<string, string> = {
  ARMED: '解锁',
  DISARMED: '上锁',
  TAKEOFF_DETECTED: '离地确认',
  LANDED_DETECTED: '落地确认',
  TAKEOFF_COMPLETED: '起飞完成',
  MODE_CHANGED: '模式切换',
  FAILSAFE_STARTED: 'Failsafe 触发',
  FAILSAFE_ENDED: 'Failsafe 解除',
  ESTIMATOR_FLAGS_CHANGED: '估计器状态变化',
  ESTIMATOR_FLAGS_SUMMARY: '估计器状态变化摘要',
  VEHICLE_COMMAND_REQUESTED: '命令请求',
  LOG_ENDED_WHILE_AIRBORNE_SUSPECTED: '日志疑似在空中结束',
}

const severityLabels: Record<string, string> = {
  critical: '严重',
  error: '错误',
  warning: '警告',
  notice: '提示',
  info: '信息',
}

function formatSeconds(value: number | null) {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${value.toFixed(2)} s`
    : '不可用'
}

function formatPhase(phase: string) {
  return phaseLabels[phase] ?? phase
}

function formatEventTitle(code: string, fallback: string) {
  return eventTitleLabels[code] ?? fallback
}

function getGroupRangeLabel(group: IncidentEventGroup) {
  return group.startTimeS === group.endTimeS
    ? formatSeconds(group.startTimeS)
    : `${formatSeconds(group.startTimeS)} - ${formatSeconds(group.endTimeS)}`
}

function getTimelineItems(report: IncidentAnalysisResponse): TimelineItem[] {
  if (report.eventGroups?.length) {
    return report.eventGroups.map((group) => ({ kind: 'group', group }))
  }

  return report.timeline.map((event) => ({ kind: 'event', event }))
}

function getEventIcon({
  code,
  phase,
  severity,
  type,
}: {
  code?: string
  phase?: string
  severity?: string
  type?: string
}) {
  const normalizedSeverity = severity?.toLowerCase() ?? ''
  const normalizedPhase = phase?.toLowerCase() ?? ''
  const normalizedType = type?.toLowerCase() ?? ''
  const normalizedCode = code?.toLowerCase() ?? ''
  const iconKey = `${normalizedPhase} ${normalizedType} ${normalizedCode}`

  if (normalizedSeverity === 'critical' || normalizedSeverity === 'error') {
    return { label: normalizedSeverity, symbol: '!' }
  }
  if (normalizedSeverity === 'warning') {
    return { label: 'warning', symbol: '!' }
  }
  if (iconKey.includes('failsafe')) {
    return { label: 'failsafe', symbol: 'F' }
  }
  if (iconKey.includes('takeoff')) {
    return { label: 'takeoff', symbol: '↑' }
  }
  if (iconKey.includes('landing') || iconKey.includes('landed')) {
    return { label: 'landing', symbol: '↓' }
  }
  if (iconKey.includes('flight_mode') || iconKey.includes('mode')) {
    return { label: 'flight_mode', symbol: 'M' }
  }
  if (iconKey.includes('arming') || iconKey.includes('armed')) {
    return { label: 'arming', symbol: 'A' }
  }
  if (iconKey.includes('disarming') || iconKey.includes('disarmed')) {
    return { label: 'disarming', symbol: 'D' }
  }
  if (iconKey.includes('estimator') || iconKey.includes('ekf')) {
    return { label: 'estimator', symbol: 'E' }
  }
  if (iconKey.includes('command')) {
    return { label: 'command', symbol: 'C' }
  }

  return { label: 'event', symbol: '•' }
}

function TimelineIcon({
  code,
  phase,
  severity,
  type,
}: {
  code?: string
  phase?: string
  severity?: string
  type?: string
}) {
  const icon = getEventIcon({ code, phase, severity, type })

  return (
    <span className="incident-event-icon" role="img" aria-label={icon.label}>
      {icon.symbol}
    </span>
  )
}

function GroupTimelineItem({ group }: { group: IncidentEventGroup }) {
  return (
    <li className={`incident-timeline-item incident-event-${group.severity}`}>
      <time>{getGroupRangeLabel(group)}</time>
      <TimelineIcon phase={group.phase} severity={group.severity} />
      <div className="incident-timeline-content">
        <div className="incident-event-title-row">
          <strong>{group.title}</strong>
          <span className="incident-group-count">
            {group.rawEvents.length} 条事件
          </span>
        </div>
        <p>{group.summary}</p>
        <small>
          {formatPhase(group.phase)}
          {group.evidenceSignals.length > 0
            ? `；证据信号：${group.evidenceSignals.join(', ')}`
            : ''}
        </small>
      </div>
    </li>
  )
}

function RawTimelineItem({ event }: { event: IncidentTimelineEvent }) {
  return (
    <li className={`incident-timeline-item incident-event-${event.severity}`}>
      <time>{formatSeconds(event.timeS)}</time>
      <TimelineIcon
        code={event.code}
        phase={event.phase}
        severity={event.severity}
        type={event.type}
      />
      <div className="incident-timeline-content">
        <div className="incident-event-title-row">
          <strong>{formatEventTitle(event.code, event.title)}</strong>
          <span className="incident-group-count">
            {severityLabels[event.severity] ?? event.severity}
          </span>
        </div>
        <p>{event.detail}</p>
        <small>
          {formatPhase(event.phase ?? 'unknown')}；置信度：{event.confidence}
        </small>
      </div>
    </li>
  )
}

function IncidentEventTimelineSection({
  report,
}: {
  report: IncidentAnalysisResponse
}) {
  const items = getTimelineItems(report)

  return (
    <div className="incident-section">
      <h4>飞行事件时间线</h4>
      {items.length > 0 ? (
        <ol className="incident-timeline">
          {items.map((item) =>
            item.kind === 'group' ? (
              <GroupTimelineItem key={item.group.id} group={item.group} />
            ) : (
              <RawTimelineItem key={item.event.id} event={item.event} />
            ),
          )}
        </ol>
      ) : (
        <p className="hint">当前没有可展示的确定性事件。</p>
      )}
    </div>
  )
}

function IncidentAnalysisPanel({
  selectedLogId,
  report,
  isLoading,
  errorText,
  onRun,
}: IncidentAnalysisPanelProps) {
  return (
    <section className="incident-panel">
      <div className="incident-panel-head">
        <div>
          <h3>功能 1：常规日志分析</h3>
          <p className="hint">仅展示飞行事件时间线和对应事件图标。</p>
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
          <IncidentEventTimelineSection report={report} />
        </div>
      ) : null}
    </section>
  )
}

export default IncidentAnalysisPanel
