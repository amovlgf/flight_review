import type { ControlQualityPayload } from '../types/log'

export type ControlQualityRequestTracker = {
  begin: (clientId: string) => number
  isLatest: (clientId: string, requestId: number) => boolean
  invalidate: (clientId: string) => void
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function normalizeClientId(clientId: string) {
  return typeof clientId === 'string' ? clientId.trim() : ''
}

export function createControlQualityRequestTracker(): ControlQualityRequestTracker {
  const requestIds = new Map<string, number>()

  return {
    begin(clientId: string) {
      const key = normalizeClientId(clientId)
      const nextId = (requestIds.get(key) ?? 0) + 1
      requestIds.set(key, nextId)
      return nextId
    },
    isLatest(clientId: string, requestId: number) {
      const key = normalizeClientId(clientId)
      return requestIds.get(key) === requestId
    },
    invalidate(clientId: string) {
      const key = normalizeClientId(clientId)
      requestIds.set(key, (requestIds.get(key) ?? 0) + 1)
    },
  }
}

export function buildControlQualitySegment(
  startS: number | null,
  endS: number | null,
  source: string,
): NonNullable<ControlQualityPayload['segment']> {
  if (!isFiniteNumber(startS) || !isFiniteNumber(endS)) {
    return {
      startS: null,
      endS: null,
      source: 'auto',
    }
  }

  return {
    startS: Math.min(startS, endS),
    endS: Math.max(startS, endS),
    source: source === 'chart_selection' ? 'chart_selection' : 'manual',
  }
}
