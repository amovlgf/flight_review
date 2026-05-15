import { describe, expect, it } from 'vitest'
import type { TopicChart } from '../types/log'
import { buildPidAttitudeTrackingCharts } from './pidAttitudeTracking'

function buildQuaternionPoints(
  points: Array<[number, [number, number, number, number]]>,
  prefix = 'q',
) {
  return [
    {
      name: `${prefix}[0]`,
      unit: '',
      points: points.map(([time, quaternion]) => [time, quaternion[0]] as [number, number]),
    },
    {
      name: `${prefix}[1]`,
      unit: '',
      points: points.map(([time, quaternion]) => [time, quaternion[1]] as [number, number]),
    },
    {
      name: `${prefix}[2]`,
      unit: '',
      points: points.map(([time, quaternion]) => [time, quaternion[2]] as [number, number]),
    },
    {
      name: `${prefix}[3]`,
      unit: '',
      points: points.map(([time, quaternion]) => [time, quaternion[3]] as [number, number]),
    },
  ]
}

describe('pidAttitudeTracking', () => {
  it('builds three tracking charts from vehicle_attitude and vehicle_attitude_setpoint', () => {
    const topicCharts: TopicChart[] = [
      {
        topic: 'vehicle_attitude',
        title: 'vehicle_attitude',
        series: [
          ...buildQuaternionPoints([
            [0, [1, 0, 0, 0]],
            [1, [1, 0, 0, 0]],
          ]),
        ],
      },
      {
        topic: 'vehicle_attitude_setpoint',
        title: 'vehicle_attitude_setpoint',
        series: [
          ...buildQuaternionPoints(
            [
              [0, [1, 0, 0, 0]],
              [1, [1, 0, 0, 0]],
            ],
            'q_d',
          ),
        ],
      },
    ]

    const charts = buildPidAttitudeTrackingCharts(topicCharts)

    expect(charts).toHaveLength(3)
    expect(charts.map((item) => item.topic)).toEqual([
      'pid_roll_angle_tracking',
      'pid_pitch_angle_tracking',
      'pid_yaw_angle_tracking',
    ])
    expect(charts.every((item) => item.series.length === 2)).toBe(true)
  })

  it('each tracking chart contains exactly actual and setpoint series', () => {
    const topicCharts: TopicChart[] = [
      {
        topic: 'vehicle_attitude',
        title: 'vehicle_attitude',
        series: buildQuaternionPoints([[0, [1, 0, 0, 0]]]),
      },
      {
        topic: 'vehicle_attitude_setpoint',
        title: 'vehicle_attitude_setpoint',
        series: buildQuaternionPoints([[0, [1, 0, 0, 0]]], 'q_d'),
      },
    ]

    const charts = buildPidAttitudeTrackingCharts(topicCharts)

    expect(charts[0]?.series.map((item) => item.name)).toEqual([
      'Roll Actual',
      'Roll Setpoint',
    ])
    expect(charts[1]?.series.map((item) => item.name)).toEqual([
      'Pitch Actual',
      'Pitch Setpoint',
    ])
    expect(charts[2]?.series.map((item) => item.name)).toEqual([
      'Yaw Actual',
      'Yaw Setpoint',
    ])
  })

  it('returns an empty array when vehicle_attitude is missing', () => {
    const charts = buildPidAttitudeTrackingCharts([
      {
        topic: 'vehicle_attitude_setpoint',
        title: 'vehicle_attitude_setpoint',
        series: buildQuaternionPoints([[0, [1, 0, 0, 0]]], 'q_d'),
      },
    ])

    expect(charts).toEqual([])
  })

  it('returns an empty array when vehicle_attitude_setpoint is missing', () => {
    const charts = buildPidAttitudeTrackingCharts([
      {
        topic: 'vehicle_attitude',
        title: 'vehicle_attitude',
        series: buildQuaternionPoints([[0, [1, 0, 0, 0]]]),
      },
    ])

    expect(charts).toEqual([])
  })

  it('skips invalid quaternion points without producing NaN or Infinity', () => {
    const charts = buildPidAttitudeTrackingCharts([
      {
        topic: 'vehicle_attitude',
        title: 'vehicle_attitude',
        series: [
          {
            name: 'q[0]',
            unit: '',
            points: [
              [0, 1],
              [1, Number.NaN],
            ],
          },
          {
            name: 'q[1]',
            unit: '',
            points: [
              [0, 0],
              [1, 0],
            ],
          },
          {
            name: 'q[2]',
            unit: '',
            points: [
              [0, 0],
              [1, 0],
            ],
          },
          {
            name: 'q[3]',
            unit: '',
            points: [
              [0, 0],
              [1, 0],
            ],
          },
        ],
      },
      {
        topic: 'vehicle_attitude_setpoint',
        title: 'vehicle_attitude_setpoint',
        series: buildQuaternionPoints([[0, [1, 0, 0, 0]]], 'q_d'),
      },
    ])

    expect(charts).toHaveLength(3)
    expect(charts[0]?.series[0]?.points).toEqual([[0, 0]])
    const allValues = charts.flatMap((chart) =>
      chart.series.flatMap((series) => series.points.map((point) => point[1])),
    )
    expect(allValues.some((value) => Number.isNaN(value))).toBe(false)
    expect(allValues.some((value) => !Number.isFinite(value))).toBe(false)
  })

  it('does not mutate the original topicCharts array', () => {
    const topicCharts: TopicChart[] = [
      {
        topic: 'vehicle_attitude',
        title: 'vehicle_attitude',
        series: buildQuaternionPoints([[0, [1, 0, 0, 0]]]),
      },
      {
        topic: 'vehicle_attitude_setpoint',
        title: 'vehicle_attitude_setpoint',
        series: buildQuaternionPoints([[0, [1, 0, 0, 0]]], 'q_d'),
      },
    ]
    const snapshot = structuredClone(topicCharts)

    void buildPidAttitudeTrackingCharts(topicCharts)

    expect(topicCharts).toEqual(snapshot)
  })

  it('supports q.00/q.01/q.02/q.03 field names', () => {
    const topicCharts: TopicChart[] = [
      {
        topic: 'vehicle_attitude',
        title: 'vehicle_attitude',
        series: [
          { name: 'q.00', unit: '', points: [[0, 1]] },
          { name: 'q.01', unit: '', points: [[0, 0]] },
          { name: 'q.02', unit: '', points: [[0, 0]] },
          { name: 'q.03', unit: '', points: [[0, 0]] },
        ],
      },
      {
        topic: 'vehicle_attitude_setpoint',
        title: 'vehicle_attitude_setpoint',
        series: [
          { name: 'q_d.00', unit: '', points: [[0, 1]] },
          { name: 'q_d.01', unit: '', points: [[0, 0]] },
          { name: 'q_d.02', unit: '', points: [[0, 0]] },
          { name: 'q_d.03', unit: '', points: [[0, 0]] },
        ],
      },
    ]

    const charts = buildPidAttitudeTrackingCharts(topicCharts)

    expect(charts).toHaveLength(3)
    expect(charts[0]?.series[0]?.points).toEqual([[0, 0]])
  })

  it('supports q[0]/q[1]/q[2]/q[3] and q_d[0]/q_d[1]/q_d[2]/q_d[3]', () => {
    const topicCharts: TopicChart[] = [
      {
        topic: 'vehicle_attitude_0',
        title: 'vehicle_attitude_0',
        series: buildQuaternionPoints([[0, [1, 0, 0, 0]]]),
      },
      {
        topic: 'vehicle_attitude_setpoint_0',
        title: 'vehicle_attitude_setpoint_0',
        series: buildQuaternionPoints([[0, [1, 0, 0, 0]]], 'q_d'),
      },
    ]

    const charts = buildPidAttitudeTrackingCharts(topicCharts)

    expect(charts).toHaveLength(3)
  })

  it('falls back to derived Euler fields when setpoint quaternion fields are unavailable', () => {
    const topicCharts: TopicChart[] = [
      {
        topic: 'vehicle_attitude',
        title: 'vehicle_attitude',
        series: buildQuaternionPoints([[0, [1, 0, 0, 0]]]),
      },
      {
        topic: 'vehicle_attitude_setpoint',
        title: 'vehicle_attitude_setpoint',
        series: [
          { name: 'roll_sp', unit: 'deg', points: [[0, 10]] },
          { name: 'pitch_sp', unit: 'deg', points: [[0, 5]] },
          { name: 'yaw_sp', unit: 'deg', points: [[0, -2]] },
        ],
      },
    ]

    const charts = buildPidAttitudeTrackingCharts(topicCharts)

    expect(charts).toHaveLength(3)
    expect(charts[0]?.series[1]?.points).toEqual([[0, 10]])
    expect(charts[1]?.series[1]?.points).toEqual([[0, 5]])
    expect(charts[2]?.series[1]?.points).toEqual([[0, -2]])
  })
})
