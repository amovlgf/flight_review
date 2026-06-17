const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildEventGroups,
  buildFlightProcess,
  buildFlightProcessEventGroup,
  buildPhases,
  buildTimeline,
} = require('./incidentAnalysisService');

const analysisCapability = {
  timeline: true,
  phaseDetection: true,
  eventExtraction: true,
  attitudeAnalysis: false,
  rateAnalysis: false,
  actuatorAnalysis: false,
  batteryAnalysis: true,
  estimatorAnalysis: true,
  reasons: [],
};

function makeSignal(id, points) {
  return { id, points };
}

test('V1.3 builds unified inferred flight phases from stable events', () => {
  const signals = {
    'log.timeS': makeSignal('log.timeS', [
      [0, 0],
      [10, 10],
      [20, 20],
      [30, 30],
      [40, 40],
    ]),
    'vehicle.landed': makeSignal('vehicle.landed', [
      [0, 1],
      [10, 0],
      [30, 1],
      [40, 1],
    ]),
    'vehicle.armed': makeSignal('vehicle.armed', [
      [0, 0],
      [5, 1],
      [35, 0],
    ]),
  };

  const phases = buildPhases(signals, analysisCapability);

  assert.deepEqual(
    phases.map((item) => item.phase),
    ['ground_standby', 'armed_waiting_takeoff', 'liftoff_confirmed', 'normal_flight', 'landing_process', 'landed_complete'],
  );
  assert.deepEqual(phases[0], {
    phase: 'ground_standby',
    startS: 0,
    endS: 5,
    source: 'vehicle.landed + vehicle.armed',
    confidence: 'high',
    evidenceCount: 2,
  });
  for (let index = 1; index < phases.length; index += 1) {
    assert.ok(phases[index].startS >= phases[index - 1].endS);
  }
});

test('V1.3 timeline extracts raw events and inferred phases without cause conclusions', () => {
  const signals = {
    'log.timeS': makeSignal('log.timeS', [
      [0, 0],
      [10, 10],
      [20, 20],
      [30, 30],
    ]),
    'vehicle.armed': makeSignal('vehicle.armed', [
      [0, 0],
      [5, 1],
      [25, 0],
    ]),
    'vehicle.landed': makeSignal('vehicle.landed', [
      [0, 1],
      [10, 0],
      [28, 1],
    ]),
    'vehicle.navState': makeSignal('vehicle.navState', [
      [0, 0],
      [12, 2],
    ]),
    'vehicle.failsafe': makeSignal('vehicle.failsafe', [
      [0, 0],
      [18, 1],
      [22, 0],
    ]),
    'estimator.flags': makeSignal('estimator.flags', [
      [0, 0],
      [16, 4],
    ]),
  };

  const timeline = buildTimeline(signals, analysisCapability);
  const codes = timeline.map((item) => item.code);

  assert.ok(codes.includes('ARMED'));
  assert.ok(codes.includes('TAKEOFF_DETECTED'));
  assert.equal(codes.filter((code) => code === 'LANDED_DETECTED').length, 1);
  assert.ok(codes.includes('MODE_CHANGED'));
  assert.ok(codes.includes('FAILSAFE_STARTED'));
  assert.ok(codes.includes('ESTIMATOR_FLAGS_SUMMARY'));
  assert.ok(!codes.some((code) => code.includes('CAUSE')));
  assert.equal(timeline.find((item) => item.code === 'TAKEOFF_DETECTED')?.rawEvent?.signal, 'vehicle.landed');
  assert.equal(timeline.find((item) => item.code === 'MODE_CHANGED')?.confidence, 'high');
  assert.ok(
    timeline
      .filter((item) => item.evidence.length > 0)
      .every((item) => Array.isArray(item.evidenceLinks) && item.evidenceLinks.length > 0),
  );
  assert.match(
    timeline.find((item) => item.code === 'ESTIMATOR_FLAGS_SUMMARY')?.detail || '',
    /^0x[0-9A-F]+ -> 0x[0-9A-F]+; changed: /,
  );
});

test('V1.3 timeline events include evidence links for chart navigation', () => {
  const signals = {
    'log.timeS': makeSignal('log.timeS', [
      [0, 0],
      [10, 10],
    ]),
    'vehicle.armed': {
      id: 'vehicle.armed',
      topic: 'vehicle_status',
      instance: 0,
      field: 'arming_state',
      points: [
        [0, 0],
        [5, 1],
      ],
    },
    'vehicle.landed': {
      id: 'vehicle.landed',
      topic: 'vehicle_land_detected',
      instance: 0,
      field: 'landed',
      points: [
        [0, 1],
        [10, 0],
      ],
    },
  };

  const timeline = buildTimeline(signals, analysisCapability);
  const armedEvent = timeline.find((item) => item.code === 'ARMED');
  const link = armedEvent?.evidenceLinks?.[0];

  assert.equal(link?.standardSignal, 'vehicle.armed');
  assert.equal(link?.chartGroupId, 'v1_3_state_signals');
  assert.equal(link?.seriesId, 'vehicle.armed');
  assert.equal(link?.chartTopic, 'vehicle_status');
  assert.deepEqual(link?.source, {
    topic: 'vehicle_status',
    instance: 0,
    field: 'arming_state',
  });
  assert.deepEqual(link?.timeWindow, {
    startS: 2,
    endS: 10,
  });
});

