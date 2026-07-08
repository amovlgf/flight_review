const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeFlightPhases } = require('./flightPhaseAnalyzerService');

function signal(id, points) {
  return { id, points };
}

test('flight-summary phase analyzer returns the five summary phases with mode changes', () => {
  const phases = analyzeFlightPhases({
    signals: {
      'log.timeS': signal('log.timeS', [
        [0, 0],
        [10, 10],
        [20, 20],
        [40, 40],
        [60, 60],
      ]),
      'vehicle.armed': signal('vehicle.armed', [
        [0, 0],
        [8, 1],
        [58, 0],
      ]),
      'vehicle.landed': signal('vehicle.landed', [
        [0, 1],
        [12, 0],
        [52, 1],
        [60, 1],
      ]),
      'vehicle.navState': signal('vehicle.navState', [
        [0, 0],
        [9, 9],
        [15, 3],
        [45, 10],
        [55, 0],
      ]),
      'position.altitudeRelative': signal('position.altitudeRelative', [
        [0, 0],
        [20, 12],
        [40, 10],
        [60, 0],
      ]),
    },
    modeSegments: [
      { start: 0, end: 9, mode: 'MANUAL', mode_code: 0, color: '#aaa' },
      { start: 9, end: 15, mode: 'AUTO_TAKEOFF', mode_code: 9, color: '#aaa' },
      { start: 15, end: 45, mode: 'AUTO_MISSION', mode_code: 3, color: '#aaa' },
      { start: 45, end: 55, mode: 'AUTO_LAND', mode_code: 10, color: '#aaa' },
      { start: 55, end: 60, mode: 'MANUAL', mode_code: 0, color: '#aaa' },
    ],
  });

  assert.deepEqual(
    phases.map((item) => item.id),
    ['ground_standby', 'takeoff', 'normal_flight', 'landing', 'landed_complete'],
  );
  assert.deepEqual(
    phases.map((item) => item.name),
    ['地面待机', '起飞', '正常飞行', '降落', '落地完成'],
  );
  assert.equal(phases[1].startS, 8);
  assert.equal(phases[1].endS, 15);
  assert.ok(phases[2].modeChanges.some((item) => item.mode === 'AUTO_MISSION'));
  assert.ok(phases.every((item) => item.durationS >= 0));
});
