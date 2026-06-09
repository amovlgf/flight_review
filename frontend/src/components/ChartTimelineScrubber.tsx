import { memo, useMemo } from 'react'
import type { ChartTimeRange } from './ChartPanel'

type ChartTimelineScrubberProps = {
  timeRange: ChartTimeRange
  timelinePointer: number | null
  isTimelinePlaying?: boolean
  onTimelineSeek?: (timeValue: number) => void
  onTogglePlayback?: () => void
}

function clampTime(value: number, timeRange: ChartTimeRange) {
  return Math.min(Math.max(value, timeRange.start), timeRange.end)
}

function ChartTimelineScrubber({
  timeRange,
  timelinePointer,
  isTimelinePlaying = false,
  onTimelineSeek,
  onTogglePlayback,
}: ChartTimelineScrubberProps) {
  const span = timeRange.end - timeRange.start
  const isUsable = span > 0 && Boolean(onTimelineSeek)
  const value = useMemo(() => {
    if (!Number.isFinite(timelinePointer)) {
      return timeRange.start
    }

    return clampTime(timelinePointer ?? timeRange.start, timeRange)
  }, [timeRange, timelinePointer])
  const step = span > 0 ? Math.max(span / 1000, 0.001) : 0.001

  return (
    <div className="chart-timeline-scrubber">
      <span className="chart-timeline-label">时间轴</span>
      <button
        type="button"
        className="chart-timeline-play"
        disabled={!isUsable}
        aria-label={isTimelinePlaying ? '暂停时间轴' : '播放时间轴'}
        onClick={onTogglePlayback}
      >
        {isTimelinePlaying ? '暂停' : '播放'}
      </button>
      <span className="chart-timeline-time">{`${value.toFixed(2)}s`}</span>
      <input
        type="range"
        min={timeRange.start}
        max={timeRange.end}
        step={step}
        value={value}
        disabled={!isUsable}
        aria-label="时间进度"
        onChange={(event) => {
          const nextValue = Number(event.target.value)
          if (Number.isFinite(nextValue)) {
            onTimelineSeek?.(nextValue)
          }
        }}
      />
    </div>
  )
}

export default memo(ChartTimelineScrubber)
