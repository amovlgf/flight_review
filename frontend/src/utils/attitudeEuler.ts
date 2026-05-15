export type EulerDeg = {
  rollDeg: number
  pitchDeg: number
  yawDeg: number
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function radToDeg(value: number) {
  return (value * 180) / Math.PI
}

export function quaternionToEulerDeg(
  q0: unknown,
  q1: unknown,
  q2: unknown,
  q3: unknown,
): EulerDeg | null {
  if (
    !isFiniteNumber(q0) ||
    !isFiniteNumber(q1) ||
    !isFiniteNumber(q2) ||
    !isFiniteNumber(q3)
  ) {
    return null
  }

  const magnitude = Math.hypot(q0, q1, q2, q3)
  if (!Number.isFinite(magnitude) || magnitude <= 0) {
    return null
  }

  const w = q0 / magnitude
  const x = q1 / magnitude
  const y = q2 / magnitude
  const z = q3 / magnitude

  if (
    !Number.isFinite(w) ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(z)
  ) {
    return null
  }

  const roll = Math.atan2(
    2 * (w * x + y * z),
    1 - 2 * (x * x + y * y),
  )
  const pitchInput = Math.min(1, Math.max(-1, 2 * (w * y - z * x)))
  const pitch = Math.asin(pitchInput)
  const yaw = Math.atan2(
    2 * (w * z + x * y),
    1 - 2 * (y * y + z * z),
  )

  const rollDeg = radToDeg(roll)
  const pitchDeg = radToDeg(pitch)
  const yawDeg = radToDeg(yaw)

  if (
    !Number.isFinite(rollDeg) ||
    !Number.isFinite(pitchDeg) ||
    !Number.isFinite(yawDeg)
  ) {
    return null
  }

  return {
    rollDeg,
    pitchDeg,
    yawDeg,
  }
}
