import { describe, expect, it } from 'vitest'
import { buildTopicChartOption } from './chartOptions'
import type { ModeSegment, TopicChart } from '../types/log'

describe('buildTopicChartOption', () => {
  it('builds a valid ECharts option shape with series and mode background', () => {
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
    const modeSegments: ModeSegment[] = [
      {
        start: 0,
        end: 1,
        mode: 'MANUAL',
        mode_code: 1,
        color: '#94a3b8',
      },
    ]

    const option = buildTopicChartOption(topicChart, modeSegments)

    expect(option.tooltip).toEqual({ trigger: 'axis' })
    expect(option.toolbox.orient).toBe('vertical')
    expect(option.legend.data).toEqual(['\u9ad8\u5ea6 (m)', '\u901f\u5ea6 (m/s)'])
    expect(option.xAxis.type).toBe('value')
    expect(option.yAxis.type).toBe('value')
    expect(option.dataZoom).toHaveLength(2)
    expect(option.series).toHaveLength(2)
    expect(option.series[0]).toMatchObject({
      name: '\u9ad8\u5ea6 (m)',
      type: 'line',
      smooth: false,
      showSymbol: false,
      data: topicChart.series[0].points,
    })
    expect(option.series[0].markArea?.data).toHaveLength(1)
    expect(option.series[1].markArea).toBeUndefined()
  })
})
