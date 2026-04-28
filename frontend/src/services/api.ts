const API_BASE_URL = 'http://localhost:3001/api';

export async function uploadLogFile(file: File) {
  const formData = new FormData();
  formData.append('logFile', file);

  const response = await fetch(`${API_BASE_URL}/logs/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error('UPLOAD_FAILED');
  }

  return response.json();
}

export async function fetchChartData(logId: string, role: string) {
  const query = new URLSearchParams({
    logId,
    role,
  });
  const response = await fetch(
    `${API_BASE_URL}/logs/chart-data?${query.toString()}`,
  );

  if (!response.ok) {
    let errorMessage = 'FETCH_CHART_DATA_FAILED';
    try {
      const payload = await response.json();
      if (payload && typeof payload.message === 'string') {
        errorMessage = payload.message;
      }
    } catch {
      // ignore JSON parse error and keep default message
    }
    throw new Error(errorMessage);
  }

  return response.json();
}

export async function fetchLogList(params?: {
  q?: string;
  page?: number;
  pageSize?: number;
}) {
  const query = new URLSearchParams();
  if (params?.q) query.set('q', params.q);
  if (params?.page) query.set('page', String(params.page));
  if (params?.pageSize) query.set('pageSize', String(params.pageSize));
  const queryString = query.toString();

  const response = await fetch(
    `${API_BASE_URL}/logs${queryString ? `?${queryString}` : ''}`,
  );

  if (!response.ok) {
    throw new Error('FETCH_LOG_LIST_FAILED');
  }

  return response.json();
}
