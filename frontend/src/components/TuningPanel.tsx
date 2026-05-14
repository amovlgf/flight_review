import { useMemo, useState } from 'react'
import {
  calculateTuningMetrics,
  calculateTuningProposal,
  calculateTuningReview,
} from '../services/api'
import type {
  TuningAxis,
  TuningGainKey,
  TuningLoop,
  TuningMetrics,
  TuningMetricsResponse,
  TuningParamNames,
  TuningPidValues,
  TuningProposalBoundsMap,
  TuningProposalCurrentParams,
  TuningProposalGainKey,
  TuningProposalResponse,
  TuningReviewResponse,
  TuningRiskLevel,
  TuningSafetyBounds,
} from '../types/tuning'
import {
  buildTuningMarkdownReport,
  downloadMarkdownReport,
} from '../utils/tuningReport'
import {
  buildPx4ParamsFile,
  downloadPx4ParamsFile,
  getPx4ParamsExportHint,
  shouldAllowParamsExport,
} from '../utils/px4ParamsExport'

type TuningPanelProps = {
  selectedLogId?: string
}

type MetricDescriptor = {
  key: keyof TuningMetrics
  label: string
  format: (value: number | null) => string
}

type NumericProposalInputs =
  | {
      currentParams: TuningProposalCurrentParams
      bounds: TuningProposalBoundsMap
      error: null
    }
  | {
      currentParams: null
      bounds: null
      error: string
    }

const AXIS_OPTIONS: Array<{ value: TuningAxis; label: string }> = [
  { value: 'roll', label: 'roll' },
  { value: 'pitch', label: 'pitch' },
  { value: 'yaw', label: 'yaw' },
]

const LOOP_OPTIONS: Array<{ value: TuningLoop; label: string }> = [
  { value: 'rate', label: 'rate' },
  { value: 'attitude', label: 'attitude' },
]

const GAIN_KEYS: TuningGainKey[] = ['P', 'I', 'D']
const PROPOSAL_GAIN_KEYS: TuningProposalGainKey[] = ['p', 'i', 'd']

const METRIC_ROWS: MetricDescriptor[] = [
  {
    key: 'trackingErrorRms',
    label: 'RMS 误差',
    format: (value) => formatMetricValue(value, { digits: 4 }),
  },
  {
    key: 'trackingErrorPeak',
    label: '峰值误�?',
    format: (value) => formatMetricValue(value, { digits: 4 }),
  },
  {
    key: 'overshootPercent',
    label: '超调�?',
    format: (value) => formatMetricValue(value, { digits: 2, suffix: '%' }),
  },
  {
    key: 'settlingTimeS',
    label: '调节时间',
    format: (value) => formatMetricValue(value, { digits: 3, suffix: ' s' }),
  },
  {
    key: 'phaseDelayMs',
    label: '相位延迟',
    format: (value) => formatMetricValue(value, { digits: 2, suffix: ' ms' }),
  },
  {
    key: 'dominantOscillationHz',
    label: '主振荡频�?',
    format: (value) => formatMetricValue(value, { digits: 3, suffix: ' Hz' }),
  },
  {
    key: 'oscillationScore',
    label: '振荡评分',
    format: (value) => formatMetricValue(value, { digits: 4 }),
  },
  {
    key: 'actuatorSaturationRatio',
    label: '执行器饱和率',
    format: (value) =>
      formatMetricValue(value === null ? null : value * 100, {
        digits: 2,
        suffix: '%',
      }),
  },
  {
    key: 'motorClippingDurationS',
    label: '电机剪切持续时间',
    format: (value) => formatMetricValue(value, { digits: 3, suffix: ' s' }),
  },
]

const PROPOSAL_STATUS_LABELS = {
  proposal_generated: '已生成候选参�?',
  no_change: '保持不变',
  rejected: '已拒�?',
} as const

const REVIEW_STATUS_MESSAGES = {
  rejected: '不建议采用该参数建议�?',
  manual_review_required: '需要人工复核�?',
  approved_for_sitl_only: '仅建议用�? SITL 或受控测试，不可直接用于实机�?',
} as const

