import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import ChartPanel from './components/ChartPanel'
import type {
  ActiveLogMeta,
  ChartSeries,
  ChartTimeRange,
  DiagnosticItem,
  ModeSegment,
  TopicChart,
} from './components/ChartPanel'
import LogSelector from './components/LogSelector'
import TuningPanel from './components/TuningPanel'
import UploadPanel from './components/UploadPanel'
import { fetchChartData, fetchLogList, uploadLogFile } from './services/api'
import type { TuningSegmentState } from './types/tuning'

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

const PAGE_SIZE = 8
const DEFAULT_TUNING_SEGMENT: TuningSegmentState = {
  startS: null,
  endS: null,
  source: 'default',
}
const ROLE_OPTIONS = [
  { value: 'customer', label: '\u5ba2\u6237\u89c6\u56fe' },
  { value: 'aftersales', label: '\u552e\u540e\u89c6\u56fe' },
  { value: 'engineer', label: '\u7814\u53d1\u89c6\u56fe' },
]

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
  const [viewRole, setViewRole] = useState('aftersales')
  const [viewMode, setViewMode] = useState<ViewMode>('upload')
  const [tuningSegment, setTuningSegment] = useState<TuningSegmentState>(
    DEFAULT_TUNING_SEGMENT,
  )

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
      setChartHint('\u56fe\u8868\u7ec4\u4ef6\u5360\u4f4d\u533a')
      setActiveLogMeta(null)
      setTuningSegment(DEFAULT_TUNING_SEGMENT)
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
      setActiveLogMeta(null)
      setTuningSegment(DEFAULT_TUNING_SEGMENT)
      setStatusText('\u4e0a\u4f20\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u540e\u7aef\u662f\u5426\u542f\u52a8\u3002')
    } finally {
      setIsUploading(false)
    }
  }

  const cleanupChartInteractions = useCallback(() => {
    chartCleanupRef.current.forEach((cleanup) => cleanup())
    chartCleanupRef.current.clear()
    chartRegistryRef.current.clear()
  }, [])

  const handleBackToUpload = () => {
    cleanupChartInteractions()
    setTuningSegment(DEFAULT_TUNING_SEGMENT)
    setViewMode('upload')
  }

  const handleLoadChart = async () => {
    if (!selectedLogId) return

    try {
      const data = await fetchChartData(selectedLogId, viewRole)
      if (Array.isArray(data?.series) && data.series.length === 0) {
        setSeriesData([])
        setTopicCharts([])
        setModeSegments([])
        setChartHint(
          `\u5df2\u8c03\u7528\u56fe\u8868\u63a5\u53e3\uff08logId: ${selectedLogId}\uff09\uff1a\u5f53\u524d\u8fd4\u56de\u7a7a\u6570\u636e\uff08\u5360\u4f4d\uff09`,
        )
        setTuningSegment(DEFAULT_TUNING_SEGMENT)
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
    } catch {
      setSeriesData([])
      setTopicCharts([])
      setModeSegments([])
      setActiveLogMeta(null)
      setTuningSegment(DEFAULT_TUNING_SEGMENT)
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
    setActiveLogMeta(null)
    setTuningSegment(DEFAULT_TUNING_SEGMENT)
    if (logId) {
      setChartHint('\u5df2\u5207\u6362\u65e5\u5fd7\uff0c\u8bf7\u70b9\u51fb\u6253\u5f00\u56fe\u8868\u6a21\u5757\u3002')
    } else {
      setChartHint('\u56fe\u8868\u7ec4\u4ef6\u5360\u4f4d\u533a')
    }
  }

  const handleSearch = async () => {
    await loadLogList({ page: 1, keyword: searchKeyword })
    setSeriesData([])
    setDiagnostics([])
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

  const handleRoleChange = (role: string) => {
    setViewRole(role)
    setSeriesData([])
    setTopicCharts([])
    setDiagnostics([])
    setActiveLogMeta(null)
    setTuningSegment(DEFAULT_TUNING_SEGMENT)
    setChartHint('\u89c6\u56fe\u89d2\u8272\u5df2\u5207\u6362\uff0c\u8bf7\u91cd\u65b0\u6253\u5f00\u56fe\u8868\u6a21\u5757\u3002')
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

    const finishLeftSelection = (clientX: number) => {
      if (!isLeftSelecting) return
      const rect = dom.getBoundingClientRect()
      const endX = Math.min(Math.max(clientX - rect.left, 0), rect.width)
      const delta = Math.abs(endX - selectStartX)
      isLeftSelecting = false

      // Left-drag box zoom on x-axis.
      if (delta > 8 && rect.width > 0) {
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
        isLeftSelecting = true
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
    }

    chartCleanupRef.current.set(chartKey, cleanup)
  }, [syncChartZoom])

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
          <UploadPanel
            selectedFileName={selectedFileName}
            isUploading={isUploading}
            statusText={statusText}
            onFileSelected={handleFileSelected}
            onUpload={handleUpload}
          />
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
              viewRole={viewRole}
              roleOptions={ROLE_OPTIONS}
              searchKeyword={searchKeyword}
              logList={logList}
              listPage={listPage}
              listPageCount={listPageCount}
              listTotal={listTotal}
              onRoleChange={handleRoleChange}
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
              tuningSegment={tuningSegment}
              onTuningSegmentChange={setTuningSegment}
            />
            <ChartPanel
              activeLogMeta={activeLogMeta}
              topicCharts={topicCharts}
              seriesData={seriesData}
              modeSegments={modeSegments}
              diagnostics={diagnostics}
              chartHint={chartHint}
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
