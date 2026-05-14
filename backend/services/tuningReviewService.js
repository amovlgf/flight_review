const {
  VALID_TUNING_AXES,
  VALID_TUNING_LOOPS,
} = require('./tuningMetricsService');

const VALID_REVIEW_STATUSES = [
  'approved_for_sitl_only',
  'manual_review_required',
  'rejected',
];
const VALID_RISK_LEVELS = ['low', 'medium', 'high'];
const SUSPICIOUS_PARAMETER_KEYS = ['recommendedParams', 'changes', 'newPidValues'];

const REVIEW_SYSTEM_INSTRUCTIONS = [
  'You are a reviewer, not a controller.',
  'Do not output new PID values.',
  'Do not approve direct real-flight application.',
  'Review only the provided local rule-engine proposal for offline log analysis and SITL-style follow-up.',
  'If the evidence is incomplete or risky, require manual review.',
  'Output JSON only.',
].join(' ');

const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'reviewStatus',
    'riskLevel',
    'summary',
    'concerns',
    'recommendations',
    'warnings',
  ],
  properties: {
    reviewStatus: {
      type: 'string',
      enum: VALID_REVIEW_STATUSES,
    },
    riskLevel: {
      type: 'string',
      enum: VALID_RISK_LEVELS,
    },
    summary: {
      type: 'string',
    },
    concerns: {
      type: 'array',
      items: { type: 'string' },
    },
    recommendations: {
      type: 'array',
      items: { type: 'string' },
    },
    warnings: {
      type: 'array',
      items: { type: 'string' },
    },
  },
};

function pushWarning(warnings, message) {
  if (!warnings.includes(message)) {
    warnings.push(message);
  }
}

function sanitizeStringArray(values) {
  if (!Array.isArray(values)) return [];

  return values
    .filter((value) => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean);
}

function buildReviewResponse({
  reviewStatus,
  riskLevel,
  summary,
  concerns = [],
  recommendations = [],
  warnings = [],
}) {
  return {
    reviewStatus,
    riskLevel,
    summary: typeof summary === 'string' ? summary : '',
    concerns: sanitizeStringArray(concerns),
    recommendations: sanitizeStringArray(recommendations),
    warnings: sanitizeStringArray(warnings),
  };
}

function extractProposalWarnings(request) {
  return sanitizeStringArray(request?.proposal?.warnings);
}

function buildRejectedByRuleResponse(request) {
  const concerns = extractProposalWarnings(request);

  return buildReviewResponse({
    reviewStatus: 'rejected',
    riskLevel: 'high',
    summary:
      'The local conservative rule engine already rejected this proposal, so LLM review is not used to override it.',
    concerns:
      concerns.length > 0
        ? concerns
        : ['The local conservative rule engine rejected the PID proposal.'],
    recommendations: [
      'Inspect actuator saturation and offline log conditions before attempting any further PID gain changes.',
    ],
    warnings: [],
  });
}

function buildManualReviewResponse({
  summary,
  concerns = [],
  recommendations = [],
  warnings = [],
}) {
  return buildReviewResponse({
    reviewStatus: 'manual_review_required',
    riskLevel: 'medium',
    summary,
    concerns,
    recommendations,
    warnings,
  });
}

function containsSuspiciousParameterKeys(value) {
  if (!value || typeof value !== 'object') {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some(containsSuspiciousParameterKeys);
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (SUSPICIOUS_PARAMETER_KEYS.includes(key)) {
      return true;
    }
    if (containsSuspiciousParameterKeys(nestedValue)) {
      return true;
    }
  }

  return false;
}

function isValidReviewPayload(payload) {
  return (
    payload &&
    typeof payload === 'object' &&
    VALID_REVIEW_STATUSES.includes(payload.reviewStatus) &&
    VALID_RISK_LEVELS.includes(payload.riskLevel) &&
    typeof payload.summary === 'string' &&
    Array.isArray(payload.concerns) &&
    Array.isArray(payload.recommendations) &&
    Array.isArray(payload.warnings)
  );
}

function extractResponseText(responsePayload) {
  if (typeof responsePayload?.output_text === 'string') {
    return responsePayload.output_text;
  }

  if (!Array.isArray(responsePayload?.output)) {
    return '';
  }

  const textChunks = [];
  for (const item of responsePayload.output) {
    if (!Array.isArray(item?.content)) continue;
    for (const contentItem of item.content) {
      if (typeof contentItem?.text === 'string') {
        textChunks.push(contentItem.text);
      }
    }
  }

  return textChunks.join('\n').trim();
}

