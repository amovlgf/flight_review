export type LogMetadata = {
  fileSizeBytes: number
  version: number
  logStartTimestampUs: number
}

export type LogItem = {
  logId: string
  fileName: string
  uploadedAt: string
  metadata: LogMetadata
}

export type ChartPoint = [number, number]

export type ChartSeries = {
  name: string
  unit: string
  points: ChartPoint[]
}

export type TopicChart = {
  topic: string
  title: string
  series: ChartSeries[]
}

export type Diagnostic = {
  level: 'ok' | 'warning' | 'info'
  ruleCode: string
  title: string
  detail: string
}

export type ModeSegment = {
  start: number
  end: number
  durationS?: number
  mode: string
  mode_code: number
  color: string
  isShortMode?: boolean
}

export type ChartDataSource =
  | 'header-derived-simulated-series'
  | 'px4-topics-derived'
  | (string & {})

export type ChartDataResponse = {
  contractVersion: 'chart-data.v1.3' | string
  message: string
  code?: string
  dataSource: ChartDataSource
  role: string
  availableRoles: string[]
  logId: string
  fileName: string
  uploadedAt: string
  metadata: LogMetadata
  usedTopics: string[]
  modeSegments: ModeSegment[]
  series: ChartSeries[]
  topicCharts: TopicChart[]
  diagnostics: Diagnostic[]
}

export type UploadLogResponse = {
  message: string
  logId: string
  file: {
    originalName: string
    size: number
  }
  metadata: LogMetadata
  diagnostics: Diagnostic[]
  topicCharts: TopicChart[]
  dataSource: ChartDataSource
  usedTopics: string[]
  modeSegments: ModeSegment[]
}

export type BatchAnalyzeFailedLog = {
  fileName: string
  reason: string
}

export type BatchAnalyzeUnlockedLog = {
  fileName: string
  flightTimeS: number | null
  logStartTimestampUs?: number | null
}

export type BatchAnalyzeLogsResponse = {
  unlockedLogs: string[]
  unlockedLogDetails?: BatchAnalyzeUnlockedLog[]
  failedLogs: BatchAnalyzeFailedLog[]
  total: number
  unlockedCount: number
  failedCount: number
}

export type BatchControlQualityReportItem = {
  logId: string
  fileName: string
  uploadedAt: string
  metadata: LogMetadata
  report: ControlQualityReport
}

export type BatchControlQualityResponse = {
  reports: BatchControlQualityReportItem[]
  failedLogs: BatchAnalyzeFailedLog[]
  total: number
  successCount: number
  failedCount: number
}

export type LogListResponse = {
  total: number
  page: number
  pageSize: number
  pageCount: number
  q: string
  items: LogItem[]
}

export type FetchLogListParams = {
  q?: string
  page?: number
  pageSize?: number
}

export type ControlQualityStatus =
  | 'available'
  | 'unavailable'
  | 'topic_missing'
  | 'field_missing'
  | 'not_enough_data'

export type ControlQualityMetrics = Record<string, number | string | null>

export type ControlQualityAxis = {
  status: ControlQualityStatus | string
  unit: string
  metrics: ControlQualityMetrics
}

export type ControlQualityLoop = {
  status: ControlQualityStatus | string
  axis?: Record<string, ControlQualityAxis>
  metrics?: ControlQualityMetrics
  channels?: Array<Record<string, number | string | null>>
  chart?: Array<{
    name: string
    points: ChartPoint[]
  }>
  charts?: Array<{
    axis: string
    unit: string
    setpointFeedback: Array<[number, number, number]>
    error: ChartPoint[]
  }>
  notes?: string[]
}

export type ControlQualityParameterBound = {
  min: number | string | null
  max: number | string | null
  maxStepPercent: number | string | null
}

export type ControlQualityParameterTuningStatus =
  | 'target_generated'
  | 'bounds_required'
  | 'invalid_bounds'
  | 'missing_current'
  | 'blocked'
  | 'unchanged'
  | 'display_only'
  | string

