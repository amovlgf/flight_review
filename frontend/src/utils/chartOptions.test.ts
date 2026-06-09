import { describe, expect, it } from 'vitest'
import { buildTopicChartOption, getChartTimeRange } from './chartOptions'
import type { ModeSegment, TopicChart } from '../types/log'

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

    expect(option.tooltip).toEqual({ trigger: 'axis' })
    expect(option.toolbox.orient).toBe('vertical')
    expect(option.legend.data).toEqual(['高度 (m)', '速度 (m/s)'])
    expect(option.xAxis.type).toBe('value')
    expect(option.yAxis.type).toBe('value')
    expect(option.dataZoom).toHaveLength(1)
    expect(option.series).toHaveLength(2)
    expect(option.series[0]).toMatchObject({
      name: '高度 (m)',
      type: 'line',
      smooth: false,
      showSymbol: false,
      data: topicChart.series[0].points,
    })
    expect(option.series[0].markArea?.data).toHaveLength(1)
    expect(option.series[1].markArea).toBeUndefined()
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

    expect(option.series).toHaveLength(1)
    expect(option.series[0]?.data).toEqual([])
    expect(option.series[0]?.markArea).toBeUndefined()
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

    expect(option.series).toHaveLength(1)
    expect(option.series[0]?.data).toEqual([
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
})
