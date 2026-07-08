import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import EmbeddedSignalChart from './EmbeddedSignalChart'
import type { ChartSelectionPreview, ChartTimeRange } from './ChartPanel'
import { fetchFlightSummary, uploadLogFile } from '../services/api'
import type {
  FlightSummaryEmbeddedChart,
  FlightSummaryFailsafeEvent,
  FlightSummaryFlightStatus,
  FlightSummaryPhase,
  FlightSummaryResponse,
} from '../types/log'

type FlightSummaryPageProps = {
  selectionBox?: ChartSelectionPreview | null
  timelinePointer?: number | null
  isTimelinePlaying?: boolean
  isGlobalChartSyncEnabled: boolean
  onToggleGlobalChartSync: () => void
  onBackToHome: () => void
  onChartReady: (
    chartKey: string,
    instance: unknown,
    timeRange: ChartTimeRange,
  ) => void
  onChartDispose: (chartKey: string) => void
  onTimelineSeek: (timeValue: number) => void
  onToggleTimelinePlayback: () => void
}

type EmbeddedChartProps = Pick<
  FlightSummaryPageProps,
  | 'selectionBox'
  | 'timelinePointer'
  | 'isTimelinePlaying'
  | 'onChartReady'
  | 'onChartDispose'
  | 'onTimelineSeek'
  | 'onToggleTimelinePlayback'
>