export type ControlQualityParameterTuningItem = {
  loop: string
  axis: string
  axes: string[]
  gain: string
  role?: string
  targetable?: boolean
  parameter: string
  description?: string
  currentValue: number | null
  currentSource: 'initial' | 'changed' | 'missing' | string
  currentTimeS: number | null
  bounds: {
    min: number
    max: number
    maxStepPercent: number
  } | null
  metricSummary: Record<string, number | string | null>
  status: ControlQualityParameterTuningStatus
  targetValue: number | null
  changePercent: number | null
  phenomenon?: string
  confidence?: 'low' | 'medium' | 'high' | string
  evidence?: string[]
  reason: string
}

export type ControlQualityLoopParameterTuning = {
  status: string
  parameters: ControlQualityParameterTuningItem[]
  blockers?: string[]
  notes: string[]
}

export type ControlQualityParameterTuning = {
  actuatorBlocksIncrease: boolean
  actuatorSaturationLevel?: 'none' | 'high' | 'severe' | string
  loops: Record<string, ControlQualityLoopParameterTuning | undefined>
  warnings: string[]
}

export type ControlQualityReport = {
  log_file: string
  analysis_time_range: {
    start_s: number | null
    end_s: number | null
    source: string
  }
  summary: {
    available_loops: string[]
    unavailable_loops: string[]
    main_hints: string[]
  }
  loops: {
    actuator?: ControlQualityLoop
    rate?: ControlQualityLoop
    attitude?: ControlQualityLoop
    velocity?: ControlQualityLoop
    position?: ControlQualityLoop
  }
  parameterTuning?: ControlQualityParameterTuning
  estimator_quality: Record<string, number | string | null>
  missing_topics: string[]
  missing_fields: Array<{
    loop: string
    axis: string
    topic: string
    fields: string[]
  }>
  warnings: string[]
}

export type ControlQualityPayload = {
  logId: string
  segment?: {
    startS: number | null
    endS: number | null
    source?: string
  }
  parameterBounds?: Record<string, ControlQualityParameterBound>
  format?: 'json' | 'csv'
}

export type DataQualityLevel =
  | 'complete'
  | 'partial'
  | 'insufficient'
  | 'invalid'

export type DataQualityRuleResult = {
  code: string
  level: DataQualityLevel
  message: string
}

export type DataQualityReport = {
  level: DataQualityLevel
  rules: DataQualityRuleResult[]
  parser: {
    success: boolean
    error: string | null
  }
}

export type AnalysisCapability = {
  timeline: boolean
  phaseDetection: boolean
  eventExtraction: boolean
  attitudeAnalysis: boolean
  rateAnalysis: boolean
  actuatorAnalysis: boolean
  batteryAnalysis: boolean
  estimatorAnalysis: boolean
  reasons: string[]
}

export type SignalMappingReportItem = {
  standardSignal: string
  status: 'mapped' | 'missing' | string
  required: boolean
  source: {
    topic: string
    instance: number
    field: string
    source: 'raw' | 'derived' | string
  } | null
  sampleCount: number
  missingRatio: number
}

export type MissingSignal = {
  id: string
  required: boolean
  reason: string
}

export type AnalysisWarning = {
  code: string
  level: 'info' | 'warning' | 'error' | string
  message: string
}

export type IncidentFlightPhase = {
  phase: string
  startS: number
  endS: number
  source: string
  confidence: 'high' | 'medium' | 'low' | 'confirmed' | 'derived' | string
  evidenceCount?: number
}

export type IncidentEvidenceDetail = {
  signal: string
  message: string
  value?: number | string | boolean | null
  source_topic: string
  source_field: string
}

export type IncidentRawEvent = {
  kind: string
  signal?: string
  previous?: number | string | boolean | null
  current?: number | string | boolean | null
  previousLabel?: string
  currentLabel?: string
  stableDurationS?: number
  changeCount?: number
  changedFields?: string[]
  [key: string]: unknown
}

export type IncidentChartHint = {
  chartGroupId: string
  seriesId: string
  chartTopic: string
  targetTimeS: number
  timeWindow: {
    startS: number
    endS: number
  }
}