test('V1.3 landing events point evidence to the state chart group', () => {
  const signals = {
    'log.timeS': makeSignal('log.timeS', [
      [0, 0],
      [10, 10],
      [20, 20],
      [21, 21],
    ]),
    'vehicle.landed': {
      id: 'vehicle.landed',
      topic: 'vehicle_land_detected',
      instance: 0,
      field: 'landed',
      points: [
        [0, 1],
        [10, 0],
        [20, 1],
        [21, 1],
      ],
    },
  };

  const timeline = buildTimeline(signals, analysisCapability);
  const takeoffLink = timeline.find((item) => item.code === 'TAKEOFF_DETECTED')?.evidenceLinks?.[0];
  const landingLink = timeline.find((item) => item.code === 'LANDED_DETECTED')?.evidenceLinks?.[0];

  assert.equal(takeoffLink?.chartGroupId, 'v1_3_state_signals');
  assert.equal(landingLink?.chartGroupId, 'v1_3_state_signals');
  assert.equal(takeoffLink?.standardSignal, 'vehicle.landed');
  assert.equal(landingLink?.standardSignal, 'vehicle.landed');
});

test('V1.3 ignores short landed-state bounce before the debounce window', () => {
  const signals = {
    'log.timeS': makeSignal('log.timeS', [
      [0, 0],
      [1, 1],
      [2, 2],
    ]),
    'vehicle.landed': makeSignal('vehicle.landed', [
      [0, 1],
      [1, 0],
      [1.2, 1],
      [2, 1],
    ]),
  };

  const timeline = buildTimeline(signals, analysisCapability);

  assert.ok(!timeline.some((item) => item.code === 'TAKEOFF_DETECTED'));
});

test('V1.3 estimator flag changes are summarized instead of repeated raw bitmask events', () => {
  const signals = {
    'log.timeS': makeSignal('log.timeS', [
      [0, 0],
      [30, 30],
    ]),
    'estimator.flags': makeSignal('estimator.flags', [
      [0, 1],
      [3.38, 2],
      [15.38, 3],
      [78.38, 4],
    ]),
  };

  const timeline = buildTimeline(signals, analysisCapability);
  const estimatorEvents = timeline.filter((item) => item.type === 'estimator');

  assert.equal(estimatorEvents.length, 1);
  assert.equal(estimatorEvents[0].code, 'ESTIMATOR_FLAGS_SUMMARY');
  assert.match(estimatorEvents[0].detail, /3 changes/);
  assert.equal(estimatorEvents[0].evidenceLinks?.[0]?.chartGroupId, 'v1_3_optional_signals');
});

test('V1.3 groups nearby deterministic events into readable flight phases', () => {
  const signals = {
    'log.timeS': makeSignal('log.timeS', [
      [0, 0],
      [66, 66],
      [67, 67],
      [69, 69],
      [146, 146],
      [147, 147],
      [149, 149],
    ]),
    'vehicle.armed': makeSignal('vehicle.armed', [
      [0, 1],
      [148.9, 0],
    ]),
    'vehicle.landed': makeSignal('vehicle.landed', [
      [0, 1],
      [67.25, 0],
      [146.9, 1],
      [149, 1],
    ]),
    'vehicle.groundContact': makeSignal('vehicle.groundContact', [
      [0, 0],
      [146.03, 1],
      [149, 1],
    ]),
    'vehicle.maybeLanded': makeSignal('vehicle.maybeLanded', [
      [0, 0],
      [146.55, 1],
      [149, 1],
    ]),
    'takeoff.state': makeSignal('takeoff.state', [
      [0, 3],
      [66.44, 4],
      [69.44, 5],
      [146.9, 3],
    ]),
    'estimator.csInAir': makeSignal('estimator.csInAir', [
      [0, 0],
      [67.47, 1],
    ]),
    'estimator.csGroundEffect': makeSignal('estimator.csGroundEffect', [
      [0, 0],
      [67.47, 1],
    ]),
    'vehicleCommand.command': makeSignal('vehicleCommand.command', [
      [0, 0],
      [147.05, 400],
    ]),
  };

  const groups = buildEventGroups(buildTimeline(signals, analysisCapability));
  const takeoffGroup = groups.find((item) => item.phase === 'takeoff');
  const landingGroup = groups.find((item) => item.phase === 'landing');

  assert.equal(groups.filter((item) => item.phase === 'takeoff').length, 1);
  assert.equal(groups.filter((item) => item.phase === 'landing').length, 1);
  assert.ok(takeoffGroup);
  assert.ok(landingGroup);
  assert.ok(takeoffGroup.rawEvents.some((event) => event.code === 'TAKEOFF_COMPLETED'));
  assert.ok(takeoffGroup.rawEvents.some((event) => event.code === 'TAKEOFF_DETECTED'));
  assert.ok(takeoffGroup.rawEvents.some((event) => event.detail === 'FLIGHT -> UNKNOWN_5'));
  assert.ok(takeoffGroup.evidenceEvents.some((event) => event.type === 'estimator'));
  assert.ok(landingGroup.rawEvents.some((event) => event.code === 'GROUND_CONTACT_STARTED'));
  assert.ok(landingGroup.rawEvents.some((event) => event.code === 'LANDED_DETECTED'));
  assert.ok(landingGroup.rawEvents.some((event) => event.code === 'DISARMED'));
  assert.ok(landingGroup.rawEvents.some((event) => event.detail === 'UNKNOWN_5 -> RAMPUP'));
  assert.equal(takeoffGroup.chartPreset, 'takeoffEvidence');
  assert.equal(landingGroup.chartPreset, 'landingEvidence');
});

