import { memo, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import ReactECharts from 'echarts-for-react'
import type {
  ControlQualityAxis,
  ControlQualityLoop,
  ControlQualityReport,
} from '../types/log'

type ControlQualityPanelProps = {
  report: ControlQualityReport | null
  isLoading: boolean
  errorText: string
  onApplyRange: (startS: number | null, endS: number | null) => void
  onExportCsv: () => void
}

const LOOP_LABELS: Record<string, string> = {
  actuator: '1. Actuator Output',
  rate: '2. Rate Loop',
  attitude: '3. Attitude Loop',
  velocity: '4. Velocity Loop',
  position: '5. Position Loop',
}

const LOOP_ORDER = ['actuator', 'rate', 'attitude', 'velocity', 'position'] as const

function formatMetric(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.abs(value) >= 100 ? value.toFixed(1) : value.toFixed(4)
  }
  if (typeof value === 'string' && value.length > 0) return value
  return '-'
}

function downloadText(fileName: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

function buildReportHtml(report: ControlQualityReport) {
  const hints = report.summary.main_hints
    .map((hint) => `<li>${hint}</li>`)
    .join('')
  const missingTopics = report.missing_topics
    .map((topic) => `<li>${topic}</li>`)
    .join('')

  return `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<title>Control Quality Report - ${report.log_file}</title>
<style>
body{font-family:Arial,sans-serif;line-height:1.5;margin:32px;color:#1f2937}
table{border-collapse:collapse;width:100%;margin:12px 0}
td,th{border:1px solid #d8dee9;padding:8px;text-align:left}
th{background:#f8fafc}
</style>
<h1>Control Quality Report</h1>
<p><strong>Log:</strong> ${report.log_file}</p>
<p><strong>Range:</strong> ${formatMetric(report.analysis_time_range.start_s)}s - ${formatMetric(report.analysis_time_range.end_s)}s</p>
<h2>Summary</h2>
<p>Available loops: ${report.summary.available_loops.join(', ') || '-'}</p>
<p>Unavailable loops: ${report.summary.unavailable_loops.join(', ') || '-'}</p>
<ul>${hints}</ul>
<h2>Missing Topics</h2>
<ul>${missingTopics || '<li>-</li>'}</ul>
</html>`
}

function buildSetpointFeedbackOption(
  title: string,
  unit: string,
  points: Array<[number, number, number]>,
) {
  return {
    backgroundColor: '#f7f9fc',
    tooltip: { trigger: 'axis' },
    legend: { top: 8, data: ['setpoint', 'feedback'] },
    grid: { left: 58, right: 24, top: 58, bottom: 44 },
    xAxis: { type: 'value', name: 'time (s)' },
    yAxis: { type: 'value', name: unit || 'value' },
    dataZoom: [{ type: 'inside' }, { type: 'slider', height: 16, bottom: 10 }],
    title: { text: title, left: 8, top: 8, textStyle: { fontSize: 13 } },
    series: [
      {
        name: 'setpoint',
        type: 'line',
        showSymbol: false,
        data: points.map((point) => [point[0], point[1]]),
        lineStyle: { color: '#f97316', width: 2.3 },
      },
      {
        name: 'feedback',
        type: 'line',
        showSymbol: false,
        data: points.map((point) => [point[0], point[2]]),
        lineStyle: { color: '#1d4ed8', width: 2.3 },
      },
    ],
  }
}

function buildErrorOption(title: string, unit: string, points: Array<[number, number]>) {
  return {
    backgroundColor: '#f7f9fc',
    tooltip: { trigger: 'axis' },
    grid: { left: 58, right: 24, top: 48, bottom: 44 },
    xAxis: { type: 'value', name: 'time (s)' },
    yAxis: { type: 'value', name: unit || 'error' },
    dataZoom: [{ type: 'inside' }, { type: 'slider', height: 16, bottom: 10 }],
    title: { text: title, left: 8, top: 8, textStyle: { fontSize: 13 } },
    series: [
      {
        name: 'error',
        type: 'line',
        showSymbol: false,
        data: points,
        lineStyle: { color: '#dc2626', width: 2 },
        markLine: {
          silent: true,
          symbol: 'none',
          data: [{ yAxis: 0 }],
          lineStyle: { color: '#64748b', type: 'dashed' },
        },
      },
    ],
  }
}

function MetricsTable({ axis }: { axis: ControlQualityAxis | null }) {
  const metrics = axis?.metrics || {}
  const rows = [
    ['RMSE', metrics.rmse],
    ['NRMSE', metrics.nrmse],
    ['Max Error', metrics.max_error],
    ['P95 Error', metrics.p95_error],
    ['P99 Error', metrics.p99_error],
    ['Delay', metrics.delay_s],
    ['Delay Status', metrics.delay_status],
    ['Setpoint Range', metrics.setpoint_range],
    ['Zero Crossing', metrics.zero_crossing_count],
    ['Error Diff Std', metrics.error_diff_std],
  ]

  return (
    <table className="control-quality-table">
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <th>{label}</th>
            <td>{formatMetric(value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ControlLoopCard({
  loopName,
  loop,
}: {
  loopName: string
  loop: ControlQualityLoop | undefined
}) {
  const axisNames = Object.keys(loop?.axis || {})
  const [selectedAxis, setSelectedAxis] = useState(axisNames[0] || '')
  const resolvedAxis = selectedAxis && loop?.axis ? loop.axis[selectedAxis] : null
  const chart = loop?.charts?.find((item) => item.axis === selectedAxis)

  return (
    <section className="control-quality-loop">
      <div className="control-quality-loop-head">
        <h4>{LOOP_LABELS[loopName] || loopName}</h4>
        <span className={`control-status control-status-${loop?.status || 'missing'}`}>
          {loop?.status || 'missing'}
        </span>
      </div>
      {axisNames.length > 0 ? (
        <label className="tuning-field control-quality-axis">
          <span className="tuning-subtitle">Axis</span>
          <select
            className="select tuning-select"
            value={selectedAxis}
            onChange={(event) => setSelectedAxis(event.target.value)}
          >
            {axisNames.map((axisName) => (
              <option key={axisName} value={axisName}>
                {axisName}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {resolvedAxis ? <MetricsTable axis={resolvedAxis} /> : null}
      {chart ? (
        <div className="control-quality-charts">
          <ReactECharts
            option={buildSetpointFeedbackOption(
              `${selectedAxis} setpoint vs feedback`,
              chart.unit,
              chart.setpointFeedback,
            )}
            lazyUpdate
            style={{ height: 260 }}
          />
          <ReactECharts
            option={buildErrorOption(`${selectedAxis} error`, chart.unit, chart.error)}
            lazyUpdate
            style={{ height: 240 }}
          />
        </div>
      ) : (
        <p className="hint">No curve is available for the selected axis.</p>
      )}
    </section>
  )
}

function ActuatorSummary({ loop }: { loop: ControlQualityLoop | undefined }) {
  if (!loop) return null
  const metrics = loop.metrics || {}
  return (
    <section className="control-quality-loop">
      <div className="control-quality-loop-head">
        <h4>{LOOP_LABELS.actuator}</h4>
        <span className={`control-status control-status-${loop.status}`}>
          {loop.status}
        </span>
      </div>
      <table className="control-quality-table">
        <tbody>
          {[
            ['sat_high_ratio', metrics.sat_high_ratio],
            ['sat_low_ratio', metrics.sat_low_ratio],
            ['mean_output', metrics.mean_output],
            ['max_output', metrics.max_output],
            ['min_output', metrics.min_output],
            ['output_std', metrics.output_std],
            ['motor_mean_spread_ratio', metrics.motor_mean_spread_ratio],
          ].map(([label, value]) => (
            <tr key={label}>
              <th>{label}</th>
              <td>{formatMetric(value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function ControlQualityPanel({
  report,
  isLoading,
  errorText,
  onApplyRange,
  onExportCsv,
}: ControlQualityPanelProps) {
  const initialStart = report?.analysis_time_range.start_s ?? ''
  const initialEnd = report?.analysis_time_range.end_s ?? ''
  const rangeKey = `${initialStart}-${initialEnd}`

  const reportFileStem = useMemo(
    () => (report?.log_file || 'control-quality').replace(/[^a-z0-9_.-]+/gi, '_'),
    [report?.log_file],
  )

  if (!report && !isLoading && !errorText) {
    return null
  }

  const handleApplyRange = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const start = Number(formData.get('startS'))
    const end = Number(formData.get('endS'))
    onApplyRange(
      Number.isFinite(start) ? start : null,
      Number.isFinite(end) ? end : null,
    )
  }

  const handleExportJson = () => {
    if (!report) return
    downloadText(
      `${reportFileStem}.control-quality.json`,
      JSON.stringify(report, null, 2),
      'application/json;charset=utf-8',
    )
  }

  const handleExportHtml = () => {
    if (!report) return
    downloadText(
      `${reportFileStem}.control-quality.html`,
      buildReportHtml(report),
      'text/html;charset=utf-8',
    )
  }

  return (
    <section className="control-quality-panel">
      <div className="page-title-row">
        <div>
          <h3>Control Loop Quality</h3>
          {report ? (
            <p className="hint">
              {`Range: ${formatMetric(report.analysis_time_range.start_s)}s - ${formatMetric(report.analysis_time_range.end_s)}s / ${report.analysis_time_range.source}`}
            </p>
          ) : null}
        </div>
        <div className="actions control-quality-actions">
          <button className="button" type="button" onClick={handleExportJson} disabled={!report}>
            Export JSON
          </button>
          <button className="button" type="button" onClick={onExportCsv} disabled={!report}>
            Export CSV
          </button>
          <button className="button" type="button" onClick={handleExportHtml} disabled={!report}>
            Export HTML
          </button>
        </div>
      </div>

      <form
        key={rangeKey}
        className="control-quality-range"
        onSubmit={handleApplyRange}
      >
        <label className="tuning-field">
          <span className="tuning-subtitle">start_s</span>
          <input
            name="startS"
            className="input tuning-input"
            defaultValue={String(initialStart)}
          />
        </label>
        <label className="tuning-field">
          <span className="tuning-subtitle">end_s</span>
          <input
            name="endS"
            className="input tuning-input"
            defaultValue={String(initialEnd)}
          />
        </label>
        <button className="button" type="submit">
          Recalculate
        </button>
      </form>

      {isLoading ? <p className="hint">Calculating control-loop metrics...</p> : null}
      {errorText ? <p className="hint control-quality-error">{errorText}</p> : null}

      {report ? (
        <>
          <div className="control-quality-summary">
            <div>
              <strong>Available</strong>
              <p>{report.summary.available_loops.join(', ') || '-'}</p>
            </div>
            <div>
              <strong>Unavailable</strong>
              <p>{report.summary.unavailable_loops.join(', ') || '-'}</p>
            </div>
          </div>
          <ul className="control-quality-hints">
            {report.summary.main_hints.map((hint) => (
              <li key={hint}>{hint}</li>
            ))}
          </ul>
          <div className="control-quality-loop-list">
            <ActuatorSummary loop={report.loops.actuator} />
            {LOOP_ORDER.filter((loopName) => loopName !== 'actuator').map((loopName) => (
              <ControlLoopCard
                key={loopName}
                loopName={loopName}
                loop={report.loops[loopName]}
              />
            ))}
          </div>
        </>
      ) : null}
    </section>
  )
}

export default memo(ControlQualityPanel)
