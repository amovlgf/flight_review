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
  actuator: '1. 执行器输出',
  rate: '2. 角速度环',
  attitude: '3. 姿态环',
  velocity: '4. 速度环',
  position: '5. 位置环',
}

const LOOP_SHORT_LABELS: Record<string, string> = {
  actuator: '执行器输出',
  rate: '角速度环',
  attitude: '姿态环',
  velocity: '速度环',
  position: '位置环',
}

const AXIS_LABELS: Record<string, string> = {
  roll: '横滚',
  pitch: '俯仰',
  yaw: '偏航',
  vx: '北向速度 vx',
  vy: '东向速度 vy',
  vz: '地向速度 vz',
  x: '北向位置 x',
  y: '东向位置 y',
  z: '地向位置 z',
  xy: '水平位置 xy',
}

const STATUS_LABELS: Record<string, string> = {
  available: '可分析',
  unavailable: '不可用',
  topic_missing: 'topic 缺失',
  field_missing: '字段缺失',
  not_enough_data: '数据不足',
  not_enough_excitation: '激励不足',
  invalid: '无效',
  ok: '正常',
  missing: '缺失',
  low: '低',
  medium: '中',
  high: '高',
}

const SOURCE_LABELS: Record<string, string> = {
  auto_trim_5_percent: '自动排除前后 5%',
  all_available_data: '全部可用数据',
  manual: '手动区间',
  auto: '自动区间',
}

const HINT_LABELS: Record<string, string> = {
  'Position tracking error is more prominent than velocity tracking. Review position setpoint smoothness and local position jumps.':
    '位置跟踪误差相对更明显，建议检查位置期望值是否平滑，以及本地位置反馈是否存在跳变。',
  'Actuator output reaches the reference saturation band in this log. Treat inner-loop conclusions with reduced confidence.':
    '执行器输出触及参考饱和区间，内环结论需要降低可信度。',
  'Feedback jumps or spikes were detected. Control-loop metrics may be affected by estimator or sensor data quality.':
    '反馈数据存在跳变或尖峰，控制环指标可能受到估计器或传感器数据质量影响。',
  'No cross-loop phenomenon hint was generated from the available metrics.':
    '当前可用指标未生成跨环路现象提示。',
}

const LOOP_ORDER = ['actuator', 'rate', 'attitude', 'velocity', 'position'] as const
type MetricRow = [string, string, unknown]

function formatStatus(value: string | null | undefined) {
  if (!value) return '-'
  return STATUS_LABELS[value] || value
}

function formatLoopName(value: string) {
  return LOOP_SHORT_LABELS[value] || value
}

function formatAxisName(value: string) {
  return AXIS_LABELS[value] || value
}

function formatSource(value: string) {
  return SOURCE_LABELS[value] || value
}

function formatHint(value: string) {
  return HINT_LABELS[value] || value
}

function formatLoopList(values: string[]) {
  return values.map(formatLoopName).join('、') || '-'
}

