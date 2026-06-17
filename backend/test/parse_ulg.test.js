const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PARSER_SCRIPT = path.join(
  __dirname,
  '..',
  'scripts',
  'parse_ulg.py',
);

function writeFakePyulogModule(tempDir, datasets) {
  const serializedDatasets = JSON.stringify(datasets);
  const moduleSource = `
import json

_DATASETS = json.loads(${JSON.stringify(serializedDatasets)})

class _Dataset:
    def __init__(self, item):
        self.name = item["name"]
        self.data = item["data"]
        if "multi_id" in item:
            self.multi_id = item["multi_id"]

class ULog:
    def __init__(self, file_path, message_name_filter_list=None):
        self.data_list = [_Dataset(item) for item in _DATASETS]
`;

  fs.writeFileSync(path.join(tempDir, 'pyulog.py'), moduleSource, 'utf8');
}

function runParserWithDatasets(datasets, parserArgs = []) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'log-dev-pyulog-'));
  try {
    writeFakePyulogModule(tempDir, datasets);

    const dummyLogPath = path.join(tempDir, 'dummy.ulg');
    fs.writeFileSync(dummyLogPath, 'dummy', 'utf8');

    const env = { ...process.env };
    env.PYTHONPATH = env.PYTHONPATH
      ? `${tempDir}${path.delimiter}${env.PYTHONPATH}`
      : tempDir;

    const rawOutput = execFileSync(
      'python',
      ['-X', 'utf8', PARSER_SCRIPT, ...parserArgs, dummyLogPath],
      {
        cwd: path.join(__dirname, '..'),
        encoding: 'utf8',
        env,
      },
    );

    return JSON.parse(rawOutput);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function buildAttitudeDatasets(actualFields, setpointFields) {
  return [
    {
      name: 'vehicle_attitude',
      data: {
        timestamp: [0, 1_000_000],
        ...actualFields,
      },
    },
    {
      name: 'vehicle_attitude_setpoint',
      data: {
        timestamp: [0, 1_000_000],
        ...setpointFields,
      },
    },
  ];
}

function findTopicChart(payload, topicName) {
  return payload.topicCharts.find((item) => item.topic === topicName);
}

test('parse_ulg.py supports dotted quaternion field names for PID attitude topics', () => {
  const payload = runParserWithDatasets(
    buildAttitudeDatasets(
      {
        'q.00': [1, 0.9238795],
        'q.01': [0, 0.3826834],
        'q.02': [0, 0],
        'q.03': [0, 0],
      },
      {
        'q_d.00': [1, 0.9238795],
        'q_d.01': [0, 0.3826834],
        'q_d.02': [0, 0],
        'q_d.03': [0, 0],
      },
    ),
  );

  const actualTopic = findTopicChart(payload, 'vehicle_attitude');
  const setpointTopic = findTopicChart(payload, 'vehicle_attitude_setpoint');

  assert.ok(actualTopic, 'vehicle_attitude topic should be present');
  assert.ok(setpointTopic, 'vehicle_attitude_setpoint topic should be present');
  assert.ok(actualTopic.series.some((item) => item.name === 'roll'));
  assert.ok(setpointTopic.series.some((item) => item.name === 'roll_sp'));
  assert.ok(payload.usedTopics.includes('vehicle_attitude'));
  assert.ok(payload.usedTopics.includes('vehicle_attitude_setpoint'));
});

test('parse_ulg.py supports compact quaternion field names for PID attitude topics', () => {
  const payload = runParserWithDatasets(
    buildAttitudeDatasets(
      {
        q0: [1, 0.7071068],
        q1: [0, 0],
        q2: [0, 0.7071068],
        q3: [0, 0],
      },
      {
        q_d0: [1, 0.7071068],
        q_d1: [0, 0],
        q_d2: [0, 0.7071068],
        q_d3: [0, 0],
      },
    ),
  );

  const actualTopic = findTopicChart(payload, 'vehicle_attitude');
  const setpointTopic = findTopicChart(payload, 'vehicle_attitude_setpoint');

  assert.ok(actualTopic, 'vehicle_attitude topic should be present');
  assert.ok(setpointTopic, 'vehicle_attitude_setpoint topic should be present');
  assert.ok(actualTopic.series.some((item) => item.name === 'pitch'));
  assert.ok(setpointTopic.series.some((item) => item.name === 'pitch_sp'));
});

test('parse_ulg.py prefers direct Euler fields for attitude and setpoint when available', () => {
  const payload = runParserWithDatasets([
    {
      name: 'vehicle_attitude',
      data: {
        timestamp: [0, 1_000_000],
        roll: [0, Math.PI / 6],
        pitch: [0, -Math.PI / 12],
        yaw: [0, Math.PI / 8],
        'q[0]': [1, 1],
        'q[1]': [0, 0],
        'q[2]': [0, 0],
        'q[3]': [0, 0],
      },
    },
    {
      name: 'vehicle_attitude_setpoint',
      data: {
        timestamp: [0, 1_000_000],
        roll_body: [0, Math.PI / 5],
        pitch_body: [0, -Math.PI / 10],
        yaw_body: [0, Math.PI / 7],
        'q_d[0]': [1, 1],
        'q_d[1]': [0, 0],
        'q_d[2]': [0, 0],
        'q_d[3]': [0, 0],
      },
    },
  ]);

  const actualTopic = findTopicChart(payload, 'vehicle_attitude');
  const setpointTopic = findTopicChart(payload, 'vehicle_attitude_setpoint');

  assert.deepEqual(
    actualTopic.series.find((item) => item.name === 'roll')?.points,
    [
      [0, 0],
      [1, 30],
    ],
  );
  assert.deepEqual(
    setpointTopic.series.find((item) => item.name === 'roll_sp')?.points,
    [
      [0, 0],
      [1, 36],
    ],
  );
});

test('parse_ulg.py keeps local position setpoint fields when early samples are NaN', () => {
  const payload = runParserWithDatasets([
    {
      name: 'vehicle_local_position_setpoint',
      multi_id: 0,
      data: {
        timestamp: [0, 1_000_000, 2_000_000],
        x: ['nan', 1, 2],
        y: ['nan', -1, -2],
        z: ['nan', -2, -3],
        vx: ['nan', 0.1, 0.2],
        vy: ['nan', -0.1, -0.2],
        vz: ['nan', 0.3, 0.4],
        yaw: [0, 0.1, 0.2],
      },
    },
  ]);

  const setpointTopic = findTopicChart(payload, 'vehicle_local_position_setpoint_0');
  const names = setpointTopic.series.map((item) => item.name);

  assert.ok(names.includes('x'));
  assert.ok(names.includes('y'));
  assert.ok(names.includes('z'));
  assert.ok(names.includes('vx'));
  assert.ok(names.includes('vy'));
  assert.ok(names.includes('vz'));
  assert.deepEqual(
    setpointTopic.series.find((item) => item.name === 'x')?.points,
    [
      [1, 1],
      [2, 2],
    ],
  );
});

test('parse_ulg.py reports unlock summary from actuator_armed.armed', () => {
  const payload = runParserWithDatasets([
    {
      name: 'actuator_armed',
      data: {
        timestamp: [0, 1_000_000, 2_000_000],
        armed: [0, 1, 0],
      },
    },
  ]);

  assert.equal(payload.unlockSummary.hasUnlockedFlight, true);
  assert.deepEqual(payload.unlockSummary.sources, [
    { topic: 'actuator_armed', field: 'armed', flightTimeS: 1 },
  ]);
  assert.equal(payload.unlockSummary.flightTimeS, 1);
});

test('parse_ulg.py reports unlock summary from vehicle_status.arming_state', () => {
  const payload = runParserWithDatasets([
    {
      name: 'vehicle_status',
      data: {
        timestamp: [0, 1_000_000, 2_000_000],
        nav_state: [0, 0, 0],
        arming_state: [1, 2, 1],
      },
    },
  ]);

  assert.equal(payload.unlockSummary.hasUnlockedFlight, true);
  assert.equal(payload.unlockSummary.flightTimeS, 1);
  assert.ok(
    payload.unlockSummary.sources.some(
      (item) => item.topic === 'vehicle_status' && item.field === 'arming_state',
    ),
  );
});

test('parse_ulg.py can return lightweight unlock summary only', () => {
  const payload = runParserWithDatasets(
    [
      {
        name: 'actuator_armed',
        data: {
          timestamp: [0, 1_000_000, 2_000_000],
          armed: [0, 1, 0],
        },
      },
    ],
    ['--unlock-summary'],
  );

  assert.deepEqual(Object.keys(payload), ['unlockSummary']);
  assert.equal(payload.unlockSummary.hasUnlockedFlight, true);
  assert.equal(payload.unlockSummary.flightTimeS, 1);
});

test('parse_ulg.py raw signals mode uses one global log time axis', () => {
  const payload = runParserWithDatasets(
    [
      {
        name: 'vehicle_status',
        data: {
          timestamp: [10_000_000, 11_000_000],
          arming_state: [1, 2],
          nav_state: [0, 2],
        },
      },
      {
        name: 'battery_status',
        data: {
          timestamp: [12_000_000, 13_000_000],
          voltage_v: [16.2, 15.9],
        },
      },
    ],
    ['--raw-signals'],
  );

  assert.equal(payload.dataSource, 'px4-raw-signals');
  assert.equal(payload.timeRange.startS, 0);
  assert.equal(payload.timeRange.endS, 3);

  const statusTopic = payload.rawTopics.find((item) => item.topic === 'vehicle_status');
  const batteryTopic = payload.rawTopics.find((item) => item.topic === 'battery_status');

  assert.deepEqual(statusTopic.timeS, [0, 1]);
  assert.deepEqual(batteryTopic.timeS, [2, 3]);
  assert.deepEqual(statusTopic.fields.arming_state, [1, 2]);
  assert.deepEqual(batteryTopic.fields.voltage_v, [16.2, 15.9]);
});
