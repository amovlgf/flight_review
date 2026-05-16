import type {
  TuningAxis,
  TuningSegmentQualityMetrics,
  TuningSegmentQualityResult,
  TuningSeriesPoint,
} from '../types/tuning'

type EvaluatePidSegmentQualityInput = {
  axis: TuningAxis
  startS: number | null
  endS: number | null
  actualSeries: TuningSeriesPoint[] | null | undefined
  setpointSeries: TuningSeriesPoint[] | null | undefined
}

const MIN_DURATION_S = 1
const MAX_DURATION_S = 30
const MIN_SAMPLE_COUNT = 10
const MIN_SETPOINT_RANGE_DEG = 2
const SMALL_SETPOINT_RANGE_DEG = 8
const GOOD_SETPOINT_RANGE_DEG = 5
const LARGE_PEAK_ERROR_DEG = 20

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function clampScore(value: number) {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.min(100, Math.max(0, Math.round(value)))
}

function normalizeSeries(
  series: TuningSeriesPoint[] | null | undefined,
): TuningSeriesPoint[] {
  if (!Array.isArray(series)) {
    return []
  }

  return series
    .filter(
      (point): point is TuningSeriesPoint =>
        Boolean(point) &&
        isFiniteNumber(point.timeS) &&
        isFiniteNumber(point.value),
    )
    .map((point) => ({ timeS: point.timeS, value: point.value }))
    .sort((left, right) => left.timeS - right.timeS)
}

function filterSeriesBySegment(
  series: TuningSeriesPoint[],
  startS: number,
  endS: number,
) {
  return series.filter((point) => point.timeS >= startS && point.timeS <= endS)
}

function computeRange(points: TuningSeriesPoint[]) {
  if (points.length === 0) {
    return null
  }

  let min = points[0].value
  let max = points[0].value

  for (const point of points) {
    if (point.value < min) min = point.value
    if (point.value > max) max = point.value
  }

  const range = max - min
  return Number.isFinite(range) ? range : null
}

function findNearestValue(
  series: TuningSeriesPoint[],
  timeS: number,
): number | null {
  if (series.length === 0) {
    return null
  }

  let low = 0
  let high = series.length - 1

  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const middleTime = series[middle].timeS

    if (middleTime === timeS) {
      return series[middle].value
    }

    if (middleTime < timeS) {
      low = middle + 1
    } else {
      high = middle - 1
    }
  }

  const next = series[Math.min(low, series.length - 1)]
  const prev = series[Math.max(high, 0)]

  if (!next) return prev?.value ?? null
  if (!prev) return next.value

  return Math.abs(next.timeS - timeS) < Math.abs(timeS - prev.timeS)
    ? next.value
    : prev.value
}

function computeErrorMetrics(
  actualSeries: TuningSeriesPoint[],
  setpointSeries: TuningSeriesPoint[],
) {
  if (actualSeries.length === 0 || setpointSeries.length === 0) {
    return {
      rmsErrorDeg: null,
      peakErrorDeg: null,
    }
  }

  const baseSeries =
    setpointSeries.length <= actualSeries.length ? setpointSeries : actualSeries
  const lookupSeries =
    baseSeries === setpointSeries ? actualSeries : setpointSeries

  let sumSquares = 0
  let peakError = 0
  let sampleCount = 0

  for (const point of baseSeries) {
    const nearestValue = findNearestValue(lookupSeries, point.timeS)
    if (!isFiniteNumber(nearestValue)) {
      continue
    }

    const error =
      baseSeries === setpointSeries
        ? nearestValue - point.value
        : point.value - nearestValue

    if (!Number.isFinite(error)) {
      continue
    }

    const absError = Math.abs(error)
    sumSquares += error * error
    if (absError > peakError) {
      peakError = absError
    }
    sampleCount += 1
  }

  if (sampleCount === 0) {
    return {
      rmsErrorDeg: null,
      peakErrorDeg: null,
    }
  }

  const rmsErrorDeg = Math.sqrt(sumSquares / sampleCount)
  return {
    rmsErrorDeg: Number.isFinite(rmsErrorDeg) ? rmsErrorDeg : null,
    peakErrorDeg: Number.isFinite(peakError) ? peakError : null,
  }
}

function createMetrics(
  durationS: number | null,
  setpointRangeDeg: number | null,
  actualRangeDeg: number | null,
  sampleCount: number,
  rmsErrorDeg: number | null,
  peakErrorDeg: number | null,
): TuningSegmentQualityMetrics {
  return {
    durationS: isFiniteNumber(durationS) ? durationS : null,
    setpointRangeDeg: isFiniteNumber(setpointRangeDeg) ? setpointRangeDeg : null,
    actualRangeDeg: isFiniteNumber(actualRangeDeg) ? actualRangeDeg : null,
    sampleCount: Number.isFinite(sampleCount) ? sampleCount : 0,
    rmsErrorDeg: isFiniteNumber(rmsErrorDeg) ? rmsErrorDeg : null,
    peakErrorDeg: isFiniteNumber(peakErrorDeg) ? peakErrorDeg : null,
  }
}

