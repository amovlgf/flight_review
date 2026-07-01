export type SelectionPoint = {
  x: number
  y: number
}

export type NormalizedSelectionBox = {
  left: number
  top: number
  width: number
  height: number
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function normalizeSelectionBox(
  start: SelectionPoint | null | undefined,
  current: SelectionPoint | null | undefined,
): NormalizedSelectionBox | null {
  if (
    !start ||
    !current ||
    !isFiniteNumber(start.x) ||
    !isFiniteNumber(start.y) ||
    !isFiniteNumber(current.x) ||
    !isFiniteNumber(current.y)
  ) {
    return null
  }

  const left = Math.min(start.x, current.x)
  const top = Math.min(start.y, current.y)
  const width = Math.abs(current.x - start.x)
  const height = Math.abs(current.y - start.y)

  if (
    !isFiniteNumber(left) ||
    !isFiniteNumber(top) ||
    !isFiniteNumber(width) ||
    !isFiniteNumber(height)
  ) {
    return null
  }

  return { left, top, width, height }
}

export function isValidSelectionBox(
  box: NormalizedSelectionBox | null | undefined,
  minPixels = 5,
) {
  if (!box) {
    return false
  }

  const threshold =
    typeof minPixels === 'number' && Number.isFinite(minPixels) && minPixels > 0
      ? minPixels
      : 0

  return Math.max(box.width, box.height) >= threshold
}

export function isValidTimeSelectionBox(
  box: NormalizedSelectionBox | null | undefined,
  minWidthPixels = 5,
): box is NormalizedSelectionBox {
  if (!box) {
    return false
  }

  const threshold =
    typeof minWidthPixels === 'number' &&
    Number.isFinite(minWidthPixels) &&
    minWidthPixels > 0
      ? minWidthPixels
      : 0

  return box.width >= threshold
}

export function ensureVisibleSelectionBox(
  box: NormalizedSelectionBox | null | undefined,
  minPixels = 1,
): NormalizedSelectionBox | null {
  if (!box) {
    return null
  }

  const minimum =
    typeof minPixels === 'number' && Number.isFinite(minPixels) && minPixels > 0
      ? minPixels
      : 0

  return {
    left: box.left,
    top: box.top,
    width: Math.max(box.width, minimum),
    height: Math.max(box.height, minimum),
  }
}
