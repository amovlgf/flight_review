import type { ChartSeries, TopicChart } from '../types/log'

export const PID_VIEW_TOPIC_ALLOWLIST = [
  'vehicle_rates_setpoint',
  'vehicle_rates_setpoint_0',
  'vehicle_angular_velocity',
  'vehicle_angular_velocity_0',
  'vehicle_attitude_setpoint',
  'vehicle_attitude_setpoint_0',
  'vehicle_attitude',
  'vehicle_attitude_0',
  'actuator_outputs',
  'actuator_outputs_0',
  'actuator_outputs_1',
  'actuator_motors',
  'actuator_motors_0',
  'actuator_motors_1',
  'vehicle_local_position',
  'vehicle_local_position_0',
  'battery_status',
  'battery_status_0',
] as const

const PID_VIEW_TOPIC_SORT_ORDER = [
  'vehicle_rates_setpoint',
  'vehicle_angular_velocity',
  'vehicle_attitude_setpoint',
  'vehicle_attitude',
  'actuator_outputs',
  'actuator_motors',
  'vehicle_local_position',
  'battery_status',
] as const

type TopicChartLike = Partial<TopicChart> & {
  topicName?: string
  name?: string
}

type ChartSeriesLike = Partial<ChartSeries> & {
  key?: string
  label?: string
  title?: string
}

type TopicFamily = (typeof PID_VIEW_TOPIC_SORT_ORDER)[number]

const PID_VIEW_TOPIC_SET = new Set(PID_VIEW_TOPIC_ALLOWLIST)
const PID_VIEW_TOPIC_FAMILY_SET = new Set(
  PID_VIEW_TOPIC_ALLOWLIST.map((topic) => normalizeTopicFamily(topic)),
)

const PID_VIEW_FIELD_MATCHERS: Record<
  TopicFamily,
  ReadonlyArray<string | RegExp>
> = {
  vehicle_rates_setpoint: [
    'roll',
    'pitch',
    'yaw',
    'roll rate setpoint',
    'pitch rate setpoint',
    'yaw rate setpoint',
    'roll_rate',
    'pitch_rate',
    'yaw_rate',
  ],
  vehicle_angular_velocity: [
    'x',
    'y',
    'z',
    'xyz[0]',
    'xyz[1]',
    'xyz[2]',
    'rollspeed',
    'pitchspeed',
    'yawspeed',
    'roll rate',
    'pitch rate',
    'yaw rate',
    'roll_rate',
    'pitch_rate',
    'yaw_rate',
  ],
  vehicle_attitude_setpoint: [
    'roll',
    'pitch',
    'yaw',
    'roll_body',
    'pitch_body',
    'yaw_body',
    'roll_sp',
    'pitch_sp',
    'yaw_sp',
    'yaw_sp_move_rate',
    '期望滚转�?',
    '期望俯仰�?',
    '期望航向�?',
    '期望偏航变化�?',
  ],
  vehicle_attitude: [
    'roll',
    'pitch',
    'yaw',
    'roll_deg',
    'pitch_deg',
    'yaw_deg',
    '滚转�?',
    '俯仰�?',
    '航向�?',
    '滚转�? (deg)',
    '俯仰�? (deg)',
    '航向�? (deg)',
  ],
  actuator_outputs: ['noutputs', /^output\[[0-3]\]$/i],
  actuator_motors: ['reversible_flags', /^control\[[0-3]\]$/i],
  vehicle_local_position: [
    'x',
    'y',
    'z',
    'vx',
    'vy',
    'vz',
    'heading',
    'altitude',
    '高度',
    '速度',
    'speed',
    'speed_3d',
  ],
  battery_status: [
    'voltage_v',
    'voltage_filtered_v',
    'current_a',
    'current_filtered_a',
    'remaining',
    'discharged_mah',
    '电压',
    '电流',
    '剩余电量',
    '已耗电�?',
  ],
}

function normalizeTopicFamily(topic: string) {
  return topic.trim().replace(/_\d+$/, '')
}

function normalizeText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function getTopicName(item: unknown): string | null {
  if (!item || typeof item !== 'object') {
    return null
  }

  const candidate = item as TopicChartLike
  const fields = [
    candidate.topic,
    candidate.topicName,
    candidate.name,
    candidate.title,
  ]

  for (const field of fields) {
    if (typeof field === 'string' && field.trim().length > 0) {
      return field.trim()
    }
  }

  return null
}

function getTopicFamily(item: unknown): TopicFamily | null {
  const topicName = getTopicName(item)
  if (!topicName) {
    return null
  }

  const normalizedTopicName = normalizeTopicFamily(topicName)
  return PID_VIEW_TOPIC_SORT_ORDER.includes(normalizedTopicName as TopicFamily)
    ? (normalizedTopicName as TopicFamily)
    : null
}