const REVIEW_STATUS_LABELS = {
  rejected: '已拒�?',
  manual_review_required: '需要人工复�?',
  approved_for_sitl_only: '仅限 SITL / 受控测试',
} as const

const RISK_LEVEL_LABELS = {
  low: '低风�?',
  medium: '中风�?',
  high: '高风�?',
} as const

function formatMetricValue(
  value: number | null,
  options?: {
    digits?: number
    suffix?: string
  },
) {
  if (value === null || !Number.isFinite(value)) {
    return '暂无数据'
  }

  const digits = options?.digits ?? 3
  const suffix = options?.suffix ?? ''
  return `${value.toFixed(digits)}${suffix}`
}

function formatProposalNumber(value: number) {
  if (!Number.isFinite(value)) {
    return '暂无数据'
  }

  return value.toFixed(6).replace(/\.?0+$/, '')
}

function formatPercentValue(value: number) {
  if (!Number.isFinite(value)) {
    return '暂无数据'
  }

  const prefix = value > 0 ? '+' : ''
  return `${prefix}${value.toFixed(2).replace(/\.?0+$/, '')}%`
}

function getParameterNames(axis: TuningAxis, loop: TuningLoop): TuningParamNames {
  if (loop === 'attitude') {
    if (axis === 'roll') {
      return { P: 'MC_ROLL_P', I: null, D: null }
    }
    if (axis === 'pitch') {
      return { P: 'MC_PITCH_P', I: null, D: null }
    }
    return { P: 'MC_YAW_P', I: null, D: null }
  }

  if (axis === 'roll') {
    return {
      P: 'MC_ROLLRATE_P',
      I: 'MC_ROLLRATE_I',
      D: 'MC_ROLLRATE_D',
    }
  }

  if (axis === 'pitch') {
    return {
      P: 'MC_PITCHRATE_P',
      I: 'MC_PITCHRATE_I',
      D: 'MC_PITCHRATE_D',
    }
  }

  return {
    P: 'MC_YAWRATE_P',
    I: 'MC_YAWRATE_I',
    D: 'MC_YAWRATE_D',
  }
}

function createEmptyPidValues(): TuningPidValues {
  return {
    P: '',
    I: '',
    D: '',
  }
}

function createEmptySafetyBounds(): TuningSafetyBounds {
  return {
    P: { min: '', max: '', maxStepPercent: '' },
    I: { min: '', max: '', maxStepPercent: '' },
    D: { min: '', max: '', maxStepPercent: '' },
  }
}

function parseNumericInput(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null

  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function buildNumericProposalInputs(
  pidValues: TuningPidValues,
  safetyBounds: TuningSafetyBounds,
): NumericProposalInputs {
  const currentParams = {
    p: parseNumericInput(pidValues.P),
    i: parseNumericInput(pidValues.I),
    d: parseNumericInput(pidValues.D),
  }
  const bounds = {
    p: {
      min: parseNumericInput(safetyBounds.P.min),
      max: parseNumericInput(safetyBounds.P.max),
      maxStepPercent: parseNumericInput(safetyBounds.P.maxStepPercent),
    },
    i: {
      min: parseNumericInput(safetyBounds.I.min),
      max: parseNumericInput(safetyBounds.I.max),
      maxStepPercent: parseNumericInput(safetyBounds.I.maxStepPercent),
    },
    d: {
      min: parseNumericInput(safetyBounds.D.min),
      max: parseNumericInput(safetyBounds.D.max),
      maxStepPercent: parseNumericInput(safetyBounds.D.maxStepPercent),
    },
  }

  const hasInvalidCurrentParams = PROPOSAL_GAIN_KEYS.some(
    (key) => currentParams[key] === null,
  )
  const hasInvalidBounds = PROPOSAL_GAIN_KEYS.some((key) => {
    const bound = bounds[key]
    return (
      bound.min === null ||
      bound.max === null ||
      bound.maxStepPercent === null ||
      bound.max < bound.min ||
      bound.maxStepPercent < 0
    )
  })

  if (hasInvalidCurrentParams || hasInvalidBounds) {
    return {
      currentParams: null,
      bounds: null,
      error: '请先填写有效的当�? PID 参数和安全边界�?',
    }
  }

  return {
    currentParams: {
      p: currentParams.p ?? 0,
      i: currentParams.i ?? 0,
      d: currentParams.d ?? 0,
    },
    bounds: {
      p: {
        min: bounds.p.min ?? 0,
        max: bounds.p.max ?? 0,
        maxStepPercent: bounds.p.maxStepPercent ?? 0,
      },
      i: {
        min: bounds.i.min ?? 0,
        max: bounds.i.max ?? 0,
        maxStepPercent: bounds.i.maxStepPercent ?? 0,
      },
      d: {
        min: bounds.d.min ?? 0,
        max: bounds.d.max ?? 0,
        maxStepPercent: bounds.d.maxStepPercent ?? 0,
      },
    },
    error: null,
  }
}

function getRiskAlertClass(riskLevel: TuningRiskLevel) {
  if (riskLevel === 'high') return 'tuning-alert-risk'
  if (riskLevel === 'medium') return 'tuning-alert-warning'
  return 'tuning-alert-info'
}

function buildReportFilename(axis: TuningAxis, loop: TuningLoop) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `px4_pid_tuning_report_${axis}_${loop}_${timestamp}.md`
}

