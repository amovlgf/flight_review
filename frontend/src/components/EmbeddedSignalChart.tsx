import { memo, useCallback, useEffect, useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import ChartTimelineScrubber from './ChartTimelineScrubber'
import type { ChartSelectionPreview, ChartTimeRange } from './ChartPanel'
import type { ChartSeries } from '../types/log'
import {
  buildTopicChartOption,
  getSeriesTimeBounds,
} from '../utils/chartOptions'

type EmbeddedSignalChartProps = {
  chartKey: string
  title: string
  series: ChartSeries[]
  selectionBox?: ChartSelectionPreview | null
  timelinePointer?: number | null
  isTimelinePlaying?: boolean
  onChartReady?: (
    chartKey: string,
    instance: unknown,
    timeRange: ChartTimeRange,
  ) => void
  onChartDispose?: (chartKey: string) => void
  onTimelineSeek?: (timeValue: number) => void
  onToggleTimelinePlayback?: () => void
}

function EmbeddedSignalChart({
  chartKey,
  title,
  series,
  selectionBox,
  timelinePointer,
  isTimelinePlaying = false,
  onChartReady,
  onChartDispose,
  onTimelineSeek,
  onToggleTimelinePlayback,
}: EmbeddedSignalChartProps) {
  const timeRange = useMemo<ChartTimeRange>(() => {
    const bounds = getSeriesTimeBounds(series)
    return {
      start: bounds.start,
      end: bounds.end,
    }
  }, [series])

  const option = useMemo(
    () =>
      buildTopicChartOption(
        {
          topic: chartKey,
          title,
          series,
        },
        [],
        { showModeTrack: false },
      ),
    [chartKey, series, title],
  )

  const handleChartReady = useCallback(
    (instance: unknown) => {
      onChartReady?.(chartKey, instance, timeRange)
    },
    [chartKey, onChartReady, timeRange],
  )

  useEffect(() => {
    return () => {
      onChartDispose?.(chartKey)
    }
  }, [chartKey, onChartDispose])

  const activeSelectionBox =
    selectionBox?.chartId === chartKey ? selectionBox : null

  if (series.length === 0) {
    return <p className="hint">当前模块没有可显示的曲线。</p>
  }

  return (
    <div className="embedded-signal-chart">
      <div className="topic-title-row">
        <h4 className="topic-title">{title}</h4>
      </div>
      <div className="chart-canvas-shell">
        <ReactECharts
          key={chartKey}
          option={option}
          lazyUpdate
          style={{ height: 260 }}
          onChartReady={handleChartReady}
        />
        {activeSelectionBox ? (
          <div
            className="chart-selection-box"
            style={{
              left: activeSelectionBox.left,
              top: activeSelectionBox.top,
              width: activeSelectionBox.width,
              height: activeSelectionBox.height,
            }}
          />
        ) : null}
        <ChartTimelineScrubber
          timeRange={timeRange}
          timelinePointer={timelinePointer ?? null}
          isTimelinePlaying={isTimelinePlaying}
          onTimelineSeek={onTimelineSeek}
          onTogglePlayback={onToggleTimelinePlayback}
        />
      </div>
    </div>
  )
}

export default memo(EmbeddedSignalChart)
