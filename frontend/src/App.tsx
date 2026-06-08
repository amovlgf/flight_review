import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import BatchLogUpload from './components/BatchLogUpload'
import ChartPanel from './components/ChartPanel'
import ControlQualityPanel from './components/ControlQualityPanel'
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
import TuningPanel from './components/TuningPanel'
import UploadPanel from './components/UploadPanel'
import {
  calculateControlQuality,
  exportControlQualityCsv,
  fetchChartData,
  fetchLogList,
  uploadLogFile,
} from './services/api'
import type { ControlQualityReport } from './types/log'
import type {
  TuningAxis,
  TuningSegmentQualityResult,
  TuningSegmentState,
} from './types/tuning'
import {
  buildPidAttitudeTrackingCharts,
  getPidAxisTrackingSeries,
} from './utils/pidAttitudeTracking'
import {
  isValidSelectionBox,
  normalizeSelectionBox,
} from './utils/selectionBox'
import { evaluatePidSegmentQuality } from './utils/segmentQuality'

type ChartAction = {
  type: string
  dataZoomIndex?: number
  start?: number
  end?: number
}

type ChartZoomState = {
  start?: number
  end?: number
}

type ChartInstance = {
  getDom: () => HTMLElement
  getOption: () => { dataZoom?: ChartZoomState[] }
  dispatchAction: (action: ChartAction) => void
  on: (eventName: 'datazoom', handler: () => void) => void
  off: (eventName: 'datazoom', handler: () => void) => void
  isDisposed?: () => boolean
}

type ChartRegistryItem = {
  chart: ChartInstance
  timeRange: ChartTimeRange
}

type ViewMode = 'upload' | 'chart'
type ChartViewMode = 'pid' | 'normal'

const PAGE_SIZE = 8
const SHOW_SINGLE_LOG_UPLOAD = true
const DEFAULT_TUNING_SEGMENT: TuningSegmentState = {
  startS: null,
  endS: null,
  source: 'default',
}

