import type { TuningAxis, TuningSeriesPoint } from '../types/tuning'
import type { ChartSeries, TopicChart } from '../types/log'
import { quaternionToEulerDeg } from './attitudeEuler'

type AttitudeAxis = 'roll' | 'pitch' | 'yaw'

type EulerSeriesMap = Record<AttitudeAxis, Array<[number, number]>>

const ACTUAL_TOPIC_FAMILY = 'vehicle_attitude'
const SETPOINT_TOPIC_FAMILY = 'vehicle_attitude_setpoint'

const ACTUAL_QUATERNION_CANDIDATES = {
  q0: ['q[0]', 'q.00', 'q0'],
  q1: ['q[1]', 'q.01', 'q1'],
  q2: ['q[2]', 'q.02', 'q2'],
  q3: ['q[3]', 'q.03', 'q3'],
} as const

const SETPOINT_QUATERNION_CANDIDATES = {
  q0: ['q_d[0]', 'q_d.00', 'q_d0'],
  q1: ['q_d[1]', 'q_d.01', 'q_d1'],
  q2: ['q_d[2]', 'q_d.02', 'q_d2'],
  q3: ['q_d[3]', 'q_d.03', 'q_d3'],
} as const

const ACTUAL_EULER_CANDIDATES: Record<AttitudeAxis, string[]> = {
  roll: ['roll', 'roll_deg'],
  pitch: ['pitch', 'pitch_deg'],
  yaw: ['yaw', 'yaw_deg'],
}

const SETPOINT_EULER_CANDIDATES: Record<AttitudeAxis, string[]> = {
  roll: ['roll_sp', 'roll_body', 'roll'],
  pitch: ['pitch_sp', 'pitch_body', 'pitch'],
  yaw: ['yaw_sp', 'yaw_body', 'yaw'],
}

function normalizeTopicFamily(topic: string) {
  return topic.trim().replace(/_\d+$/, '')
}

