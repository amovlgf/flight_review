const REQUIRED_TOPIC_GROUPS = [
  {
    id: 'timestamp',
    topics: [],
    reason: 'No usable timestamp axis was decoded.',
  },
  {
    id: 'vehicle_status',
    topics: ['vehicle_status'],
    reason: 'vehicle_status is required to read arming, mode, and failsafe state.',
  },
  {
    id: 'vehicle_land_detected',
    topics: ['vehicle_land_detected'],
    reason: 'vehicle_land_detected is required to split takeoff and landing phases.',
  },
  {
    id: 'vehicle_local_position|vehicle_global_position',
    topics: ['vehicle_local_position', 'vehicle_global_position'],
    reason: 'At least one position topic is required to verify basic flight movement.',
  },
];

const OPTIONAL_TOPICS = [
  'battery_status',
  'sensor_combined',
  'estimator_status',
  'estimator_innovations',
  'estimator_innovation_test_ratios',
  'failsafe_flags',
  'actuator_outputs',
  'vehicle_attitude',
  'vehicle_attitude_setpoint',
  'vehicle_rates_setpoint',
  'vehicle_angular_velocity',
];

function isRawTopicUsable(rawTopic) {
  return rawTopic && Array.isArray(rawTopic.timeS) && rawTopic.timeS.length > 0;
}

function normalizeTopicName(topicName) {
  if (typeof topicName !== 'string') return '';
  return topicName.replace(/_\d+$/, '');
}

function hasTopic(rawTopics, topicName) {
  return rawTopics.some((item) => normalizeTopicName(item?.topic) === topicName && isRawTopicUsable(item));
}

function hasAnyTimestamp(rawTopics) {
  return rawTopics.some(isRawTopicUsable);
}

function evaluateFlightSummaryDataGate(rawSignalPayload) {
  const rawTopics = Array.isArray(rawSignalPayload?.rawTopics) ? rawSignalPayload.rawTopics : [];
  const missingRequired = [];
  const blockingReasons = [];

  for (const group of REQUIRED_TOPIC_GROUPS) {
    const available =
      group.id === 'timestamp'
        ? hasAnyTimestamp(rawTopics)
        : group.topics.some((topicName) => hasTopic(rawTopics, topicName));
    if (available) continue;
    missingRequired.push(group.id);
    blockingReasons.push(group.reason);
  }

  const missingOptional = OPTIONAL_TOPICS.filter((topicName) => !hasTopic(rawTopics, topicName));
  const limitations = missingOptional.map(
    (topicName) => `${topicName} missing; related summary details or embedded curves are limited.`,
  );

  if (missingRequired.length > 0) {
    blockingReasons.unshift(
      'This log does not meet the minimum analysis requirements for flight summary.',
    );
  }

  return {
    canAnalyze: missingRequired.length === 0,
    missingRequired,
    missingOptional,
    blockingReasons,
    limitations,
  };
}

module.exports = {
  OPTIONAL_TOPICS,
  evaluateFlightSummaryDataGate,
};