const DEFAULT_SEGMENT_QUALITY: TuningSegmentQualityResult = {
  status: 'unknown',
  score: 0,
  summary: '暂无片段质量评分。',
  reasons: ['当前还没有可用于分析的片段。'],
  recommendations: ['请先在图表中框选一个分析片段。'],
  metrics: {
    durationS: null,
    setpointRangeDeg: null,
    actualRangeDeg: null,
    sampleCount: 0,
    rmsErrorDeg: null,
    peakErrorDeg: null,
  },
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

function downloadTextFile(fileName: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
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
  const [selectedFileName, setSelectedFileName] = useState('')
  const [isUploading, setIsUploading] = useState(false)
  const [selectedLogId, setSelectedLogId] = useState('')
  const [statusText, setStatusText] = useState('')
  const [chartHint, setChartHint] = useState(
    '\u56fe\u8868\u7ec4\u4ef6\u5360\u4f4d\u533a',
  )
  const [seriesData, setSeriesData] = useState<ChartSeries[]>([])
  const [topicCharts, setTopicCharts] = useState<TopicChart[]>([])
  const [modeSegments, setModeSegments] = useState<ModeSegment[]>([])
  const [diagnostics, setDiagnostics] = useState<DiagnosticItem[]>([])
  const [logList, setLogList] = useState<
    Array<{ logId: string; fileName: string; uploadedAt: string }>
  >([])
  const [activeLogMeta, setActiveLogMeta] = useState<ActiveLogMeta | null>(null)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [listPage, setListPage] = useState(1)
  const [listPageCount, setListPageCount] = useState(1)
  const [listTotal, setListTotal] = useState(0)
  const [viewMode, setViewMode] = useState<ViewMode>('upload')
  const [chartViewMode, setChartViewMode] = useState<ChartViewMode>('pid')
  const [selectedTuningAxis, setSelectedTuningAxis] =
    useState<TuningAxis>('roll')
  const [tuningSegment, setTuningSegment] = useState<TuningSegmentState>(
    DEFAULT_TUNING_SEGMENT,
  )
  const [selectionBox, setSelectionBox] = useState<ChartSelectionPreview | null>(
    null,
  )
  const [controlQualityReport, setControlQualityReport] =
    useState<ControlQualityReport | null>(null)
  const [isControlQualityLoading, setIsControlQualityLoading] = useState(false)
  const [controlQualityError, setControlQualityError] = useState('')

  const pidTrackingCharts = useMemo(
    () => buildPidAttitudeTrackingCharts(topicCharts),
    [topicCharts],
  )

  const visibleTopicCharts = useMemo(
    () => (chartViewMode === 'pid' ? pidTrackingCharts : topicCharts),
    [chartViewMode, pidTrackingCharts, topicCharts],
  )

  const visibleSeriesData = useMemo(
    () => (chartViewMode === 'normal' ? seriesData : []),
    [chartViewMode, seriesData],
  )

  const visibleDiagnostics = useMemo(
    () => (chartViewMode === 'normal' ? diagnostics : []),
    [chartViewMode, diagnostics],
  )

  const activePidChartTopic = useMemo(
    () =>
      chartViewMode === 'pid'
        ? `pid_${selectedTuningAxis}_angle_tracking`
        : undefined,
    [chartViewMode, selectedTuningAxis],
  )

  const segmentQuality = useMemo(() => {
    const { actualSeries, setpointSeries } = getPidAxisTrackingSeries(
      pidTrackingCharts,
      selectedTuningAxis,
    )

    if (actualSeries.length === 0 || setpointSeries.length === 0) {
      return {
        ...DEFAULT_SEGMENT_QUALITY,
        reasons: ['当前日志缺少可用于片段质量评分的 PID 跟踪数据。'],
        recommendations: ['请切换到包含姿态跟踪数据的日志，或改用常规视图检查原始数据。'],
      }
    }

    const result = evaluatePidSegmentQuality({
      axis: selectedTuningAxis,
      startS: tuningSegment.startS,
      endS: tuningSegment.endS,
      actualSeries,
      setpointSeries,
    })

    return result ?? DEFAULT_SEGMENT_QUALITY
  }, [pidTrackingCharts, selectedTuningAxis, tuningSegment.endS, tuningSegment.startS])

  const chartViewDescription = useMemo(
    () =>
      chartViewMode === 'pid'
        ? '\u5f53\u524d PID \u89c6\u56fe\u4ec5\u663e\u793a roll / pitch / yaw \u4e09\u8f74\u7684\u671f\u671b\u89d2\u5ea6\u4e0e\u5b9e\u9645\u89d2\u5ea6\u8ddf\u968f\u66f2\u7ebf\u3002'
        : '\u5f53\u524d\u663e\u793a\u65e5\u5fd7\u4e2d\u7684\u5e38\u89c4\u56fe\u8868\u6570\u636e\uff0c\u540e\u7eed\u5c06\u7ee7\u7eed\u4f18\u5316\u5206\u7c7b\u4e0e\u5e03\u5c40\u3002',
    [chartViewMode],
  )

  const chartEmptyStateMessage = useMemo(() => {
    if (
      activeLogMeta &&
      chartViewMode === 'pid' &&
      visibleTopicCharts.length === 0
    ) {
      return '\u5f53\u524d\u65e5\u5fd7\u7f3a\u5c11\u59ff\u6001\u6216\u59ff\u6001\u671f\u671b\u56db\u5143\u6570\u6570\u636e\uff0c\u65e0\u6cd5\u751f\u6210 PID \u89d2\u5ea6\u8ddf\u968f\u89c6\u56fe\u3002\u53ef\u5207\u6362\u5230\u5e38\u89c4\u89c6\u56fe\u67e5\u770b\u539f\u59cb\u6570\u636e\u3002'
    }

    return undefined
  }, [activeLogMeta, chartViewMode, visibleTopicCharts])

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

    try {
      setIsUploading(true)
      setStatusText('\u6b63\u5728\u4e0a\u4f20...')
      setSeriesData([])
      setTopicCharts([])
      setModeSegments([])
      setDiagnostics([])
      setControlQualityReport(null)
      setControlQualityError('')
      setChartHint('\u56fe\u8868\u7ec4\u4ef6\u5360\u4f4d\u533a')
      setActiveLogMeta(null)
      setTuningSegment(DEFAULT_TUNING_SEGMENT)
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
      setViewMode('chart')
      setStatusText(
        logId
          ? `\u4e0a\u4f20\u6210\u529f\uff0c\u529f\u80fd 2 \u5df2\u89e3\u9501\uff08logId: ${logId}\uff09\u3002`
          : '\u4e0a\u4f20\u6210\u529f\uff0c\u529f\u80fd 2 \u5df2\u89e3\u9501\u3002',
      )
    } catch {
      setSeriesData([])
      setTopicCharts([])
      setModeSegments([])
      setDiagnostics([])
      setControlQualityReport(null)
      setControlQualityError('')
      setActiveLogMeta(null)
      setTuningSegment(DEFAULT_TUNING_SEGMENT)
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
    setSelectionBox(null)
  }, [])

  const handleBackToUpload = () => {
    cleanupChartInteractions()
    setTuningSegment(DEFAULT_TUNING_SEGMENT)
    setControlQualityReport(null)
    setControlQualityError('')
    setViewMode('upload')
  }

  const loadControlQuality = useCallback(
    async (
      logId: string,
      segment?: { startS: number | null; endS: number | null; source?: string },
    ) => {
      try {
        setIsControlQualityLoading(true)
        setControlQualityError('')
        const report = await calculateControlQuality({ logId, segment })
        setControlQualityReport(report)
      } catch {
        setControlQualityReport(null)
        setControlQualityError(
          'Control-loop metrics failed. Please confirm the log is still available and contains PX4 control topics.',
        )
      } finally {
        setIsControlQualityLoading(false)
      }
    },
    [],
  )

  const handleLoadChart = async () => {
    if (!selectedLogId) return

    try {
      const data = await fetchChartData(selectedLogId)
      if (Array.isArray(data?.series) && data.series.length === 0) {
        setSeriesData([])
        setTopicCharts([])
        setModeSegments([])
        setControlQualityReport(null)
        setControlQualityError('')
        setChartHint(
          `\u5df2\u8c03\u7528\u56fe\u8868\u63a5\u53e3\uff08logId: ${selectedLogId}\uff09\uff1a\u5f53\u524d\u8fd4\u56de\u7a7a\u6570\u636e\uff08\u5360\u4f4d\uff09`,
        )
        setTuningSegment(DEFAULT_TUNING_SEGMENT)
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
        logId: typeof data?.logId === 'string' ? data.logId : selectedLogId,
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
          : '\u5df2\u52a0\u8f7d\u56fe\u8868\u6570\u636e\uff08\u6765\u81ea PX4 \u4e3b\u9898\u89e3\u6790\uff09'
      )
      await loadControlQuality(selectedLogId)
    } catch {
      setSeriesData([])
      setTopicCharts([])
      setModeSegments([])
      setControlQualityReport(null)
      setControlQualityError('')
      setActiveLogMeta(null)
      setTuningSegment(DEFAULT_TUNING_SEGMENT)
      setSelectionBox(null)
      void loadLogList({ preferLogId: '' })
      setChartHint(
        '\u56fe\u8868\u6570\u636e\u8bf7\u6c42\u5931\u8d25\uff08\u53ef\u80fd\u662f\u65e5\u5fd7\u5df2\u5931\u6548\uff0c\u8bf7\u5237\u65b0\u5217\u8868\u6216\u91cd\u65b0\u4e0a\u4f20\uff09',
      )
    }
  }

  const handleLogSelect = (logId: string) => {
    setSelectedLogId(logId)
    setSeriesData([])
    setTopicCharts([])
    setModeSegments([])
    setDiagnostics([])
    setControlQualityReport(null)
    setControlQualityError('')
    setActiveLogMeta(null)
    setTuningSegment(DEFAULT_TUNING_SEGMENT)
    setSelectionBox(null)
    if (logId) {
      setChartHint('\u5df2\u5207\u6362\u65e5\u5fd7\uff0c\u8bf7\u70b9\u51fb\u6253\u5f00\u56fe\u8868\u6a21\u5757\u3002')
    } else {
      setChartHint('\u56fe\u8868\u7ec4\u4ef6\u5360\u4f4d\u533a')
    }
  }

  const handleApplyControlQualityRange = async (
    startS: number | null,
    endS: number | null,
  ) => {
    if (!selectedLogId) return
    const segment = {
      startS,
      endS,
      source: startS !== null && endS !== null ? 'manual' : 'auto',
    }
    setTuningSegment({
      startS,
      endS,
      source: segment.source === 'manual' ? 'manual' : 'default',
    })
    await loadControlQuality(selectedLogId, segment)
  }

  const handleExportControlQualityCsv = async () => {
    if (!selectedLogId || !controlQualityReport) return
    const csv = await exportControlQualityCsv({
      logId: selectedLogId,
      segment: {
        startS: controlQualityReport.analysis_time_range.start_s,
        endS: controlQualityReport.analysis_time_range.end_s,
        source: controlQualityReport.analysis_time_range.source,
      },
    })
    const fileStem = (controlQualityReport.log_file || 'control-quality').replace(
      /[^a-z0-9_.-]+/gi,
      '_',
    )
    downloadTextFile(
      `${fileStem}.control-quality.csv`,
      csv,
      'text/csv;charset=utf-8',
    )
  }

  const handleSearch = async () => {
    await loadLogList({ page: 1, keyword: searchKeyword })
    setSeriesData([])
    setDiagnostics([])
    setControlQualityReport(null)
    setControlQualityError('')
    setActiveLogMeta(null)
    setChartHint('\u65e5\u5fd7\u5217\u8868\u5df2\u66f4\u65b0\uff0c\u8bf7\u9009\u62e9\u65e5\u5fd7\u540e\u6253\u5f00\u56fe\u8868\u3002')
  }

  const handlePrevPage = async () => {
    if (listPage <= 1) return
    await loadLogList({ page: listPage - 1 })
  }

  const handleNextPage = async () => {
    if (listPage >= listPageCount) return
    await loadLogList({ page: listPage + 1 })
  }

  const syncChartZoom = useCallback((
    sourceChartKey: string,
    sourceStartPercent: number,
    sourceEndPercent: number,
  ) => {
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

      try {
        target.chart.dispatchAction({
          type: 'dataZoom',
          dataZoomIndex: 0,
          start: targetStart,
          end: targetEnd,
        })
        target.chart.dispatchAction({
          type: 'dataZoom',
          dataZoomIndex: 1,
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
  }, [])

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
  ) => {
    const chart = chartInstance as ChartInstance
    if (!chart || isChartDisposed(chart)) {
      return
    }
    const oldCleanup = chartCleanupRef.current.get(chartKey)
    if (oldCleanup) oldCleanup()
    chartRegistryRef.current.set(chartKey, { chart, timeRange })

    const dom = chart.getDom()
    let isMiddleDragging = false
    let isLeftSelecting = false
    let lastClientX = 0
    let lastMiddleDownAt = 0
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
        chart.dispatchAction({
          type: 'dataZoom',
          dataZoomIndex: 1,
          start,
          end,
        })
      } catch {
        chartRegistryRef.current.delete(chartKey)
        chartCleanupRef.current.delete(chartKey)
      }
    }

    const resetZoom = () => {
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
      const rect = dom.getBoundingClientRect()
      const currentX = Math.min(Math.max(clientX - rect.left, 0), rect.width)
      const currentY = Math.min(Math.max(clientY - rect.top, 0), rect.height)
      const normalizedBox = normalizeSelectionBox(
        { x: selectStartX, y: selectStartY },
        { x: currentX, y: currentY },
      )

      if (!normalizedBox) {
        clearSelectionPreview(chartKey)
        return
      }

      if (!isValidSelectionBox(normalizedBox, 5)) {
        clearSelectionPreview(chartKey)
        return
      }

      setSelectionBox({
        chartId: chartKey,
        left: normalizedBox.left,
        top: normalizedBox.top,
        width: normalizedBox.width,
        height: normalizedBox.height,
      })
    }

    const finishLeftSelection = (clientX: number) => {
      if (!isLeftSelecting) return
      const rect = dom.getBoundingClientRect()
      const endX = Math.min(Math.max(clientX - rect.left, 0), rect.width)
      const delta = Math.abs(endX - selectStartX)
      isLeftSelecting = false
      clearSelectionPreview(chartKey)

      // Left-drag box zoom on x-axis.
      if (delta >= 5 && rect.width > 0) {
        const minX = Math.min(selectStartX, endX)
        const maxX = Math.max(selectStartX, endX)
        const start = (minX / rect.width) * 100
        const end = (maxX / rect.width) * 100
        applyDataZoom(start, end)

        const selectedStartTime = percentToTimeValue(start, timeRange)
        const selectedEndTime = percentToTimeValue(end, timeRange)
        if (
          Number.isFinite(selectedStartTime) &&
          Number.isFinite(selectedEndTime) &&
          selectedEndTime > selectedStartTime
        ) {
          setTuningSegment({
            startS: Number(selectedStartTime.toFixed(3)),
            endS: Number(selectedEndTime.toFixed(3)),
            source: 'chart_selection',
          })
        }
      }
    }

    const onMouseDown = (event: MouseEvent) => {
      if (event.button === 0) {
        const rect = dom.getBoundingClientRect()
        selectStartX = Math.min(Math.max(event.clientX - rect.left, 0), rect.width)
        selectStartY = Math.min(
          Math.max(event.clientY - rect.top, 0),
          rect.height,
        )
        isLeftSelecting = true
        clearSelectionPreview(chartKey)
        return
      }

      if (event.button !== 1) return
      event.preventDefault()

      const now = Date.now()
      if (now - lastMiddleDownAt < 320) {
        resetZoom()
      }
      lastMiddleDownAt = now

      isMiddleDragging = true
      lastClientX = event.clientX
    }

    const onMouseMove = (event: MouseEvent) => {
      if (isLeftSelecting) {
        event.preventDefault()
        updateSelectionPreview(event.clientX, event.clientY)
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
        finishLeftSelection(event.clientX)
        return
      }

      if (event.button !== 1) return
      isMiddleDragging = false
    }

    const onMouseLeave = () => {
      if (isLeftSelecting) {
        clearSelectionPreview(chartKey)
      }
      isMiddleDragging = false
    }

    const onAuxClick = (event: MouseEvent) => {
      if (event.button === 1) {
        event.preventDefault()
      }
    }

    const onWindowMouseUp = (event: MouseEvent) => {
      if (event.button === 0) {
        finishLeftSelection(event.clientX)
      } else if (event.button === 1) {
        isMiddleDragging = false
      }
    }

    const onDataZoom = () => {
      if (isSyncingZoomRef.current || isChartDisposed(chart)) return
      const zoomState = chart.getOption()?.dataZoom?.[0]
      const start = Number(zoomState?.start ?? 0)
      const end = Number(zoomState?.end ?? 100)
      syncChartZoom(chartKey, start, end)
    }

    dom.addEventListener('mousedown', onMouseDown)
    dom.addEventListener('mousemove', onMouseMove)
    dom.addEventListener('mouseup', onMouseUp)
    dom.addEventListener('mouseleave', onMouseLeave)
    dom.addEventListener('auxclick', onAuxClick)
    window.addEventListener('mouseup', onWindowMouseUp)
    chart.on('datazoom', onDataZoom)

    const cleanup = () => {
      dom.removeEventListener('mousedown', onMouseDown)
      dom.removeEventListener('mousemove', onMouseMove)
      dom.removeEventListener('mouseup', onMouseUp)
      dom.removeEventListener('mouseleave', onMouseLeave)
      dom.removeEventListener('auxclick', onAuxClick)
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
  }, [clearSelectionPreview, syncChartZoom])

  const handleChartDispose = useCallback((chartKey: string) => {
    const cleanup = chartCleanupRef.current.get(chartKey)
    if (cleanup) {
      cleanup()
    }
    chartCleanupRef.current.delete(chartKey)
    chartRegistryRef.current.delete(chartKey)
  }, [])

  useEffect(() => {
    return cleanupChartInteractions
  }, [cleanupChartInteractions])

  return (
    <div className="app">
      <header className="header">
        <h1>{'\u98de\u884c\u65e5\u5fd7\u5e73\u53f0\uff08\u6846\u67b6\u7248\uff09'}</h1>
        <p>{'\u9879\u76ee\u7ed3\u6784\u5df2\u5c31\u7eea\uff0c\u5177\u4f53\u529f\u80fd\u5c06\u5728\u4e0b\u4e00\u6b65\u5b9e\u73b0\u3002'}</p>
      </header>

      <main className="page">
        {viewMode === 'upload' ? (
          <>
            {SHOW_SINGLE_LOG_UPLOAD && (
              <UploadPanel
                selectedFileName={selectedFileName}
                isUploading={isUploading}
                statusText={statusText}
                onFileSelected={handleFileSelected}
                onUpload={handleUpload}
              />
            )}
            <BatchLogUpload />
          </>
        ) : (
          <section className={`card ${selectedLogId ? '' : 'card-disabled'}`}>
            <div className="page-title-row">
              <h2>{'\u529f\u80fd 2\uff1a\u56fe\u8868\u5c55\u793a'}</h2>
              <button
                type="button"
                className="button"
                onClick={handleBackToUpload}
              >
                {'\u8fd4\u56de\u4e0a\u4f20\u65e5\u5fd7'}
              </button>
            </div>
            <ul>
              <li>{'\u65e5\u5fd7\u7b5b\u9009\u6761\u4ef6\u533a\u57df'}</li>
              <li>{'\u56fe\u8868\u5c55\u793a\u533a\u57df\uff08\u6298\u7ebf/\u67f1\u72b6\uff09'}</li>
              <li>{'\u56fe\u8868\u6570\u636e\u63a5\u53e3\u5360\u4f4d'}</li>
            </ul>
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
              onLoadChart={handleLoadChart}
            />
            <TuningPanel
              selectedLogId={selectedLogId || undefined}
              axis={selectedTuningAxis}
              onAxisChange={setSelectedTuningAxis}
              tuningSegment={tuningSegment}
              segmentQuality={segmentQuality}
              onTuningSegmentChange={setTuningSegment}
            />
            <ControlQualityPanel
              report={controlQualityReport}
              isLoading={isControlQualityLoading}
              errorText={controlQualityError}
              onApplyRange={handleApplyControlQualityRange}
              onExportCsv={handleExportControlQualityCsv}
            />
            <div className="chart-view-toolbar">
              <div className="chart-view-row">
                <label className="tuning-field" htmlFor="chart-view-mode">
                  <span className="tuning-subtitle">
                    {'\u56fe\u8868\u663e\u793a\u6a21\u5f0f\uff1a'}
                  </span>
                  <select
                    id="chart-view-mode"
                    className="select"
                    value={chartViewMode}
                    onChange={(event) =>
                      setChartViewMode(event.target.value as ChartViewMode)
                    }
                  >
                    <option value="pid">
                      {'PID \u89c6\u56fe'}
                    </option>
                    <option value="normal">{'\u5e38\u89c4\u89c6\u56fe'}</option>
                  </select>
                </label>
              </div>
              <p className="hint">{chartViewDescription}</p>
            </div>
            <ChartPanel
              activeLogMeta={activeLogMeta}
              topicCharts={visibleTopicCharts}
              seriesData={visibleSeriesData}
              modeSegments={modeSegments}
              diagnostics={visibleDiagnostics}
              selectionBox={selectionBox}
              activeChartTopic={activePidChartTopic}
              activeChartBadgeLabel={
                chartViewMode === 'pid'
                  ? '\u5f53\u524d\u8c03\u53c2\u8f74'
                  : undefined
              }
              chartHint={chartHint}
              emptyStateMessage={chartEmptyStateMessage}
              showDefaultSeriesFallback={chartViewMode === 'normal'}
              onChartReady={bindChartInteractions}
              onChartDispose={handleChartDispose}
            />
          </section>
        )}
      </main>
    </div>
  )
}

export default App
