const test = require('node:test');
const assert = require('node:assert/strict');
const {
  proposeTuningChanges,
} = require('./tuningProposalService');

function createBaseRequest() {
  return {
    axis: 'roll',
    loop: 'rate',
    currentParams: {
      p: 0.15,
      i: 0.2,
      d: 0.003,
    },
    bounds: {
      p: {
        min: 0.05,
        max: 0.3,
        maxStepPercent: 5,
      },
      i: {
        min: 0.02,
        max: 0.4,
        maxStepPercent: 5,
      },
      d: {
        min: 0.0005,
        max: 0.01,
        maxStepPercent: 8,
      },
    },
    metrics: {
      trackingErrorRms: 0.1,
      trackingErrorPeak: 0.3,
      overshootPercent: null,
      settlingTimeS: null,
      phaseDelayMs: 50,
      dominantOscillationHz: 8,
      oscillationScore: 0.2,
      actuatorSaturationRatio: 0.01,
      motorClippingDurationS: 0.1,
    },
  };
}

function assertNoNonFiniteNumbers(value) {
  if (typeof value === 'number') {
    assert.ok(Number.isFinite(value));
    return;
  }

  if (Array.isArray(value)) {
    value.forEach(assertNoNonFiniteNumbers);
    return;
  }

  if (value && typeof value === 'object') {
    Object.values(value).forEach(assertNoNonFiniteNumbers);
  }
}

test('returns rejected when actuator saturation ratio is high', () => {
  const request = createBaseRequest();
  request.metrics.actuatorSaturationRatio = 0.08;

  const result = proposeTuningChanges(request);

  assert.equal(result.status, 'rejected');
  assert.equal(result.changes.length, 0);
  assert.match(result.warnings.join(' '), /saturation/i);
});

test('reduces P when overshoot is high and actuator is not saturated', () => {
  const request = createBaseRequest();
  request.metrics.overshootPercent = 25;
  request.metrics.oscillationScore = 0.2;

  const result = proposeTuningChanges(request);
  const pChange = result.changes.find((item) => item.key === 'p');

  assert.equal(result.status, 'proposal_generated');
  assert.ok(pChange);
  assert.equal(pChange.parameter, 'MC_ROLLRATE_P');
  assert.ok(pChange.to < pChange.from);
  assert.equal(pChange.reasonCode, 'HIGH_OVERSHOOT');
});

test('increases P when tracking error and phase delay are high with low oscillation', () => {
  const request = createBaseRequest();
  request.metrics.trackingErrorRms = 0.35;
  request.metrics.phaseDelayMs = 500;
  request.metrics.oscillationScore = 0.1;

  const result = proposeTuningChanges(request);
  const pChange = result.changes.find((item) => item.key === 'p');

  assert.equal(result.status, 'proposal_generated');
  assert.ok(pChange);
  assert.ok(pChange.to > pChange.from);
  assert.equal(pChange.changePercent, 5);
});

test('high oscillation never increases P or D', () => {
  const request = createBaseRequest();
  request.metrics.oscillationScore = 0.75;
  request.metrics.overshootPercent = 30;

  const result = proposeTuningChanges(request);

  assert.equal(result.status, 'proposal_generated');
  for (const change of result.changes.filter((item) => item.key === 'p' || item.key === 'd')) {
    assert.ok(change.changePercent <= 0);
  }
});

test('attitude loop returns no_change with a warning', () => {
  const request = createBaseRequest();
  request.loop = 'attitude';

  const result = proposeTuningChanges(request);

  assert.equal(result.status, 'no_change');
  assert.equal(result.changes.length, 0);
  assert.match(result.warnings.join(' '), /attitude loop/i);
});

test('changes do not exceed maxStepPercent', () => {
  const request = createBaseRequest();
  request.metrics.trackingErrorRms = 0.4;
  request.metrics.phaseDelayMs = 250;
  request.metrics.oscillationScore = 0.1;
  request.bounds.p.maxStepPercent = 2;

  const result = proposeTuningChanges(request);
  const pChange = result.changes.find((item) => item.key === 'p');

  assert.ok(pChange);
  assert.ok(Math.abs(pChange.changePercent) <= 2);
});

test('changes stay within min and max bounds', () => {
  const request = createBaseRequest();
  request.currentParams.p = 0.051;
  request.currentParams.d = 0.0099;
  request.metrics.overshootPercent = 30;
  request.metrics.oscillationScore = 0.2;

  const result = proposeTuningChanges(request);
  const pChange = result.changes.find((item) => item.key === 'p');
  const dChange = result.changes.find((item) => item.key === 'd');

  assert.ok(pChange);
  assert.ok(dChange);
  assert.ok(pChange.to >= request.bounds.p.min);
  assert.ok(dChange.to <= request.bounds.d.max);
});

test('output does not contain NaN or Infinity', () => {
  const request = createBaseRequest();
  request.metrics.phaseDelayMs = Number.POSITIVE_INFINITY;
  request.metrics.overshootPercent = Number.NaN;

  const result = proposeTuningChanges(request);

  assertNoNonFiniteNumbers(result);
});