export type IncidentTimelineEvent = {
  id: string
  code: string
  type: string
  timeS: number
  severity: 'info' | 'warning' | 'error' | string
  title: string
  detail: string
  description?: string
  phase?: string
  rawEvent?: IncidentRawEvent | null
  confidence: 'high' | 'medium' | 'low' | 'confirmed' | 'derived' | string
  evidence: string[]
  evidenceDetails?: IncidentEvidenceDetail[]
  source_topic?: string
  source_field?: string
  chart_hint?: IncidentChartHint | null
  evidenceLinks?: IncidentEvidenceLink[]
}

export type IncidentEventGroup = {
  id: string
  phase:
    | 'arming'
    | 'takeoff'
    | 'flight'
    | 'flight_mode'
    | 'landing'
    | 'disarming'
    | 'command'
    | 'failsafe'
    | 'flight_process'
    | 'estimator'
    | 'mission'
    | 'unknown'
    | string
  severity: 'info' | 'notice' | 'warning' | 'critical' | string
  startTimeS: number
  endTimeS: number
  title: string
  summary: string
  primaryEvents: IncidentTimelineEvent[]
  evidenceEvents: IncidentTimelineEvent[]
  rawEvents: IncidentTimelineEvent[]
  evidenceSignals: string[]
  evidenceLinks?: IncidentEvidenceLink[]
  chartPreset:
    | 'takeoffEvidence'
    | 'landingEvidence'
    | 'modeTimeline'
    | 'commandAck'
    | 'failsafeWindow'
    | 'estimatorFlags'
    | null
    | string
}

export type IncidentEvidenceLink = {
  id: string
  eventId: string
  standardSignal: string
  chartGroupId: string
  seriesId: string
  chartTopic: string
  targetTimeS: number
  timeWindow: {
    startS: number
    endS: number
  }
  source: {
    topic: string
    instance: number
    field: string
  }
}

export type FlightProcessSourceRef = {
  topic: string
  instance: number
  field: string
} | null

export type FlightProcessBooleanInterval = {
  startS: number
  endS: number
}

export type FlightProcessBooleanChange = {
  timeS: number
  active: boolean
}

export type FlightProcessLocalizationSource = {
  id: string
  label: string
  signal: string
  available: boolean
  activeIntervals: FlightProcessBooleanInterval[]
  changes: FlightProcessBooleanChange[]
  source: FlightProcessSourceRef
}

export type FlightProcessFailsafeFlag = {
  id: string
  label: string
  signal: string
  value: number
  source: FlightProcessSourceRef
}

export type FlightProcessFailsafeEvent = {
  id: string
  startS: number
  endS: number | null
  durationS: number | null
  navState: string | null
  navStateUserIntention: string | null
  activeFlags: FlightProcessFailsafeFlag[]
  source: FlightProcessSourceRef
}

export type FlightProcessPositionSeries = {
  kind: 'setpoint' | 'actual' | 'vision' | string
  label: string
  signal: string
  unit: string
  points: ChartPoint[]
  source: FlightProcessSourceRef
}

export type FlightProcessPositionAxis = {
  axis: 'x' | 'y' | 'z' | string
  label: string
  unit: string
  series: FlightProcessPositionSeries[]
}

export type FlightProcessMissingSignal = {
  signal: string
  label: string
}

export type FlightProcessReport = {
  localizationSources: FlightProcessLocalizationSource[]
  failsafeEvents: FlightProcessFailsafeEvent[]
  positionComparison: FlightProcessPositionAxis[]
  missingSignals: FlightProcessMissingSignal[]
}

export type IncidentAnomalySeverity =
  | 'none'
  | 'info'
  | 'warning'
  | 'critical'
  | string

export type IncidentAnomalyThreshold = {
  id: string
  source: 'logged_flag' | 'static' | 'adaptive' | string
  comparator: string
  value: number | string | null
}