test('V1.2 timeline reports airborne log end only as suspected state', () => {
  const signals = {
    'log.timeS': makeSignal('log.timeS', [
      [0, 0],
      [10, 10],
    ]),
    'vehicle.armed': makeSignal('vehicle.armed', [
      [0, 1],
      [10, 1],
    ]),
    'vehicle.landed': makeSignal('vehicle.landed', [
      [0, 0],
      [10, 0],
    ]),
    'position.altitudeRelative': makeSignal('position.altitudeRelative', [
      [0, 8],
      [10, 12],
    ]),
  };

  const timeline = buildTimeline(signals, analysisCapability);
  const event = timeline.find((item) => item.code === 'LOG_ENDED_WHILE_AIRBORNE_SUSPECTED');

  assert.equal(event?.severity, 'warning');
  assert.match(event?.detail || '', /suspected state/);
});

test('V1.3 flight process summarizes localization, failsafe, and position comparison', () => {
  const signals = {
    'estimator.csGnssPos': makeSignal('estimator.csGnssPos', [
      [0, 0],
      [5, 1],
      [20, 1],
      [25, 0],
    ]),
    'estimator.csEvPos': makeSignal('estimator.csEvPos', [
      [0, 0],
      [10, 1],
      [30, 1],
    ]),
    'vehicle.failsafe': makeSignal('vehicle.failsafe', [
      [0, 0],
      [12, 1],
      [18, 0],
    ]),
    'vehicle.navState': makeSignal('vehicle.navState', [
      [0, 7],
      [20, 5],
    ]),
    'failsafeFlag.offboardControlSignalLost': makeSignal('failsafeFlag.offboardControlSignalLost', [
      [0, 0],
      [12, 1],
      [18, 0],
    ]),
    'position.setpoint.x': makeSignal('position.setpoint.x', [
      [0, 0],
      [1, 2],
    ]),
    'position.actual.x': makeSignal('position.actual.x', [
      [0, 0],
      [1, 1.8],
    ]),
    'position.vision.x': makeSignal('position.vision.x', [
      [0, 0],
      [1, 1.7],
    ]),
  };

  const flightProcess = buildFlightProcess({ signals });
  const gnss = flightProcess.localizationSources.find((item) => item.id === 'gnss_pos');
  const vision = flightProcess.localizationSources.find((item) => item.id === 'vision_pos');
  const xAxis = flightProcess.positionComparison.find((item) => item.axis === 'x');

  assert.deepEqual(gnss?.activeIntervals, [{ startS: 5, endS: 25 }]);
  assert.equal(vision?.available, true);
  assert.equal(flightProcess.failsafeEvents.length, 1);
  assert.equal(flightProcess.failsafeEvents[0].activeFlags[0].id, 'offboard_control_signal_lost');
  assert.equal(flightProcess.failsafeEvents[0].durationS, 6);
  assert.deepEqual(
    xAxis?.series.map((item) => item.kind),
    ['setpoint', 'actual', 'vision'],
  );

  const flightProcessGroup = buildFlightProcessEventGroup(
    signals,
    [
      {
        phase: 'takeoff',
        startTimeS: 0,
        endTimeS: 5,
      },
      {
        phase: 'landing',
        startTimeS: 25,
        endTimeS: 30,
      },
    ],
    flightProcess,
  );

  assert.equal(flightProcessGroup?.phase, 'flight_process');
  assert.equal(flightProcessGroup?.startTimeS, 5);
  assert.equal(flightProcessGroup?.endTimeS, 25);
  assert.equal(flightProcessGroup?.rawEvents.length, 3);
  assert.ok(flightProcessGroup?.evidenceLinks?.some((link) => link.chartGroupId === 'flight_process_position_comparison'));
});
