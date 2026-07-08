import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import EmbeddedSignalChart from './EmbeddedSignalChart'

describe('EmbeddedSignalChart', () => {
  it('uses the same chart interaction props as feature three charts', () => {
    const html = renderToStaticMarkup(
      <EmbeddedSignalChart
        chartKey="summary-chart"
        title="State signals"
        series={[
          {
            name: 'vehicle.failsafe',
            unit: '',
            points: [
              [0, 0],
              [1, 1],
            ],
          },
        ]}
        selectionBox={{
          chartId: 'summary-chart',
          left: 1,
          top: 2,
          width: 3,
          height: 4,
        }}
        timelinePointer={0.5}
        isTimelinePlaying={false}
        onChartReady={() => undefined}
        onChartDispose={() => undefined}
        onTimelineSeek={() => undefined}
        onToggleTimelinePlayback={() => undefined}
      />,
    )

    expect(html).toContain('chart-canvas-shell')
    expect(html).toContain('chart-selection-box')
    expect(html).toContain('chart-timeline-scrubber')
    expect(html).toContain('State signals')
  })
})
