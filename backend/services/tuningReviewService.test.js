const test = require('node:test');
const assert = require('node:assert/strict');
const { reviewTuningProposal } = require('./tuningReviewService');

function createReviewRequest() {
  return {
    axis: 'roll',
    loop: 'rate',
    stage: 'offline_log_review',
    vehicle: {
      type: 'multicopter',
      frame: 'quad_x',
    },
    currentParams: {
      p: 0.15,
      i: 0.2,
      d: 0.003,
    },
    bounds: {
      p: { min: 0.05, max: 0.3, maxStepPercent: 5 },
      i: { min: 0.02, max: 0.4, maxStepPercent: 5 },
      d: { min: 0.0005, max: 0.01, maxStepPercent: 8 },
    },
    metrics: {
      trackingErrorRms: 0.347998779336764,
      trackingErrorPeak: 1.757352941176473,
      overshootPercent: null,
      settlingTimeS: null,
      phaseDelayMs: 1764.7058823529412,
      dominantOscillationHz: 9.263671875,
      oscillationScore: 0.03776989446326182,
      actuatorSaturationRatio: 0.01,
      motorClippingDurationS: 0.7920792079207921,
    },
    proposal: {
      status: 'proposal_generated',
      axis: 'roll',
      loop: 'rate',
      parameterNames: {
        p: 'MC_ROLLRATE_P',
        i: 'MC_ROLLRATE_I',
        d: 'MC_ROLLRATE_D',
      },
      changes: [
        {
          key: 'p',
          parameter: 'MC_ROLLRATE_P',
          from: 0.15,
          to: 0.1575,
          changePercent: 5,
          reasonCode: 'HIGH_TRACKING_ERROR_PHASE_DELAY',
          reason:
            'Tracking error and phase delay are high while oscillation remains low, increase P conservatively.',
        },
      ],
      unchanged: [
        {
          key: 'i',
          parameter: 'MC_ROLLRATE_I',
          value: 0.2,
          reason: 'No strong evidence for changing I.',
        },
      ],
      warnings: [],
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

test('proposal.status rejected bypasses LLM and returns rejected/high', async () => {
  const request = createReviewRequest();
  request.proposal.status = 'rejected';
  request.proposal.warnings = [
    'Actuator saturation ratio is high; conservative rules block PID gain increases.',
  ];

  let fetchCallCount = 0;
  const result = await reviewTuningProposal(request, {
    apiKey: 'test-key',
    fetchImpl: async () => {
      fetchCallCount += 1;
      throw new Error('LLM should not be called');
    },
  });

  assert.equal(fetchCallCount, 0);
  assert.equal(result.reviewStatus, 'rejected');
  assert.equal(result.riskLevel, 'high');
  assert.match(result.summary, /rule engine/i);
  assert.match(result.concerns.join(' '), /saturation/i);
});

test('missing OPENAI_API_KEY returns manual_review_required', async () => {
  const request = createReviewRequest();

  const result = await reviewTuningProposal(request, {
    env: {},
  });

  assert.equal(result.reviewStatus, 'manual_review_required');
  assert.equal(result.riskLevel, 'medium');
  assert.match(result.warnings.join(' '), /OpenAI API key is not configured/i);
});

test('valid LLM JSON response is parsed successfully', async () => {
  const request = createReviewRequest();

  const result = await reviewTuningProposal(request, {
    apiKey: 'test-key',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          reviewStatus: 'approved_for_sitl_only',
          riskLevel: 'medium',
          summary: 'The proposal is acceptable for SITL-only validation.',
          concerns: ['Observe actuator saturation during SITL replay.'],
          recommendations: ['Run SITL replay before any further decision.'],
          warnings: ['Do not apply directly to a real vehicle.'],
        }),
      }),
    }),
  });

  assert.equal(result.reviewStatus, 'approved_for_sitl_only');
  assert.equal(result.riskLevel, 'medium');
  assert.equal(result.concerns.length, 1);
});

test('invalid LLM JSON returns manual_review_required', async () => {
  const request = createReviewRequest();

  const result = await reviewTuningProposal(request, {
    apiKey: 'test-key',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        output_text: 'not-json',
      }),
    }),
  });

  assert.equal(result.reviewStatus, 'manual_review_required');
  assert.match(result.warnings.join(' '), /Invalid LLM JSON response/i);
});

test('LLM parameter suggestion fields are rejected with manual review', async () => {
  const request = createReviewRequest();

  const result = await reviewTuningProposal(request, {
    apiKey: 'test-key',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          reviewStatus: 'approved_for_sitl_only',
          riskLevel: 'low',
          summary: 'Looks good.',
          concerns: [],
          recommendations: [],
          warnings: [],
          recommendedParams: {
            p: 0.14,
          },
        }),
      }),
    }),
  });

  assert.equal(result.reviewStatus, 'manual_review_required');
  assert.match(result.warnings.join(' '), /attempted to provide parameter values/i);
});

test('OpenAI API exception returns manual_review_required', async () => {
  const request = createReviewRequest();

  const result = await reviewTuningProposal(request, {
    apiKey: 'test-key',
    fetchImpl: async () => {
      throw new Error('network failed');
    },
  });

  assert.equal(result.reviewStatus, 'manual_review_required');
  assert.match(result.warnings.join(' '), /LLM review failed/i);
});

test('review output does not contain NaN or Infinity', async () => {
  const request = createReviewRequest();

  const result = await reviewTuningProposal(request, {
    env: {},
  });

  assertNoNonFiniteNumbers(result);
});
