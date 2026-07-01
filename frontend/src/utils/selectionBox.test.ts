import { describe, expect, it } from 'vitest'
import {
  buildChartSelectionControlSegment,
  ensureVisibleSelectionBox,
  isValidTimeSelectionBox,
  isValidSelectionBox,
  normalizeSelectionBox,
  shouldShowSelectionPreview,
} from './selectionBox'

describe('selectionBox', () => {
  it('normalizes a selection dragged from top-left to bottom-right', () => {
    expect(
      normalizeSelectionBox({ x: 10, y: 20 }, { x: 60, y: 90 }),
    ).toEqual({
      left: 10,
      top: 20,
      width: 50,
      height: 70,
    })
  })

  it('normalizes a selection dragged from bottom-right to top-left', () => {
    expect(
      normalizeSelectionBox({ x: 80, y: 120 }, { x: 20, y: 40 }),
    ).toEqual({
      left: 20,
      top: 40,
      width: 60,
      height: 80,
    })
  })

  it('normalizes a two-click selection from opposite corners', () => {
    expect(
      normalizeSelectionBox({ x: 12, y: 45 }, { x: 112, y: 46 }),
    ).toEqual({
      left: 12,
      top: 45,
      width: 100,
      height: 1,
    })
  })

  it('normalizes a reversed two-click selection from opposite corners', () => {
    expect(
      normalizeSelectionBox({ x: 112, y: 46 }, { x: 12, y: 45 }),
    ).toEqual({
      left: 12,
      top: 45,
      width: 100,
      height: 1,
    })
  })

  it('treats a tiny selection as invalid', () => {
    const box = normalizeSelectionBox({ x: 10, y: 10 }, { x: 13, y: 12 })

    expect(isValidSelectionBox(box, 5)).toBe(false)
  })

  it('requires enough x-axis width for time range selection', () => {
    const tallButNarrowBox = normalizeSelectionBox(
      { x: 10, y: 10 },
      { x: 13, y: 120 },
    )

    expect(isValidSelectionBox(tallButNarrowBox, 5)).toBe(true)
    expect(shouldShowSelectionPreview(tallButNarrowBox, 5)).toBe(true)
    expect(isValidTimeSelectionBox(tallButNarrowBox, 5)).toBe(false)
  })

  it('builds a current-column control segment for valid chart selections', () => {
    expect(buildChartSelectionControlSegment('log-column-1', 12, 8)).toEqual({
      rangeGroupKey: 'log-column-1',
      segment: {
        startS: 8,
        endS: 12,
        source: 'chart_selection',
      },
    })
  })

  it('skips control segment recalculation outside control-quality charts', () => {
    expect(buildChartSelectionControlSegment(undefined, 8, 12)).toBeNull()
    expect(buildChartSelectionControlSegment('', 8, 12)).toBeNull()
    expect(buildChartSelectionControlSegment('log-column-1', 8, 8.0004)).toBeNull()
  })

  it('keeps a very flat selection box visible', () => {
    const box = normalizeSelectionBox({ x: 10, y: 20 }, { x: 50, y: 20 })

    expect(ensureVisibleSelectionBox(box, 1)).toEqual({
      left: 10,
      top: 20,
      width: 40,
      height: 1,
    })
  })

  it('never returns a negative width or height for reverse dragging', () => {
    const box = normalizeSelectionBox({ x: 40, y: 30 }, { x: 10, y: 5 })

    expect(box?.width).toBe(30)
    expect(box?.height).toBe(25)
  })

  it('safely handles invalid coordinates', () => {
    expect(
      normalizeSelectionBox(
        { x: Number.NaN, y: 10 },
        { x: 20, y: 20 },
      ),
    ).toBeNull()
    expect(
      normalizeSelectionBox(
        { x: 10, y: 10 },
        { x: Number.POSITIVE_INFINITY, y: 20 },
      ),
    ).toBeNull()
    expect(isValidSelectionBox(null, 5)).toBe(false)
  })
})
