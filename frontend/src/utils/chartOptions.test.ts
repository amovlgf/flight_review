import { describe, expect, it } from 'vitest'
import { buildTopicChartOption, getChartTimeRange } from './chartOptions'
import type { ModeSegment, TopicChart } from '../types/log'

type TestSeriesOption = {
  data?: unknown
  lineStyle?: { width?: number }
  markArea?: { data?: unknown[] }
}

const MODE_SEGMENTS: ModeSegment[] = [
  {
    start: 0,
    end: 1,
    mode: 'MANUAL',
    mode_code: 1,
    color: '#94a3b8',
  },
]

describe('chartOptions', () => {
  it('calculates a normal time range and builds a valid option', () => {
    const topicChart: TopicChart = {
      topic: 'vehicle_local_position',
      title: 'vehicle_local_position',
      series: [
        {
          name: 'altitude',
          unit: 'm',
          points: [
            [0, 10],
            [1, 12],
          ],
        },
        {
          name: 'speed',
          unit: 'm/s',
          points: [
            [0, 3],
            [1, 4],
          ],
        },
      ],
    }

    expect(getChartTimeRange(topicChart)).toBe(1)

    const option = buildTopicChartOption(topicChart, MODE_SEGMENTS)
    const series = option.series as TestSeriesOption[]

    expect(option.tooltip.trigger).toBe('axis')
    expect(option.toolbox.orient).toBe('vertical')
    expect(option.legend.data).toEqual(['高度 (m)', '速度 (m/s)'])
    expect(option.xAxis[0].type).toBe('value')
    expect(option.yAxis[0].type).toBe('value')
    expect(option.dataZoom).toHaveLength(1)
    expect(option.series).toHaveLength(3)
    expect(option.series[0]).toMatchObject({
      name: '高度 (m)',
      type: 'line',
      smooth: false,
      showSymbol: false,
      data: topicChart.series[0].points,
    })
    expect(series[0].markArea?.data).toHaveLength(1)
    expect(series[1].markArea).toBeUndefined()
    expect(option.series[2]).toMatchObject({
      name: '飞行模式',
      type: 'custom',
      xAxisIndex: 1,
      yAxisIndex: 1,
    })
  })

  it('does not crash on empty series', () => {
    const topicChart: TopicChart = {
      topic: 'empty',
      title: 'empty',
      series: [],
    }

    expect(getChartTimeRange(topicChart)).toBe(0)

    const option = buildTopicChartOption(topicChart, MODE_SEGMENTS)

    expect(option.legend.data).toEqual([])
    expect(option.series).toEqual([])
  })

  it('does not crash when series points are empty', () => {
    const topicChart: TopicChart = {
      topic: 'empty-points',
      title: 'empty-points',
      series: [
        {
          name: 'altitude',
          unit: 'm',
          points: [],
        },
      ],
    }

    expect(getChartTimeRange(topicChart)).toBe(0)

    const option = buildTopicChartOption(topicChart, [])
    const series = option.series as TestSeriesOption[]

    expect(option.series).toHaveLength(1)
    expect(series[0]?.data).toEqual([])
    expect(series[0]?.markArea).toBeUndefined()
  })

  it('skips invalid points without crashing', () => {
    const topicChart: TopicChart = {
      topic: 'invalid-points',
      title: 'invalid-points',
      series: [
        {
          name: 'altitude',
          unit: 'm',
          points: [
            [0, 10],
            undefined,
            [Number.NaN, 2],
            [3, Number.POSITIVE_INFINITY],
            [4, 16],
          ] as unknown as Array<[number, number]>,
        },
      ],
    }

    expect(getChartTimeRange(topicChart)).toBe(4)

    const option = buildTopicChartOption(topicChart, [])
    const series = option.series as TestSeriesOption[]

    expect(option.series).toHaveLength(1)
    expect(series[0]?.data).toEqual([
      [0, 10],
      [4, 16],
    ])
  })

  it('handles very large point arrays without stack overflow', () => {
    const points = Array.from({ length: 200000 }, (_, index) => [
      index * 0.01,
      Math.sin(index / 10),
    ]) as Array<[number, number]>
    const topicChart: TopicChart = {
      topic: 'large',
      title: 'large',
      series: [
        {
          name: 'roll',
          unit: 'rad',
          points,
        },
      ],
    }

    expect(() => getChartTimeRange(topicChart)).not.toThrow()
    expect(() => buildTopicChartOption(topicChart, [])).not.toThrow()
    expect(getChartTimeRange(topicChart)).toBeCloseTo((points.length - 1) * 0.01)
  })

  it('renders discrete evidence state signals as visible stepped lines', () => {
    const topicChart: TopicChart = {
      topic: 'v1_3_state_signals',
      title: 'V1.3 state evidence signals',
      series: [
        {
          name: 'takeoff.state',
          unit: '',
          points: [
            [66.44, 3],
            [66.45, 5],
          ],
        },
      ],
    }

    const option = buildTopicChartOption(topicChart, [])
    const series = option.series as TestSeriesOption[]

    expect(option.series[0]).toMatchObject({
      name: 'takeoff.state ()',
      type: 'line',
      step: 'end',
      showSymbol: true,
      symbol: 'circle',
    })
    expect(series[0]?.lineStyle?.width).toBeGreaterThanOrEqual(2.8)
  })

  it('can render mode background without the dedicated mode track', () => {
    const option = buildTopicChartOption(
      {
        topic: 'evidence',
        title: 'Evidence',
        series: [
          {
            name: 'roll',
            unit: 'deg',
            points: [
              [0, 0],
              [10, 1],
            ],
          },
        ],
      },
      MODE_SEGMENTS,
      { showModeTrack: false },
    )

    expect(option.xAxis).toHaveLength(1)
    expect(option.yAxis).toHaveLength(1)
    expect(option.series).toHaveLength(1)
    expect((option.series as TestSeriesOption[])[0]?.markArea?.data).toHaveLength(1)
  })
})
