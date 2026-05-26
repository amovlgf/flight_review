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
