export type TuningAxis = 'roll' | 'pitch' | 'yaw'

export type TuningLoop = 'rate' | 'attitude'

export type TuningGainKey = 'P' | 'I' | 'D'

export type TuningProposalGainKey = 'p' | 'i' | 'd'

export type TuningPidValues = Record<TuningGainKey, string>

export type TuningSafetyBound = {
  min: string
  max: string
  maxStepPercent: string
}

export type TuningSafetyBounds = Record<TuningGainKey, TuningSafetyBound>

export type TuningParamNames = Record<TuningGainKey, string | null>

export type TuningSegment = {
  startS?: number
  endS?: number
}

export type TuningSegmentSource = 'chart_selection' | 'manual' | 'default'

export type TuningSegmentState = {
  startS: number | null
  endS: number | null
  source: TuningSegmentSource
}

export type TuningSeriesPoint = {
  timeS: number
  value: number
}

export type TuningSegmentQualityStatus =
  | 'good'
  | 'warning'
  | 'bad'
  | 'unknown'

export type TuningSegmentQualityMetrics = {
  durationS: number | null
  setpointRangeDeg: number | null
  actualRangeDeg: number | null
  sampleCount: number
  rmsErrorDeg: number | null
  peakErrorDeg: number | null
}

export type TuningSegmentQualityResult = {
  status: TuningSegmentQualityStatus
  score: number
  summary: string
  reasons: string[]
  recommendations: string[]
  metrics: TuningSegmentQualityMetrics
}

export type TuningMetrics = {
  trackingErrorRms: number
  trackingErrorPeak: number
  overshootPercent: number | null
  settlingTimeS: number | null
  phaseDelayMs: number | null
  dominantOscillationHz: number | null
  oscillationScore: number
  actuatorSaturationRatio: number | null
  motorClippingDurationS: number | null
}

export type CalculateTuningMetricsPayload = {
  logId: string
  axis: TuningAxis
  loop: TuningLoop
  segment?: TuningSegment
}

export type TuningMetricsResponse = {
  axis: TuningAxis
  loop: TuningLoop
  metrics: TuningMetrics
  warnings: string[]
}

export type TuningProposalBounds = {
  min: number
  max: number
  maxStepPercent: number
}

export type TuningProposalCurrentParams = Record<TuningProposalGainKey, number>

export type TuningProposalBoundsMap = Record<
  TuningProposalGainKey,
  TuningProposalBounds
>

export type CalculateTuningProposalPayload = {
  axis: TuningAxis
  loop: TuningLoop
  currentParams: TuningProposalCurrentParams
  bounds: TuningProposalBoundsMap
  metrics: TuningMetrics
}

export type TuningProposalStatus =
  | 'proposal_generated'
  | 'no_change'
  | 'rejected'

export type TuningProposalParameterNames = Record<
  TuningProposalGainKey,
  string | null
>

export type TuningProposalChange = {
  key: TuningProposalGainKey
  parameter: string
  from: number
  to: number
  changePercent: number
  reasonCode: string
  reason: string
}

export type TuningProposalUnchanged = {
  key: TuningProposalGainKey
  parameter: string
  value: number
  reason: string
}

export type TuningProposalResponse = {
  status: TuningProposalStatus
  axis: TuningAxis
  loop: TuningLoop
  parameterNames: TuningProposalParameterNames
  changes: TuningProposalChange[]
  unchanged: TuningProposalUnchanged[]
  warnings: string[]
}

export type TuningReviewStatus =
  | 'approved_for_sitl_only'
  | 'manual_review_required'
  | 'rejected'

export type TuningRiskLevel = 'low' | 'medium' | 'high'

export type TuningVehicle = {
  type: string
  frame: string
}

export type CalculateTuningReviewPayload = {
  axis: TuningAxis
  loop: TuningLoop
  stage: 'offline_log_review'
  vehicle: TuningVehicle
  currentParams: TuningProposalCurrentParams
  bounds: TuningProposalBoundsMap
  metrics: TuningMetrics
  proposal: TuningProposalResponse
}

export type TuningReviewResponse = {
  reviewStatus: TuningReviewStatus
  riskLevel: TuningRiskLevel
  summary: string
  concerns: string[]
  recommendations: string[]
  warnings: string[]
}
