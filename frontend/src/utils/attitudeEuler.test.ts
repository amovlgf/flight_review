import { describe, expect, it } from 'vitest'
import { quaternionToEulerDeg } from './attitudeEuler'

const EPSILON = 1e-6
const DEGREE_TOLERANCE = 0.01

describe('attitudeEuler', () => {
  it('returns near-zero Euler angles for the identity quaternion', () => {
    const euler = quaternionToEulerDeg(1, 0, 0, 0)

    expect(euler).not.toBeNull()
    expect(euler?.rollDeg ?? Infinity).toBeCloseTo(0, 6)
    expect(euler?.pitchDeg ?? Infinity).toBeCloseTo(0, 6)
    expect(euler?.yawDeg ?? Infinity).toBeCloseTo(0, 6)
  })

  it('returns about 90 degrees for a pure roll quaternion', () => {
    const halfAngle = Math.PI / 4
    const euler = quaternionToEulerDeg(Math.cos(halfAngle), Math.sin(halfAngle), 0, 0)

    expect(euler).not.toBeNull()
    expect(euler?.rollDeg ?? Infinity).toBeCloseTo(90, 2)
    expect(Math.abs(euler?.pitchDeg ?? Infinity)).toBeLessThan(DEGREE_TOLERANCE)
    expect(Math.abs(euler?.yawDeg ?? Infinity)).toBeLessThan(DEGREE_TOLERANCE)
  })

  it('returns about 90 degrees for a pure pitch quaternion', () => {
    const halfAngle = Math.PI / 4
    const euler = quaternionToEulerDeg(Math.cos(halfAngle), 0, Math.sin(halfAngle), 0)

    expect(euler).not.toBeNull()
    expect(euler?.pitchDeg ?? Infinity).toBeCloseTo(90, 2)
  })

  it('returns about 90 degrees for a pure yaw quaternion', () => {
    const halfAngle = Math.PI / 4
    const euler = quaternionToEulerDeg(Math.cos(halfAngle), 0, 0, Math.sin(halfAngle))

    expect(euler).not.toBeNull()
    expect(euler?.yawDeg ?? Infinity).toBeCloseTo(90, 2)
    expect(Math.abs(euler?.rollDeg ?? Infinity)).toBeLessThan(DEGREE_TOLERANCE)
    expect(Math.abs(euler?.pitchDeg ?? Infinity)).toBeLessThan(DEGREE_TOLERANCE)
  })

  it('returns null for invalid inputs instead of NaN or Infinity', () => {
    expect(quaternionToEulerDeg(Number.NaN, 0, 0, 1)).toBeNull()
    expect(quaternionToEulerDeg(0, 0, 0, 0)).toBeNull()
    expect(quaternionToEulerDeg(Infinity, 0, 0, 0)).toBeNull()
    expect(quaternionToEulerDeg('1', 0, 0, 0)).toBeNull()
  })

  it('safely clamps the asin input when normalization is slightly out of range', () => {
    const euler = quaternionToEulerDeg(0.7071069, 0, 0.7071069, 0)

    expect(euler).not.toBeNull()
    expect(Math.abs((euler?.pitchDeg ?? 0) - 90)).toBeLessThan(0.05 + EPSILON)
    expect(Number.isFinite(euler?.rollDeg ?? Infinity)).toBe(true)
    expect(Number.isFinite(euler?.yawDeg ?? Infinity)).toBe(true)
  })
})