function buildReviewPromptInput(request) {
  return JSON.stringify(
    {
      task: 'Review a locally-generated PID proposal for offline log review only.',
      constraints: {
        reviewerOnly: true,
        doNotGeneratePidValues: true,
        doNotApproveRealFlight: true,
        allowedOutcome: 'Review the supplied proposal only.',
      },
      reviewContext: {
        axis: request.axis,
        loop: request.loop,
        stage: request.stage,
        vehicle: request.vehicle,
        currentParams: request.currentParams,
        bounds: request.bounds,
        metrics: request.metrics,
        proposal: request.proposal,
      },
      outputContract: {
        reviewStatus: VALID_REVIEW_STATUSES,
        riskLevel: VALID_RISK_LEVELS,
        summary: 'string',
        concerns: ['string'],
        recommendations: ['string'],
        warnings: ['string'],
      },
    },
    null,
    2,
  );
}

async function callOpenAiReviewer(request, options) {
  const apiKey = options.apiKey;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const model = options.model ?? 'gpt-5.2';
  const endpoint = options.endpoint ?? 'https://api.openai.com/v1/responses';

  if (typeof fetchImpl !== 'function') {
    throw new Error('FETCH_UNAVAILABLE');
  }

  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      store: false,
      instructions: REVIEW_SYSTEM_INSTRUCTIONS,
      input: buildReviewPromptInput(request),
      text: {
        format: {
          type: 'json_schema',
          name: 'pid_tuning_review',
          strict: true,
          schema: REVIEW_SCHEMA,
        },
      },
    }),
  });

  if (!response?.ok) {
    let errorText = '';
    try {
      errorText = await response.text();
    } catch {
      errorText = '';
    }
    throw new Error(`OPENAI_HTTP_${response?.status || 0}:${errorText}`);
  }

  return response.json();
}

async function reviewTuningProposal(request, options = {}) {
  const axis = VALID_TUNING_AXES.includes(request?.axis) ? request.axis : 'roll';
  const loop = VALID_TUNING_LOOPS.includes(request?.loop) ? request.loop : 'rate';
  const normalizedRequest = {
    ...request,
    axis,
    loop,
  };

  if (normalizedRequest?.proposal?.status === 'rejected') {
    return buildRejectedByRuleResponse(normalizedRequest);
  }

  const env = options.env ?? process.env;
  const apiKey = options.apiKey ?? env.OPENAI_API_KEY;
  const model = options.model ?? env.OPENAI_REVIEW_MODEL ?? env.OPENAI_MODEL ?? 'gpt-5.2';
  const proposalWarnings = extractProposalWarnings(normalizedRequest);

  if (!apiKey) {
    return buildManualReviewResponse({
      summary:
        'OpenAI review is unavailable, so only the local rule-engine result can be used at this stage.',
      concerns: proposalWarnings,
      recommendations: [
        'Keep the proposal in manual review until an LLM reviewer is configured or a human reviewer signs off.',
      ],
      warnings: ['OpenAI API key is not configured.'],
    });
  }

  try {
    const responsePayload = await callOpenAiReviewer(normalizedRequest, {
      apiKey,
      model,
      fetchImpl: options.fetchImpl,
      endpoint: options.endpoint,
    });
    const responseText = extractResponseText(responsePayload);

    let parsedReview;
    try {
      parsedReview = JSON.parse(responseText);
    } catch {
      return buildManualReviewResponse({
        summary:
          'The LLM response could not be parsed safely, so manual review is required.',
        concerns: proposalWarnings,
        recommendations: [
          'Re-run the review after checking the LLM response formatting.',
        ],
        warnings: ['Invalid LLM JSON response.'],
      });
    }

    if (containsSuspiciousParameterKeys(parsedReview)) {
      return buildManualReviewResponse({
        summary:
          'The LLM attempted to provide parameter values, so the review was downgraded to manual review.',
        concerns: proposalWarnings,
        recommendations: [
          'Discard any generated parameter values and continue with human review only.',
        ],
        warnings: ['LLM attempted to provide parameter values.'],
      });
    }

    if (!isValidReviewPayload(parsedReview)) {
      return buildManualReviewResponse({
        summary:
          'The LLM response did not match the expected review contract, so manual review is required.',
        concerns: proposalWarnings,
        recommendations: [
          'Inspect the raw LLM response contract before using it for review decisions.',
        ],
        warnings: ['Invalid LLM JSON response.'],
      });
    }

    return buildReviewResponse(parsedReview);
  } catch {
    return buildManualReviewResponse({
      summary:
        'LLM review could not be completed, so the proposal must remain in manual review.',
      concerns: proposalWarnings,
      recommendations: [
        'Rely on the local rule-engine output and require human review before any next step.',
      ],
      warnings: ['LLM review failed.'],
    });
  }
}

module.exports = {
  REVIEW_SYSTEM_INSTRUCTIONS,
  callOpenAiReviewer,
  reviewTuningProposal,
};
