import type { TopicChart } from '../types/log'

export const PID_TUNING_TOPIC_ALLOWLIST = [
  'vehicle_attitude',
  'vehicle_attitude_0',
  'vehicle_attitude_setpoint',
  'vehicle_attitude_setpoint_0',
  'vehicle_angular_velocity',
  'vehicle_angular_velocity_0',
  'vehicle_rates_setpoint',
  'vehicle_rates_setpoint_0',
  'actuator_outputs',
  'actuator_outputs_0',
  'actuator_motors',
  'actuator_motors_0',
  'vehicle_local_position',
  'vehicle_local_position_0',
  'battery_status',
  'battery_status_0',
  'vehicle_status',
  'vehicle_status_0',
] as const

const PID_TUNING_TOPIC_SORT_ORDER = [
  'vehicle_rates_setpoint',
  'vehicle_angular_velocity',
  'vehicle_attitude_setpoint',
  'vehicle_attitude',
  'actuator_outputs',
  'actuator_motors',
  'vehicle_local_position',
  'battery_status',
  'vehicle_status',
] as const

function normalizeTopicFamily(topic: string) {
  return topic.replace(/_\d+$/, '')
}

function isPidTuningTopic(topic: string) {
  const normalizedTopic = normalizeTopicFamily(topic)
  return PID_TUNING_TOPIC_ALLOWLIST.some(
    (allowlistedTopic) =>
      allowlistedTopic === topic ||
      allowlistedTopic === normalizedTopic ||
      normalizeTopicFamily(allowlistedTopic) === normalizedTopic,
  )
}

export function filterPidTuningTopics(topicCharts: TopicChart[] | null | undefined) {
  if (!Array.isArray(topicCharts) || topicCharts.length === 0) {
    return []
  }

  return topicCharts.filter(
    (topicChart) =>
      typeof topicChart?.topic === 'string' &&
      topicChart.topic.length > 0 &&
      isPidTuningTopic(topicChart.topic),
  )
}

const SORT_ORDER_FOR_INDEX: readonly string[] = PID_TUNING_TOPIC_SORT_ORDER

export function sortPidTuningTopics(topicCharts: TopicChart[] | null | undefined) {
  if (!Array.isArray(topicCharts) || topicCharts.length === 0) {
    return []
  }

  return [...topicCharts].sort((left, right) => {
    const leftFamily = normalizeTopicFamily(left.topic)
    const rightFamily = normalizeTopicFamily(right.topic)
    const leftIndex = SORT_ORDER_FOR_INDEX.indexOf(leftFamily)
    const rightIndex = SORT_ORDER_FOR_INDEX.indexOf(rightFamily)
    const safeLeftIndex =
      leftIndex === -1 ? SORT_ORDER_FOR_INDEX.length : leftIndex
    const safeRightIndex =
      rightIndex === -1 ? SORT_ORDER_FOR_INDEX.length : rightIndex

    if (safeLeftIndex !== safeRightIndex) {
      return safeLeftIndex - safeRightIndex
    }

    return left.topic.localeCompare(right.topic)
  })
}
