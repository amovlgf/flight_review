import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import './App.css'
import BatchLogUpload from './components/BatchLogUpload'
import ControlQualityPanel from './components/ControlQualityPanel'
import FlightSummaryPage from './components/FlightSummaryPage'
import type {
  ChartSelectionPreview,
  ChartTimeRange,
} from './components/ChartPanel'
import {
  batchCalculateControlQuality,
  calculateControlQuality,
} from './services/api'
import type {
  ControlQualityParameterBound,
  ControlQualityReport,
} from './types/log'
import {
  buildControlQualitySegment,
  createControlQualityRequestTracker,
} from './utils/controlQualityRequest'
import type { ControlQualityRequestTracker } from './utils/controlQualityRequest'
import {
  buildChartSelectionControlSegment,
  ensureVisibleSelectionBox,
  isSelectableChartPoint,
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
  containPixel?: (
    finder: Record<string, unknown>,
    value: [number, number],
  ) => boolean
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

type ControlQualityVisibleRange = {
  startS: number
  endS: number
}

type ViewMode = 'home' | 'flight-summary' | 'batch' | 'control-analysis'

type ControlAnalysisReportItem = {
  clientId: string
  fileName: string
  logId: string
  report: ControlQualityReport | null
  isLoading: boolean
  errorText: string
}

const TIMELINE_PLAYBACK_SPEED = 1
const TIMELINE_FINE_STEP_MIN_S = 0.05
const TIMELINE_FINE_STEP_MAX_S = 1
const CHART_SELECTION_MIN_PREVIEW_PX = 5
const CHART_SELECTION_MIN_WIDTH_PX = 5
const CHART_SELECTION_MIN_VISUAL_PX = 1

function getFileSelectionKey(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}`
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
  const controlQualityRequestTrackerRef =
    useRef<ControlQualityRequestTracker | null>(null)
  if (controlQualityRequestTrackerRef.current === null) {
    controlQualityRequestTrackerRef.current = createControlQualityRequestTracker()
  }
  const [viewMode, setViewMode] = useState<ViewMode>('home')
  const controlAnalysisEntryFileInputRef =
    useRef<HTMLInputElement | null>(null)
  const [isControlAnalysisUploading, setIsControlAnalysisUploading] =
    useState(false)
  const [controlAnalysisStatusText, setControlAnalysisStatusText] = useState('')
  const [controlAnalysisReports, setControlAnalysisReports] = useState<
    ControlAnalysisReportItem[]
  >([])
  const controlAnalysisReportsRef = useRef<ControlAnalysisReportItem[]>([])
  const [controlQualityVisibleRanges, setControlQualityVisibleRanges] = useState<
    Record<string, ControlQualityVisibleRange>
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

  const handleEnterFlightSummary = () => {
    cleanupChartInteractions()
    setViewMode('flight-summary')
  }

  const handleEnterBatchAnalysis = () => {
    setViewMode('batch')
  }

  const resetControlAnalysisState = () => {
    controlAnalysisReportsRef.current.forEach((item) => {
      controlQualityRequestTrackerRef.current?.invalidate(item.clientId)
    })
    setControlAnalysisReports([])
    setControlQualityVisibleRanges({})
    setControlAnalysisStatusText('')
  }

  const handleRequestControlAnalysisLogs = () => {
    if (controlAnalysisEntryFileInputRef.current) {
      controlAnalysisEntryFileInputRef.current.value = ''
    }
    controlAnalysisEntryFileInputRef.current?.click()
  }

  const handleControlAnalysisEntryFileChange = (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length === 0) {
      return
    }

    void handleStartControlAnalysisFromFiles(files)
  }

  const handleStartControlAnalysisFromFiles = async (files: File[]) => {
    if (files.length === 0) {
      return
    }

    const nextItems = files.map((file, index) => ({
      clientId: `${getFileSelectionKey(file)}-${index}`,
      fileName: file.name,
      logId: '',
      report: null,
      isLoading: true,
      errorText: '',
    }))
    try {
      cleanupChartInteractions()
      resetControlAnalysisState()
      setViewMode('control-analysis')
      setIsControlAnalysisUploading(true)
      setControlAnalysisStatusText(
        `\u6b63\u5728\u5206\u6790 ${files.length} \u4efd\u63a7\u5236\u73af\u8def\u65e5\u5fd7...`,
      )
      setControlAnalysisReports(nextItems)
      setControlQualityVisibleRanges({})

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
      setControlAnalysisReports(
        nextItems.map((item) => ({
          ...item,
          isLoading: false,
          errorText:
            '\u65e5\u5fd7\u4e0a\u4f20\u6216\u63a7\u5236\u73af\u5206\u6790\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u540e\u7aef\u548c .ulg \u6587\u4ef6\u3002',
        })),
      )
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
    const requestId =
      controlQualityRequestTrackerRef.current?.begin(clientId) ?? 0
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
      if (
        !controlQualityRequestTrackerRef.current?.isLatest(clientId, requestId)
      ) {
        return false
      }
      setControlAnalysisReports((currentItems) =>
        currentItems.map((item) =>
          item.clientId === clientId
            ? { ...item, logId, report, isLoading: false, errorText: '' }
            : item,
        ),
      )
      return true
    } catch {
      if (
        !controlQualityRequestTrackerRef.current?.isLatest(clientId, requestId)
      ) {
        return false
      }
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

  const handleApplyControlQualityRange = async (
    item: ControlAnalysisReportItem,
    startS: number | null,
    endS: number | null,
  ) => {
    if (!item.logId) return
    const segment = buildControlQualitySegment(startS, endS, 'manual')
    setControlQualityVisibleRanges((current) => {
      if (
        typeof segment.startS !== 'number' ||
        typeof segment.endS !== 'number'
      ) {
        const next = { ...current }
        delete next[item.clientId]
        return next
      }

      return {
        ...current,
        [item.clientId]: {
          startS: segment.startS,
          endS: segment.endS,
        },
      }
    })
    await loadControlQualityForItem(item.clientId, item.logId, segment)
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

    setControlQualityVisibleRanges((current) => ({
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
    const nextVisibleRanges: Record<string, ControlQualityVisibleRange> = {}

    if (source.rangeGroupKey) {
      nextVisibleRanges[source.rangeGroupKey] = {
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
        nextVisibleRanges[target.rangeGroupKey] = {
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

    if (Object.keys(nextVisibleRanges).length > 0) {
      setControlQualityVisibleRanges((current) => ({
        ...current,
        ...nextVisibleRanges,
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
        const startPoint = getClampedChartPoint(event.clientX, event.clientY)
        if (!isSelectableChartPoint(chart, startPoint)) {
          clearLeftSelectionState()
          return
        }

        if (hasPendingClickSelection && !isLeftPointerDown) {
          finishLeftSelection(event.clientX, event.clientY)
          return
        }

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
        setControlQualityVisibleRanges((current) => ({
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
      : '等待日志'

  return (
    <div className="app">
      <header className="header">
        <h1>{'\u98de\u884c\u65e5\u5fd7\u5206\u6790\u5e73\u53f0'}</h1>
        <p>
          {'选择功能后进入对应模块：飞行日志摘要、批量筛选日志、控制环路分析。'}
        </p>
      </header>
      <input
        ref={controlAnalysisEntryFileInputRef}
        type="file"
        className="hidden-input"
        accept=".ulg"
        multiple
        onChange={handleControlAnalysisEntryFileChange}
      />

      <main className="page">
        {viewMode === 'home' ? (
          <section className="feature-hub">
            <h2>{'\u529f\u80fd\u9009\u62e9'}</h2>
            <div className="feature-grid">
              <button
                type="button"
                className="feature-card"
                onClick={handleEnterFlightSummary}
              >
                <h3>{'功能 1：飞行日志摘要'}</h3>
                <p>
                  {'上传单份 .ulg 日志，自动整理飞行阶段、飞行状态和简短报告。'}
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
                onClick={handleRequestControlAnalysisLogs}
              >
                <h3>{'\u529f\u80fd 3\uff1a\u63a7\u5236\u73af\u8def\u5206\u6790'}</h3>
                <p>
                  {'\u6309\u6267\u884c\u5668\u3001\u89d2\u901f\u5ea6\u3001\u59ff\u6001\u3001\u901f\u5ea6\u3001\u4f4d\u7f6e\u73af\u987a\u5e8f\u5206\u6790\u63a7\u5236\u8ddf\u968f\u8d28\u91cf\u3002'}
                </p>
              </button>
            </div>
          </section>
        ) : null}

        {viewMode === 'flight-summary' ? (
          <FlightSummaryPage
            selectionBox={selectionBox}
            timelinePointer={timelinePointer}
            isTimelinePlaying={isTimelinePlaying}
            isGlobalChartSyncEnabled={isGlobalChartSyncEnabled}
            onToggleGlobalChartSync={() =>
              setIsGlobalChartSyncEnabled((current) => !current)
            }
            onBackToHome={handleBackToHome}
            onChartReady={bindChartInteractions}
            onChartDispose={handleChartDispose}
            onTimelineSeek={(timeValue) => {
              setIsTimelinePlaying(false)
              setTimelineTime(timeValue)
            }}
            onToggleTimelinePlayback={toggleTimelinePlayback}
          />
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
          <section className="control-analysis-page">
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
            <div className="control-analysis-meta-row">
              <p className="hint control-analysis-file-summary">
                {controlAnalysisReports.length > 0
                  ? controlAnalysisReports.map((item) => item.fileName).join('、')
                  : '等待入口选择日志'}
              </p>
              <span
                className={`control-analysis-status control-analysis-status-${
                  controlAnalysisHasReports ? 'done' : 'idle'
                }`}
              >
                {controlAnalysisStatusLabel}
              </span>
            </div>
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
                      visibleRange={controlQualityVisibleRanges[item.clientId]}
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