function formatSeconds(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${value.toFixed(2)} s`
    : '-'
}

function formatBoolean(value: boolean | null | undefined) {
  if (value === true) return '是'
  if (value === false) return '否'
  return '-'
}

function formatList(values: string[]) {
  return values.length > 0 ? values.join('、') : '无'
}

function isUlgFile(file: File) {
  return file.name.toLowerCase().endsWith('.ulg')
}

function chartKeyFor(prefix: string, chart: FlightSummaryEmbeddedChart) {
  return `${prefix}__${chart.id}`
}

function ChartList({
  chartKeyPrefix,
  charts,
  selectionBox,
  timelinePointer,
  isTimelinePlaying,
  onChartReady,
  onChartDispose,
  onTimelineSeek,
  onToggleTimelinePlayback,
}: EmbeddedChartProps & {
  chartKeyPrefix: string
  charts: FlightSummaryEmbeddedChart[]
}) {
  if (charts.length === 0) {
    return <p className="hint">当前模块没有可用曲线。</p>
  }

  return (
    <div className="flight-summary-chart-list">
      {charts.map((chart) => (
        <EmbeddedSignalChart
          key={chart.id}
          chartKey={chartKeyFor(chartKeyPrefix, chart)}
          title={chart.title}
          series={chart.series}
          selectionBox={selectionBox}
          timelinePointer={timelinePointer}
          isTimelinePlaying={isTimelinePlaying}
          onChartReady={onChartReady}
          onChartDispose={onChartDispose}
          onTimelineSeek={onTimelineSeek}
          onToggleTimelinePlayback={onToggleTimelinePlayback}
        />
      ))}
    </div>
  )
}

function LogSummaryCard({ report }: { report: FlightSummaryResponse }) {
  const summary = report.summary

  return (
    <section className="flight-summary-panel">
      <div className="page-title-row">
        <div>
          <h3>日志摘要</h3>
          <p className="hint">{report.fileName}</p>
        </div>
        <span
          className={`control-status control-status-${
            report.dataGate.canAnalyze ? 'available' : 'unavailable'
          }`}
        >
          {report.dataGate.canAnalyze ? '可分析' : '数据不足'}
        </span>
      </div>
      <div className="flight-summary-grid">
        <div>
          <strong>飞行总时长</strong>
          <p>{formatSeconds(summary?.totalDurationS)}</p>
        </div>
        <div>
          <strong>解锁时间</strong>
          <p>{formatSeconds(summary?.armedAtS)}</p>
        </div>
        <div>
          <strong>起飞时间</strong>
          <p>{formatSeconds(summary?.takeoffAtS)}</p>
        </div>
        <div>
          <strong>降落时间</strong>
          <p>{formatSeconds(summary?.landingAtS)}</p>
        </div>
        <div>
          <strong>是否触发 failsafe</strong>
          <p>{formatBoolean(summary?.failsafeTriggered)}</p>
        </div>
        <div>
          <strong>数据完整性</strong>
          <p>{summary?.dataCompleteness === 'complete' ? '完整' : '部分受限'}</p>
        </div>
      </div>
    </section>
  )
}

function DataGateError({ report }: { report: FlightSummaryResponse }) {
  return (
    <section className="flight-summary-panel flight-summary-error">
      <div className="page-title-row">
        <div>
          <h3>数据不足，无法进入分析页面</h3>
          <p className="hint">当前日志不满足飞行摘要的基础条件。</p>
        </div>
        <span className="control-status control-status-unavailable">
          数据不足
        </span>
      </div>
      <ul className="flight-summary-list">
        {report.dataGate.blockingReasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
      <p className="hint">
        缺失必需字段：{formatList(report.dataGate.missingRequired)}
      </p>
    </section>
  )
}

function FlightPhaseItem({
  phase,
  chartProps,
}: {
  phase: FlightSummaryPhase
  chartProps: EmbeddedChartProps
}) {
  return (
    <section className="flight-summary-section">
      <div className="flight-summary-section-head">
        <div className="incident-event-icon" aria-label={phase.id}>
          {phase.name.slice(0, 1)}
        </div>
        <div>
          <h4>{phase.name}</h4>
          <p className="hint">
            {formatSeconds(phase.startS)} - {formatSeconds(phase.endS)} / 持续{' '}
            {formatSeconds(phase.durationS)}
          </p>
        </div>
        <span className="control-status control-status-available">
          {phase.modeChanges.length} 个模式
        </span>
      </div>
      <p className="hint">
        飞行模式：{formatList(phase.modeChanges.map((item) => item.mode))}
      </p>
      <ChartList
        chartKeyPrefix={`flight-summary__phase__${phase.id}`}
        charts={phase.charts}
        {...chartProps}
      />
    </section>
  )
}

function FlightPhasePanel({
  phases,
  chartProps,
}: {
  phases: FlightSummaryPhase[]
  chartProps: EmbeddedChartProps
}) {
  return (
    <section className="flight-summary-panel">
      <h3>飞行阶段</h3>
      <div className="flight-summary-stack">
        {phases.map((phase) => (
          <FlightPhaseItem key={phase.id} phase={phase} chartProps={chartProps} />
        ))}
      </div>
    </section>
  )
}

function FailsafeStatusCard({
  status,
  chartProps,
}: {
  status: FlightSummaryFlightStatus['failsafe']
  chartProps: EmbeddedChartProps
}) {
  const firstEvent: FlightSummaryFailsafeEvent | undefined = status.events[0]

  return (
    <section className="flight-summary-section">
      <div className="flight-summary-section-head">
        <div className="incident-event-icon" aria-label="failsafe">
          F
        </div>
        <div>
          <h4>故障保护状态</h4>
          <p className="hint">
            {status.triggered
              ? `首次触发：${formatSeconds(firstEvent?.startS)}`
              : '未检测到 failsafe 窗口'}
          </p>
        </div>
        <span
          className={`control-status control-status-${
            status.triggered ? 'unavailable' : 'available'
          }`}
        >
          {status.triggered ? '已触发' : '未触发'}
        </span>
      </div>
      {status.events.length > 0 ? (
        <table className="control-quality-table flight-summary-table">
          <thead>
            <tr>
              <th>触发时间</th>
              <th>结束时间</th>
              <th>阶段</th>
              <th>模式</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {status.events.map((event) => (
              <tr key={event.id}>
                <td>{formatSeconds(event.startS)}</td>
                <td>{formatSeconds(event.endS)}</td>
                <td>{event.phaseName}</td>
                <td>{event.mode}</td>
                <td>{formatList(event.activeFlags)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <ChartList
        chartKeyPrefix="flight-summary__failsafe"
        charts={status.charts}
        {...chartProps}
      />
    </section>
  )
}

function EstimatorStatusCard({
  status,
  chartProps,
}: {
  status: FlightSummaryFlightStatus['estimator']
  chartProps: EmbeddedChartProps
}) {
  return (
    <section className="flight-summary-section">
      <div className="flight-summary-section-head">
        <div className="incident-event-icon" aria-label="estimator">
          E
        </div>
        <div>
          <h4>传感器融合状态</h4>
          <p className="hint">
            GPS：{status.gpsStatus} / 高度源：{status.heightSource}
          </p>
        </div>
        <span className={`control-status control-status-${status.status}`}>
          {status.status}
        </span>
      </div>
      <div className="flight-summary-grid flight-summary-grid-compact">
        <div>
          <strong>本地位置有效</strong>
          <p>{formatBoolean(status.localPositionValid)}</p>
        </div>
        <div>
          <strong>全局位置有效</strong>
          <p>{formatBoolean(status.globalPositionValid)}</p>
        </div>
        <div>
          <strong>卫星数</strong>
          <p>{status.satellitesUsed ?? '-'}</p>
        </div>
      </div>
      <ChartList
        chartKeyPrefix="flight-summary__estimator"
        charts={status.charts}
        {...chartProps}
      />
    </section>
  )
}

function FlightStatusPanel({
  status,
  chartProps,
}: {
  status: FlightSummaryFlightStatus
  chartProps: EmbeddedChartProps
}) {
  return (
    <section className="flight-summary-panel">
      <h3>飞行状态</h3>
      <div className="flight-summary-stack">
        <FailsafeStatusCard status={status.failsafe} chartProps={chartProps} />
        <EstimatorStatusCard status={status.estimator} chartProps={chartProps} />
      </div>
    </section>
  )
}

function DataLimitationPanel({ report }: { report: FlightSummaryResponse }) {
  return (
    <section className="flight-summary-panel">
      <h3>数据限制</h3>
      <div className="flight-summary-grid">
        <div>
          <strong>缺失必需字段</strong>
          <p>{formatList(report.dataGate.missingRequired)}</p>
        </div>
        <div>
          <strong>缺失可选字段</strong>
          <p>{formatList(report.dataGate.missingOptional)}</p>
        </div>
      </div>
      {report.dataGate.limitations.length > 0 ? (
        <ul className="flight-summary-list">
          {report.dataGate.limitations.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

function ReportExportButton({ report }: { report: FlightSummaryResponse }) {
  const handleExport = () => {
    if (!report.reportMarkdown) return
    const blob = new Blob([report.reportMarkdown], {
      type: 'text/markdown;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${report.fileName || 'flight-log'}-summary.md`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <button
      type="button"
      className="button"
      onClick={handleExport}
      disabled={!report.reportMarkdown}
    >
      导出简短报告
    </button>
  )
}

