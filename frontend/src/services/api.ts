import type {
  BatchAnalyzeLogsResponse,
  BatchControlQualityResponse,
  ChartDataResponse,
  ControlQualityPayload,
  ControlQualityReport,
  FetchLogListParams,
  IncidentAnalysisResponse,
  LogListResponse,
  UploadLogResponse,
} from '../types/log'
import type {
  CalculateTuningMetricsPayload,
  CalculateTuningProposalPayload,
  CalculateTuningReviewPayload,
  TuningMetricsResponse,
  TuningProposalResponse,
  TuningReviewResponse,
} from '../types/tuning'

const API_BASE_URL = 'http://localhost:3001/api'

export async function uploadLogFile(file: File): Promise<UploadLogResponse> {
  const formData = new FormData()
  formData.append('logFile', file)

  const response = await fetch(`${API_BASE_URL}/logs/upload`, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    throw new Error('UPLOAD_FAILED')
  }

  return response.json()
}

export async function batchAnalyzeLogFiles(
  files: File[],
): Promise<BatchAnalyzeLogsResponse> {
  const formData = new FormData()
  files.forEach((file) => {
    formData.append('logFiles', file)
  })

  const response = await fetch(`${API_BASE_URL}/logs/batch-analyze`, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    let errorMessage = 'BATCH_ANALYZE_FAILED'
    try {
      const payload = await response.json()
      if (payload && typeof payload.message === 'string') {
        errorMessage = payload.message
      }
    } catch {
      // ignore JSON parse error and keep default message
    }
    throw new Error(errorMessage)
  }

  return response.json()
}

export async function batchCalculateControlQuality(
  files: File[],
): Promise<BatchControlQualityResponse> {
  const formData = new FormData()
  files.forEach((file) => {
    formData.append('logFiles', file)
  })

  const response = await fetch(`${API_BASE_URL}/logs/control-quality/batch`, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    let errorMessage = 'BATCH_CONTROL_QUALITY_FAILED'
    try {
      const payload = await response.json()
      if (payload && typeof payload.message === 'string') {
        errorMessage = payload.message
      }
    } catch {
      // ignore JSON parse error and keep default message
    }
    throw new Error(errorMessage)
  }

  return response.json()
}

export async function fetchChartData(
  logId: string,
  role?: string,
): Promise<ChartDataResponse> {
  const query = new URLSearchParams({ logId })
  if (role) {
    query.set('role', role)
  }
  const response = await fetch(
    `${API_BASE_URL}/logs/chart-data?${query.toString()}`,
  )

  if (!response.ok) {
    let errorMessage = 'FETCH_CHART_DATA_FAILED'
    try {
      const payload = await response.json()
      if (payload && typeof payload.message === 'string') {
        errorMessage = payload.message
      }
    } catch {
      // ignore JSON parse error and keep default message
    }
    throw new Error(errorMessage)
  }

  return response.json()
}

export async function runIncidentAnalysis(
  logId: string,
): Promise<IncidentAnalysisResponse> {
  const response = await fetch(`${API_BASE_URL}/logs/${logId}/incident-analysis`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  })

  if (!response.ok) {
    let errorMessage = 'INCIDENT_ANALYSIS_FAILED'
    try {
      const payload = await response.json()
      if (payload && typeof payload.message === 'string') {
        errorMessage = payload.message
      }
    } catch {
      // ignore JSON parse error and keep default message
    }
    throw new Error(errorMessage)
  }

  return response.json()
}

export async function fetchLogList(
  params?: FetchLogListParams,
): Promise<LogListResponse> {
  const query = new URLSearchParams()
  if (params?.q) query.set('q', params.q)
  if (params?.page) query.set('page', String(params.page))
  if (params?.pageSize) query.set('pageSize', String(params.pageSize))
  const queryString = query.toString()

  const response = await fetch(
    `${API_BASE_URL}/logs${queryString ? `?${queryString}` : ''}`,
  )

  if (!response.ok) {
    throw new Error('FETCH_LOG_LIST_FAILED')
  }

  return response.json()
}

export async function calculateControlQuality(
  payload: ControlQualityPayload,
): Promise<ControlQualityReport> {
  const response = await fetch(`${API_BASE_URL}/logs/control-quality`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...payload, format: 'json' }),
  })

  if (!response.ok) {
    throw new Error('CONTROL_QUALITY_FAILED')
  }

  return response.json()
}

export async function exportControlQualityCsv(
  payload: ControlQualityPayload,
): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/logs/control-quality`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...payload, format: 'csv' }),
  })

  if (!response.ok) {
    throw new Error('CONTROL_QUALITY_CSV_FAILED')
  }

  return response.text()
}

export async function calculateTuningMetrics(
  payload: CalculateTuningMetricsPayload,
): Promise<TuningMetricsResponse> {
  const response = await fetch(`${API_BASE_URL}/tuning/metrics`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    let errorMessage = 'CALCULATE_TUNING_METRICS_FAILED'
    try {
      const errorPayload = await response.json()
      if (errorPayload && typeof errorPayload.message === 'string') {
        errorMessage = errorPayload.message
      }
    } catch {
      // ignore JSON parse error and keep default message
    }
    throw new Error(errorMessage)
  }

  return response.json()
}

export async function calculateTuningProposal(
  payload: CalculateTuningProposalPayload,
): Promise<TuningProposalResponse> {
  const response = await fetch(`${API_BASE_URL}/tuning/propose`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    let errorMessage = 'CALCULATE_TUNING_PROPOSAL_FAILED'
    try {
      const errorPayload = await response.json()
      if (errorPayload && typeof errorPayload.message === 'string') {
        errorMessage = errorPayload.message
      }
    } catch {
      // ignore JSON parse error and keep default message
    }
    throw new Error(errorMessage)
  }

  return response.json()
}

export async function calculateTuningReview(
  payload: CalculateTuningReviewPayload,
): Promise<TuningReviewResponse> {
  const response = await fetch(`${API_BASE_URL}/tuning/review`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    let errorMessage = 'CALCULATE_TUNING_REVIEW_FAILED'
    try {
      const errorPayload = await response.json()
      if (errorPayload && typeof errorPayload.message === 'string') {
        errorMessage = errorPayload.message
      }
    } catch {
      // ignore JSON parse error and keep default message
    }
    throw new Error(errorMessage)
  }

  return response.json()
}
