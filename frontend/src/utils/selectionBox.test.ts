import { describe, expect, it } from 'vitest'
import {
  isValidSelectionBox,
  normalizeSelectionBox,
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

  it('treats a tiny selection as invalid', () => {
    const box = normalizeSelectionBox({ x: 10, y: 10 }, { x: 13, y: 12 })

    expect(isValidSelectionBox(box, 5)).toBe(false)
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