export type IncidentAnomalyFinding = {
  id: string
  detectorId: string
  category: string
  severity: IncidentAnomalySeverity
  title: string
  summary: string
  startTimeS: number
  endTimeS: number | null
  confidence: 'confirmed' | 'derived' | 'low' | 'medium' | 'high' | string
  evidenceSignals: string[]
  missingSignals: string[]
  source: {
    topic: string
    instance: number
    field: string
  } | null
  thresholds: IncidentAnomalyThreshold[]
  evidenceLinks?: IncidentEvidenceLink[]
  supportingEvidence?: IncidentEvidenceAssessment[]
  counterEvidence?: IncidentEvidenceAssessment[]
  missingEvidence?: IncidentEvidenceAssessment[]
  timelineRelation?: {
    phase: string
    nearestPreviousEventId: string | null
    nearestNextEventId: string | null
    nearbyEventIds: string[]
    summary: string
  }
  propagationRole?:
    | 'primary_suspect_event'
    | 'contributing_event'
    | 'consequence_event'
    | 'context_event'
    | 'unknown'
    | string
  limitations: string[]
}

export type IncidentEvidenceAssessment = {
  id: string
  type:
    | 'supporting_signal'
    | 'nearby_timeline_event'
    | 'counter_or_context_signal'
    | 'missing_signal'
    | string
  signal: string
  timeWindow: {
    startS: number
    endS: number
  }
  summary: string
  confidence: 'confirmed' | 'derived' | 'low' | 'medium' | 'high' | string
  evidenceLinks: IncidentEvidenceLink[]
}

export type IncidentAnomalyDetectorResult = {
  id: string
  category: string
  version: string
  status:
    | 'unavailable'
    | 'not_triggered'
    | 'triggered'
    | 'not_run'
    | string
  severity: IncidentAnomalySeverity
  title: string
  summary: string
  evidenceSignals: string[]
  missingSignals: string[]
  thresholds: IncidentAnomalyThreshold[]
  findings: IncidentAnomalyFinding[]
  limitations: string[]
}

export type IncidentAnomalySummary = {
  version: string
  status:
    | 'not_available'
    | 'no_critical_detected'
    | 'needs_review'
    | string
  severity: IncidentAnomalySeverity
  earliestAnomalyTimeS: number | null
  findings: IncidentAnomalyFinding[]
  detectorResults: IncidentAnomalyDetectorResult[]
  limitations: string[]
}

export type IncidentPropagation = {
  version: string
  status: 'built' | 'no_anomalies' | 'not_available' | string
  events: Array<{
    id: string
    findingId: string
    title: string
    startTimeS: number
    endTimeS: number | null
    severity: IncidentAnomalySeverity
    role: string
    phase: string
    summary: string
    previousEventId: string | null
    nextEventId: string | null
    relatedTimelineEventIds: string[]
  }>
  links: Array<{
    id: string
    sourceFindingId: string
    targetFindingId: string
    relation: 'temporal_sequence' | string
    confidence: 'low' | 'medium' | 'high' | string
    summary: string
  }>
  limitations: string[]
}

export type IncidentAnalysisResponse = {
  contractVersion:
    | 'incident-analysis.v3.0'
    | 'incident-analysis.v2.0'
    | 'incident-analysis.v1.3'
    | 'incident-analysis.v1.2'
    | string
  analysisId: string
  logId: string
  fileName: string
  dataQuality: DataQualityReport
  analysisCapability: AnalysisCapability
  signalMappingReport: SignalMappingReportItem[]
  flightSummary: {
    durationS: number | null
    armedFlightTimeS: number | null
    displayTimeOffsetS?: number | null
    flightWindow?: {
      startS: number
      endS: number
      durationS: number
      source: string
    } | null
    unlockCount: number | null
  }
  phases: IncidentFlightPhase[]
  timeline: IncidentTimelineEvent[]
  eventGroups?: IncidentEventGroup[]
  flightProcess?: FlightProcessReport
  anomalySummary?: IncidentAnomalySummary
  incidentPropagation?: IncidentPropagation
  chartGroups: Array<{
    id: string
    title: string
    series: Array<{
      id: string
      label: string
      unit: string
      points: ChartPoint[]
      source: {
        topic: string
        instance: number
        field: string
      }
    }>
  }>
  warnings: AnalysisWarning[]
  missingSignals: MissingSignal[]
}
