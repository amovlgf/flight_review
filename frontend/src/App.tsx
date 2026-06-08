import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
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
import UploadPanel from './components/UploadPanel'
import {
  calculateControlQuality,
  exportControlQualityCsv,
  fetchChartData,
  fetchLogList,
  uploadLogFile,
} from './services/api'
import type { ControlQualityReport } from './types/log'
import {
  isValidSelectionBox,
  normalizeSelectionBox,
} from './utils/selectionBox'

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

type ViewMode = 'home' | 'log-analysis' | 'batch' | 'control-analysis'
type LogAnalysisStep = 'upload' | 'chart'

const PAGE_SIZE = 8
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
  const [viewMode, setViewMode] = useState<ViewMode>('home')
  const [logAnalysisStep, setLogAnalysisStep] =
    useState<LogAnalysisStep>('upload')
  const controlAnalysisFileInputRef = useRef<HTMLInputElement | null>(null)
  const [controlAnalysisFileName, setControlAnalysisFileName] = useState('')
  const [isControlAnalysisUploading, setIsControlAnalysisUploading] =
    useState(false)
  const [controlAnalysisStatusText, setControlAnalysisStatusText] = useState('')
  const [controlAnalysisLogId, setControlAnalysisLogId] = useState('')
  const [selectionBox, setSelectionBox] = useState<ChartSelectionPreview | null>(
    null,
  )
  const [controlQualityReport, setControlQualityReport] =
    useState<ControlQualityReport | null>(null)
  const [isControlQualityLoading, setIsControlQualityLoading] = useState(false)
  const [controlQualityError, setControlQualityError] = useState('')

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
      }
      setStatusText(
        logId
          ? `\u4e0a\u4f20\u6210\u529f\uff08logId: ${logId}\uff09\uff0c\u56fe\u8868\u5df2\u81ea\u52a8\u52a0\u8f7d\u3002`
          : '\u4e0a\u4f20\u6210\u529f\u3002',
      )
    } catch {
      setSeriesData([])
      setTopicCharts([])
      setModeSegments([])
      setDiagnostics([])
      setControlQualityReport(null)
      setControlQualityError('')
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
    setSelectionBox(null)
  }, [])

  const handleBackToHome = () => {
    cleanupChartInteractions()
    setControlQualityReport(null)
    setControlQualityError('')
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
    setControlQualityReport(null)
    setControlQualityError('')
    setControlAnalysisLogId('')
    setControlAnalysisStatusText('')
    setControlAnalysisFileName('')
  }

  const handleChooseControlAnalysisFile = () => {
    controlAnalysisFileInputRef.current?.click()
  }

  const handleControlAnalysisFileChange = (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0]
    if (!file) return
    setControlAnalysisFileName(file.name)
    setControlAnalysisStatusText(
      '\u5df2\u9009\u62e9\u63a7\u5236\u73af\u8def\u5206\u6790\u65e5\u5fd7\uff0c\u8bf7\u70b9\u51fb\u4e0a\u4f20\u65e5\u5fd7\u6587\u4ef6\u3002',
    )
  }

  const handleUploadControlAnalysisLog = async () => {
    const file = controlAnalysisFileInputRef.current?.files?.[0] ?? null
    if (!file) {
      setControlAnalysisStatusText(
        '\u8bf7\u5148\u9009\u62e9\u7528\u4e8e\u63a7\u5236\u73af\u8def\u5206\u6790\u7684 .ulg \u65e5\u5fd7\u3002',
      )
      return
    }

    try {
      setIsControlAnalysisUploading(true)
      setControlAnalysisStatusText(
        '\u6b63\u5728\u4e0a\u4f20\u65e5\u5fd7\u5e76\u8ba1\u7b97\u63a7\u5236\u73af\u6307\u6807...',
      )
      setControlQualityReport(null)
      setControlQualityError('')
      setControlAnalysisLogId('')

      const uploadResult = await uploadLogFile(file)
      const logId =
        uploadResult && typeof uploadResult.logId === 'string'
          ? uploadResult.logId
          : ''
      if (!logId) throw new Error('LOG_ID_MISSING')

      setControlAnalysisLogId(logId)
      await loadControlQuality(logId)
      setControlAnalysisStatusText(
        `\u65e5\u5fd7\u5df2\u4e0a\u4f20\u5e76\u5b8c\u6210\u63a7\u5236\u73af\u5206\u6790\uff08\u65e5\u5fd7\u7f16\u53f7\uff1a${logId}\uff09\u3002`,
      )
    } catch {
      setControlAnalysisStatusText(
        '\u65e5\u5fd7\u4e0a\u4f20\u6216\u63a7\u5236\u73af\u5206\u6790\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u540e\u7aef\u548c .ulg \u6587\u4ef6\u3002',
      )
    } finally {
      setIsControlAnalysisUploading(false)
    }
  }

  const loadControlQuality = async (
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
        '\u63a7\u5236\u73af\u6307\u6807\u8ba1\u7b97\u5931\u8d25\uff0c\u8bf7\u786e\u8ba4\u65e5\u5fd7\u5305\u542b PX4 \u63a7\u5236\u76f8\u5173 topic\u3002',
      )
    } finally {
      setIsControlQualityLoading(false)
    }
  }

  const loadChartForLog = async (logId: string) => {
    if (!logId) return

    try {
      const data = await fetchChartData(logId)
      if (Array.isArray(data?.series) && data.series.length === 0) {
        setSeriesData([])
        setTopicCharts([])
        setModeSegments([])
        setControlQualityReport(null)
        setControlQualityError('')
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
      setControlQualityReport(null)
      setControlQualityError('')
      setActiveLogMeta(null)
      setSelectionBox(null)
      void loadLogList({ preferLogId: '' })
      setChartHint(
        '\u56fe\u8868\u6570\u636e\u8bf7\u6c42\u5931\u8d25\uff08\u53ef\u80fd\u662f\u65e5\u5fd7\u5df2\u5931\u6548\uff0c\u8bf7\u5237\u65b0\u5217\u8868\u6216\u91cd\u65b0\u4e0a\u4f20\uff09',
      )
    }
  }

  const handleLogSelect = async (logId: string) => {
    cleanupChartInteractions()
    setSelectedLogId(logId)
    setSeriesData([])
    setTopicCharts([])
    setModeSegments([])
    setDiagnostics([])
    setControlQualityReport(null)
    setControlQualityError('')
    setActiveLogMeta(null)
    setSelectionBox(null)
    if (logId) {
      await loadChartForLog(logId)
    } else {
      setChartHint('\u56fe\u8868\u7ec4\u4ef6\u5360\u4f4d\u533a')
    }
  }

  const handleApplyControlQualityRange = async (
    startS: number | null,
    endS: number | null,
  ) => {
    if (!controlAnalysisLogId) return
    await loadControlQuality(controlAnalysisLogId, {
      startS,
      endS,
      source: startS !== null && endS !== null ? 'manual' : 'auto',
    })
  }

  const handleExportControlQualityCsv = async () => {
    if (!controlAnalysisLogId || !controlQualityReport) return
    const csv = await exportControlQualityCsv({
      logId: controlAnalysisLogId,
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
                <h3>{'\u529f\u80fd 1\uff1a\u65e5\u5fd7\u4e0a\u4f20\u5206\u6790'}</h3>
                <p>
                  {'\u4e0a\u4f20\u5355\u4efd .ulg \u65e5\u5fd7\uff0c\u67e5\u770b\u56fe\u8868\u4e0e\u8bca\u65ad\u4fe1\u606f\u3002'}
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
              <h2>{'\u529f\u80fd 1\uff1a\u65e5\u5fd7\u4e0a\u4f20\u5206\u6790'}</h2>
              <div className="actions">
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
            <ChartPanel
              activeLogMeta={activeLogMeta}
              topicCharts={topicCharts}
              seriesData={seriesData}
              modeSegments={modeSegments}
              diagnostics={diagnostics}
              selectionBox={selectionBox}
              chartHint={chartHint}
              showDefaultSeriesFallback
              onChartReady={bindChartInteractions}
              onChartDispose={handleChartDispose}
            />
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
                  {'\u6309\u6587\u6863\u8981\u6c42\u4ece\u5185\u73af\u5230\u5916\u73af\u4f9d\u6b21\u5c55\u793a\u5f53\u524d\u65e5\u5fd7\u7684\u63a7\u5236\u8ddf\u968f\u66f2\u7ebf\u4e0e\u6307\u6807\u3002'}
                </p>
              </div>
              <button
                type="button"
                className="button"
                onClick={handleBackToHome}
              >
                {'\u8fd4\u56de\u529f\u80fd\u5217\u8868'}
              </button>
            </div>
            <input
              ref={controlAnalysisFileInputRef}
              type="file"
              className="hidden-input"
              accept=".ulg"
              onChange={handleControlAnalysisFileChange}
            />
            <div className="actions">
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
                disabled={isControlAnalysisUploading}
              >
                {isControlAnalysisUploading
                  ? '\u4e0a\u4f20\u4e2d...'
                  : '\u4e0a\u4f20\u65e5\u5fd7\u6587\u4ef6'}
              </button>
            </div>
            {controlAnalysisFileName ? (
              <p className="hint">
                {'\u5df2\u9009\u6587\u4ef6\uff1a'}
                {controlAnalysisFileName}
              </p>
            ) : null}
            {controlAnalysisStatusText ? (
              <p className="hint">{controlAnalysisStatusText}</p>
            ) : null}
            <ControlQualityPanel
              report={controlQualityReport}
              isLoading={isControlQualityLoading}
              errorText={controlQualityError}
              onApplyRange={handleApplyControlQualityRange}
              onExportCsv={handleExportControlQualityCsv}
            />
          </section>
        ) : null}
      </main>
    </div>
  )
}

export default App