function buildParamsFilename(axis: TuningAxis, loop: TuningLoop) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `px4_pid_tuning_${axis}_${loop}_${timestamp}.params`
}

function TuningPanel({ selectedLogId }: TuningPanelProps) {
  const [axis, setAxis] = useState<TuningAxis>('roll')
  const [loop, setLoop] = useState<TuningLoop>('rate')
  const [pidValues, setPidValues] = useState<TuningPidValues>(createEmptyPidValues)
  const [safetyBounds, setSafetyBounds] = useState<TuningSafetyBounds>(
    createEmptySafetyBounds,
  )
  const [segmentStartS, setSegmentStartS] = useState('0')
  const [segmentEndS, setSegmentEndS] = useState('10')

  const tuningInputKey = useMemo(
    () => [selectedLogId ?? '', axis, loop, segmentStartS, segmentEndS].join('|'),
    [selectedLogId, axis, loop, segmentStartS, segmentEndS],
  )

  const [isCalculatingMetrics, setIsCalculatingMetrics] = useState(false)
  const [metricsError, setMetricsError] = useState('')
  const [metricsErrorKey, setMetricsErrorKey] = useState<string | null>(null)
  const [metricsResult, setMetricsResult] = useState<TuningMetricsResponse | null>(
    null,
  )
  const [metricsValidKey, setMetricsValidKey] = useState<string | null>(null)

  const [isGeneratingProposal, setIsGeneratingProposal] = useState(false)
  const [proposalError, setProposalError] = useState('')
  const [proposalErrorKey, setProposalErrorKey] = useState<string | null>(null)
  const [proposalResult, setProposalResult] = useState<TuningProposalResponse | null>(
    null,
  )
  const [proposalValidKey, setProposalValidKey] = useState<string | null>(null)

  const [isReviewing, setIsReviewing] = useState(false)
  const [reviewError, setReviewError] = useState('')
  const [reviewErrorKey, setReviewErrorKey] = useState<string | null>(null)
  const [reviewResult, setReviewResult] = useState<TuningReviewResponse | null>(null)
  const [reviewValidKey, setReviewValidKey] = useState<string | null>(null)

  const activeMetricsResult =
    metricsValidKey === tuningInputKey ? metricsResult : null
  const activeMetricsError =
    metricsErrorKey === tuningInputKey ? metricsError : ''
  const activeProposalResult =
    proposalValidKey === tuningInputKey ? proposalResult : null
  const activeProposalError =
    proposalErrorKey === tuningInputKey ? proposalError : ''
  const activeReviewResult =
    reviewValidKey === tuningInputKey ? reviewResult : null
  const activeReviewError =
    reviewErrorKey === tuningInputKey ? reviewError : ''

  const parameterNames = getParameterNames(axis, loop)
  const hasSelectedLog = Boolean(selectedLogId)
  const hasMetrics = Boolean(activeMetricsResult)
  const hasProposal = Boolean(activeProposalResult)
  const hasActuatorRisk =
    (activeMetricsResult?.metrics.actuatorSaturationRatio ?? 0) > 0.05
  const canExportParams = shouldAllowParamsExport({
    proposal: activeProposalResult,
    review: activeReviewResult,
  })

  const paramsExportHint = getPx4ParamsExportHint({
    proposal: activeProposalResult,
    review: activeReviewResult,
  })

  const handlePidChange = (gain: TuningGainKey, value: string) => {
    setPidValues((current) => ({
      ...current,
      [gain]: value,
    }))
    setProposalError('')
    setProposalErrorKey(null)
    setProposalResult(null)
    setProposalValidKey(null)
    setReviewError('')
    setReviewErrorKey(null)
    setReviewResult(null)
    setReviewValidKey(null)
  }

  const handleSafetyBoundChange = (
    gain: TuningGainKey,
    field: keyof TuningSafetyBounds[TuningGainKey],
    value: string,
  ) => {
    setSafetyBounds((current) => ({
      ...current,
      [gain]: {
        ...current[gain],
        [field]: value,
      },
    }))
    setProposalError('')
    setProposalErrorKey(null)
    setProposalResult(null)
    setProposalValidKey(null)
    setReviewError('')
    setReviewErrorKey(null)
    setReviewResult(null)
    setReviewValidKey(null)
  }

  const handleCalculateMetrics = async () => {
    const requestKey = tuningInputKey
    if (!selectedLogId) {
      setMetricsError('����ѡ����־')
      setMetricsErrorKey(requestKey)
      return
    }

    const segmentStartValue = Number(segmentStartS)
    const segmentEndValue = Number(segmentEndS)
    const segment =
      segmentStartS.trim() || segmentEndS.trim()
        ? {
            ...(segmentStartS.trim() && Number.isFinite(segmentStartValue)
              ? { startS: segmentStartValue }
              : {}),
            ...(segmentEndS.trim() && Number.isFinite(segmentEndValue)
              ? { endS: segmentEndValue }
              : {}),
          }
        : undefined

    try {
      setIsCalculatingMetrics(true)
      setMetricsError('')
      setMetricsErrorKey(null)
      setProposalError('')
      setProposalErrorKey(null)
      setProposalResult(null)
      setProposalValidKey(null)
      setReviewError('')
      setReviewErrorKey(null)
      setReviewResult(null)
      setReviewValidKey(null)

      const result = await calculateTuningMetrics({
        logId: selectedLogId,
        axis,
        loop,
        ...(segment && Object.keys(segment).length > 0 ? { segment } : {}),
      })
      setMetricsResult(result)
      setMetricsValidKey(requestKey)
    } catch (error) {
      setMetricsResult(null)
      setMetricsValidKey(null)
      setMetricsError(
        error instanceof Error
          ? error.message
          : '����ָ�����ʧ�ܣ����Ժ����ԡ�',
      )
      setMetricsErrorKey(requestKey)
    } finally {
      setIsCalculatingMetrics(false)
    }
  }

  const handleGenerateProposal = async () => {
    const requestKey = tuningInputKey
    const stableMetrics =
      metricsValidKey === tuningInputKey ? metricsResult : null
    if (!stableMetrics) {
      setProposalError('���ȼ������ָ��')
      setProposalErrorKey(requestKey)
      return
    }

    const numericInputs = buildNumericProposalInputs(pidValues, safetyBounds)
    if (numericInputs.error || !numericInputs.currentParams || !numericInputs.bounds) {
      setProposalError(
        numericInputs.error ?? '������д��Ч�ĵ�ǰ PID �����Ͱ�ȫ�߽硣',
      )
      setProposalErrorKey(requestKey)
      setProposalResult(null)
      setProposalValidKey(null)
      setReviewError('')
      setReviewErrorKey(null)
      setReviewResult(null)
      setReviewValidKey(null)
      return
    }

    const currentParams = numericInputs.currentParams
    const bounds = numericInputs.bounds

    try {
      setIsGeneratingProposal(true)
      setProposalError('')
      setProposalErrorKey(null)
      setReviewError('')
      setReviewErrorKey(null)
      setReviewResult(null)
      setReviewValidKey(null)

      const result = await calculateTuningProposal({
        axis,
        loop,
        currentParams,
        bounds,
        metrics: stableMetrics.metrics,
      })
      setProposalResult(result)
      setProposalValidKey(requestKey)
    } catch (error) {
      setProposalResult(null)
      setProposalValidKey(null)
      setProposalError(
        error instanceof Error
          ? error.message
          : '��ѡ��������ʧ�ܣ����Ժ����ԡ�',
      )
      setProposalErrorKey(requestKey)
    } finally {
      setIsGeneratingProposal(false)
    }
  }

  const handleReviewProposal = async () => {
    const requestKey = tuningInputKey
    const stableMetrics =
      metricsValidKey === tuningInputKey ? metricsResult : null
    const stableProposal =
      proposalValidKey === tuningInputKey ? proposalResult : null
    if (!stableProposal || !stableMetrics) {
      setReviewError('�������ɺ�ѡ������')
      setReviewErrorKey(requestKey)
      return
    }

    const numericInputs = buildNumericProposalInputs(pidValues, safetyBounds)
    if (numericInputs.error || !numericInputs.currentParams || !numericInputs.bounds) {
      setReviewError(
        numericInputs.error ?? '������д��Ч�ĵ�ǰ PID �����Ͱ�ȫ�߽硣',
      )
      setReviewErrorKey(requestKey)
      setReviewResult(null)
      setReviewValidKey(null)
      return
    }

    const currentParams = numericInputs.currentParams
    const bounds = numericInputs.bounds

    try {
      setIsReviewing(true)
      setReviewError('')
      setReviewErrorKey(null)

      const result = await calculateTuningReview({
        axis,
        loop,
        stage: 'offline_log_review',
        vehicle: {
          type: 'multicopter',
          frame: 'quad_x',
        },
        currentParams,
        bounds,
        metrics: stableMetrics.metrics,
        proposal: stableProposal,
      })
      setReviewResult(result)
      setReviewValidKey(requestKey)
    } catch (error) {
      setReviewResult(null)
      setReviewValidKey(null)
      setReviewError(
        error instanceof Error
          ? error.message
          : 'Safety / AI Review ʧ�ܣ����Ժ����ԡ�',
      )
      setReviewErrorKey(requestKey)
    } finally {
      setIsReviewing(false)
    }
  }

  const handleExportReport = () => {
    if (!activeMetricsResult) return

    const markdown = buildTuningMarkdownReport({
      axis,
      loop,
      generatedAt: new Date().toISOString(),
      parameterNames,
      pidValues,
      safetyBounds,
      metricsResult: activeMetricsResult,
      proposalResult: activeProposalResult,
      reviewResult: activeReviewResult,
    })
    downloadMarkdownReport(markdown, buildReportFilename(axis, loop))
  }

  const handleExportPx4Params = () => {
    if (!activeProposalResult || !canExportParams) return

    const content = buildPx4ParamsFile({
      axis,
      loop,
      proposal: activeProposalResult,
      review: activeReviewResult,
    })
    downloadPx4ParamsFile(content, buildParamsFilename(axis, loop))
  }

  return (
    <section className="chart-wrap tuning-panel">
      <div className="page-title-row">
        <h3 className="topic-title">{'PID Tuning Assistant'}</h3>
      </div>

      <p className="hint">
        {'当前仅支持离线日志分析，不会写入飞控参数�?'}
      </p>
      {selectedLogId ? (
        <p className="hint">{`当前关联日志�?${selectedLogId}`}</p>
      ) : (
        <p className="hint tuning-note">{'请先选择日志'}</p>
      )}

      <div className="tuning-grid">
        <label className="tuning-field">
          <span className="series-selector-label">{'axis'}</span>
          <select
            className="select tuning-select"
            value={axis}
            onChange={(event) => setAxis(event.target.value as TuningAxis)}
          >
            {AXIS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="tuning-field">
          <span className="series-selector-label">{'loop'}</span>
          <select
            className="select tuning-select"
            value={loop}
            onChange={(event) => setLoop(event.target.value as TuningLoop)}
          >
            {LOOP_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="tuning-section">
        <h4 className="tuning-subtitle">{'分析片段（秒�?'}</h4>
        <div className="tuning-grid">
          <label className="tuning-field">
            <span className="series-selector-label">{'startS'}</span>
            <input
              type="number"
              step="any"
              className="input tuning-input"
              value={segmentStartS}
              onChange={(event) => setSegmentStartS(event.target.value)}
              placeholder="0"
            />
          </label>

          <label className="tuning-field">
            <span className="series-selector-label">{'endS'}</span>
            <input
              type="number"
              step="any"
              className="input tuning-input"
              value={segmentEndS}
              onChange={(event) => setSegmentEndS(event.target.value)}
              placeholder="10"
            />
          </label>
        </div>
      </div>

      <div className="tuning-section">
        <h4 className="tuning-subtitle">{'当前 PID'}</h4>
        <div className="tuning-grid tuning-grid-compact">
          {GAIN_KEYS.map((gain) => (
            <label key={gain} className="tuning-field">
              <span className="series-selector-label">{gain}</span>
              <span className="tuning-param-name">
                {parameterNames[gain] ?? '暂不生成对应参数'}
              </span>
              <input
                type="number"
                step="any"
                className="input tuning-input"
                value={pidValues[gain]}
                onChange={(event) => handlePidChange(gain, event.target.value)}
                placeholder={`Current ${gain}`}
              />
            </label>
          ))}
        </div>
      </div>

      {loop === 'attitude' && (
        <p className="hint tuning-note">
          {'attitude loop 暂仅支持指标分析，不生成自动参数建议�?'}
        </p>
      )}

      <div className="tuning-section">
        <h4 className="tuning-subtitle">{'安全边界'}</h4>
        <div className="tuning-bounds-table">
          <div className="tuning-bounds-row tuning-bounds-header">
            <span>{'Param'}</span>
            <span>{'Min'}</span>
            <span>{'Max'}</span>
            <span>{'Max Step %'}</span>
          </div>

          {GAIN_KEYS.map((gain) => (
            <div key={gain} className="tuning-bounds-row">
              <span className="series-selector-label">{gain}</span>
              <input
                type="number"
                step="any"
                className="input tuning-input"
                value={safetyBounds[gain].min}
                onChange={(event) =>
                  handleSafetyBoundChange(gain, 'min', event.target.value)
                }
                placeholder="min"
              />
              <input
                type="number"
                step="any"
                className="input tuning-input"
                value={safetyBounds[gain].max}
                onChange={(event) =>
                  handleSafetyBoundChange(gain, 'max', event.target.value)
                }
                placeholder="max"
              />
              <input
                type="number"
                step="any"
                className="input tuning-input"
                value={safetyBounds[gain].maxStepPercent}
                onChange={(event) =>
                  handleSafetyBoundChange(
                    gain,
                    'maxStepPercent',
                    event.target.value,
                  )
                }
                placeholder="%"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="actions tuning-actions">
        <button
          type="button"
          className="button"
          disabled={!hasSelectedLog || isCalculatingMetrics}
          onClick={() => void handleCalculateMetrics()}
        >
          {isCalculatingMetrics ? '计算�?...' : '计算跟随指标'}
        </button>
        <button
          type="button"
          className="button"
          disabled={!hasMetrics || isGeneratingProposal}
          onClick={() => void handleGenerateProposal()}
        >
          {isGeneratingProposal ? '生成�?...' : '生成候选参�?'}
        </button>
        <button
          type="button"
          className="button"
          disabled={!hasProposal || isReviewing}
          onClick={() => void handleReviewProposal()}
        >
          {isReviewing ? '审查�?...' : 'AI 审查建议'}
        </button>
        <button
          type="button"
          className="button"
          disabled={!hasMetrics}
          onClick={handleExportReport}
        >
          {'导出 Markdown 报告'}
        </button>
        <button
          type="button"
          className="button"
          disabled={!canExportParams}
          onClick={handleExportPx4Params}
        >
          {'导出 PX4 参数文件'}
        </button>
      </div>

      {!hasMetrics ? <p className="hint">{'请先计算跟随指标'}</p> : null}
      {!hasProposal ? <p className="hint">{'请先生成候选参�?'}</p> : null}
      {!canExportParams && paramsExportHint ? (
        <p className="hint">{paramsExportHint}</p>
      ) : null}

      <div className="tuning-section">
        <div className="page-title-row">
          <h4 className="tuning-subtitle">{'跟随性能指标'}</h4>
          {activeMetricsResult ? (
            <p className="hint-inline">
              {`最近一次计算：${activeMetricsResult.axis} / ${activeMetricsResult.loop}`}
            </p>
          ) : null}
        </div>

        {activeMetricsError ? (
          <div className="tuning-alert tuning-alert-error" role="alert">
            {activeMetricsError}
          </div>
        ) : null}

        {activeMetricsResult?.warnings.length ? (
          <div className="tuning-alert tuning-alert-warning" role="status">
            <strong>{'注意�?'}</strong>
            <ul className="tuning-alert-list">
              {activeMetricsResult.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {hasActuatorRisk ? (
          <div className="tuning-alert tuning-alert-risk" role="status">
            {
              '执行器饱和比例较高，后续调参规则应禁止增�? P/I/D 增益�?'
            }
          </div>
        ) : null}

        {activeMetricsResult ? (
          <div className="tuning-metrics-table">
            <div className="tuning-metrics-row tuning-metrics-header">
              <span>{'指标'}</span>
              <span>{'结果'}</span>
            </div>
            {METRIC_ROWS.map((metric) => (
              <div key={metric.key} className="tuning-metrics-row">
                <span className="series-selector-label">{metric.label}</span>
                <span>{metric.format(activeMetricsResult.metrics[metric.key])}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="hint">
            {'点击“计算跟随指标”后将在这里显示结果�?'}
          </p>
        )}
      </div>

      <div className="tuning-section">
        <div className="page-title-row">
          <h4 className="tuning-subtitle">{'候�? PID 参数'}</h4>
          {activeProposalResult ? (
            <p className="hint-inline">
              {`状态：${PROPOSAL_STATUS_LABELS[activeProposalResult.status]}`}
            </p>
          ) : null}
        </div>

        {activeProposalError ? (
          <div className="tuning-alert tuning-alert-error" role="alert">
            {activeProposalError}
          </div>
        ) : null}

        {activeProposalResult?.status === 'rejected' ? (
          <div className="tuning-alert tuning-alert-risk" role="status">
            {'当前数据不适合生成 PID 增益增加建议�?'}
          </div>
        ) : null}

        {activeProposalResult?.status === 'no_change' ? (
          <div className="tuning-alert tuning-alert-info" role="status">
            {'没有足够证据建议修改参数�?'}
          </div>
        ) : null}

        {activeProposalResult?.warnings.length ? (
          <div className="tuning-alert tuning-alert-warning" role="status">
            <strong>{'注意�?'}</strong>
            <ul className="tuning-alert-list">
              {activeProposalResult.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {activeProposalResult ? (
          <>
            <div className="tuning-metrics-table">
              <div className="tuning-metrics-row tuning-metrics-header">
                <span>{'参数�?'}</span>
                <span>{'PX4 参数�?'}</span>
              </div>
              {PROPOSAL_GAIN_KEYS.map((key) => (
                <div key={key} className="tuning-metrics-row">
                  <span className="series-selector-label">{key.toUpperCase()}</span>
                  <span>{activeProposalResult.parameterNames[key] ?? '暂无映射'}</span>
                </div>
              ))}
            </div>

            <div className="tuning-proposal-stack">
              <div className="tuning-section">
                <h5 className="tuning-subtitle">{'建议调整'}</h5>
                {activeProposalResult.changes.length ? (
                  <div className="tuning-proposal-list">
                    {activeProposalResult.changes.map((change) => (
                      <div key={change.parameter} className="tuning-proposal-card">
                        <p className="tuning-proposal-line">
                          <strong>{change.parameter}</strong>
                          <span>
                            {`${formatProposalNumber(change.from)} �? ${formatProposalNumber(change.to)} (${formatPercentValue(change.changePercent)})`}
                          </span>
                        </p>
                        <p className="hint">{`原因�?${change.reason}`}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="hint">{'当前没有新的参数调整建议�?'}</p>
                )}
              </div>

              <div className="tuning-section">
                <h5 className="tuning-subtitle">{'保持不变'}</h5>
                {activeProposalResult.unchanged.length ? (
                  <div className="tuning-proposal-list">
                    {activeProposalResult.unchanged.map((item) => (
                      <div key={item.parameter} className="tuning-proposal-card">
                        <p className="tuning-proposal-line">
                          <strong>{item.parameter}</strong>
                          <span>{formatProposalNumber(item.value)}</span>
                        </p>
                        <p className="hint">{`原因�?${item.reason}`}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="hint">{'当前没有保持不变的参数条目�?'}</p>
                )}
              </div>
            </div>
          </>
        ) : (
          <p className="hint">
            {'点击“生成候选参数”后将在这里显示候�? PID 结果�?'}
          </p>
        )}
      </div>

      <div className="tuning-section">
        <div className="page-title-row">
          <h4 className="tuning-subtitle">{'Safety / AI Review'}</h4>
          {activeReviewResult ? (
            <p className="hint-inline">
              {`状态：${REVIEW_STATUS_LABELS[activeReviewResult.reviewStatus]} / 风险�?${RISK_LEVEL_LABELS[activeReviewResult.riskLevel]}`}
            </p>
          ) : null}
        </div>

        {activeReviewError ? (
          <div className="tuning-alert tuning-alert-error" role="alert">
            {activeReviewError}
          </div>
        ) : null}

        {activeReviewResult ? (
          <>
            <div
              className={`tuning-alert ${getRiskAlertClass(activeReviewResult.riskLevel)}`}
              role="status"
            >
              {REVIEW_STATUS_MESSAGES[activeReviewResult.reviewStatus]}
            </div>

            <div className="tuning-proposal-stack">
              <div className="tuning-proposal-card">
                <p className="tuning-proposal-line">
                  <strong>{'Summary'}</strong>
                  <span>{RISK_LEVEL_LABELS[activeReviewResult.riskLevel]}</span>
                </p>
                <p className="hint">{activeReviewResult.summary}</p>
              </div>

              <div className="tuning-section">
                <h5 className="tuning-subtitle">{'Concerns'}</h5>
                {activeReviewResult.concerns.length ? (
                  <div className="tuning-proposal-list">
                    {activeReviewResult.concerns.map((concern) => (
                      <div key={concern} className="tuning-proposal-card">
                        <p className="hint">{concern}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="hint">{'当前没有额外 concern�?'}</p>
                )}
              </div>

              <div className="tuning-section">
                <h5 className="tuning-subtitle">{'Recommendations'}</h5>
                {activeReviewResult.recommendations.length ? (
                  <div className="tuning-proposal-list">
                    {activeReviewResult.recommendations.map((recommendation) => (
                      <div key={recommendation} className="tuning-proposal-card">
                        <p className="hint">{recommendation}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="hint">{'当前没有额外 recommendation�?'}</p>
                )}
              </div>
            </div>

            {activeReviewResult.warnings.length ? (
              <div className="tuning-alert tuning-alert-warning" role="status">
                <strong>{'注意�?'}</strong>
                <ul className="tuning-alert-list">
                  {activeReviewResult.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        ) : (
          <p className="hint">
            {'点击“AI 审查建议”后将在这里显示 Safety / AI Review 结果�?'}
          </p>
        )}
      </div>

      <p className="hint">
        {
          '当前版本仅接入离线指标计算、保守候选参数生成、Safety / AI Review、Markdown 报告导出与受�? PX4 参数文件导出，不包含自动写入飞控�?'
        }
      </p>
    </section>
  )
}

export default TuningPanel
