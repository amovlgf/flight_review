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

export type ChartSelectionControlSegment = {
  rangeGroupKey: string
  segment: {
    startS: number
    endS: number
    source: 'chart_selection'
  }
}

export type SelectableChartPixelProbe = {
  containPixel?: (
    finder: Record<string, unknown>,
    value: [number, number],
  ) => boolean
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

export function shouldShowSelectionPreview(
  box: NormalizedSelectionBox | null | undefined,
  minPixels = 5,
) {
  return isValidSelectionBox(box, minPixels)
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

export function isSelectableChartPoint(
  chart: SelectableChartPixelProbe | null | undefined,
  point: SelectionPoint | null | undefined,
) {
  if (!point || !isFiniteNumber(point.x) || !isFiniteNumber(point.y)) {
    return false
  }

  if (!chart || typeof chart.containPixel !== 'function') {
    return true
  }

  try {
    return chart.containPixel({ gridIndex: 0 }, [point.x, point.y])
  } catch {
    return false
  }
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

export function buildChartSelectionControlSegment(
  rangeGroupKey: string | null | undefined,
  startValue: number,
  endValue: number,
  minDurationS = 0.001,
): ChartSelectionControlSegment | null {
  const key = typeof rangeGroupKey === 'string' ? rangeGroupKey.trim() : ''
  if (!key) {
    return null
  }

  if (
    typeof startValue !== 'number' ||
    typeof endValue !== 'number' ||
    !Number.isFinite(startValue) ||
    !Number.isFinite(endValue)
  ) {
    return null
  }

  const startS = Math.min(startValue, endValue)
  const endS = Math.max(startValue, endValue)
  const minimum =
    typeof minDurationS === 'number' &&
    Number.isFinite(minDurationS) &&
    minDurationS > 0
      ? minDurationS
      : 0

  if (endS - startS < minimum) {
    return null
  }

  return {
    rangeGroupKey: key,
    segment: {
      startS,
      endS,
      source: 'chart_selection',
    },
  }
}
