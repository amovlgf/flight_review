import type {
  IncidentAnalysisResponse,
  IncidentTimelineEvent,
  ModeSegment,
} from '../types/log'
import { getSeriesDisplayName, getSeriesTimeBounds } from './chartOptions'

const EVIDENCE_DISPLAY_WINDOW_BEFORE_S = 5
const EVIDENCE_DISPLAY_WINDOW_AFTER_S = 5

export function resolveEvidenceTime(
  series: Array<{ points: Array<[number, number]> }>,
  targetTimeS: number,
) {
  const points = series.flatMap((item) => item.points)
  if (points.length === 0) return targetTimeS

  const sortedPoints = [...points].sort((a, b) => a[0] - b[0])
  const firstTime = sortedPoints[0][0]
  const lastTime = sortedPoints[sortedPoints.length - 1][0]
  if (targetTimeS >= firstTime && targetTimeS <= lastTime) {
    return targetTimeS
  }

  for (let index = 1; index < sortedPoints.length; index += 1) {
    const previous = sortedPoints[index - 1]
    const current = sortedPoints[index]
    if (previous[1] !== current[1]) {
      return current[0]
    }
  }

  return sortedPoints.reduce((closest, point) =>
    Math.abs(point[0] - targetTimeS) < Math.abs(closest[0] - targetTimeS)
      ? point
      : closest,
  )[0]
}

export function getEvidenceChart(
  report: IncidentAnalysisResponse,
  event: IncidentTimelineEvent,
) {
  const link = event.evidenceLinks?.[0]
  if (!link) return null

  const group = report.chartGroups.find((item) => item.id === link.chartGroupId)
  if (!group) return null

  const linksInGroup = (event.evidenceLinks ?? []).filter(
    (item) => item.chartGroupId === link.chartGroupId,
  )
  const matchingSeries = group.series.filter((item) =>
    linksInGroup.some(
      (evidenceLink) =>
        item.id === evidenceLink.seriesId ||
        item.label === evidenceLink.seriesId ||
        item.id === evidenceLink.standardSignal ||
        item.label === evidenceLink.standardSignal,
    ),
  )
  const focusSeries = matchingSeries[0] ?? group.series[0] ?? null
  const sourceSeries = matchingSeries.length > 0 ? matchingSeries : focusSeries ? [focusSeries] : group.series

  const rawSeries = sourceSeries.map((item) => {
    return {
      name: item.label || item.id,
      unit: item.unit || '',
      points: item.points,
    }
  })
  const displayTimeOffsetS =
    typeof report.flightSummary.displayTimeOffsetS === 'number' &&
    Number.isFinite(report.flightSummary.displayTimeOffsetS)
      ? report.flightSummary.displayTimeOffsetS
      : 0
  const localEvidenceTimeS = resolveEvidenceTime(rawSeries, link.targetTimeS)
  const timeOffsetS = link.targetTimeS - localEvidenceTimeS
  const displayShiftS = timeOffsetS - displayTimeOffsetS
  const modeTimeOffsetS =
    displayTimeOffsetS > 0 && localEvidenceTimeS === link.targetTimeS
      ? 0
      : displayShiftS
  const targetTimeS = Number((link.targetTimeS - displayTimeOffsetS).toFixed(6))
  const startS = typeof link.timeWindow?.startS === 'number'
    ? Number((link.timeWindow.startS - displayTimeOffsetS).toFixed(6))
    : undefined
  const endS = typeof link.timeWindow?.endS === 'number'
    ? Number((link.timeWindow.endS - displayTimeOffsetS).toFixed(6))
    : undefined
  const series = rawSeries.map((item) => ({
    ...item,
    points: item.points.map(([timeS, value]) => [
      Number((timeS + displayShiftS).toFixed(6)),
      value,
    ]) as Array<[number, number]>,
  }))

  return {
    title: group.title,
    source: `${link.source.topic}.${link.source.field}`,
    targetTimeS,
    logTargetTimeS: link.targetTimeS,
    logDurationS: report.flightSummary.durationS,
    displayDurationS:
      report.flightSummary.flightWindow?.durationS ??
      (displayTimeOffsetS > 0 ? report.flightSummary.armedFlightTimeS : null) ??
      null,
    displayTimeOffsetS,
    startS,
    endS,
    timeOffsetS: modeTimeOffsetS,
    focusLabel: focusSeries
      ? `${getSeriesDisplayName(focusSeries.label || focusSeries.id)} (${focusSeries.unit || ''})`
      : link.standardSignal,
    series,
  }
}

function isFiniteTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function getEvidenceDisplayRange(chart: {
  startS?: number
  endS?: number
  targetTimeS: number
  series: Array<{ points: Array<[number, number]> }>
}, centerTimeS = chart.targetTimeS) {
  if (isFiniteTime(centerTimeS)) {
    return {
      start: Math.max(0, Number((centerTimeS - EVIDENCE_DISPLAY_WINDOW_BEFORE_S).toFixed(6))),
      end: Number((centerTimeS + EVIDENCE_DISPLAY_WINDOW_AFTER_S).toFixed(6)),
    }
  }

  const bounds = getSeriesTimeBounds(chart.series)
  if (bounds.hasData && bounds.end > bounds.start) {
    return { start: bounds.start, end: bounds.end }
  }

  return {
    start: Math.max(0, chart.targetTimeS - 3),
    end: chart.targetTimeS + 5,
  }
}

export function getEvidenceTimelineRange(chart: {
  targetTimeS: number
  displayDurationS?: number | null
  logDurationS?: number | null
  series: Array<{ points: Array<[number, number]> }>
}) {
  if (isFiniteTime(chart.displayDurationS) && chart.displayDurationS > 0) {
    return {
      start: 0,
      end: Math.max(chart.displayDurationS, chart.targetTimeS),
    }
  }

  if (isFiniteTime(chart.logDurationS) && chart.logDurationS > 0) {
    return {
      start: 0,
      end: Math.max(chart.logDurationS, chart.targetTimeS),
    }
  }

  const bounds = getSeriesTimeBounds(chart.series)
  if (bounds.hasData && bounds.end > bounds.start) {
    return {
      start: 0,
      end: Math.max(bounds.end, chart.targetTimeS),
    }
  }

  const displayRange = getEvidenceDisplayRange(chart)
  return {
    start: 0,
    end: displayRange.end,
  }
}

export function alignModeSegmentsToEvidenceTime(
  modeSegments: ModeSegment[],
  timeOffsetS: number,
) {
  if (!Number.isFinite(timeOffsetS) || timeOffsetS === 0) {
    return modeSegments
  }

  return modeSegments.map((segment) => ({
    ...segment,
    start: Number((segment.start + timeOffsetS).toFixed(6)),
    end: Number((segment.end + timeOffsetS).toFixed(6)),
  }))
}
