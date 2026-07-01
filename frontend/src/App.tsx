import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import './App.css'
import AdvancedRawDataPanel from './components/AdvancedRawDataPanel'
import BatchLogUpload from './components/BatchLogUpload'
import ChartPanel from './components/ChartPanel'
import ControlQualityPanel from './components/ControlQualityPanel'
import IncidentAnalysisPanel from './components/IncidentAnalysisPanel'
import type {
  ActiveLogMeta,
  ChartSelectionPreview,
  ChartSeries,
  ChartTimeRange,
  DiagnosticItem,
  ModeSegment,
  TopicChart,
} from './components/ChartPanel'
import LogSelector from './components/LogSelector'
import UploadPanel from './components/UploadPanel'
import {
  batchCalculateControlQuality,
  calculateControlQuality,
  fetchChartData,
  fetchLogList,
  runIncidentAnalysis,
  uploadLogFile,
} from './services/api'
import type {
  ControlQualityParameterBound,
  ControlQualityReport,
  IncidentAnalysisResponse,
  IncidentTimelineEvent,
} from './types/log'
import {
  buildChartSelectionControlSegment,
  ensureVisibleSelectionBox,
  isValidTimeSelectionBox,
  normalizeSelectionBox,
  shouldShowSelectionPreview,
} from './utils/selectionBox'

type ChartAction = {
  type: string
  [key: string]: unknown
}

type ChartZoomState = {
  start?: number
  end?: number
}

type ChartInstance = {
  getDom: () => HTMLElement
  getHeight: () => number
  getOption: () => { dataZoom?: ChartZoomState[] }
  convertFromPixel: (
    finder: Record<string, unknown>,
    value: number | number[],
  ) => number | number[]
  convertToPixel: (
    finder: Record<string, unknown>,
    value: number | number[],
  ) => number | number[]
  dispatchAction: (action: ChartAction) => void
  on: (eventName: 'datazoom', handler: () => void) => void
  off: (eventName: 'datazoom', handler: () => void) => void
  isDisposed?: () => boolean
}

type ChartRegistryItem = {
  chart: ChartInstance
  timeRange: ChartTimeRange
  rangeGroupKey?: string
}

type ControlQualityLinkedRange = {
  startS: number
  endS: number
}

type ViewMode = 'home' | 'log-analysis' | 'batch' | 'control-analysis'
type LogAnalysisStep = 'upload' | 'chart'

type ControlAnalysisReportItem = {
  clientId: string
  fileName: string
  logId: string
  report: ControlQualityReport | null
  isLoading: boolean
  errorText: string
}

type IncidentEvidenceFocus = {
  eventId: string
  chartTopic: string
  seriesName: string
  label: string
  startS: number
  endS: number
  targetTimeS: number
}

function mapIncidentChartGroupsToTopicCharts(
  report: IncidentAnalysisResponse,
): TopicChart[] {
  return Array.isArray(report.chartGroups)
    ? report.chartGroups.map((group) => ({
        topic: group.id,
        title: group.title,
        series: Array.isArray(group.series)
          ? group.series.map((item) => ({
              name: item.label || item.id,
              unit: item.unit || '',
              points: item.points,
            }))
          : [],
      }))
    : []
}

const PAGE_SIZE = 8
const TIMELINE_PLAYBACK_SPEED = 1
const TIMELINE_FINE_STEP_MIN_S = 0.05
const TIMELINE_FINE_STEP_MAX_S = 1
const CHART_SELECTION_MIN_PREVIEW_PX = 5
const CHART_SELECTION_MIN_WIDTH_PX = 5
const CHART_SELECTION_MIN_VISUAL_PX = 1