function formatMetric(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.abs(value) >= 100 ? value.toFixed(1) : value.toFixed(4)
  }
  if (typeof value === 'string' && value.length > 0) return formatStatus(value)
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
    .map((hint) => `<li>${formatHint(hint)}</li>`)
    .join('')
  const missingTopics = report.missing_topics
    .map((topic) => `<li>${topic}</li>`)
    .join('')

  return `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<title>控制效果分析报告 - ${report.log_file}</title>
<style>
body{font-family:Arial,sans-serif;line-height:1.5;margin:32px;color:#1f2937}
table{border-collapse:collapse;width:100%;margin:12px 0}
td,th{border:1px solid #d8dee9;padding:8px;text-align:left}
th{background:#f8fafc}
</style>
<h1>控制效果分析报告</h1>
<p><strong>日志文件：</strong> ${report.log_file}</p>
<p><strong>分析区间：</strong> ${formatMetric(report.analysis_time_range.start_s)}s - ${formatMetric(report.analysis_time_range.end_s)}s</p>
<h2>总览</h2>
<p>可分析环路：${formatLoopList(report.summary.available_loops)}</p>
<p>不可用环路：${formatLoopList(report.summary.unavailable_loops)}</p>
<ul>${hints}</ul>
<h2>缺失 topic</h2>
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
    legend: { top: 8, data: ['期望值', '实际值'] },
    grid: { left: 58, right: 24, top: 58, bottom: 44 },
    xAxis: { type: 'value', name: '时间 (s)' },
    yAxis: { type: 'value', name: unit || '数值' },
    dataZoom: [{ type: 'inside' }, { type: 'slider', height: 16, bottom: 10 }],
    title: { text: title, left: 8, top: 8, textStyle: { fontSize: 13 } },
    series: [
      {
        name: '期望值',
        type: 'line',
        showSymbol: false,
        data: points.map((point) => [point[0], point[1]]),
        lineStyle: { color: '#f97316', width: 2.3 },
      },
      {
        name: '实际值',
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
    xAxis: { type: 'value', name: '时间 (s)' },
    yAxis: { type: 'value', name: unit || '误差' },
    dataZoom: [{ type: 'inside' }, { type: 'slider', height: 16, bottom: 10 }],
    title: { text: title, left: 8, top: 8, textStyle: { fontSize: 13 } },
    series: [
      {
        name: '误差',
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

function CollapsibleMetricTable({
  rows,
  title = '指标表',
}: {
  rows: MetricRow[]
  title?: string
}) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="control-quality-metrics">
      <button
        type="button"
        className="button control-quality-collapse-button"
        onClick={() => setIsOpen((current) => !current)}
        aria-expanded={isOpen}
      >
        {isOpen ? `收起${title}` : `展开${title}`}
      </button>
      {isOpen ? (
        <table className="control-quality-table">
          <thead>
            <tr>
              <th>指标</th>
              <th>中文含义</th>
              <th>数值</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, description, value]) => (
              <tr key={label}>
                <th>{label}</th>
                <td>{description}</td>
                <td>{formatMetric(value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  )
}

function MetricsTable({ axis }: { axis: ControlQualityAxis | null }) {
  const metrics = axis?.metrics || {}
  const rows: MetricRow[] = [
    ['分析状态', '当前轴是否具备足够的期望值和实际值用于计算。', axis?.status],
    ['平均绝对误差 MAE', '期望值与实际值偏差绝对值的平均水平，越小表示跟随越贴近。', metrics.mae],
    ['均方根误差 RMSE', '对较大误差更敏感的整体跟随误差，越小越好。', metrics.rmse],
    ['归一化均方根误差 NRMSE', '按信号幅度归一化后的 RMSE，便于不同轴或不同环路比较。', metrics.nrmse],
    ['最大误差', '分析区间内出现过的最大瞬时跟随偏差。', metrics.max_error],
    ['P95 误差', '95% 样本不超过的误差水平，用于观察大部分时间的跟随质量。', metrics.p95_error],
    ['P99 误差', '99% 样本不超过的误差水平，用于观察少量尖峰误差。', metrics.p99_error],
    ['估计延迟 (s)', '通过期望值与实际值相关性估算的响应滞后时间。', metrics.delay_s],
    ['延迟状态', '延迟估算是否可信，例如数据不足或激励不足时会标记不可用。', metrics.delay_status],
    ['期望值变化范围', '分析区间内期望值的最大变化幅度，用于判断激励是否充分。', metrics.setpoint_range],
    ['误差过零次数', '误差符号切换次数，过多可能说明震荡或超调较明显。', metrics.zero_crossing_count],
    ['误差变化标准差', '相邻误差变化量的离散程度，用于观察误差抖动。', metrics.error_diff_std],
  ]

  return <CollapsibleMetricTable rows={rows} />
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
          {formatStatus(loop?.status || 'missing')}
        </span>
      </div>
      {axisNames.length > 0 ? (
        <label className="tuning-field control-quality-axis">
          <span className="tuning-subtitle">分析轴</span>
          <select
            className="select tuning-select"
            value={selectedAxis}
            onChange={(event) => setSelectedAxis(event.target.value)}
          >
            {axisNames.map((axisName) => (
              <option key={axisName} value={axisName}>
                {formatAxisName(axisName)}
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
              `${formatAxisName(selectedAxis)} 期望值 / 实际值`,
              chart.unit,
              chart.setpointFeedback,
            )}
            lazyUpdate
            style={{ height: 260 }}
          />
          <ReactECharts
            option={buildErrorOption(`${formatAxisName(selectedAxis)} 误差`, chart.unit, chart.error)}
            lazyUpdate
            style={{ height: 240 }}
          />
        </div>
      ) : (
        <p className="hint">当前分析轴没有可用曲线。</p>
      )}
    </section>
  )
}

function ActuatorSummary({ loop }: { loop: ControlQualityLoop | undefined }) {
  if (!loop) return null
  const metrics = loop.metrics || {}
  const rows: MetricRow[] = [
    ['分析状态', '执行器输出 topic 是否存在且包含可用输出通道。', loop.status],
    ['上限饱和比例', '输出接近上限的样本比例，越高说明执行器余量越小。', metrics.sat_high_ratio],
    ['下限饱和比例', '输出接近下限的样本比例，越高说明低端饱和越明显。', metrics.sat_low_ratio],
    ['平均输出', '所有可用执行器通道的平均输出水平。', metrics.mean_output],
    ['最大输出', '分析区间内执行器输出的最大值。', metrics.max_output],
    ['最小输出', '分析区间内执行器输出的最小值。', metrics.min_output],
    ['输出标准差', '执行器输出波动程度，数值越大表示变化越剧烈。', metrics.output_std],
    ['电机平均输出差异比例', '不同电机平均输出的相对差异，用于观察负载或配平不均。', metrics.motor_mean_spread_ratio],
  ]

  return (
    <section className="control-quality-loop">
      <div className="control-quality-loop-head">
        <h4>{LOOP_LABELS.actuator}</h4>
        <span className={`control-status control-status-${loop.status}`}>
          {formatStatus(loop.status)}
        </span>
      </div>
      <CollapsibleMetricTable rows={rows} />
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
          <h3>控制环质量</h3>
          {report ? (
            <p className="hint">
              {`分析区间：${formatMetric(report.analysis_time_range.start_s)}s - ${formatMetric(report.analysis_time_range.end_s)}s / ${formatSource(report.analysis_time_range.source)}`}
            </p>
          ) : null}
        </div>
        <div className="actions control-quality-actions">
          <button className="button" type="button" onClick={handleExportJson} disabled={!report}>
            导出 JSON
          </button>
          <button className="button" type="button" onClick={onExportCsv} disabled={!report}>
            导出 CSV
          </button>
          <button className="button" type="button" onClick={handleExportHtml} disabled={!report}>
            导出 HTML
          </button>
        </div>
      </div>

      <form
        key={rangeKey}
        className="control-quality-range"
        onSubmit={handleApplyRange}
      >
        <label className="tuning-field">
          <span className="tuning-subtitle">开始时间 (s)</span>
          <input
            name="startS"
            className="input tuning-input"
            defaultValue={String(initialStart)}
          />
        </label>
        <label className="tuning-field">
          <span className="tuning-subtitle">结束时间 (s)</span>
          <input
            name="endS"
            className="input tuning-input"
            defaultValue={String(initialEnd)}
          />
        </label>
        <button className="button" type="submit">
          重新计算
        </button>
      </form>

      {isLoading ? <p className="hint">正在计算控制环指标...</p> : null}
      {errorText ? <p className="hint control-quality-error">{errorText}</p> : null}

      {report ? (
        <>
          <div className="control-quality-summary">
            <div>
              <strong>可分析环路</strong>
              <p>{formatLoopList(report.summary.available_loops)}</p>
            </div>
            <div>
              <strong>不可用环路</strong>
              <p>{formatLoopList(report.summary.unavailable_loops)}</p>
            </div>
          </div>
          <ul className="control-quality-hints">
            {report.summary.main_hints.map((hint) => (
              <li key={hint}>{formatHint(hint)}</li>
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