export function evaluatePidSegmentQuality({
  axis,
  startS,
  endS,
  actualSeries,
  setpointSeries,
}: EvaluatePidSegmentQualityInput): TuningSegmentQualityResult {
  if (
    !isFiniteNumber(startS) ||
    !isFiniteNumber(endS) ||
    startS >= endS
  ) {
    return {
      status: 'unknown',
      score: 0,
      summary: '暂无有效分析片段。',
      reasons: ['当前尚未选择有效的时间片段。'],
      recommendations: ['请在图表中框选一个有效的分析片段。'],
      metrics: createMetrics(null, null, null, 0, null, null),
    }
  }

  const normalizedActualSeries = normalizeSeries(actualSeries)
  const normalizedSetpointSeries = normalizeSeries(setpointSeries)
  const actualInSegment = filterSeriesBySegment(
    normalizedActualSeries,
    startS,
    endS,
  )
  const setpointInSegment = filterSeriesBySegment(
    normalizedSetpointSeries,
    startS,
    endS,
  )

  const durationS = endS - startS
  const sampleCount = Math.min(actualInSegment.length, setpointInSegment.length)
  const setpointRangeDeg = computeRange(setpointInSegment)
  const actualRangeDeg = computeRange(actualInSegment)
  const { rmsErrorDeg, peakErrorDeg } = computeErrorMetrics(
    actualInSegment,
    setpointInSegment,
  )

  const metrics = createMetrics(
    durationS,
    setpointRangeDeg,
    actualRangeDeg,
    sampleCount,
    rmsErrorDeg,
    peakErrorDeg,
  )

  const reasons: string[] = []
  const recommendations: string[] = []
  let score = 100
  let hasBadCondition = false
  let hasWarningCondition = false

  if (durationS < MIN_DURATION_S) {
    hasBadCondition = true
    score -= 65
    reasons.push('片段时间过短，无法可靠评估姿态跟随。')
    recommendations.push('请框选至少 1 秒以上且包含完整打杆响应的片段。')
  } else if (durationS > MAX_DURATION_S) {
    hasWarningCondition = true
    score -= 15
    reasons.push('片段时间较长，可能混入多次动作或飞行状态变化。')
    recommendations.push('建议只框选一次明确打杆动作及其恢复过程。')
  } else {
    reasons.push('当前片段长度适中。')
  }

  if (sampleCount < MIN_SAMPLE_COUNT) {
    hasBadCondition = true
    score -= 55
    reasons.push('片段内有效数据点不足。')
    recommendations.push('请选择数据更完整的时间段。')
  } else {
    reasons.push('片段内数据点数量满足初步分析要求。')
  }

  if (setpointRangeDeg === null) {
    hasBadCondition = true
    score -= 60
    reasons.push(`当前 ${axis} 轴缺少有效的期望角度数据。`)
    recommendations.push('请检查所选轴是否有对应的期望角度曲线。')
  } else if (setpointRangeDeg < MIN_SETPOINT_RANGE_DEG) {
    hasBadCondition = true
    score -= 70
    reasons.push('该片段期望角度变化过小，不适合评估 PID 跟随。')
    recommendations.push('请框选包含明显 roll / pitch / yaw 指令变化的片段。')
  } else if (setpointRangeDeg < SMALL_SETPOINT_RANGE_DEG) {
    hasWarningCondition = true
    score -= 20
    reasons.push('该片段期望角度变化可用于初步分析，但动作幅度偏小。')
    recommendations.push('建议选择幅度更明显的指令变化片段，以便估计超调与调节时间。')
  } else {
    reasons.push('该片段包含明显期望角度变化。')
  }

  if (actualRangeDeg === null) {
    hasBadCondition = true
    score -= 55
    reasons.push(`当前 ${axis} 轴缺少有效的实际角度数据。`)
    recommendations.push('请检查姿态实际角度数据是否完整。')
  } else {
    reasons.push('实际角度数据完整，可用于跟随分析。')
  }

  if (
    setpointRangeDeg !== null &&
    setpointRangeDeg >= GOOD_SETPOINT_RANGE_DEG &&
    actualRangeDeg !== null &&
    actualRangeDeg < setpointRangeDeg * 0.2
  ) {
    if (actualRangeDeg < Math.max(1, setpointRangeDeg * 0.1)) {
      hasBadCondition = true
      score -= 35
    } else {
      hasWarningCondition = true
      score -= 25
    }
    reasons.push('期望角度变化明显，但实际角度响应较弱。')
    recommendations.push('检查是否选错轴、数据是否异常，或控制响应是否受限。')
  }

  if (peakErrorDeg !== null && peakErrorDeg > LARGE_PEAK_ERROR_DEG) {
    hasWarningCondition = true
    score -= 15
    reasons.push('片段内峰值跟随误差较大。')
    recommendations.push('建议确认是否包含异常动作、强扰动或模式切换。')
  }

  const status = hasBadCondition
    ? 'bad'
    : hasWarningCondition
      ? 'warning'
      : 'good'

  const summary =
    status === 'good'
      ? '该片段适合进行 PID 跟随分析。'
      : status === 'warning'
        ? '该片段可用于初步分析，但质量一般。'
        : '该片段目前不适合进行 PID 跟随分析。'

  if (status === 'good' && recommendations.length === 0) {
    recommendations.push('可以基于该片段计算跟随指标并生成候选 PID 参数。')
  }

  return {
    status,
    score: clampScore(score),
    summary,
    reasons,
    recommendations,
    metrics,
  }
}
