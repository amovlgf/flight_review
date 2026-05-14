const fs = require('fs');
const path = require('path');

const DEFAULT_ROLE_TOPIC_POLICY = {
  customer: [
    'actuator_outputs',
    'battery_status',
    'input_rc',
    'vehicle_status_0',
    'vehicle_local_position',
    'vehicle_local_position_setpoint',
    'sensor_combined',
    'vehicle_visual_odometry',
  ],
  aftersales: [
    'actuator_outputs',
    'battery_status',
    'input_rc',
    'vehicle_status_0',
    'vehicle_local_position',
    'vehicle_local_position_setpoint',
    'sensor_combined',
    'vehicle_visual_odometry',
    'sensor_accel_0',
    'sensor_gyro_0',
    'sensor_baro_0',
    'vehicle_attitude',
    'vehicle_attitude_setpoint',
  ],
  engineer: '*',
};

const DEFAULT_ROLE = 'aftersales';
const DEFAULT_POLICY_PATH = path.join(
  __dirname,
  '..',
  '..',
  'docs',
  'role-topic-policy.txt',
);

function loadRoleTopicPolicyFromFile(policyPath = DEFAULT_POLICY_PATH) {
  try {
    if (!fs.existsSync(policyPath)) {
      return { ...DEFAULT_ROLE_TOPIC_POLICY };
    }

    const text = fs.readFileSync(policyPath, 'utf8');
    const lines = text.split(/\r?\n/);
    const parsed = {};
    let currentRole = '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#') || line.startsWith('===')) {
        continue;
      }

      const roleMatch = line.match(/^\[(.+)\]$/);
      if (roleMatch) {
        currentRole = roleMatch[1].trim();
        if (currentRole) {
          parsed[currentRole] = [];
        }
        continue;
      }

      if (!currentRole) continue;

      if (line === '*') {
        parsed[currentRole] = '*';
        continue;
      }

      if (parsed[currentRole] !== '*') {
        parsed[currentRole].push(line);
      }
    }

    return {
      ...DEFAULT_ROLE_TOPIC_POLICY,
      ...parsed,
    };
  } catch (error) {
    return { ...DEFAULT_ROLE_TOPIC_POLICY };
  }
}

const ROLE_TOPIC_POLICY = loadRoleTopicPolicyFromFile();

function getRoleTopicPolicy() {
  return ROLE_TOPIC_POLICY;
}

function getAvailableRoles() {
  return Object.keys(ROLE_TOPIC_POLICY);
}

function resolveRole(roleRaw) {
  return Object.prototype.hasOwnProperty.call(ROLE_TOPIC_POLICY, roleRaw)
    ? roleRaw
    : DEFAULT_ROLE;
}

function topicMatchesPolicy(policyTopic, actualTopic) {
  if (policyTopic === actualTopic) return true;
  if (actualTopic.startsWith(`${policyTopic}_`)) return true;
  return false;
}

function filterTopicChartsByRole(topicCharts, role) {
  const safeTopicCharts = Array.isArray(topicCharts) ? topicCharts : [];
  const policy = ROLE_TOPIC_POLICY[role];
  if (policy === '*') return safeTopicCharts;
  if (!Array.isArray(policy)) return [];

  return safeTopicCharts.filter((topic) =>
    policy.some((item) => topicMatchesPolicy(item, topic.topic)),
  );
}

module.exports = {
  DEFAULT_ROLE_TOPIC_POLICY,
  loadRoleTopicPolicyFromFile,
  getRoleTopicPolicy,
  getAvailableRoles,
  resolveRole,
  filterTopicChartsByRole,
};
