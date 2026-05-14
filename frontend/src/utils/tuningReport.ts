import type {
  TuningAxis,
  TuningLoop,
  TuningMetricsResponse,
  TuningParamNames,
  TuningPidValues,
  TuningProposalResponse,
  TuningReviewResponse,
  TuningSafetyBounds,
} from '../types/tuning'

type TuningReportInput = {
  axis: TuningAxis
  loop: TuningLoop
  generatedAt?: string
  parameterNames: TuningParamNames
  pidValues: TuningPidValues
  safetyBounds: TuningSafetyBounds
  metricsResult: TuningMetricsResponse
  proposalResult?: TuningProposalResponse | null
  reviewResult?: TuningReviewResponse | null
}

const METRIC_KEYS: Array<keyof TuningMetricsResponse['metrics']> = [
  'trackingErrorRms',
  'trackingErrorPeak',
  'overshootPercent',
  'settlingTimeS',
  'phaseDelayMs',
  'dominantOscillationHz',
  'oscillationScore',
  'actuatorSaturationRatio',
  'motorClippingDurationS',
]

function formatValue(value: number | string | null | undefined) {
  if (value === null || value === undefined) return 'N/A'
  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? value.toFixed(6).replace(/\.?0+$/, '')
      : 'N/A'
  }

  const trimmed = value.trim()
  return trimmed ? trimmed : 'N/A'
}

function renderList(items: string[]) {
  if (!items.length) return 'None'
  return items.map((item) => `- ${item}`).join('\n')
}

function buildNextStep(
  proposalResult?: TuningProposalResponse | null,
  reviewResult?: TuningReviewResponse | null,
) {
  if (
    proposalResult?.status === 'rejected' ||
    reviewResult?.reviewStatus === 'rejected'
  ) {
    return 'Inspect actuator saturation, the selected test segment, propulsion margin, and log conditions. PID gain changes are not recommended at this stage.'
  }

  if (reviewResult?.reviewStatus === 'approved_for_sitl_only') {
    return 'Validate the proposal only in SITL or a controlled low-risk test before considering any real-world use.'
  }

  if (reviewResult?.reviewStatus === 'manual_review_required') {
    return 'Escalate this result for human review before considering any parameter change.'
  }

  return 'Generate Safety / AI Review or request human review before considering any parameter change.'
}

export function buildTuningMarkdownReport(input: TuningReportInput): string {
  const generatedAt = input.generatedAt ?? new Date().toISOString()
  const proposalResult = input.proposalResult ?? null
  const reviewResult = input.reviewResult ?? null

  const currentPidTable = ['P', 'I', 'D']
    .map((key) => {
      const upperKey = key as keyof TuningPidValues
      return `| ${key} | ${input.parameterNames[upperKey] ?? 'N/A'} | ${formatValue(input.pidValues[upperKey])} |`
    })
    .join('\n')

  const boundsTable = ['P', 'I', 'D']
    .map((key) => {
      const upperKey = key as keyof TuningSafetyBounds
      const bound = input.safetyBounds[upperKey]
      return `| ${key} | ${formatValue(bound.min)} | ${formatValue(bound.max)} | ${formatValue(bound.maxStepPercent)} |`
    })
    .join('\n')

  const metricsTable = METRIC_KEYS.map(
    (metricKey) =>
      `| ${metricKey} | ${formatValue(input.metricsResult.metrics[metricKey])} |`,
  ).join('\n')

  const metricsWarnings = renderList(input.metricsResult.warnings)

  const proposalSection = proposalResult
    ? [
        `- Status: ${proposalResult.status}`,
        proposalResult.status === 'rejected'
          ? '- Note: The local conservative tuning engine rejected this proposal.'
          : null,
        '',
        '### Changes',
        proposalResult.changes.length
          ? proposalResult.changes
              .map(
                (change) =>
                  `- ${change.parameter}: ${formatValue(change.from)} -> ${formatValue(change.to)} (${formatValue(change.changePercent)}%)\n  - Reason Code: ${change.reasonCode}\n  - Reason: ${change.reason}`,
              )
              .join('\n')
          : 'None',
        '',
        '### Unchanged',
        proposalResult.unchanged.length
          ? proposalResult.unchanged
              .map(
                (item) =>
                  `- ${item.parameter}: ${formatValue(item.value)}\n  - Reason: ${item.reason}`,
              )
              .join('\n')
          : 'None',
        '',
        '### Warnings',
        renderList(proposalResult.warnings),
      ]
        .filter(Boolean)
        .join('\n')
    : 'Not generated yet.'

  const reviewSection = reviewResult
    ? [
        `- Review Status: ${reviewResult.reviewStatus}`,
        `- Risk Level: ${reviewResult.riskLevel}`,
        `- Summary: ${reviewResult.summary}`,
        '',
        '### Concerns',
        renderList(reviewResult.concerns),
        '',
        '### Recommendations',
        renderList(reviewResult.recommendations),
        '',
        '### Warnings',
        renderList(reviewResult.warnings),
      ].join('\n')
    : 'Not generated yet.'

  return [
    '# PX4 PID Tuning Report',
    '',
    '## Basic Information',
    `- Stage: offline_log_review`,
    `- Axis: ${input.axis}`,
    `- Loop: ${input.loop}`,
    `- Generated At: ${generatedAt}`,
    `- Validation Status: Offline log review only`,
    '',
    '## Current PID Parameters',
    '| Key | PX4 Parameter | Value |',
    '| --- | --- | --- |',
    currentPidTable,
    '',
    '## Parameter Bounds',
    '| Key | Min | Max | Max Step Percent |',
    '| --- | --- | --- | --- |',
    boundsTable,
    '',
    '## Tracking Performance Metrics',
    '| Metric | Value |',
    '| --- | --- |',
    metricsTable,
    '',
    '## Metrics Warnings',
    metricsWarnings,
    '',
    '## Candidate PID Proposal',
    proposalSection,
    '',
    '## Safety / AI Review',
    reviewSection,
    '',
    '## Safety Notes',
    '- This report is generated from offline flight-log analysis.',
    '- Do not automatically apply these parameters to a real vehicle.',
    '- Validate any parameter change in SITL or a controlled low-risk test before real flight.',
    '- If actuator saturation is high, do not increase PID gains.',
    '- Human review is required before applying parameters to a real vehicle.',
    '',
    '## Next Step',
    buildNextStep(proposalResult, reviewResult),
    '',
  ].join('\n')
}

export function downloadMarkdownReport(markdown: string, filename: string): void {
  const blob = new Blob([markdown], {
    type: 'text/markdown;charset=utf-8',
  })
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(objectUrl)
}
