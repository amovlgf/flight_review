import { useEffect, useRef, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import './App.css'
import { fetchChartData, fetchLogList, uploadLogFile } from './services/api'

type ChartPoint = [number, number]

type ChartSeries = {
  name: string
  unit: string
  points: ChartPoint[]
}

type DiagnosticItem = {
  level: 'ok' | 'warning' | 'info'
  ruleCode: string
  title: string
  detail: string
}

type LogListItem = {
  logId: string
  fileName: string
  uploadedAt: string
}

type ActiveLogMeta = {
  logId: string
  fileName: string
  uploadedAt: string
}

type TopicChart = {
  topic: string
  title: string
  series: ChartSeries[]
}

const PAGE_SIZE = 8
const ROLE_OPTIONS = [
  { value: 'customer', label: '\u5ba2\u6237\u89c6\u56fe' },
  { value: 'aftersales', label: '\u552e\u540e\u89c6\u56fe' },
  { value: 'engineer', label: '\u7814\u53d1\u89c6\u56fe' },
]

function getSeriesDisplayName(name: string) {
  if (name === 'Altitude' || name === 'altitude') return '\u9ad8\u5ea6'
  if (name === 'Speed' || name === 'speed' || name === 'speed_3d')
    return '\u901f\u5ea6'
  if (name === 'Voltage') return '\u7535\u538b'
  if (name === 'voltage_v') return '\u7535\u538b'
  if (name === 'current_a') return '\u7535\u6d41'
  if (name === 'remaining') return '\u5269\u4f59\u7535\u91cf'
  if (name === 'temperature') return '\u6e29\u5ea6'
  if (name === 'discharged_mah') return '\u5df2\u8017\u7535\u91cf'
  if (name === 'roll') return '\u6eda\u8f6c\u89d2'
  if (name === 'pitch') return '\u4fef\u4ef0\u89d2'
  if (name === 'yaw') return '\u822a\u5411\u89d2'
  if (name === 'roll_sp') return '\u671f\u671b\u6eda\u8f6c\u89d2'
  if (name === 'pitch_sp') return '\u671f\u671b\u4fef\u4ef0\u89d2'
  if (name === 'yaw_sp') return '\u671f\u671b\u822a\u5411\u89d2'
  if (name === 'yaw_sp_move_rate') return '\u671f\u671b\u504f\u822a\u53d8\u5316\u7387'
  if (name === 'lat') return '\u7eac\u5ea6'
  if (name === 'lon') return '\u7ecf\u5ea6'
  if (name === 'alt') return 'GPS\u9ad8\u5ea6'
  if (name === 'alt_ellipsoid') return '\u692d\u7403\u9ad8'
  if (name === 'eph') return '\u6c34\u5e73\u7cbe\u5ea6'
  if (name === 'epv') return '\u5782\u76f4\u7cbe\u5ea6'
  if (name === 'fix_type') return '\u5b9a\u4f4d\u72b6\u6001'
  if (name === 'satellites_used') return '\u53ef\u89c1\u536b\u661f'
  if (name === 'vel_m_s') return 'GPS\u901f\u5ea6'
  if (name === 'vel_n_m_s') return '\u5317\u5411\u901f\u5ea6'
  if (name === 'vel_e_m_s') return '\u4e1c\u5411\u901f\u5ea6'
  if (name === 'vel_d_m_s') return '\u5929\u5411\u901f\u5ea6'
  if (name === 'q[0]') return 'q0'
  if (name === 'q[1]') return 'q1'
  if (name === 'q[2]') return 'q2'
  if (name === 'q[3]') return 'q3'
  if (name.startsWith('output[')) return `\u8f93\u51fa${name.slice(6)}`
  return name
}

function getDiagnosticZh(item: DiagnosticItem) {
  if (item.ruleCode === 'LOW_BATTERY') {
    return {
      title: '\u68c0\u6d4b\u5230\u7535\u6c60\u7535\u538b\u4e0b\u964d',
      detail: item.detail.replace('Minimum voltage', '\u6700\u4f4e\u7535\u538b'),
    }
  }
  if (item.ruleCode === 'BATTERY_NORMAL') {
    return {
      title: '\u7535\u6c60\u7535\u538b\u7a33\u5b9a',
      detail: item.detail.replace('Minimum voltage', '\u6700\u4f4e\u7535\u538b'),
    }
  }
  if (item.ruleCode === 'HIGH_SPEED') {
    return {
      title: '\u901f\u5ea6\u5cf0\u503c\u8d85\u8fc7\u9884\u671f\u8303\u56f4',
      detail: item.detail.replace('Peak speed', '\u901f\u5ea6\u5cf0\u503c'),
    }
  }
  if (item.ruleCode === 'SPEED_NORMAL') {
    return {
      title: '\u901f\u5ea6\u5904\u4e8e\u9884\u671f\u8303\u56f4',
      detail: item.detail.replace('Peak speed', '\u901f\u5ea6\u5cf0\u503c'),
    }
  }
  if (item.ruleCode === 'ALTITUDE_SUMMARY') {
    return {
      title: '\u9ad8\u5ea6\u6982\u89c8',
      detail: item.detail.replace('Maximum altitude', '\u6700\u5927\u9ad8\u5ea6'),
    }
  }

  return { title: item.title, detail: item.detail }
}

function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const chartCleanupRef = useRef<Map<string, () => void>>(new Map())
  const [selectedFileName, setSelectedFileName] = useState('')
  const [isUploading, setIsUploading] = useState(false)
  const [selectedLogId, setSelectedLogId] = useState('')
  const [statusText, setStatusText] = useState('')
  const [chartHint, setChartHint] = useState(
    '\u56fe\u8868\u7ec4\u4ef6\u5360\u4f4d\u533a',
  )
  const [seriesData, setSeriesData] = useState<ChartSeries[]>([])
  const [topicCharts, setTopicCharts] = useState<TopicChart[]>([])
  const [diagnostics, setDiagnostics] = useState<DiagnosticItem[]>([])
  const [logList, setLogList] = useState<LogListItem[]>([])
  const [activeLogMeta, setActiveLogMeta] = useState<ActiveLogMeta | null>(null)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [listPage, setListPage] = useState(1)
  const [listPageCount, setListPageCount] = useState(1)
  const [listTotal, setListTotal] = useState(0)
  const [viewRole, setViewRole] = useState('aftersales')

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
        items.some((item: LogListItem) => item.logId === options.preferLogId)
      ) {
        setSelectedLogId(options.preferLogId)
        return
      }

      if (!selectedLogId || !items.some((item: LogListItem) => item.logId === selectedLogId)) {
        setSelectedLogId(items[0].logId)
      }
    } catch {
      setLogList([])
    }
  }

  useEffect(() => {
    loadLogList({ page: 1, keyword: '' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleChooseFile = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setSelectedFileName(file.name)
    setStatusText('\u5df2\u9009\u62e9\u6587\u4ef6\uff0c\u8bf7\u70b9\u51fb\u4e0a\u4f20\u3002')
  }

  const handleUpload = async () => {
    const file = fileInputRef.current?.files?.[0]
    if (!file) {
      setStatusText('\u8bf7\u5148\u9009\u62e9\u65e5\u5fd7\u6587\u4ef6\u3002')
      return
    }

    try {
      setIsUploading(true)
      setStatusText('\u6b63\u5728\u4e0a\u4f20...')
      setSeriesData([])
      setTopicCharts([])
      setDiagnostics([])
      setChartHint('\u56fe\u8868\u7ec4\u4ef6\u5360\u4f4d\u533a')
      setActiveLogMeta(null)
      const uploadResult = await uploadLogFile(file)
      const logId =
        uploadResult && typeof uploadResult.logId === 'string'
          ? uploadResult.logId
          : ''
      if (logId) {
        setSelectedLogId(logId)
      }
      await loadLogList({ preferLogId: logId, page: 1, keyword: '' })
      setStatusText(
        logId
          ? `\u4e0a\u4f20\u6210\u529f\uff0c\u529f\u80fd 2 \u5df2\u89e3\u9501\uff08logId: ${logId}\uff09\u3002`
          : '\u4e0a\u4f20\u6210\u529f\uff0c\u529f\u80fd 2 \u5df2\u89e3\u9501\u3002',
      )
    } catch {
      setSeriesData([])
      setTopicCharts([])
      setDiagnostics([])
      setActiveLogMeta(null)
      setStatusText('\u4e0a\u4f20\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u540e\u7aef\u662f\u5426\u542f\u52a8\u3002')
    } finally {
      setIsUploading(false)
    }
  }

  const handleLoadChart = async () => {
    if (!selectedLogId) return

    try {
      const data = await fetchChartData(selectedLogId, viewRole)
      if (Array.isArray(data?.series) && data.series.length === 0) {
        setSeriesData([])
        setTopicCharts([])
        setChartHint(
          `\u5df2\u8c03\u7528\u56fe\u8868\u63a5\u53e3\uff08logId: ${selectedLogId}\uff09\uff1a\u5f53\u524d\u8fd4\u56de\u7a7a\u6570\u636e\uff08\u5360\u4f4d\uff09`,
        )
        return
      }
      const normalizedSeries = Array.isArray(data?.series) ? data.series : []
      const normalizedTopicCharts = Array.isArray(data?.topicCharts)
        ? data.topicCharts
        : []
      const normalizedDiagnostics = Array.isArray(data?.diagnostics)
        ? data.diagnostics
        : []
      setSeriesData(normalizedSeries)
      setTopicCharts(normalizedTopicCharts)
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
      setActiveLogMeta(null)
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
    setDiagnostics([])
    setActiveLogMeta(null)
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
    setChartHint('\u89c6\u56fe\u89d2\u8272\u5df2\u5207\u6362\uff0c\u8bf7\u91cd\u65b0\u6253\u5f00\u56fe\u8868\u6a21\u5757\u3002')
  }

  const buildTopicChartOption = (chart: TopicChart) => ({
    tooltip: { trigger: 'axis' },
    toolbox: {
      orient: 'vertical',
      right: 8,
      top: 84,
      feature: {
        dataZoom: {
          yAxisIndex: 'none',
          title: {
            zoom: '\u533a\u95f4\u7f29\u653e',
            back: '\u8fd8\u539f\u7f29\u653e',
          },
        },
        restore: { title: '\u8fd8\u539f' },
      },
    },
    legend: {
      type: 'scroll',
      top: 8,
      data: chart.series.map(
        (item) => `${getSeriesDisplayName(item.name)} (${item.unit})`,
      ),
    },
    grid: { left: 56, right: 76, top: 74, bottom: 64 },
    xAxis: {
      type: 'value',
      name: '\u65f6\u95f4 (s)',
      nameGap: 28,
      axisLabel: { margin: 12 },
    },
    yAxis: {
      type: 'value',
      name: '\u6570\u503c',
      nameGap: 22,
      axisLabel: { margin: 10 },
    },
    dataZoom: [
      {
        type: 'inside',
        xAxisIndex: 0,
        filterMode: 'none',
      },
      {
        type: 'slider',
        xAxisIndex: 0,
        filterMode: 'none',
        bottom: 16,
        height: 18,
      },
    ],
    series: chart.series.map((item) => ({
      name: `${getSeriesDisplayName(item.name)} (${item.unit})`,
      type: 'line',
      smooth: false,
      showSymbol: false,
      data: item.points,
    })),
  })

  const bindChartInteractions = (chartKey: string, chartInstance: any) => {
    const oldCleanup = chartCleanupRef.current.get(chartKey)
    if (oldCleanup) oldCleanup()

    const dom = chartInstance.getDom() as HTMLElement
    let isMiddleDragging = false
    let isLeftSelecting = false
    let lastClientX = 0
    let lastMiddleDownAt = 0
    let selectStartX = 0

    const applyDataZoom = (start: number, end: number) => {
      chartInstance.dispatchAction({
        type: 'dataZoom',
        dataZoomIndex: 0,
        start,
        end,
      })
      chartInstance.dispatchAction({
        type: 'dataZoom',
        dataZoomIndex: 1,
        start,
        end,
      })
    }

    const resetZoom = () => {
      applyDataZoom(0, 100)
      chartInstance.dispatchAction({ type: 'restore' })
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

      const deltaX = event.clientX - lastClientX
      lastClientX = event.clientX

      const zoomState = chartInstance.getOption()?.dataZoom?.[0]
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

    dom.addEventListener('mousedown', onMouseDown)
    dom.addEventListener('mousemove', onMouseMove)
    dom.addEventListener('mouseup', onMouseUp)
    dom.addEventListener('mouseleave', onMouseLeave)
    dom.addEventListener('auxclick', onAuxClick)
    window.addEventListener('mouseup', onWindowMouseUp)

    const cleanup = () => {
      dom.removeEventListener('mousedown', onMouseDown)
      dom.removeEventListener('mousemove', onMouseMove)
      dom.removeEventListener('mouseup', onMouseUp)
      dom.removeEventListener('mouseleave', onMouseLeave)
      dom.removeEventListener('auxclick', onAuxClick)
      window.removeEventListener('mouseup', onWindowMouseUp)
    }

    chartCleanupRef.current.set(chartKey, cleanup)
  }

  useEffect(() => {
    return () => {
      chartCleanupRef.current.forEach((cleanup) => cleanup())
      chartCleanupRef.current.clear()
    }
  }, [])

  return (
    <div className="app">
      <header className="header">
        <h1>{'\u98de\u884c\u65e5\u5fd7\u5e73\u53f0\uff08\u6846\u67b6\u7248\uff09'}</h1>
        <p>{'\u9879\u76ee\u7ed3\u6784\u5df2\u5c31\u7eea\uff0c\u5177\u4f53\u529f\u80fd\u5c06\u5728\u4e0b\u4e00\u6b65\u5b9e\u73b0\u3002'}</p>
      </header>

      <main className="grid">
        <section className="card">
          <h2>{'\u529f\u80fd 1\uff1a\u4e0a\u4f20\u98de\u884c\u65e5\u5fd7'}</h2>
          <ul>
            <li>{'\u524d\u7aef\u4e0a\u4f20\u5165\u53e3'}</li>
            <li>{'\u540e\u7aef\u6587\u4ef6\u63a5\u6536\u63a5\u53e3'}</li>
            <li>{'\u65e5\u5fd7\u89e3\u6790\u670d\u52a1\u5360\u4f4d'}</li>
          </ul>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden-input"
            onChange={handleFileChange}
          />
          <div className="actions">
            <button type="button" className="button" onClick={handleChooseFile}>
              {'\u9009\u62e9\u65e5\u5fd7\u6587\u4ef6'}
            </button>
            <button
              type="button"
              className="button"
              onClick={handleUpload}
              disabled={isUploading}
            >
              {isUploading ? '\u4e0a\u4f20\u4e2d...' : '\u4e0a\u4f20\u6587\u4ef6'}
            </button>
          </div>
          {selectedFileName && (
            <p className="hint">
              {'\u5df2\u9009\u6587\u4ef6\uff1a'}
              {selectedFileName}
            </p>
          )}
          {statusText && <p className="hint">{statusText}</p>}
        </section>

        <section className={`card ${selectedLogId ? '' : 'card-disabled'}`}>
          <h2>{'\u529f\u80fd 2\uff1a\u56fe\u8868\u5c55\u793a'}</h2>
          <ul>
            <li>{'\u65e5\u5fd7\u7b5b\u9009\u6761\u4ef6\u533a\u57df'}</li>
            <li>{'\u56fe\u8868\u5c55\u793a\u533a\u57df\uff08\u6298\u7ebf/\u67f1\u72b6\uff09'}</li>
            <li>{'\u56fe\u8868\u6570\u636e\u63a5\u53e3\u5360\u4f4d'}</li>
          </ul>
          <div className="actions">
            <select
              className="select role-select"
              value={viewRole}
              onChange={(event) => handleRoleChange(event.target.value)}
            >
              {ROLE_OPTIONS.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
            <input
              className="input"
              value={searchKeyword}
              onChange={(event) => setSearchKeyword(event.target.value)}
              placeholder={'\u6309\u6587\u4ef6\u540d\u641c\u7d22\u65e5\u5fd7'}
            />
            <button type="button" className="button" onClick={handleSearch}>
              {'\u641c\u7d22'}
            </button>
          </div>
          <div className="actions">
            <select
              className="select"
              value={selectedLogId}
              onChange={(event) => handleLogSelect(event.target.value)}
            >
              <option value="">
                {'\u8bf7\u9009\u62e9\u65e5\u5fd7'}
              </option>
              {logList.map((item) => (
                <option key={item.logId} value={item.logId}>
                  {`${item.fileName} (${new Date(item.uploadedAt).toLocaleString()})`}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="button"
              onClick={() => loadLogList({ preferLogId: selectedLogId })}
            >
              {'\u5237\u65b0\u65e5\u5fd7\u5217\u8868'}
            </button>
          </div>
          <div className="actions">
            <button
              type="button"
              className="button"
              disabled={listPage <= 1}
              onClick={handlePrevPage}
            >
              {'\u4e0a\u4e00\u9875'}
            </button>
            <button
              type="button"
              className="button"
              disabled={listPage >= listPageCount}
              onClick={handleNextPage}
            >
              {'\u4e0b\u4e00\u9875'}
            </button>
            <p className="hint-inline">
              {`\u7b2c ${listPage} / ${listPageCount} \u9875\uff0c\u5171 ${listTotal} \u6761`}
            </p>
          </div>
          <button
            type="button"
            className="button"
            onClick={handleLoadChart}
            disabled={!selectedLogId}
          >
            {selectedLogId
              ? '\u6253\u5f00\u56fe\u8868\u6a21\u5757'
              : '\u8bf7\u5148\u4e0a\u4f20\u6216\u9009\u62e9\u5386\u53f2\u65e5\u5fd7'}
          </button>
          {activeLogMeta && (
            <p className="hint">
              {`\u5f53\u524d\u5df2\u52a0\u8f7d\uff1a${activeLogMeta.fileName} (logId: ${activeLogMeta.logId})${
                activeLogMeta.uploadedAt
                  ? ` / ${new Date(activeLogMeta.uploadedAt).toLocaleString()}`
                  : ''
              }`}
            </p>
          )}
          {topicCharts.length > 0 ? (
            <div className="topic-chart-list">
              {topicCharts.map((topicChart) => (
                <div key={topicChart.topic} className="chart-wrap">
                  <h3 className="topic-title">{topicChart.title}</h3>
                  <ReactECharts
                    option={buildTopicChartOption(topicChart)}
                    style={{ height: 360 }}
                    onChartReady={(instance) =>
                      bindChartInteractions(topicChart.topic, instance)
                    }
                  />
                </div>
              ))}
            </div>
          ) : seriesData.length > 0 ? (
            <div className="chart-wrap">
              <ReactECharts
                option={buildTopicChartOption({
                  topic: 'default',
                  title: '\u9ed8\u8ba4\u56fe\u8868',
                  series: seriesData,
                })}
                style={{ height: 360 }}
                onChartReady={(instance) => bindChartInteractions('default', instance)}
              />
            </div>
          ) : (
            <div className="chart-placeholder">{chartHint}</div>
          )}
          {diagnostics.length > 0 && (
            <div className="diag-list">
              {diagnostics.map((item) => (
                <div key={item.ruleCode} className={`diag-item diag-${item.level}`}>
                  <strong>{getDiagnosticZh(item).title}</strong>
                  <p>{getDiagnosticZh(item).detail}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

export default App
