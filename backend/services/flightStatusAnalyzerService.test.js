const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeFlightStatus } = require('./flightStatusAnalyzerService');

function signal(id, points) {
  return { id, points };
}

test('flight-summary status analyzer summarizes failsafe windows with phase and mode context', () => {
  const status = analyzeFlightStatus({
    signals: {
      'vehicle.failsafe': signal('vehicle.failsafe', [
        [0, 0],
        [12, 1],
        [18, 0],
      ]),
      'vehicle.navState': signal('vehicle.navState', [
        [0, 3],
        [12, 5],
      ]),
      'failsafeFlag.localPosition': signal('failsafeFlag.localPosition', [
        [0, 0],
        [12, 1],
        [18, 0],
      ]),
      'vehicle.localPositionValid': signal('vehicle.localPositionValid', [
        [0, 1],
        [12, 0],
        [20, 1],
      ]),
      'vehicle.globalPositionValid': signal('vehicle.globalPositionValid', [
        [0, 1],
        [20, 1],
      ]),
    },
    phases: [
      { id: 'normal_flight', name: '正常飞行', startS: 8, endS: 30 },
    ],
  });

  assert.equal(status.failsafe.triggered, true);
  assert.equal(status.failsafe.events[0].startS, 12);
  assert.equal(status.failsafe.events[0].endS, 18);
  assert.equal(status.failsafe.events[0].phaseId, 'normal_flight');
  assert.equal(status.failsafe.events[0].mode, 'AUTO_RTL');
  assert.deepEqual(status.failsafe.events[0].activeFlags, ['local_position']);
});

test('flight-summary status analyzer summarizes estimator and positioning availability', () => {
  const status = analyzeFlightStatus({
    signals: {
      'vehicle.localPositionValid': signal('vehicle.localPositionValid', [
        [0, 1],
        [10, 1],
      ]),
      'vehicle.globalPositionValid': signal('vehicle.globalPositionValid', [
        [0, 0],
        [10, 1],
      ]),
      'gps.fixType': signal('gps.fixType', [
        [0, 2],
        [10, 4],
      ]),
      'gps.satellitesUsed': signal('gps.satellitesUsed', [
        [0, 8],
        [10, 15],
      ]),
      'estimator.csBaroHgt': signal('estimator.csBaroHgt', [
        [0, 1],
        [10, 1],
      ]),
    },
    phases: [],
  });

  assert.equal(status.estimator.status, 'partial');
  assert.equal(status.estimator.localPositionValid, true);
  assert.equal(status.estimator.globalPositionValid, true);
  assert.equal(status.estimator.gpsStatus, '3D/DGPS fix');
  assert.equal(status.estimator.heightSource, 'baro');
  assert.ok(status.estimator.changes.some((item) => item.signal === 'vehicle.globalPositionValid'));
});
