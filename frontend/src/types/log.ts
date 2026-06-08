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
  mode: string
  mode_code: number
  color: string
}

export type ChartDataSource =
  | 'header-derived-simulated-series'
  | 'px4-topics-derived'
  | (string & {})

export type ChartDataResponse = {
  message: string
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
  charts?: Array<{
    axis: string
    unit: string
    setpointFeedback: Array<[number, number, number]>
    error: ChartPoint[]
  }>
  notes?: string[]
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
  format?: 'json' | 'csv'
}
