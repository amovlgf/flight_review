import { describe, expect, it } from 'vitest'
import {
  buildControlQualitySegment,
  createControlQualityRequestTracker,
} from './controlQualityRequest'

describe('controlQualityRequest', () => {
  it('rejects stale control-quality responses for the same client', () => {
    const tracker = createControlQualityRequestTracker()

    const firstRequestId = tracker.begin('log-column-1')
    const secondRequestId = tracker.begin('log-column-1')

    expect(tracker.isLatest('log-column-1', firstRequestId)).toBe(false)
    expect(tracker.isLatest('log-column-1', secondRequestId)).toBe(true)
  })

  it('keeps request ordering independent per client', () => {
    const tracker = createControlQualityRequestTracker()

    const firstColumnRequestId = tracker.begin('log-column-1')
    const secondColumnRequestId = tracker.begin('log-column-2')

    expect(tracker.isLatest('log-column-1', firstColumnRequestId)).toBe(true)
    expect(tracker.isLatest('log-column-2', secondColumnRequestId)).toBe(true)
  })

  it('invalidates in-flight requests when a column is cleared or replaced', () => {
    const tracker = createControlQualityRequestTracker()

    const requestId = tracker.begin('log-column-1')
    tracker.invalidate('log-column-1')

    expect(tracker.isLatest('log-column-1', requestId)).toBe(false)
  })

  it('normalizes manual, chart-selection, and auto analysis ranges', () => {
    expect(buildControlQualitySegment(1, 3, 'manual')).toEqual({
      startS: 1,
      endS: 3,
      source: 'manual',
    })
    expect(buildControlQualitySegment(3, 1, 'chart_selection')).toEqual({
      startS: 1,
      endS: 3,
      source: 'chart_selection',
    })
    expect(buildControlQualitySegment(null, null, 'manual')).toEqual({
      startS: null,
      endS: null,
      source: 'auto',
    })
  })
})