function getSeriesName(item: unknown): string | null {
  if (!item || typeof item !== 'object') {
    return null
  }

  const candidate = item as ChartSeriesLike
  const fields = [
    candidate.name,
    candidate.label,
    candidate.key,
    candidate.title,
  ]

  for (const field of fields) {
    if (typeof field === 'string' && field.trim().length > 0) {
      return field.trim()
    }
  }

  return null
}

function matchesFieldMatcher(
  fieldName: string,
  matcher: string | RegExp,
): boolean {
  if (typeof matcher === 'string') {
    return normalizeText(fieldName) === normalizeText(matcher)
  }

  return matcher.test(fieldName.trim())
}

function shouldKeepSeriesForTopic(
  topicFamily: TopicFamily,
  series: unknown,
): boolean {
  const seriesName = getSeriesName(series)
  if (!seriesName) {
    return false
  }

  const matchers = PID_VIEW_FIELD_MATCHERS[topicFamily]
  return matchers.some((matcher) => matchesFieldMatcher(seriesName, matcher))
}

function isPidViewTopicName(topicName: string) {
  const normalizedTopicName = normalizeTopicFamily(topicName)
  return (
    PID_VIEW_TOPIC_SET.has(topicName as (typeof PID_VIEW_TOPIC_ALLOWLIST)[number]) ||
    PID_VIEW_TOPIC_FAMILY_SET.has(normalizedTopicName)
  )
}

function getTopicSortRank(item: unknown) {
  const topicFamily = getTopicFamily(item)
  if (!topicFamily) {
    return PID_VIEW_TOPIC_SORT_ORDER.length
  }

  const rank = PID_VIEW_TOPIC_SORT_ORDER.indexOf(topicFamily)
  return rank === -1 ? PID_VIEW_TOPIC_SORT_ORDER.length : rank
}

export function filterPidViewTopics<T>(
  topicCharts: T[] | null | undefined,
): T[] {
  if (!Array.isArray(topicCharts)) {
    return []
  }

  return topicCharts.filter((item) => {
    const topicName = getTopicName(item)
    return topicName ? isPidViewTopicName(topicName) : false
  })
}

export function sortPidViewTopics<T>(
  topicCharts: T[] | null | undefined,
): T[] {
  if (!Array.isArray(topicCharts)) {
    return []
  }

  return topicCharts
    .map((item, index) => ({
      item,
      index,
      rank: getTopicSortRank(item),
    }))
    .sort((left, right) => {
      if (left.rank !== right.rank) {
        return left.rank - right.rank
      }

      return left.index - right.index
    })
    .map(({ item }) => item)
}

export function filterPidViewFields(
  topicChart: Pick<TopicChartLike, 'series'> & TopicChartLike,
): (Pick<TopicChartLike, 'series'> & TopicChartLike) | null
export function filterPidViewFields<T extends TopicChartLike>(
  topicCharts: T[] | null | undefined,
): T[]
export function filterPidViewFields<T extends TopicChartLike>(
  input: T[] | (Pick<TopicChartLike, 'series'> & TopicChartLike) | null | undefined,
): T[] | (Pick<TopicChartLike, 'series'> & TopicChartLike) | null {
  if (Array.isArray(input)) {
    const filteredCharts: T[] = []

    for (const topicChart of input) {
      const filteredTopic = filterPidViewFields(topicChart)
      if (filteredTopic) {
        filteredCharts.push(filteredTopic as T)
      }
    }

    return filteredCharts
  }

  if (!input || typeof input !== 'object') {
    return null
  }

  const topicFamily = getTopicFamily(input)
  if (!topicFamily) {
    return input
  }

  const filteredSeries = Array.isArray(input.series)
    ? input.series.filter((series) => shouldKeepSeriesForTopic(topicFamily, series))
    : []

  if (filteredSeries.length === 0) {
    return null
  }

  return {
    ...input,
    series: filteredSeries,
  }
}

export function getPidViewTopicCharts<T extends TopicChartLike>(
  topicCharts: T[] | null | undefined,
): T[] {
  const filteredTopics = filterPidViewTopics(topicCharts)
  const sortedTopics = sortPidViewTopics(filteredTopics)
  return filterPidViewFields(sortedTopics) as T[]
}

// Backward-compatible aliases for earlier Phase 2 naming.
export const PID_TUNING_TOPIC_ALLOWLIST = PID_VIEW_TOPIC_ALLOWLIST
export const filterPidTuningTopics = filterPidViewTopics
export const sortPidTuningTopics = sortPidViewTopics
export const filterPidTuningTopicFields = filterPidViewFields
export const getPidTuningTopicCharts = getPidViewTopicCharts
