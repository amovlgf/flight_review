import { describe, expect, it } from 'vitest'
import { evaluatePidSegmentQuality } from './segmentQuality'

function buildSeries(
  points: Array<[number, number]>,
) {
  return points.map(([timeS, value]) => ({ timeS, value }))
}

describe('segmentQuality', () => {
  it('returns unknown when start/end are missing', () => {
    const result = evaluatePidSegmentQuality({
      axis: 'roll',
      startS: null,
      endS: null,
      actualSeries: [],
      setpointSeries: [],
    })

    expect(result.status).toBe('unknown')
    expect(result.summary).toContain('暂无有效分析片段')
  })

  it('returns unknown when start is not less than end', () => {
    const result = evaluatePidSegmentQuality({
      axis: 'roll',
      startS: 5,
      endS: 5,
      actualSeries: [],
      setpointSeries: [],
    })

    expect(result.status).toBe('unknown')
  })

  it('returns bad when the segment duration is shorter than one second', () => {
    const result = evaluatePidSegmentQuality({
      axis: 'roll',
      startS: 0,
      endS: 0.8,
      actualSeries: buildSeries([
        [0, 0],
        [0.4, 1],
        [0.8, 2],
      ]),
      setpointSeries: buildSeries([
        [0, 0],
        [0.4, 5],
        [0.8, 10],
      ]),
    })

    expect(result.status).toBe('bad')
  })

  it('returns warning when the segment duration is longer than thirty seconds', () => {
    const points = Array.from({ length: 40 }, (_, index) => [index, index] as [number, number])
    const result = evaluatePidSegmentQuality({
      axis: 'roll',
      startS: 0,
      endS: 31,
      actualSeries: buildSeries(points),
      setpointSeries: buildSeries(points.map(([time]) => [time, time * 0.6] as [number, number])),
    })

    expect(result.status).toBe('warning')
  })

  it('returns bad when there are too few samples in the segment', () => {
    const result = evaluatePidSegmentQuality({
      axis: 'pitch',
      startS: 0,
      endS: 3,
      actualSeries: buildSeries([
        [0, 0],
        [1, 1],
      ]),
      setpointSeries: buildSeries([
        [0, 0],
        [1, 8],
      ]),
    })

    expect(result.status).toBe('bad')
    expect(result.metrics.sampleCount).toBe(2)
  })

  it('returns bad when setpoint movement is too small', () => {
    const points = Array.from({ length: 15 }, (_, index) => [index * 0.2, 1] as [number, number])
    const result = evaluatePidSegmentQuality({
      axis: 'yaw',
      startS: 0,
      endS: 2.8,
      actualSeries: buildSeries(points),
      setpointSeries: buildSeries(points.map(([time]) => [time, 1.5] as [number, number])),
    })

    expect(result.status).toBe('bad')
    expect(result.metrics.setpointRangeDeg).toBe(0)
  })

  it('returns good when setpoint movement is clear and data is complete', () => {
    const setpointPoints = Array.from({ length: 20 }, (_, index) => {
      const time = index * 0.2
      const value = index < 10 ? 0 : 12
      return [time, value] as [number, number]
    })
    const actualPoints = setpointPoints.map(([time, value], index) => [
      time,
      index < 10 ? 0 : value - 1.2,
    ] as [number, number])

    const result = evaluatePidSegmentQuality({
      axis: 'roll',
      startS: 0,
      endS: 3.8,
      actualSeries: buildSeries(actualPoints),
      setpointSeries: buildSeries(setpointPoints),
    })

    expect(result.status).toBe('good')
    expect(result.score).toBeGreaterThanOrEqual(70)
  })

  it('returns warning when the setpoint moves but the actual response is weak', () => {
    const setpointPoints = Array.from({ length: 20 }, (_, index) => [
      index * 0.2,
      index < 10 ? 0 : 10,
    ] as [number, number])
    const actualPoints = Array.from({ length: 20 }, (_, index) => [
      index * 0.2,
      index < 10 ? 0 : 1,
    ] as [number, number])

    const result = evaluatePidSegmentQuality({
      axis: 'pitch',
      startS: 0,
      endS: 3.8,
      actualSeries: buildSeries(actualPoints),
      setpointSeries: buildSeries(setpointPoints),
    })

    expect(['warning', 'bad']).toContain(result.status)
    expect(result.reasons.join(' ')).toContain('响应较弱')
  })

  it('never returns NaN or Infinity in score or metric fields', () => {
    const result = evaluatePidSegmentQuality({
      axis: 'yaw',
      startS: 0,
      endS: 3,
      actualSeries: buildSeries([
        [0, 0],
        [1, 5],
        [2, 10],
        [3, 8],
        [4, Number.NaN],
      ]),
      setpointSeries: buildSeries([
        [0, 0],
        [1, 6],
        [2, 12],
        [3, 12],
      ]),
    })

    expect(Number.isFinite(result.score)).toBe(true)
    expect(result.metrics.durationS === null || Number.isFinite(result.metrics.durationS)).toBe(true)
    expect(result.metrics.setpointRangeDeg === null || Number.isFinite(result.metrics.setpointRangeDeg)).toBe(true)
    expect(result.metrics.actualRangeDeg === null || Number.isFinite(result.metrics.actualRangeDeg)).toBe(true)
    expect(result.metrics.rmsErrorDeg === null || Number.isFinite(result.metrics.rmsErrorDeg)).toBe(true)
    expect(result.metrics.peakErrorDeg === null || Number.isFinite(result.metrics.peakErrorDeg)).toBe(true)
  })

  it('does not mutate the original series inputs', () => {
    const actualSeries = buildSeries([
      [0, 0],
      [1, 2],
      [2, 4],
      [3, 6],
      [4, 8],
      [5, 10],
      [6, 12],
      [7, 14],
      [8, 16],
      [9, 18],
      [10, 20],
    ])
    const setpointSeries = buildSeries([
      [0, 0],
      [1, 2],
      [2, 4],
      [3, 6],
      [4, 8],
      [5, 10],
      [6, 12],
      [7, 14],
      [8, 16],
      [9, 18],
      [10, 20],
    ])
    const actualSnapshot = structuredClone(actualSeries)
    const setpointSnapshot = structuredClone(setpointSeries)

    void evaluatePidSegmentQuality({
      axis: 'roll',
      startS: 0,
      endS: 10,
      actualSeries,
      setpointSeries,
    })

    expect(actualSeries).toEqual(actualSnapshot)
    expect(setpointSeries).toEqual(setpointSnapshot)
  })
})