function FlightSummaryPage({
  selectionBox,
  timelinePointer,
  isTimelinePlaying = false,
  isGlobalChartSyncEnabled,
  onToggleGlobalChartSync,
  onBackToHome,
  onChartReady,
  onChartDispose,
  onTimelineSeek,
  onToggleTimelinePlayback,
}: FlightSummaryPageProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [statusText, setStatusText] = useState('')
  const [report, setReport] = useState<FlightSummaryResponse | null>(null)
  const [errorText, setErrorText] = useState('')

  const chartProps: EmbeddedChartProps = {
    selectionBox,
    timelinePointer,
    isTimelinePlaying,
    onChartReady,
    onChartDispose,
    onTimelineSeek,
    onToggleTimelinePlayback,
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null
    setSelectedFile(file)
    setReport(null)
    setErrorText('')
    setStatusText(file ? `已选择文件：${file.name}` : '')
  }

  const handleUpload = async () => {
    if (!selectedFile) {
      setStatusText('请先选择一份 .ulg 日志。')
      return
    }
    if (!isUlgFile(selectedFile)) {
      setStatusText('功能 1 仅支持上传 .ulg 日志。')
      return
    }

    try {
      setIsUploading(true)
      setErrorText('')
      setReport(null)
      setStatusText('正在上传并生成飞行摘要...')
      const uploadResult = await uploadLogFile(selectedFile)
      const summary = await fetchFlightSummary(uploadResult.logId)
      setReport(summary)
      setStatusText(
        summary.dataGate.canAnalyze
          ? '飞行摘要已生成。'
          : '日志已解析，但数据不足，无法进入正常摘要展示。',
      )
    } catch (error) {
      const detail = error instanceof Error ? error.message : ''
      setErrorText(
        detail
          ? `飞行摘要生成失败：${detail}`
          : '飞行摘要生成失败，请确认后端已启动且日志格式有效。',
      )
      setStatusText('')
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <section className="card flight-summary-page">
      <div className="page-title-row">
        <div>
          <h2>功能 1：飞行日志摘要</h2>
          <p className="hint">
            上传单份 .ulg 日志，整理飞行阶段、飞行状态和简短报告。
          </p>
        </div>
        <div className="actions control-quality-page-actions">
          <button
            type="button"
            className={`button chart-sync-button${
              isGlobalChartSyncEnabled ? ' chart-sync-button-active' : ''
            }`}
            onClick={onToggleGlobalChartSync}
            aria-pressed={isGlobalChartSyncEnabled}
          >
            {isGlobalChartSyncEnabled
              ? '全局图表联动：已开启'
              : '开启全局图表联动'}
          </button>
          <button type="button" className="button" onClick={onBackToHome}>
            返回功能列表
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        className="hidden-input"
        accept=".ulg"
        onChange={handleFileChange}
      />
      <div className="control-analysis-toolbar">
        <div className="actions control-analysis-actions">
          <button
            type="button"
            className="button"
            onClick={() => fileInputRef.current?.click()}
          >
            选择日志文件
          </button>
          <button
            type="button"
            className="button"
            onClick={handleUpload}
            disabled={isUploading || !selectedFile}
          >
            {isUploading ? '上传中...' : '上传并生成摘要'}
          </button>
        </div>
        <span
          className={`control-analysis-status control-analysis-status-${
            report ? 'done' : 'idle'
          }`}
        >
          {isUploading ? '分析中' : report ? '摘要完成' : '等待日志'}
        </span>
      </div>
      {statusText ? <p className="hint">{statusText}</p> : null}
      {errorText ? <p className="hint control-quality-error">{errorText}</p> : null}

      {report && !report.dataGate.canAnalyze ? (
        <>
          <LogSummaryCard report={report} />
          <DataGateError report={report} />
          <DataLimitationPanel report={report} />
        </>
      ) : null}

      {report && report.dataGate.canAnalyze && report.flightStatus ? (
        <div className="flight-summary-stack">
          <LogSummaryCard report={report} />
          <FlightPhasePanel phases={report.phases} chartProps={chartProps} />
          <FlightStatusPanel status={report.flightStatus} chartProps={chartProps} />
          <DataLimitationPanel report={report} />
          <div className="actions">
            <ReportExportButton report={report} />
          </div>
        </div>
      ) : null}
    </section>
  )
}

export default FlightSummaryPage
