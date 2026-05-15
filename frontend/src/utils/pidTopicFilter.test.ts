import { describe, expect, it } from 'vitest'
import type { TopicChart } from '../types/log'
import {
  filterPidViewFields,
  filterPidViewTopics,
  getPidViewTopicCharts,
  PID_VIEW_TOPIC_ALLOWLIST,
  sortPidViewTopics,
} from './pidTopicFilter'

describe('pidTopicFilter', () => {
  it('PID 视图只保留允许的 topic', () => {
    const topicCharts: TopicChart[] = [
      { topic: 'vehicle_rates_setpoint', title: 'rates', series: [] },
      { topic: 'vehicle_attitude', title: 'attitude', series: [] },
      { topic: 'vehicle_visual_odometry', title: 'vo', series: [] },
    ]

    const filtered = filterPidViewTopics(topicCharts)

    expect(filtered.map((item) => item.topic)).toEqual([
      'vehicle_rates_setpoint',
      'vehicle_attitude',
    ])
  })

  it('input_rc_0 会被过滤掉', () => {
    expect(
      filterPidViewTopics([
        { topic: 'input_rc_0', title: 'input_rc_0', series: [] },
      ] as TopicChart[]),
    ).toEqual([])
  })

  it('sensor_gyro_0 会被过滤掉', () => {
    expect(
      filterPidViewTopics([
        { topic: 'sensor_gyro_0', title: 'sensor_gyro_0', series: [] },
      ] as TopicChart[]),
    ).toEqual([])
  })

  it('vehicle_status_0 会被过滤掉', () => {
    expect(
      filterPidViewTopics([
        { topic: 'vehicle_status_0', title: 'vehicle_status_0', series: [] },
      ] as TopicChart[]),
    ).toEqual([])
  })

  it('vehicle_visual_odometry_0 会被过滤掉', () => {
    expect(
      filterPidViewTopics([
        {
          topic: 'vehicle_visual_odometry_0',
          title: 'vehicle_visual_odometry_0',
          series: [],
        },
      ] as TopicChart[]),
    ).toEqual([])
  })

  it('vehicle_local_position_setpoint_0 会被过滤掉', () => {
    expect(
      filterPidViewTopics([
        {
          topic: 'vehicle_local_position_setpoint_0',
          title: 'vehicle_local_position_setpoint_0',
          series: [],
        },
      ] as TopicChart[]),
    ).toEqual([])
  })

  it('vehicle_attitude 过滤 q0/q1/q2/q3，只保留姿态角字段', () => {
    const topicCharts: TopicChart[] = [
      {
        topic: 'vehicle_attitude',
        title: 'vehicle_attitude',
        series: [
          { name: 'roll', unit: 'deg', points: [] },
          { name: 'pitch', unit: 'deg', points: [] },
          { name: 'yaw', unit: 'deg', points: [] },
          { name: 'q[0]', unit: '', points: [] },
          { name: 'q[1]', unit: '', points: [] },
          { name: 'q[2]', unit: '', points: [] },
          { name: 'q[3]', unit: '', points: [] },
        ],
      },
    ]

    const filtered = getPidViewTopicCharts(topicCharts)

    expect(filtered).toHaveLength(1)
    expect(filtered[0]?.series.map((item) => item.name)).toEqual([
      'roll',
      'pitch',
      'yaw',
    ])
  })

  it('actuator_outputs_1 只保留 output[0]~output[3] 和 noutputs', () => {
    const topicCharts: TopicChart[] = [
      {
        topic: 'actuator_outputs_1',
        title: 'actuator_outputs_1',
        series: [
          { name: 'output[0]', unit: '', points: [] },
          { name: 'output[1]', unit: '', points: [] },
          { name: 'output[2]', unit: '', points: [] },
          { name: 'output[3]', unit: '', points: [] },
          { name: 'output[4]', unit: '', points: [] },
          { name: 'noutputs', unit: '', points: [] },
        ],
      },
    ]

    const filtered = getPidViewTopicCharts(topicCharts)

    expect(filtered).toHaveLength(1)
    expect(filtered[0]?.series.map((item) => item.name)).toEqual([
      'output[0]',
      'output[1]',
      'output[2]',
      'output[3]',
      'noutputs',
    ])
  })

  it('battery_status 只保留关键电池字段', () => {
    const topicCharts: TopicChart[] = [
      {
        topic: 'battery_status',
        title: 'battery_status',
        series: [
          { name: 'voltage_v', unit: 'V', points: [] },
          { name: 'voltage_filtered_v', unit: 'V', points: [] },
          { name: 'current_a', unit: 'A', points: [] },
          { name: 'remaining', unit: '%', points: [] },
          { name: 'discharged_mah', unit: 'mAh', points: [] },
          { name: 'temperature', unit: 'C', points: [] },
        ],
      },
    ]

    const filtered = getPidViewTopicCharts(topicCharts)

    expect(filtered).toHaveLength(1)
    expect(filtered[0]?.series.map((item) => item.name)).toEqual([
      'voltage_v',
      'voltage_filtered_v',
      'current_a',
      'remaining',
      'discharged_mah',
    ])
  })

  it('字段过滤后没有 series 的 topic 会从 PID 视图中移除', () => {
    const topicCharts: TopicChart[] = [
      {
        topic: 'battery_status',
        title: 'battery_status',
        series: [{ name: 'temperature', unit: 'C', points: [] }],
      },
    ]

    expect(getPidViewTopicCharts(topicCharts)).toEqual([])
  })

  it('常规视图不应被 PID 字段过滤影响', () => {
    const topicCharts: TopicChart[] = [
      {
        topic: 'vehicle_attitude',
        title: 'vehicle_attitude',
        series: [
          { name: 'roll', unit: 'deg', points: [] },
          { name: 'q[0]', unit: '', points: [] },
        ],
      },
    ]

    expect(topicCharts[0]?.series.map((item) => item.name)).toEqual([
      'roll',
      'q[0]',
    ])
  })

  it('原始 topicCharts 不应被修改', () => {
    const topicCharts: TopicChart[] = [
      {
        topic: 'vehicle_attitude',
        title: 'vehicle_attitude',
        series: [
          { name: 'roll', unit: 'deg', points: [] },
          { name: 'q[0]', unit: '', points: [] },
        ],
      },
    ]
    const snapshot = structuredClone(topicCharts)

    void getPidViewTopicCharts(topicCharts)

    expect(topicCharts).toEqual(snapshot)
  })

  it('排序结果中 vehicle_rates_setpoint 在 vehicle_attitude 前面', () => {
    const topicCharts: TopicChart[] = [
      { topic: 'vehicle_attitude', title: 'attitude', series: [] },
      { topic: 'vehicle_rates_setpoint', title: 'rates', series: [] },
      { topic: 'battery_status', title: 'battery', series: [] },
    ]

    const sorted = sortPidViewTopics(topicCharts)

    expect(sorted.map((item) => item.topic)).toEqual([
      'vehicle_rates_setpoint',
      'vehicle_attitude',
      'battery_status',
    ])
  })

  it('filterPidViewFields 支持单个 topic 过滤', () => {
    const topic: TopicChart = {
      topic: 'vehicle_attitude_setpoint',
      title: 'vehicle_attitude_setpoint',
      series: [
        { name: 'roll_sp', unit: 'deg', points: [] },
        { name: 'yaw_sp_move_rate', unit: 'deg/s', points: [] },
        { name: 'q_d[0]', unit: '', points: [] },
      ],
    }

    const filtered = filterPidViewFields(topic)

    expect(filtered?.series?.map((item) => item.name)).toEqual([
      'roll_sp',
      'yaw_sp_move_rate',
    ])
  })

  it('导出当前 PID 视图 allowlist', () => {
    expect(PID_VIEW_TOPIC_ALLOWLIST).toContain('vehicle_rates_setpoint')
    expect(PID_VIEW_TOPIC_ALLOWLIST).toContain('actuator_motors_1')
    expect(PID_VIEW_TOPIC_ALLOWLIST).toHaveLength(18)
  })
})