function getFileSelectionKey(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}`
}

function isUlgFile(file: File) {
  return file.name.toLowerCase().endsWith('.ulg')
}

function clampPercent(value: number) {
  return Math.min(Math.max(value, 0), 100)
}

function percentToTimeValue(percent: number, timeRange: ChartTimeRange) {
  const span = timeRange.end - timeRange.start
  if (span <= 0) return timeRange.start
  return timeRange.start + (span * percent) / 100
}

function timeValueToPercent(value: number, timeRange: ChartTimeRange) {
  const span = timeRange.end - timeRange.start
  if (span <= 0) return 0
  return clampPercent(((value - timeRange.start) / span) * 100)
}

function findChartWrapElementByTopic(topic: string) {
  if (!topic || typeof document === 'undefined') return null

  return (
    Array.from(document.querySelectorAll<HTMLElement>('.chart-wrap[data-topic]')).find(
      (item) => item.dataset.topic === topic,
    ) ?? null
  )
}

function normalizePixelTimeValue(value: number | number[]) {
  const timeValue = Array.isArray(value) ? value[0] : value
  return typeof timeValue === 'number' && Number.isFinite(timeValue)
    ? timeValue
    : null
}

function clampTimeValue(value: number, timeRange: ChartTimeRange) {
  return Math.min(Math.max(value, timeRange.start), timeRange.end)
}

function isEditableKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return Boolean(
    target.closest(
      'input, textarea, select, button, a, [contenteditable="true"]',
    ) || target.isContentEditable,
  )
}

function isChartDisposed(chart: ChartInstance) {
  try {
    return chart.isDisposed?.() === true
  } catch {
    return true
  }
}

function App() {
  const chartCleanupRef = useRef<Map<string, () => void>>(new Map())
  const chartRegistryRef = useRef<Map<string, ChartRegistryItem>>(new Map())
  const isSyncingZoomRef = useRef(false)
  const isGlobalChartSyncEnabledRef = useRef(false)
  const timelinePointerRef = useRef<number | null>(null)
  const isTimelinePlayingRef = useRef(false)
  const activeTimelineChartKeyRef = useRef<string | null>(null)
  const [selectedFileName, setSelectedFileName] = useState('')
  const [isUploading, setIsUploading] = useState(false)
  const [selectedLogId, setSelectedLogId] = useState('')
  const [statusText, setStatusText] = useState('')
  const [chartHint, setChartHint] = useState(
    '\u56fe\u8868\u7ec4\u4ef6\u5360\u4f4d\u533a',
  )
  const [seriesData, setSeriesData] = useState<ChartSeries[]>([])
  const [topicCharts, setTopicCharts] = useState<TopicChart[]>([])
  const [evidenceTopicCharts, setEvidenceTopicCharts] = useState<TopicChart[]>([])
  const [evidenceChartHint, setEvidenceChartHint] = useState(
    '运行日志分析后展示事件证据图表。',
  )
  const [modeSegments, setModeSegments] = useState<ModeSegment[]>([])
  const [diagnostics, setDiagnostics] = useState<DiagnosticItem[]>([])
  const [incidentAnalysisReport, setIncidentAnalysisReport] =
    useState<IncidentAnalysisResponse | null>(null)
  const [isIncidentAnalysisLoading, setIsIncidentAnalysisLoading] =
    useState(false)
  const [incidentAnalysisError, setIncidentAnalysisError] = useState('')
  const [incidentEvidenceFocus, setIncidentEvidenceFocus] =
    useState<IncidentEvidenceFocus | null>(null)
  const [logList, setLogList] = useState<
    Array<{ logId: string; fileName: string; uploadedAt: string }>
  >([])
  const [activeLogMeta, setActiveLogMeta] = useState<ActiveLogMeta | null>(null)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [listPage, setListPage] = useState(1)
  const [listPageCount, setListPageCount] = useState(1)
  const [listTotal, setListTotal] = useState(0)
  const [viewMode, setViewMode] = useState<ViewMode>('home')
  const [logAnalysisStep, setLogAnalysisStep] =
    useState<LogAnalysisStep>('upload')
  const controlAnalysisFileInputRef = useRef<HTMLInputElement | null>(null)
  const [controlAnalysisFiles, setControlAnalysisFiles] = useState<File[]>([])
  const [isControlAnalysisUploading, setIsControlAnalysisUploading] =
    useState(false)
  const [controlAnalysisStatusText, setControlAnalysisStatusText] = useState('')
  const [controlAnalysisReports, setControlAnalysisReports] = useState<
    ControlAnalysisReportItem[]
  >([])
  const controlAnalysisReportsRef = useRef<ControlAnalysisReportItem[]>([])
  const [controlQualityLinkedRanges, setControlQualityLinkedRanges] = useState<
    Record<string, ControlQualityLinkedRange>
  >({})
  const [selectionBox, setSelectionBox] = useState<ChartSelectionPreview | null>(
    null,
  )
  const [isGlobalChartSyncEnabled, setIsGlobalChartSyncEnabled] = useState(false)
  const [timelinePointer, setTimelinePointer] = useState<number | null>(null)
  const [isTimelinePlaying, setIsTimelinePlaying] = useState(false)

  useEffect(() => {
    isGlobalChartSyncEnabledRef.current = isGlobalChartSyncEnabled
    if (!isGlobalChartSyncEnabled) {
      chartRegistryRef.current.forEach((item, chartKey) => {
        if (isChartDisposed(item.chart)) {
          chartRegistryRef.current.delete(chartKey)
          chartCleanupRef.current.delete(chartKey)
          return
        }
        try {
          item.chart.dispatchAction({ type: 'hideTip' })
        } catch {
          chartRegistryRef.current.delete(chartKey)
          chartCleanupRef.current.delete(chartKey)
        }
      })
    }
  }, [isGlobalChartSyncEnabled])

  useEffect(() => {
    isTimelinePlayingRef.current = isTimelinePlaying
  }, [isTimelinePlaying])

  useEffect(() => {
    controlAnalysisReportsRef.current = controlAnalysisReports
  }, [controlAnalysisReports])

  const loadLogList = async (options?: {
    preferLogId?: string
    page?: number
    keyword?: string
  }) => {
    const page = options?.page ?? listPage
    const keyword = options?.keyword ?? searchKeyword

    try {
      const result = await fetchLogList({
        q: keyword,
        page,
        pageSize: PAGE_SIZE,
      })
      const items = Array.isArray(result?.items) ? result.items : []
      const pageCount =
        typeof result?.pageCount === 'number' && result.pageCount > 0
          ? result.pageCount
          : 1
      const currentPage =
        typeof result?.page === 'number' && result.page > 0 ? result.page : 1
      const total = typeof result?.total === 'number' ? result.total : items.length

      setLogList(items)
      setListPage(currentPage)
      setListPageCount(pageCount)
      setListTotal(total)

      if (items.length === 0) {
        setSelectedLogId('')
        return
      }

      if (
        options?.preferLogId &&
        items.some((item: { logId: string }) => item.logId === options.preferLogId)
      ) {
        setSelectedLogId(options.preferLogId)
        return
      }

      if (
        !selectedLogId ||
        !items.some((item: { logId: string }) => item.logId === selectedLogId)
      ) {
        setSelectedLogId(items[0].logId)
      }
    } catch {
      setLogList([])
    }
  }

  useEffect(() => {
    queueMicrotask(() => {
      void loadLogList({ page: 1, keyword: '' })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleFileSelected = (fileName: string) => {
    setSelectedFileName(fileName)
    setStatusText('\u5df2\u9009\u62e9\u6587\u4ef6\uff0c\u8bf7\u70b9\u51fb\u4e0a\u4f20\u3002')
  }

  const handleUpload = async (file: File | null) => {
    if (!file) {
      setStatusText('\u8bf7\u5148\u9009\u62e9\u65e5\u5fd7\u6587\u4ef6\u3002')
      return
    }

    if (!isUlgFile(file)) {
      setStatusText('\u529f\u80fd 1 \u9ed8\u8ba4\u4ec5\u652f\u6301\u4e0a\u4f20 .ulg \u683c\u5f0f\u7684\u65e5\u5fd7\u6587\u4ef6\u3002')
      return
    }

    try {
      setIsUploading(true)
      setStatusText('\u6b63\u5728\u4e0a\u4f20...')
      setSeriesData([])
      setTopicCharts([])
      setEvidenceTopicCharts([])
      setEvidenceChartHint('运行日志分析后展示事件证据图表。')
      setModeSegments([])
      setDiagnostics([])
      setIncidentAnalysisReport(null)
      setIncidentAnalysisError('')
      setIncidentEvidenceFocus(null)
      setChartHint('\u56fe\u8868\u7ec4\u4ef6\u5360\u4f4d\u533a')
      setActiveLogMeta(null)
      setSelectionBox(null)
      const uploadResult = await uploadLogFile(file)
      const logId =
        uploadResult && typeof uploadResult.logId === 'string'
          ? uploadResult.logId
          : ''
      if (logId) {
        setSelectedLogId(logId)
      }
      await loadLogList({ preferLogId: logId, page: 1, keyword: '' })
      setLogAnalysisStep('chart')
      if (logId) {
        await loadChartForLog(logId)
        await loadIncidentAnalysisForLog(logId)
      }
      setStatusText(
        logId
          ? `\u4e0a\u4f20\u6210\u529f\uff08logId: ${logId}\uff09\uff0c\u5e38\u89c4\u5206\u6790\u5df2\u81ea\u52a8\u52a0\u8f7d\u3002`
          : '\u4e0a\u4f20\u6210\u529f\u3002',
      )
    } catch {
      setSeriesData([])
      setTopicCharts([])
      setEvidenceTopicCharts([])
      setEvidenceChartHint('运行日志分析后展示事件证据图表。')
      setModeSegments([])
      setDiagnostics([])
      setIncidentAnalysisReport(null)
      setIncidentAnalysisError('')
      setIncidentEvidenceFocus(null)
      setActiveLogMeta(null)
      setSelectionBox(null)
      setStatusText('\u4e0a\u4f20\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u540e\u7aef\u662f\u5426\u542f\u52a8\u3002')
    } finally {
      setIsUploading(false)
    }
  }

  const cleanupChartInteractions = useCallback(() => {
    chartCleanupRef.current.forEach((cleanup) => cleanup())
    chartCleanupRef.current.clear()
    chartRegistryRef.current.clear()
    activeTimelineChartKeyRef.current = null
    timelinePointerRef.current = null
    setTimelinePointer(null)
    setIsTimelinePlaying(false)
    setSelectionBox(null)
  }, [])

  const handleBackToHome = () => {
    cleanupChartInteractions()
    setViewMode('home')
  }

  const handleBackToLogUpload = () => {
    cleanupChartInteractions()
    setLogAnalysisStep('upload')
  }

  const handleEnterLogAnalysis = () => {
    setViewMode('log-analysis')
    setLogAnalysisStep('upload')
  }

  const handleEnterBatchAnalysis = () => {
    setViewMode('batch')
  }

  const handleEnterControlAnalysis = () => {
    setViewMode('control-analysis')
    setControlAnalysisReports([])
    setControlQualityLinkedRanges({})
    setControlAnalysisStatusText('')
    setControlAnalysisFiles([])
    if (controlAnalysisFileInputRef.current) {
      controlAnalysisFileInputRef.current.value = ''
    }
  }

  const handleChooseControlAnalysisFile = () => {
    controlAnalysisFileInputRef.current?.click()
  }

  const handleControlAnalysisFileChange = (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const files = Array.from(event.target.files ?? [])
    if (files.length === 0) return
    const nextFiles = [...controlAnalysisFiles]
    const existingKeys = new Set(nextFiles.map(getFileSelectionKey))
    for (const file of files) {
      const key = getFileSelectionKey(file)
      if (!existingKeys.has(key)) {
        nextFiles.push(file)
        existingKeys.add(key)
      }
    }
    setControlAnalysisFiles(nextFiles)
    setControlAnalysisStatusText(
      `\u5df2\u9009\u62e9 ${nextFiles.length} \u4efd\u63a7\u5236\u73af\u8def\u5206\u6790\u65e5\u5fd7\uff0c\u8bf7\u70b9\u51fb\u4e0a\u4f20\u5e76\u5bf9\u6bd4\u65e5\u5fd7\u3002`,
    )
    event.target.value = ''
  }

  const handleUploadControlAnalysisLog = async () => {
    const files =
      controlAnalysisFiles.length > 0
        ? controlAnalysisFiles
        : Array.from(controlAnalysisFileInputRef.current?.files ?? [])
    if (files.length === 0) {
      setControlAnalysisStatusText(
        '\u8bf7\u5148\u9009\u62e9\u7528\u4e8e\u63a7\u5236\u73af\u8def\u5206\u6790\u7684 .ulg \u65e5\u5fd7\uff0c\u53ef\u4ee5\u4e00\u6b21\u9009\u62e9\u591a\u4efd\u3002',
      )
      return
    }

    const nextItems = files.map((file, index) => ({
      clientId: `${file.name}-${file.size}-${file.lastModified}-${index}`,
      fileName: file.name,
      logId: '',
      report: null,
      isLoading: true,
      errorText: '',
    }))
    try {
      setIsControlAnalysisUploading(true)
      setControlAnalysisStatusText(
        `\u6b63\u5728\u4e00\u6b21\u6027\u4e0a\u4f20 ${files.length} \u4efd\u65e5\u5fd7\u5e76\u8ba1\u7b97\u63a7\u5236\u73af\u6307\u6807...`,
      )
      setControlAnalysisReports(nextItems)
      setControlQualityLinkedRanges({})

      const result = await batchCalculateControlQuality(files)
      const reports = Array.isArray(result.reports) ? result.reports : []
      const failedLogs = Array.isArray(result.failedLogs) ? result.failedLogs : []

      setControlAnalysisReports([
        ...reports.map((item, index) => ({
          clientId: `${item.logId}-${index}`,
          fileName: item.fileName,
          logId: item.logId,
          report: item.report,
          isLoading: false,
          errorText: '',
        })),
        ...failedLogs.map((item, index) => ({
          clientId: `failed-${item.fileName}-${index}`,
          fileName: item.fileName,
          logId: '',
          report: null,
          isLoading: false,
          errorText: item.reason || '\u65e5\u5fd7\u4e0a\u4f20\u6216\u63a7\u5236\u73af\u5206\u6790\u5931\u8d25\u3002',
        })),
      ])

      setControlAnalysisStatusText(
        `\u63a7\u5236\u73af\u5206\u6790\u5b8c\u6210\uff1a${result.successCount} \u4efd\u6210\u529f\uff0c${result.failedCount} \u4efd\u5931\u8d25\u3002`,
      )
    } catch {
      setControlAnalysisStatusText(
        '\u65e5\u5fd7\u4e0a\u4f20\u6216\u63a7\u5236\u73af\u5206\u6790\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u540e\u7aef\u548c .ulg \u6587\u4ef6\u3002',
      )
    } finally {
      setIsControlAnalysisUploading(false)
    }
  }

  const loadControlQualityForItem = useCallback(async (
    clientId: string,
    logId: string,
    segment?: { startS: number | null; endS: number | null; source?: string },
    parameterBounds?: Record<string, ControlQualityParameterBound>,
  ): Promise<boolean> => {
    setControlAnalysisReports((currentItems) =>
      currentItems.map((item) =>
        item.clientId === clientId
          ? { ...item, logId, isLoading: true, errorText: '' }
          : item,
      ),
    )

    try {
      const report = await calculateControlQuality({
        logId,
        segment,
        parameterBounds,
      })
      setControlAnalysisReports((currentItems) =>
        currentItems.map((item) =>
          item.clientId === clientId
            ? { ...item, logId, report, isLoading: false, errorText: '' }
            : item,
        ),
      )
      return true
    } catch {
      setControlAnalysisReports((currentItems) =>
        currentItems.map((item) =>
          item.clientId === clientId
            ? {
                ...item,
                logId,
                isLoading: false,
                errorText:
                  '\u63a7\u5236\u73af\u6307\u6807\u8ba1\u7b97\u5931\u8d25\uff0c\u8bf7\u786e\u8ba4\u65e5\u5fd7\u5305\u542b PX4 \u63a7\u5236\u76f8\u5173 topic\u3002',
              }
            : item,
        ),
      )
      return false
    }
  }, [])

  const loadChartForLog = async (logId: string) => {
    if (!logId) return

    try {
      const data = await fetchChartData(logId)
      if (Array.isArray(data?.series) && data.series.length === 0) {
        setSeriesData([])
        setTopicCharts([])
        setModeSegments([])
        setChartHint(
          `\u5df2\u8c03\u7528\u56fe\u8868\u63a5\u53e3\uff08logId: ${logId}\uff09\uff1a\u5f53\u524d\u8fd4\u56de\u7a7a\u6570\u636e\uff08\u5360\u4f4d\uff09`,
        )
        setSelectionBox(null)
        return
      }
      const normalizedSeries = Array.isArray(data?.series) ? data.series : []
      const normalizedTopicCharts = Array.isArray(data?.topicCharts)
        ? data.topicCharts
        : []
      const normalizedModeSegments = Array.isArray(data?.modeSegments)
        ? data.modeSegments
        : []
      const normalizedDiagnostics = Array.isArray(data?.diagnostics)
        ? data.diagnostics
        : []
      setSeriesData(normalizedSeries)
      setTopicCharts(normalizedTopicCharts)
      setModeSegments(normalizedModeSegments)
      setDiagnostics(normalizedDiagnostics)
      setActiveLogMeta({
        logId: typeof data?.logId === 'string' ? data.logId : logId,
        fileName:
          typeof data?.fileName === 'string'
            ? data.fileName
            : '\u672a\u77e5\u6587\u4ef6',
        uploadedAt:
          typeof data?.uploadedAt === 'string'
            ? data.uploadedAt
            : '',
      })
      setChartHint(
        data?.dataSource === 'header-derived-simulated-series'
          ? '\u5df2\u52a0\u8f7d\u56fe\u8868\u6570\u636e\uff08\u5f53\u524d\u4e3a\u57fa\u4e8e ULog \u5934\u90e8\u7279\u5f81\u7684\u6f14\u793a\u65f6\u5e8f\uff09'
          : '\u5df2\u52a0\u8f7d\u56fe\u8868\u6570\u636e\uff08\u6765\u81ea PX4 \u4e3b\u9898\u89e3\u6790\uff09',
      )
    } catch {
      setSeriesData([])
      setTopicCharts([])
      setModeSegments([])
      setActiveLogMeta(null)
      setSelectionBox(null)
      setIncidentEvidenceFocus(null)
      void loadLogList({ preferLogId: '' })
      setChartHint(
        '\u56fe\u8868\u6570\u636e\u8bf7\u6c42\u5931\u8d25\uff08\u53ef\u80fd\u662f\u65e5\u5fd7\u5df2\u5931\u6548\uff0c\u8bf7\u5237\u65b0\u5217\u8868\u6216\u91cd\u65b0\u4e0a\u4f20\uff09',
      )
    }
  }

  const loadIncidentAnalysisForLog = async (logId: string) => {
    if (!logId) return

    try {
      setIsIncidentAnalysisLoading(true)
      setIncidentAnalysisError('')
      setIncidentEvidenceFocus(null)
      setEvidenceTopicCharts([])
      setEvidenceChartHint('正在生成事件证据图表...')
      const report = await runIncidentAnalysis(logId)
      setIncidentAnalysisReport(report)
      const incidentTopicCharts = mapIncidentChartGroupsToTopicCharts(report)
      if (incidentTopicCharts.length > 0) {
        setEvidenceTopicCharts(incidentTopicCharts)
        setEvidenceChartHint('已加载事件证据图表。')
      } else {
        setEvidenceChartHint('当前日志没有可展示的事件证据图表。')
      }
    } catch {
      setIncidentAnalysisReport(null)
      setIncidentEvidenceFocus(null)
      setEvidenceTopicCharts([])
      setEvidenceChartHint('事件证据图表不可用。')
      setIncidentAnalysisError(
        '\u65e5\u5fd7\u5206\u6790\u5931\u8d25\uff0c\u8bf7\u786e\u8ba4\u540e\u7aef\u5df2\u542f\u52a8\u4e14\u65e5\u5fd7\u4ecd\u5728\u5f53\u524d\u4f1a\u8bdd\u4e2d\u3002',
      )
    } finally {
      setIsIncidentAnalysisLoading(false)
    }
  }

  const handleRunIncidentAnalysis = async () => {
    await loadIncidentAnalysisForLog(selectedLogId)
  }

  const handleLogSelect = async (logId: string) => {
    cleanupChartInteractions()
    setSelectedLogId(logId)
    setSeriesData([])
    setTopicCharts([])
    setEvidenceTopicCharts([])
    setEvidenceChartHint('运行日志分析后展示事件证据图表。')
    setModeSegments([])
    setDiagnostics([])
    setIncidentAnalysisReport(null)
    setIncidentAnalysisError('')
    setIncidentEvidenceFocus(null)
    setActiveLogMeta(null)
    setSelectionBox(null)
    if (logId) {
      await loadChartForLog(logId)
      await loadIncidentAnalysisForLog(logId)
    } else {
      setChartHint('\u56fe\u8868\u7ec4\u4ef6\u5360\u4f4d\u533a')
    }
  }

  const handleApplyControlQualityRange = async (
    item: ControlAnalysisReportItem,
    startS: number | null,
    endS: number | null,
  ) => {
    if (!item.logId) return
    await loadControlQualityForItem(item.clientId, item.logId, {
      startS,
      endS,
      source: startS !== null && endS !== null ? 'manual' : 'auto',
    })
  }

  const handleControlQualityChartSelection = useCallback((
    rangeGroupKey: string | undefined,
    startValue: number,
    endValue: number,
  ) => {
    const controlSegment = buildChartSelectionControlSegment(
      rangeGroupKey,
      startValue,
      endValue,
    )
    if (!controlSegment) {
      return
    }

    setControlQualityLinkedRanges((current) => ({
      ...current,
      [controlSegment.rangeGroupKey]: {
        startS: controlSegment.segment.startS,
        endS: controlSegment.segment.endS,
      },
    }))

    const targetItem = controlAnalysisReportsRef.current.find(
      (item) => item.clientId === controlSegment.rangeGroupKey,
    )
    if (!targetItem?.logId) {
      return
    }

    void loadControlQualityForItem(
      targetItem.clientId,
      targetItem.logId,
      controlSegment.segment,
    )
  }, [loadControlQualityForItem])

  const handleSearch = async () => {
    await loadLogList({ page: 1, keyword: searchKeyword })
    setSeriesData([])
    setTopicCharts([])
    setEvidenceTopicCharts([])
    setEvidenceChartHint('运行日志分析后展示事件证据图表。')
    setDiagnostics([])
    setIncidentAnalysisReport(null)
    setIncidentAnalysisError('')
    setIncidentEvidenceFocus(null)
    setActiveLogMeta(null)
    setChartHint('\u65e5\u5fd7\u5217\u8868\u5df2\u66f4\u65b0\uff0c\u8bf7\u9009\u62e9\u65e5\u5fd7\u540e\u67e5\u770b\u56fe\u8868\u3002')
  }

  const handlePrevPage = async () => {
    if (listPage <= 1) return
    await loadLogList({ page: listPage - 1 })
  }

  const handleNextPage = async () => {
    if (listPage >= listPageCount) return
    await loadLogList({ page: listPage + 1 })
  }

  const getUsableChartEntries = useCallback(() => {
    const entries: Array<[string, ChartRegistryItem]> = []
    chartRegistryRef.current.forEach((item, chartKey) => {
      if (
        !item ||
        isChartDisposed(item.chart) ||
        item.timeRange.end <= item.timeRange.start
      ) {
        chartRegistryRef.current.delete(chartKey)
        chartCleanupRef.current.delete(chartKey)
        return
      }

      entries.push([chartKey, item])
    })
    return entries
  }, [])

  const getTimelineBounds = useCallback(() => {
    let start = Infinity
    let end = -Infinity

    getUsableChartEntries().forEach(([, item]) => {
      start = Math.min(start, item.timeRange.start)
      end = Math.max(end, item.timeRange.end)
    })

    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return null
    }

    return { start, end }
  }, [getUsableChartEntries])

  const getTimelineAnchorEntry = useCallback(() => {
    const entries = getUsableChartEntries()
    const activeChartKey = activeTimelineChartKeyRef.current
    if (activeChartKey) {
      const activeEntry = entries.find(([chartKey]) => chartKey === activeChartKey)
      if (activeEntry) {
        return activeEntry
      }
    }

    return entries[0] ?? null
  }, [getUsableChartEntries])

  const getTimelineVisibleSpan = useCallback(() => {
    const anchorEntry = getTimelineAnchorEntry()
    if (!anchorEntry) {
      return null
    }

    const [, item] = anchorEntry
    const fullSpan = item.timeRange.end - item.timeRange.start
    const zoomState = item.chart.getOption()?.dataZoom?.[0]
    const startPercent = Number(zoomState?.start ?? 0)
    const endPercent = Number(zoomState?.end ?? 100)
    const startTime = percentToTimeValue(startPercent, item.timeRange)
    const endTime = percentToTimeValue(endPercent, item.timeRange)
    const visibleSpan = Math.abs(endTime - startTime)

    return visibleSpan > 0 ? visibleSpan : fullSpan
  }, [getTimelineAnchorEntry])

  const getTimelineKeyboardStep = useCallback((isCoarseStep: boolean) => {
    const visibleSpan = getTimelineVisibleSpan()
    const baseStep =
      visibleSpan && visibleSpan > 0
        ? visibleSpan / 200
        : TIMELINE_FINE_STEP_MIN_S
    const fineStep = Math.min(
      Math.max(baseStep, TIMELINE_FINE_STEP_MIN_S),
      TIMELINE_FINE_STEP_MAX_S,
    )

    return isCoarseStep ? fineStep * 10 : fineStep
  }, [getTimelineVisibleSpan])

  const showTimelineCursor = useCallback((timeValue: number) => {
    getUsableChartEntries().forEach(([chartKey, item]) => {
      try {
        const chartTime = clampTimeValue(timeValue, item.timeRange)
        const pixelValue = item.chart.convertToPixel(
          { xAxisIndex: 0 },
          chartTime,
        )
        const x = Array.isArray(pixelValue) ? pixelValue[0] : pixelValue
        if (typeof x !== 'number' || !Number.isFinite(x)) {
          return
        }

        item.chart.dispatchAction({
          type: 'showTip',
          x,
          y: Math.max(1, item.chart.getHeight() / 2),
        })
      } catch {
        chartRegistryRef.current.delete(chartKey)
        chartCleanupRef.current.delete(chartKey)
      }
    })
  }, [getUsableChartEntries])

  const hideTimelineCursor = useCallback(() => {
    getUsableChartEntries().forEach(([chartKey, item]) => {
      try {
        item.chart.dispatchAction({ type: 'hideTip' })
      } catch {
        chartRegistryRef.current.delete(chartKey)
        chartCleanupRef.current.delete(chartKey)
      }
    })
  }, [getUsableChartEntries])

  const setTimelineTime = useCallback((
    timeValue: number,
    options?: { pauseAtEnd?: boolean },
  ) => {
    const bounds = getTimelineBounds()
    if (!bounds) {
      timelinePointerRef.current = null
      setTimelinePointer(null)
      setIsTimelinePlaying(false)
      hideTimelineCursor()
      return null
    }

    const nextTime = clampTimeValue(timeValue, bounds)
    timelinePointerRef.current = nextTime
    setTimelinePointer(nextTime)
    showTimelineCursor(nextTime)

    if (options?.pauseAtEnd && nextTime >= bounds.end) {
      setIsTimelinePlaying(false)
    }

    return nextTime
  }, [getTimelineBounds, hideTimelineCursor, showTimelineCursor])

  const findMatchingChartTopic = useCallback((chartTopic: string, chartGroupId?: string) => {
    if (chartGroupId) {
      const groupMatch = evidenceTopicCharts.find((item) => item.topic === chartGroupId)
      if (groupMatch) return groupMatch.topic
    }

    if (!chartTopic) return ''

    const exactMatch = evidenceTopicCharts.find((item) => item.topic === chartTopic)
    if (exactMatch) return exactMatch.topic

    const prefixedMatch = evidenceTopicCharts.find(
      (item) =>
        item.topic.startsWith(`${chartTopic}_`) ||
        chartTopic.startsWith(`${item.topic}_`),
    )

    return prefixedMatch?.topic ?? chartTopic
  }, [evidenceTopicCharts])

  const zoomChartsToTimeWindow = useCallback((startS: number, endS: number) => {
    const safeStartS = Math.min(startS, endS)
    const safeEndS = Math.max(startS, endS)

    chartRegistryRef.current.forEach((item, chartKey) => {
      if (isChartDisposed(item.chart)) {
        chartRegistryRef.current.delete(chartKey)
        chartCleanupRef.current.delete(chartKey)
        return
      }

      const start = timeValueToPercent(safeStartS, item.timeRange)
      const end = timeValueToPercent(safeEndS, item.timeRange)

      try {
        item.chart.dispatchAction({
          type: 'dataZoom',
          dataZoomIndex: 0,
          start,
          end,
        })
      } catch {
        chartRegistryRef.current.delete(chartKey)
        chartCleanupRef.current.delete(chartKey)
      }
    })
  }, [])

  const scrollIncidentEvidenceIntoView = useCallback((
    focus: IncidentEvidenceFocus,
  ) => {
    const targetEntry = Array.from(chartRegistryRef.current.entries()).find(
      ([chartKey]) => chartKey.startsWith(`${focus.chartTopic}__`),
    )
    const registryElement = targetEntry?.[1]?.chart.getDom()?.closest('.chart-wrap')
    const targetElement =
      registryElement instanceof HTMLElement
        ? registryElement
        : findChartWrapElementByTopic(focus.chartTopic)

    targetElement?.scrollIntoView({ behavior: 'auto', block: 'start' })
  }, [])

  const applyIncidentEvidenceFocus = useCallback((
    focus: IncidentEvidenceFocus,
  ) => {
    zoomChartsToTimeWindow(focus.startS, focus.endS)
    setTimelineTime(focus.targetTimeS)
    scrollIncidentEvidenceIntoView(focus)
  }, [scrollIncidentEvidenceIntoView, setTimelineTime, zoomChartsToTimeWindow])

  const focusIncidentTimelineEvent = useCallback((event: IncidentTimelineEvent) => {
    const link = event.evidenceLinks?.[0]
    if (!link) {
      setIncidentEvidenceFocus(null)
      return
    }

    const startS = link.timeWindow?.startS ?? Math.max(0, event.timeS - 3)
    const endS = link.timeWindow?.endS ?? event.timeS + 5
    const chartTopic = findMatchingChartTopic(
      link.chartTopic || link.source.topic,
      link.chartGroupId,
    )
    const seriesName = link.seriesId || link.standardSignal || link.source.field
    const targetTimeS = link.targetTimeS ?? event.timeS
    const nextFocus = {
      eventId: event.id,
      chartTopic,
      seriesName,
      label: `${event.code} / ${link.standardSignal}`,
      startS,
      endS,
      targetTimeS,
    }

    setIsTimelinePlaying(false)
    setIncidentEvidenceFocus(nextFocus)
    window.setTimeout(() => scrollIncidentEvidenceIntoView(nextFocus), 0)
  }, [findMatchingChartTopic, scrollIncidentEvidenceIntoView])

  useEffect(() => {
    if (!incidentEvidenceFocus) {
      return undefined
    }

    const timerIds = [0, 40, 100, 180, 300, 500, 760].map((delay) =>
      window.setTimeout(() => {
        applyIncidentEvidenceFocus(incidentEvidenceFocus)
      }, delay),
    )

    return () => {
      timerIds.forEach((timerId) => window.clearTimeout(timerId))
    }
  }, [applyIncidentEvidenceFocus, incidentEvidenceFocus])

  const moveTimelinePointer = useCallback((
    direction: -1 | 1,
    isCoarseStep = false,
  ) => {
    const bounds = getTimelineBounds()
    if (!bounds) {
      return
    }

    const currentTime = timelinePointerRef.current ?? bounds.start
    const step = getTimelineKeyboardStep(isCoarseStep)
    setTimelineTime(currentTime + direction * step)
  }, [getTimelineBounds, getTimelineKeyboardStep, setTimelineTime])

  const toggleTimelinePlayback = useCallback(() => {
    const bounds = getTimelineBounds()
    if (!bounds) {
      return
    }

    if (
      timelinePointerRef.current === null ||
      timelinePointerRef.current >= bounds.end
    ) {
      setTimelineTime(bounds.start)
    }

    setIsTimelinePlaying((current) => !current)
  }, [getTimelineBounds, setTimelineTime])

  const syncChartZoom = useCallback((
    sourceChartKey: string,
    sourceStartPercent: number,
    sourceEndPercent: number,
  ) => {
    if (!isGlobalChartSyncEnabledRef.current) {
      return
    }

    const source = chartRegistryRef.current.get(sourceChartKey)
    if (!source || isSyncingZoomRef.current || isChartDisposed(source.chart)) {
      chartRegistryRef.current.delete(sourceChartKey)
      return
    }

    const sourceStartTime = percentToTimeValue(
      sourceStartPercent,
      source.timeRange,
    )
    const sourceEndTime = percentToTimeValue(sourceEndPercent, source.timeRange)
    const nextLinkedRanges: Record<string, ControlQualityLinkedRange> = {}

    if (source.rangeGroupKey) {
      nextLinkedRanges[source.rangeGroupKey] = {
        startS: Math.min(sourceStartTime, sourceEndTime),
        endS: Math.max(sourceStartTime, sourceEndTime),
      }
    }

    isSyncingZoomRef.current = true
    chartRegistryRef.current.forEach((target, targetChartKey) => {
      if (targetChartKey === sourceChartKey) return
      if (isChartDisposed(target.chart)) {
        chartRegistryRef.current.delete(targetChartKey)
        chartCleanupRef.current.delete(targetChartKey)
        return
      }

      const targetStart = timeValueToPercent(sourceStartTime, target.timeRange)
      const targetEnd = timeValueToPercent(sourceEndTime, target.timeRange)
      if (target.rangeGroupKey) {
        const targetStartTime = percentToTimeValue(targetStart, target.timeRange)
        const targetEndTime = percentToTimeValue(targetEnd, target.timeRange)
        nextLinkedRanges[target.rangeGroupKey] = {
          startS: Math.min(targetStartTime, targetEndTime),
          endS: Math.max(targetStartTime, targetEndTime),
        }
      }

      try {
        target.chart.dispatchAction({
          type: 'dataZoom',
          dataZoomIndex: 0,
          start: targetStart,
          end: targetEnd,
        })
      } catch {
        chartRegistryRef.current.delete(targetChartKey)
        chartCleanupRef.current.delete(targetChartKey)
      }
    })
    window.setTimeout(() => {
      isSyncingZoomRef.current = false
    }, 0)

    if (Object.keys(nextLinkedRanges).length > 0) {
      setControlQualityLinkedRanges((current) => ({
        ...current,
        ...nextLinkedRanges,
      }))
    }
  }, [])

  const syncChartCursor = useCallback((sourceChartKey: string, timeValue: number) => {
    if (!isGlobalChartSyncEnabledRef.current) {
      return
    }

    chartRegistryRef.current.forEach((target, targetChartKey) => {
      if (targetChartKey === sourceChartKey) return
      if (isChartDisposed(target.chart)) {
        chartRegistryRef.current.delete(targetChartKey)
        chartCleanupRef.current.delete(targetChartKey)
        return
      }

      try {
        const pixelValue = target.chart.convertToPixel({ xAxisIndex: 0 }, timeValue)
        const x = Array.isArray(pixelValue) ? pixelValue[0] : pixelValue
        if (typeof x !== 'number' || !Number.isFinite(x)) {
          return
        }

        target.chart.dispatchAction({
          type: 'showTip',
          x,
          y: Math.max(1, target.chart.getHeight() / 2),
        })
      } catch {
        chartRegistryRef.current.delete(targetChartKey)
        chartCleanupRef.current.delete(targetChartKey)
      }
    })
  }, [])

  const clearSyncedChartCursor = useCallback((sourceChartKey?: string) => {
    if (!isGlobalChartSyncEnabledRef.current) {
      return
    }

    chartRegistryRef.current.forEach((target, targetChartKey) => {
      if (targetChartKey === sourceChartKey) return
      if (isChartDisposed(target.chart)) {
        chartRegistryRef.current.delete(targetChartKey)
        chartCleanupRef.current.delete(targetChartKey)
        return
      }
      try {
        target.chart.dispatchAction({ type: 'hideTip' })
      } catch {
        chartRegistryRef.current.delete(targetChartKey)
        chartCleanupRef.current.delete(targetChartKey)
      }
    })
  }, [])

  useEffect(() => {
    if (!isTimelinePlaying) {
      return undefined
    }

    let animationFrameId = 0
    let lastFrameAt = performance.now()

    const tick = (frameAt: number) => {
      const bounds = getTimelineBounds()
      if (!bounds) {
        setIsTimelinePlaying(false)
        return
      }

      const elapsedS = Math.max(0, (frameAt - lastFrameAt) / 1000)
      lastFrameAt = frameAt
      const currentTime = timelinePointerRef.current ?? bounds.start
      const nextTime = currentTime + elapsedS * TIMELINE_PLAYBACK_SPEED

      setTimelineTime(nextTime, { pauseAtEnd: true })
      if (nextTime < bounds.end && isTimelinePlayingRef.current) {
        animationFrameId = window.requestAnimationFrame(tick)
      }
    }

    animationFrameId = window.requestAnimationFrame(tick)
    return () => {
      window.cancelAnimationFrame(animationFrameId)
    }
  }, [getTimelineBounds, isTimelinePlaying, setTimelineTime])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        isEditableKeyboardTarget(event.target) ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      ) {
        return
      }

      if (event.code === 'Space') {
        event.preventDefault()
        toggleTimelinePlayback()
        return
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        setIsTimelinePlaying(false)
        moveTimelinePointer(-1, event.shiftKey)
        return
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault()
        setIsTimelinePlaying(false)
        moveTimelinePointer(1, event.shiftKey)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [moveTimelinePointer, toggleTimelinePlayback])

  const clearSelectionPreview = useCallback((chartKey?: string) => {
    setSelectionBox((current) => {
      if (!current) {
        return null
      }

      if (!chartKey || current.chartId === chartKey) {
        return null
      }

      return current
    })
  }, [])

  const bindChartInteractions = useCallback((
    chartKey: string,
    chartInstance: unknown,
    timeRange: ChartTimeRange,
    rangeGroupKey?: string,
  ) => {
    const chart = chartInstance as ChartInstance
    if (!chart || isChartDisposed(chart)) {
      return
    }
    const oldCleanup = chartCleanupRef.current.get(chartKey)
    if (oldCleanup) oldCleanup()
    chartRegistryRef.current.set(chartKey, { chart, timeRange, rangeGroupKey })
    if (timelinePointerRef.current !== null) {
      showTimelineCursor(timelinePointerRef.current)
    }

    const dom = chart.getDom()
    let isMiddleDragging = false
    let isLeftPointerDown = false
    let isLeftDragging = false
    let hasPendingClickSelection = false
    let lastClientX = 0
    let lastMiddleDownAt = 0
    let pointerDownX = 0
    let pointerDownY = 0
    let selectStartX = 0
    let selectStartY = 0

    const applyDataZoom = (start: number, end: number) => {
      if (isChartDisposed(chart)) {
        return
      }

      try {
        chart.dispatchAction({
          type: 'dataZoom',
          dataZoomIndex: 0,
          start,
          end,
        })
      } catch {
        chartRegistryRef.current.delete(chartKey)
        chartCleanupRef.current.delete(chartKey)
      }
    }

    const applyDataZoomByValue = (startValue: number, endValue: number) => {
      if (isChartDisposed(chart)) {
        return false
      }

      try {
        chart.dispatchAction({
          type: 'dataZoom',
          dataZoomIndex: 0,
          startValue,
          endValue,
        })
        return true
      } catch {
        chartRegistryRef.current.delete(chartKey)
        chartCleanupRef.current.delete(chartKey)
        return false
      }
    }

    const getClampedChartPoint = (clientX: number, clientY: number) => {
      const rect = dom.getBoundingClientRect()
      return {
        x: Math.min(Math.max(clientX - rect.left, 0), rect.width),
        y: Math.min(Math.max(clientY - rect.top, 0), rect.height),
      }
    }

    const clearLeftSelectionState = (
      options: { clearPreview?: boolean } = {},
    ) => {
      isLeftPointerDown = false
      isLeftDragging = false
      hasPendingClickSelection = false
      if (options.clearPreview !== false) {
        clearSelectionPreview(chartKey)
      }
    }

    const setSelectionBoxFromNormalized = (
      normalizedBox: ReturnType<typeof normalizeSelectionBox>,
    ) => {
      const visibleBox = ensureVisibleSelectionBox(
        normalizedBox,
        CHART_SELECTION_MIN_VISUAL_PX,
      )
      if (!visibleBox) {
        clearSelectionPreview(chartKey)
        return false
      }

      setSelectionBox({
        chartId: chartKey,
        left: visibleBox.left,
        top: visibleBox.top,
        width: visibleBox.width,
        height: visibleBox.height,
      })
      return true
    }

    const resetZoom = () => {
      clearLeftSelectionState()
      applyDataZoom(0, 100)
      if (isChartDisposed(chart)) {
        return
      }
      try {
        chart.dispatchAction({ type: 'restore' })
      } catch {
        chartRegistryRef.current.delete(chartKey)
        chartCleanupRef.current.delete(chartKey)
      }
    }

    const updateSelectionPreview = (clientX: number, clientY: number) => {
      const currentPoint = getClampedChartPoint(clientX, clientY)
      const normalizedBox = normalizeSelectionBox(
        { x: selectStartX, y: selectStartY },
        currentPoint,
      )

      if (
        !shouldShowSelectionPreview(
          normalizedBox,
          CHART_SELECTION_MIN_PREVIEW_PX,
        )
      ) {
        clearSelectionPreview(chartKey)
        return
      }

      setSelectionBoxFromNormalized(normalizedBox)
    }

    const finishLeftSelection = (clientX: number, clientY: number) => {
      if (
        !hasPendingClickSelection &&
        !isLeftPointerDown &&
        !isLeftDragging
      ) {
        return
      }

      const endPoint = getClampedChartPoint(clientX, clientY)
      const normalizedBox = normalizeSelectionBox(
        { x: selectStartX, y: selectStartY },
        endPoint,
      )
      clearLeftSelectionState({ clearPreview: false })

      if (
        normalizedBox === null ||
        !isValidTimeSelectionBox(
          normalizedBox,
          CHART_SELECTION_MIN_WIDTH_PX,
        )
      ) {
        clearSelectionPreview(chartKey)
        return
      }

      try {
        const startTime = normalizePixelTimeValue(
          chart.convertFromPixel({ xAxisIndex: 0 }, normalizedBox.left),
        )
        const endTime = normalizePixelTimeValue(
          chart.convertFromPixel(
            { xAxisIndex: 0 },
            normalizedBox.left + normalizedBox.width,
          ),
        )
        if (startTime === null || endTime === null) {
          clearSelectionPreview(chartKey)
          return
        }

        const startValue = Math.min(startTime, endTime)
        const endValue = Math.max(startTime, endTime)

        if (endValue - startValue >= 0.001) {
          const applied = applyDataZoomByValue(startValue, endValue)
          if (applied) {
            handleControlQualityChartSelection(
              rangeGroupKey,
              startValue,
              endValue,
            )
            clearSelectionPreview(chartKey)
            return
          }
        }
        clearSelectionPreview(chartKey)
      } catch {
        chartRegistryRef.current.delete(chartKey)
        chartCleanupRef.current.delete(chartKey)
        clearSelectionPreview(chartKey)
      }
    }

    const onMouseDown = (event: MouseEvent) => {
      activeTimelineChartKeyRef.current = chartKey
      if (event.button === 0) {
        if (hasPendingClickSelection && !isLeftPointerDown) {
          finishLeftSelection(event.clientX, event.clientY)
          return
        }

        const startPoint = getClampedChartPoint(event.clientX, event.clientY)
        selectStartX = startPoint.x
        selectStartY = startPoint.y
        pointerDownX = startPoint.x
        pointerDownY = startPoint.y
        isLeftPointerDown = true
        isLeftDragging = false
        hasPendingClickSelection = true
        clearSelectionPreview(chartKey)
        return
      }

      if (event.button !== 1) return
      event.preventDefault()
      clearLeftSelectionState()

      const now = Date.now()
      if (now - lastMiddleDownAt < 320) {
        resetZoom()
      }
      lastMiddleDownAt = now

      isMiddleDragging = true
      lastClientX = event.clientX
    }

    const onMouseMove = (event: MouseEvent) => {
      activeTimelineChartKeyRef.current = chartKey
      if (hasPendingClickSelection || isLeftPointerDown) {
        if (isLeftPointerDown) {
          const currentPoint = getClampedChartPoint(event.clientX, event.clientY)
          const dragDistance = Math.max(
            Math.abs(currentPoint.x - pointerDownX),
            Math.abs(currentPoint.y - pointerDownY),
          )
          if (dragDistance >= CHART_SELECTION_MIN_WIDTH_PX) {
            isLeftDragging = true
          }
          if (isLeftDragging) {
            event.preventDefault()
          }
        }
        updateSelectionPreview(event.clientX, event.clientY)
      }

      if (isGlobalChartSyncEnabledRef.current) {
        const rect = dom.getBoundingClientRect()
        if (rect.width > 0) {
          const x = Math.min(Math.max(event.clientX - rect.left, 0), rect.width)
          try {
            const timeValue = normalizePixelTimeValue(
              chart.convertFromPixel({ xAxisIndex: 0 }, x),
            )
            if (timeValue !== null) {
              syncChartCursor(chartKey, timeValue)
            }
          } catch {
            chartRegistryRef.current.delete(chartKey)
            chartCleanupRef.current.delete(chartKey)
          }
        }
      }

      if (!isMiddleDragging) return
      const rect = dom.getBoundingClientRect()
      if (rect.width <= 0) return

      if (isChartDisposed(chart)) {
        isMiddleDragging = false
        return
      }

      const deltaX = event.clientX - lastClientX
      lastClientX = event.clientX

      const zoomState = chart.getOption()?.dataZoom?.[0]
      const currentStart = Number(zoomState?.start ?? 0)
      const currentEnd = Number(zoomState?.end ?? 100)
      const windowSize = Math.max(1, currentEnd - currentStart)
      const offsetPercent = (deltaX / rect.width) * 100

      let nextStart = currentStart - offsetPercent
      let nextEnd = currentEnd - offsetPercent

      if (nextStart < 0) {
        nextStart = 0
        nextEnd = windowSize
      }
      if (nextEnd > 100) {
        nextEnd = 100
        nextStart = 100 - windowSize
      }

      applyDataZoom(nextStart, nextEnd)
    }

    const onMouseUp = (event: MouseEvent) => {
      if (event.button === 0) {
        if (isLeftPointerDown && isLeftDragging) {
          finishLeftSelection(event.clientX, event.clientY)
        } else if (isLeftPointerDown) {
          isLeftPointerDown = false
          isLeftDragging = false
        }
        return
      }

      if (event.button !== 1) return
      isMiddleDragging = false
    }

    const onMouseLeave = () => {
      if (hasPendingClickSelection && !isLeftPointerDown) {
        clearLeftSelectionState()
      } else if (isLeftPointerDown) {
        clearSelectionPreview(chartKey)
      }
      clearSyncedChartCursor(chartKey)
      isMiddleDragging = false
    }

    const onAuxClick = (event: MouseEvent) => {
      if (event.button === 1) {
        event.preventDefault()
      }
    }

    const onWindowMouseUp = (event: MouseEvent) => {
      if (event.button === 0) {
        if (isLeftPointerDown && isLeftDragging) {
          finishLeftSelection(event.clientX, event.clientY)
        } else if (isLeftPointerDown) {
          isLeftPointerDown = false
          isLeftDragging = false
          if (
            event.target instanceof Node &&
            !dom.contains(event.target)
          ) {
            clearLeftSelectionState()
          }
        }
      } else if (event.button === 1) {
        isMiddleDragging = false
      }
    }

    const onDataZoom = () => {
      if (isSyncingZoomRef.current || isChartDisposed(chart)) return
      activeTimelineChartKeyRef.current = chartKey
      const zoomState = chart.getOption()?.dataZoom?.[0]
      const start = Number(zoomState?.start ?? 0)
      const end = Number(zoomState?.end ?? 100)
      if (rangeGroupKey) {
        const startTime = percentToTimeValue(start, timeRange)
        const endTime = percentToTimeValue(end, timeRange)
        setControlQualityLinkedRanges((current) => ({
          ...current,
          [rangeGroupKey]: {
            startS: Math.min(startTime, endTime),
            endS: Math.max(startTime, endTime),
          },
        }))
      }
      syncChartZoom(chartKey, start, end)
    }

    const chartMouseEventOptions = { capture: true }
    dom.addEventListener('mousedown', onMouseDown, chartMouseEventOptions)
    dom.addEventListener('mousemove', onMouseMove, chartMouseEventOptions)
    dom.addEventListener('mouseup', onMouseUp, chartMouseEventOptions)
    dom.addEventListener('mouseleave', onMouseLeave, chartMouseEventOptions)
    dom.addEventListener('auxclick', onAuxClick, chartMouseEventOptions)
    window.addEventListener('mouseup', onWindowMouseUp)
    chart.on('datazoom', onDataZoom)

    const cleanup = () => {
      dom.removeEventListener('mousedown', onMouseDown, chartMouseEventOptions)
      dom.removeEventListener('mousemove', onMouseMove, chartMouseEventOptions)
      dom.removeEventListener('mouseup', onMouseUp, chartMouseEventOptions)
      dom.removeEventListener('mouseleave', onMouseLeave, chartMouseEventOptions)
      dom.removeEventListener('auxclick', onAuxClick, chartMouseEventOptions)
      window.removeEventListener('mouseup', onWindowMouseUp)
      if (!isChartDisposed(chart)) {
        try {
          chart.off('datazoom', onDataZoom)
        } catch {
          // ignore disposed instances during cleanup
        }
      }
      chartRegistryRef.current.delete(chartKey)
      clearSelectionPreview(chartKey)
    }

    chartCleanupRef.current.set(chartKey, cleanup)
  }, [
    clearSelectionPreview,
    clearSyncedChartCursor,
    handleControlQualityChartSelection,
    showTimelineCursor,
    syncChartCursor,
    syncChartZoom,
  ])

  const handleChartDispose = useCallback((chartKey: string) => {
    const cleanup = chartCleanupRef.current.get(chartKey)
    if (cleanup) {
      cleanup()
    }
    chartCleanupRef.current.delete(chartKey)
    chartRegistryRef.current.delete(chartKey)
    if (activeTimelineChartKeyRef.current === chartKey) {
      activeTimelineChartKeyRef.current = null
    }
  }, [])

  useEffect(() => {
    return cleanupChartInteractions
  }, [cleanupChartInteractions])

  const controlAnalysisHasReports = controlAnalysisReports.length > 0
  const controlAnalysisStatusLabel = isControlAnalysisUploading
    ? '分析中'
    : controlAnalysisHasReports
      ? controlAnalysisReports.some((item) => item.errorText)
        ? '部分完成'
        : '分析完成'
      : controlAnalysisFiles.length > 0
        ? `已选择 ${controlAnalysisFiles.length} 份`
        : '等待日志'

  return (
    <div className="app">
      <header className="header">
        <h1>{'\u98de\u884c\u65e5\u5fd7\u5206\u6790\u5e73\u53f0'}</h1>
        <p>
          {'\u9009\u62e9\u529f\u80fd\u540e\u8fdb\u5165\u5bf9\u5e94\u6a21\u5757\uff1a\u5355\u65e5\u5fd7\u4e0a\u4f20\u5206\u6790\u3001\u6279\u91cf\u7b5b\u9009\u65e5\u5fd7\u3001\u63a7\u5236\u73af\u8def\u5206\u6790\u3002'}
        </p>
      </header>

      <main className="page">
        {viewMode === 'home' ? (
          <section className="feature-hub">
            <h2>{'\u529f\u80fd\u9009\u62e9'}</h2>
            <div className="feature-grid">
              <button
                type="button"
                className="feature-card"
                onClick={handleEnterLogAnalysis}
              >
                <h3>{'\u529f\u80fd 1\uff1a\u5e38\u89c4\u65e5\u5fd7\u5206\u6790'}</h3>
                <p>
                  {'\u4e0a\u4f20\u5355\u4efd .ulg \u65e5\u5fd7\uff0c\u67e5\u770b\u65e5\u5fd7\u6982\u89c8\u3001\u98de\u884c\u4e8b\u4ef6\u548c\u8bc1\u636e\u56fe\u8868\u3002'}
                </p>
              </button>
              <button
                type="button"
                className="feature-card"
                onClick={handleEnterBatchAnalysis}
              >
                <h3>{'\u529f\u80fd 2\uff1a\u6279\u91cf\u4e0a\u4f20\u7b5b\u9009\u65e5\u5fd7'}</h3>
                <p>
                  {'\u6279\u91cf\u4e0a\u4f20\u591a\u4efd\u65e5\u5fd7\uff0c\u7b5b\u9009\u89e3\u9501\u98de\u884c\u5e76\u6309\u65f6\u95f4\u6392\u5e8f\u3002'}
                </p>
              </button>
              <button
                type="button"
                className="feature-card"
                onClick={handleEnterControlAnalysis}
              >
                <h3>{'\u529f\u80fd 3\uff1a\u63a7\u5236\u73af\u8def\u5206\u6790'}</h3>
                <p>
                  {'\u6309\u6267\u884c\u5668\u3001\u89d2\u901f\u5ea6\u3001\u59ff\u6001\u3001\u901f\u5ea6\u3001\u4f4d\u7f6e\u73af\u987a\u5e8f\u5206\u6790\u63a7\u5236\u8ddf\u968f\u8d28\u91cf\u3002'}
                </p>
              </button>
            </div>
          </section>
        ) : null}

        {viewMode === 'log-analysis' && logAnalysisStep === 'upload' ? (
          <>
            <div className="page-title-row">
              <span />
              <button
                type="button"
                className="button"
                onClick={handleBackToHome}
              >
                {'\u8fd4\u56de\u529f\u80fd\u5217\u8868'}
              </button>
            </div>
            <UploadPanel
              selectedFileName={selectedFileName}
              isUploading={isUploading}
              statusText={statusText}
              onFileSelected={handleFileSelected}
              onUpload={handleUpload}
            />
          </>
        ) : null}

        {viewMode === 'log-analysis' && logAnalysisStep === 'chart' ? (
          <section className={`card ${selectedLogId ? '' : 'card-disabled'}`}>
            <div className="page-title-row">
              <h2>{'\u529f\u80fd 1\uff1a\u5e38\u89c4\u65e5\u5fd7\u5206\u6790'}</h2>
              <div className="actions">
                <button
                  type="button"
                  className={`button chart-sync-button${
                    isGlobalChartSyncEnabled ? ' chart-sync-button-active' : ''
                  }`}
                  onClick={() =>
                    setIsGlobalChartSyncEnabled((current) => !current)
                  }
                  aria-pressed={isGlobalChartSyncEnabled}
                >
                  {isGlobalChartSyncEnabled
                    ? '\u5168\u5c40\u56fe\u8868\u8054\u52a8\uff1a\u5df2\u5f00\u542f'
                    : '\u5f00\u542f\u5168\u5c40\u56fe\u8868\u8054\u52a8'}
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={handleBackToLogUpload}
                >
                  {'\u8fd4\u56de\u4e0a\u4f20\u65e5\u5fd7'}
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={handleBackToHome}
                >
                  {'\u8fd4\u56de\u529f\u80fd\u5217\u8868'}
                </button>
              </div>
            </div>
            <LogSelector
              selectedLogId={selectedLogId}
              searchKeyword={searchKeyword}
              logList={logList}
              listPage={listPage}
              listPageCount={listPageCount}
              listTotal={listTotal}
              onSearchKeywordChange={setSearchKeyword}
              onSearch={handleSearch}
              onLogSelect={handleLogSelect}
              onRefreshLogList={() => loadLogList({ preferLogId: selectedLogId })}
              onPrevPage={handlePrevPage}
              onNextPage={handleNextPage}
            />
            <IncidentAnalysisPanel
              selectedLogId={selectedLogId}
              report={incidentAnalysisReport}
              isLoading={isIncidentAnalysisLoading}
              errorText={incidentAnalysisError}
              onRun={handleRunIncidentAnalysis}
              modeSegments={modeSegments}
              selectionBox={selectionBox}
              onChartReady={bindChartInteractions}
              onChartDispose={handleChartDispose}
              onEventFocus={focusIncidentTimelineEvent}
            />
            <section className="incident-section evidence-chart-section">
              <h3>证据图表</h3>
              <ChartPanel
                activeLogMeta={activeLogMeta}
                topicCharts={evidenceTopicCharts}
                seriesData={[]}
                modeSegments={modeSegments}
                diagnostics={[]}
                selectionBox={selectionBox}
                timelinePointer={timelinePointer}
                isTimelinePlaying={isTimelinePlaying}
                activeChartTopic={incidentEvidenceFocus?.chartTopic}
                activeSeriesName={incidentEvidenceFocus?.seriesName}
                activeChartBadgeLabel={
                  incidentEvidenceFocus
                    ? `${incidentEvidenceFocus.label} @ ${incidentEvidenceFocus.targetTimeS.toFixed(2)}s`
                    : undefined
                }
                chartHint={evidenceChartHint}
                showDefaultSeriesFallback={false}
                onChartReady={bindChartInteractions}
                onChartDispose={handleChartDispose}
                onTimelineSeek={(timeValue) => {
                  setIsTimelinePlaying(false)
                  setTimelineTime(timeValue)
                }}
                onToggleTimelinePlayback={toggleTimelinePlayback}
              />
            </section>
            <AdvancedRawDataPanel>
              <ChartPanel
                activeLogMeta={activeLogMeta}
                topicCharts={topicCharts}
                seriesData={seriesData}
                modeSegments={modeSegments}
                diagnostics={diagnostics}
                selectionBox={selectionBox}
                timelinePointer={timelinePointer}
                isTimelinePlaying={isTimelinePlaying}
                chartHint={chartHint}
                showDefaultSeriesFallback
                onChartReady={bindChartInteractions}
                onChartDispose={handleChartDispose}
                onTimelineSeek={(timeValue) => {
                  setIsTimelinePlaying(false)
                  setTimelineTime(timeValue)
                }}
                onToggleTimelinePlayback={toggleTimelinePlayback}
              />
            </AdvancedRawDataPanel>
          </section>
        ) : null}

        {viewMode === 'batch' ? (
          <>
            <div className="page-title-row">
              <span />
              <button
                type="button"
                className="button"
                onClick={handleBackToHome}
              >
                {'\u8fd4\u56de\u529f\u80fd\u5217\u8868'}
              </button>
            </div>
            <BatchLogUpload />
          </>
        ) : null}

        {viewMode === 'control-analysis' ? (
          <section className="card">
            <div className="page-title-row">
              <div>
                <h2>{'\u529f\u80fd 3\uff1a\u63a7\u5236\u73af\u8def\u5206\u6790'}</h2>
                <p className="hint">
                  {'\u4ece\u5185\u73af\u5230\u5916\u73af\u5c55\u793a\u63a7\u5236\u8ddf\u968f\u66f2\u7ebf\u4e0e\u6307\u6807\uff1b\u652f\u6301\u591a\u65e5\u5fd7\u6309\u5217\u5bf9\u6bd4\u3002'}
                </p>
              </div>
              <div className="actions control-quality-page-actions">
                <button
                  type="button"
                  className={`button chart-sync-button${
                    isGlobalChartSyncEnabled ? ' chart-sync-button-active' : ''
                  }`}
                  onClick={() =>
                    setIsGlobalChartSyncEnabled((current) => !current)
                  }
                  aria-pressed={isGlobalChartSyncEnabled}
                >
                  {isGlobalChartSyncEnabled
                    ? '\u5168\u5c40\u56fe\u8868\u8054\u52a8\uff1a\u5df2\u5f00\u542f'
                    : '\u5f00\u542f\u5168\u5c40\u56fe\u8868\u8054\u52a8'}
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={handleBackToHome}
                >
                  {'\u8fd4\u56de\u529f\u80fd\u5217\u8868'}
                </button>
              </div>
            </div>
            <input
              ref={controlAnalysisFileInputRef}
              type="file"
              className="hidden-input"
              accept=".ulg"
              multiple
              onChange={handleControlAnalysisFileChange}
            />
            <div className="control-analysis-toolbar">
              <div className="actions control-analysis-actions">
                <button
                  type="button"
                  className="button"
                  onClick={handleChooseControlAnalysisFile}
                >
                  {'\u9009\u62e9\u65e5\u5fd7\u6587\u4ef6'}
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={handleUploadControlAnalysisLog}
                  disabled={isControlAnalysisUploading || controlAnalysisFiles.length === 0}
                >
                  {isControlAnalysisUploading
                    ? '\u4e0a\u4f20\u4e2d...'
                    : '\u4e0a\u4f20\u5e76\u5bf9\u6bd4\u65e5\u5fd7'}
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    setControlAnalysisFiles([])
                    setControlAnalysisReports([])
                    setControlQualityLinkedRanges({})
                    setControlAnalysisStatusText('')
                  }}
                  disabled={isControlAnalysisUploading || controlAnalysisFiles.length === 0}
                >
                  {'\u6e05\u7a7a\u5df2\u9009\u65e5\u5fd7'}
                </button>
              </div>
              <span
                className={`control-analysis-status control-analysis-status-${
                  controlAnalysisHasReports ? 'done' : 'idle'
                }`}
              >
                {controlAnalysisStatusLabel}
              </span>
            </div>
            {controlAnalysisFiles.length > 0 && !controlAnalysisHasReports ? (
              <div className="control-compare-selected">
                <p className="hint">
                  {`\u5df2\u9009 ${controlAnalysisFiles.length} \u4efd\u6587\u4ef6\uff1a`}
                </p>
                <ul className="batch-list">
                  {controlAnalysisFiles.map((file, index) => (
                    <li key={`${getFileSelectionKey(file)}-${index}`}>
                      {file.name}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {controlAnalysisStatusText ? (
              <p className="hint control-analysis-status-text">
                {controlAnalysisStatusText}
              </p>
            ) : null}
            {controlAnalysisReports.length > 0 ? (
              <div className="control-compare-grid">
                {controlAnalysisReports.map((item) => (
                  <article className="control-compare-column" key={item.clientId}>
                    <div className="control-compare-column-head">
                      <h3>{item.fileName}</h3>
                      {item.logId ? (
                        <details className="control-log-details">
                          <summary>详情</summary>
                          <p className="hint">{`logId: ${item.logId}`}</p>
                        </details>
                      ) : null}
                    </div>
                    <ControlQualityPanel
                      chartKeyPrefix={`control-quality__${item.clientId}`}
                      report={item.report}
                      rangeGroupKey={item.clientId}
                      selectionBox={selectionBox}
                      timelinePointer={timelinePointer}
                      isTimelinePlaying={isTimelinePlaying}
                      linkedRange={controlQualityLinkedRanges[item.clientId]}
                      isLoading={item.isLoading}
                      errorText={item.errorText}
                      onChartReady={bindChartInteractions}
                      onChartDispose={handleChartDispose}
                      onTimelineSeek={(timeValue) => {
                        setIsTimelinePlaying(false)
                        setTimelineTime(timeValue)
                      }}
                      onToggleTimelinePlayback={toggleTimelinePlayback}
                      onApplyRange={(startS, endS) =>
                        handleApplyControlQualityRange(
                          item,
                          startS,
                          endS,
                        )
                      }
                    />
                  </article>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}
      </main>
    </div>
  )
}

export default App