function normalizeSeriesName(name: string) {
  return name.trim().toLowerCase()
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function normalizePoints(points: unknown): Array<[number, number]> {
  if (!Array.isArray(points)) {
    return []
  }

  const normalized: Array<[number, number]> = []
  for (const point of points) {
    if (!Array.isArray(point) || point.length < 2) {
      continue
    }

    const time = point[0]
    const value = point[1]
    if (!isFiniteNumber(time) || !isFiniteNumber(value)) {
      continue
    }

    normalized.push([time, value])
  }

  return normalized
}

function cloneSeries(series: ChartSeries): ChartSeries {
  return {
    ...series,
    points: normalizePoints(series.points),
  }
}

function findTopicChart(
  topicCharts: TopicChart[],
  topicFamily: string,
): TopicChart | null {
  return (
    topicCharts.find(
      (topicChart) =>
        typeof topicChart?.topic === 'string' &&
        normalizeTopicFamily(topicChart.topic) === topicFamily,
    ) ?? null
  )
}

function findSeriesByNames(
  topicChart: TopicChart | null,
  candidateNames: readonly string[],
): ChartSeries | null {
  if (!topicChart || !Array.isArray(topicChart.series)) {
    return null
  }

  const normalizedCandidates = candidateNames.map(normalizeSeriesName)
  for (const series of topicChart.series) {
    if (
      typeof series?.name === 'string' &&
      normalizedCandidates.includes(normalizeSeriesName(series.name))
    ) {
      return cloneSeries(series)
    }
  }

  return null
}

function extractEulerSeriesFromQuaternions(
  topicChart: TopicChart | null,
  quaternionCandidates: typeof ACTUAL_QUATERNION_CANDIDATES | typeof SETPOINT_QUATERNION_CANDIDATES,
): EulerSeriesMap | null {
  const q0Series = findSeriesByNames(topicChart, quaternionCandidates.q0)
  const q1Series = findSeriesByNames(topicChart, quaternionCandidates.q1)
  const q2Series = findSeriesByNames(topicChart, quaternionCandidates.q2)
  const q3Series = findSeriesByNames(topicChart, quaternionCandidates.q3)

  if (!q0Series || !q1Series || !q2Series || !q3Series) {
    return null
  }

  const pointMap = new Map<
    number,
    Partial<{ q0: number; q1: number; q2: number; q3: number }>
  >()

  for (const [time, value] of q0Series.points) {
    pointMap.set(time, { ...(pointMap.get(time) ?? {}), q0: value })
  }
  for (const [time, value] of q1Series.points) {
    pointMap.set(time, { ...(pointMap.get(time) ?? {}), q1: value })
  }
  for (const [time, value] of q2Series.points) {
    pointMap.set(time, { ...(pointMap.get(time) ?? {}), q2: value })
  }
  for (const [time, value] of q3Series.points) {
    pointMap.set(time, { ...(pointMap.get(time) ?? {}), q3: value })
  }

  const roll: Array<[number, number]> = []
  const pitch: Array<[number, number]> = []
  const yaw: Array<[number, number]> = []

  const sortedTimes = [...pointMap.keys()].sort((left, right) => left - right)
  for (const time of sortedTimes) {
    const values = pointMap.get(time)
    if (
      values?.q0 === undefined ||
      values.q1 === undefined ||
      values.q2 === undefined ||
      values.q3 === undefined
    ) {
      continue
    }

    const euler = quaternionToEulerDeg(
      values.q0,
      values.q1,
      values.q2,
      values.q3,
    )
    if (!euler) {
      continue
    }

    roll.push([time, Number(euler.rollDeg.toFixed(6))])
    pitch.push([time, Number(euler.pitchDeg.toFixed(6))])
    yaw.push([time, Number(euler.yawDeg.toFixed(6))])
  }

  if (roll.length === 0 && pitch.length === 0 && yaw.length === 0) {
    return null
  }

  return { roll, pitch, yaw }
}

function extractEulerSeriesFromDerivedFields(
  topicChart: TopicChart | null,
  candidateMap: Record<AttitudeAxis, string[]>,
): EulerSeriesMap | null {
  const rollSeries = findSeriesByNames(topicChart, candidateMap.roll)
  const pitchSeries = findSeriesByNames(topicChart, candidateMap.pitch)
  const yawSeries = findSeriesByNames(topicChart, candidateMap.yaw)

  if (!rollSeries && !pitchSeries && !yawSeries) {
    return null
  }

  return {
    roll: rollSeries?.points ?? [],
    pitch: pitchSeries?.points ?? [],
    yaw: yawSeries?.points ?? [],
  }
}

function extractActualEulerSeries(topicCharts: TopicChart[]): EulerSeriesMap | null {
  const actualTopic = findTopicChart(topicCharts, ACTUAL_TOPIC_FAMILY)
  return (
    extractEulerSeriesFromDerivedFields(actualTopic, ACTUAL_EULER_CANDIDATES) ??
    extractEulerSeriesFromQuaternions(actualTopic, ACTUAL_QUATERNION_CANDIDATES)
  )
}

function extractSetpointEulerSeries(
  topicCharts: TopicChart[],
): EulerSeriesMap | null {
  const setpointTopic = findTopicChart(topicCharts, SETPOINT_TOPIC_FAMILY)
  return (
    extractEulerSeriesFromDerivedFields(setpointTopic, SETPOINT_EULER_CANDIDATES) ??
    extractEulerSeriesFromQuaternions(setpointTopic, SETPOINT_QUATERNION_CANDIDATES)
  )
}

function buildAxisTrackingChart(
  axis: AttitudeAxis,
  actualPoints: Array<[number, number]>,
  setpointPoints: Array<[number, number]>,
): TopicChart {
  const axisLabel = axis.charAt(0).toUpperCase() + axis.slice(1)

  return {
    topic: `pid_${axis}_angle_tracking`,
    title: `${axisLabel} Angle Tracking`,
    series: [
      {
        name: `${axisLabel} Actual`,
        unit: 'deg',
        points: actualPoints,
      },
      {
        name: `${axisLabel} Setpoint`,
        unit: 'deg',
        points: setpointPoints,
      },
    ],
  }
}

function pointsToSeriesSamples(points: Array<[number, number]>): TuningSeriesPoint[] {
  return points
    .filter(
      (point): point is [number, number] =>
        Array.isArray(point) &&
        point.length >= 2 &&
        isFiniteNumber(point[0]) &&
        isFiniteNumber(point[1]),
    )
    .map(([timeS, value]) => ({ timeS, value }))
}

export function getPidAxisTrackingSeries(
  pidTrackingCharts: TopicChart[] | null | undefined,
  axis: TuningAxis,
): {
  actualSeries: TuningSeriesPoint[]
  setpointSeries: TuningSeriesPoint[]
} {
  if (!Array.isArray(pidTrackingCharts)) {
    return {
      actualSeries: [],
      setpointSeries: [],
    }
  }

  const axisLabel = axis.charAt(0).toUpperCase() + axis.slice(1)
  const chartTopic = `pid_${axis}_angle_tracking`
  const chart =
    pidTrackingCharts.find((item) => item?.topic === chartTopic) ?? null

  if (!chart || !Array.isArray(chart.series)) {
    return {
      actualSeries: [],
      setpointSeries: [],
    }
  }

  const actual =
    chart.series.find((item) => item?.name === `${axisLabel} Actual`) ?? null
  const setpoint =
    chart.series.find((item) => item?.name === `${axisLabel} Setpoint`) ?? null

  return {
    actualSeries: pointsToSeriesSamples(actual?.points ?? []),
    setpointSeries: pointsToSeriesSamples(setpoint?.points ?? []),
  }
}

export function buildPidAttitudeTrackingCharts(
  topicCharts: TopicChart[] | null | undefined,
): TopicChart[] {
  if (!Array.isArray(topicCharts)) {
    return []
  }

  const actualEuler = extractActualEulerSeries(topicCharts)
  const setpointEuler = extractSetpointEulerSeries(topicCharts)

  if (!actualEuler || !setpointEuler) {
    return []
  }

  return [
    buildAxisTrackingChart('roll', actualEuler.roll, setpointEuler.roll),
    buildAxisTrackingChart('pitch', actualEuler.pitch, setpointEuler.pitch),
    buildAxisTrackingChart('yaw', actualEuler.yaw, setpointEuler.yaw),
  ]
}
