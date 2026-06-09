import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import ChartTimelineScrubber from './ChartTimelineScrubber'
import DiagnosticsPanel from './DiagnosticsPanel'
import type { DiagnosticItem } from './DiagnosticsPanel'
import {
  buildTopicChartOption,
  getSeriesDisplayName,
  getSeriesTimeBounds,
} from '../utils/chartOptions'
import type { NormalizedSelectionBox } from '../utils/selectionBox'

type ChartPoint = [number, number]

export type ChartSeries = {
  name: string
  unit: string
  points: ChartPoint[]
}

export type { DiagnosticItem } from './DiagnosticsPanel'

export type ActiveLogMeta = {
  logId: string
  fileName: string
  uploadedAt: string
}

export type TopicChart = {
  topic: string
  title: string
  series: ChartSeries[]
}

export type ModeSegment = {
  start: number
  end: number
  mode: string
  mode_code: number
  color: string
}

export type ChartSelectionPreview = NormalizedSelectionBox & {
  chartId: string
}

type ChartPanelProps = {
  activeLogMeta: ActiveLogMeta | null
  topicCharts: TopicChart[]
  seriesData: ChartSeries[]
  modeSegments: ModeSegment[]
  diagnostics: DiagnosticItem[]
  selectionBox?: ChartSelectionPreview | null
  timelinePointer?: number | null
  isTimelinePlaying?: boolean
  activeChartTopic?: string
  activeChartBadgeLabel?: string
  chartHint: string
  emptyStateMessage?: string
  showDefaultSeriesFallback?: boolean
  onChartReady: (
    chartKey: string,
    instance: unknown,
    timeRange: ChartTimeRange,
  ) => void
  onChartDispose?: (chartKey: string) => void
  onTimelineSeek?: (timeValue: number) => void
  onToggleTimelinePlayback?: () => void
}

type SelectedSeriesMap = Record<string, string[]>

type ChartCardProps = {
  chartId: string
  topic: string
  title: string
  series: ChartSeries[]
  modeSegments: ModeSegment[]
  selectedKeys?: string[]
  selectionBox?: NormalizedSelectionBox | null
  timelinePointer?: number | null
  isTimelinePlaying?: boolean
  isActive?: boolean
  activeBadgeLabel?: string
  onChartReady: (
    chartKey: string,
    instance: unknown,
    timeRange: ChartTimeRange,
  ) => void
  onChartDispose?: (chartKey: string) => void
  onTimelineSeek?: (timeValue: number) => void
  onToggleTimelinePlayback?: () => void
  onToggleSeries: (
    chartId: string,
    series: ChartSeries[],
    seriesKey: string,
  ) => void
}

export type ChartTimeRange = {
  start: number
  end: number
}

function getSeriesKey(series: ChartSeries, index: number) {
  return `${series.name}__${series.unit}__${index}`
}

function getVisibleSeries(series: ChartSeries[], selectedKeys?: string[]) {
  if (!selectedKeys) {
    return series
  }

  const selectedKeySet = new Set(selectedKeys)
  return series.filter((item, index) =>
    selectedKeySet.has(getSeriesKey(item, index)),
  )
}

function getSeriesTimeRange(series: ChartSeries[]): ChartTimeRange {
  const timeBounds = getSeriesTimeBounds(series)
  return {
    start: timeBounds.start,
    end: timeBounds.end,
  }
}

function buildChartId(topicChart: TopicChart, index: number) {
  const baseKey = topicChart.topic || topicChart.title || 'topic'
  return `${baseKey}__${index}`
}

const ChartCard = memo(function ChartCard({
  chartId,
  topic,
  title,
  series,
  modeSegments,
  selectedKeys,
  selectionBox,
  timelinePointer,
  isTimelinePlaying = false,
  isActive = false,
  activeBadgeLabel,
  onChartReady,
  onChartDispose,
  onTimelineSeek,
  onToggleTimelinePlayback,
  onToggleSeries,
}: ChartCardProps) {
  const allKeys = useMemo(() => series.map(getSeriesKey), [series])
  const activeSelectedKeys = selectedKeys ?? allKeys
  const visibleSeries = useMemo(
    () => getVisibleSeries(series, activeSelectedKeys),
    [activeSelectedKeys, series],
  )
  const timeRange = useMemo(() => getSeriesTimeRange(series), [series])

  const chartOptionState = useMemo(() => {
    try {
      return {
        option: buildTopicChartOption(
          {
            topic: chartId,
            title,
            series: visibleSeries,
          },
          modeSegments,
        ),
        error: '',
      }
    } catch (error) {
      return {
        option: null,
        error:
          error instanceof Error ? error.message : '图表配置构建失败。',
      }
    }
  }, [chartId, modeSegments, title, visibleSeries])

  const handleChartReady = useCallback(
    (instance: unknown) => {
      onChartReady(chartId, instance, timeRange)
    },
    [chartId, onChartReady, timeRange],
  )

  const handleSeriesToggle = useCallback(
    (seriesKey: string) => {
      onToggleSeries(chartId, series, seriesKey)
    },
    [chartId, onToggleSeries, series],
  )

  useEffect(() => {
    return () => {
      onChartDispose?.(chartId)
    }
  }, [chartId, onChartDispose])

  return (
    <div
      className={`chart-wrap${isActive ? ' chart-wrap-active' : ''}`}
      data-topic={topic}
    >
      <div className="topic-title-row">
        <h3 className="topic-title">{title}</h3>
        {isActive && activeBadgeLabel ? (
          <span className="topic-title-badge">{activeBadgeLabel}</span>
        ) : null}
      </div>

      {series.length > 0 ? (
        <div className="series-selector">
          <span className="series-selector-label">{'显示字段：'}</span>
          {series.map((item, index) => {
            const seriesKey = getSeriesKey(item, index)
            return (
              <label key={seriesKey} className="series-option">
                <input
                  type="checkbox"
                  checked={activeSelectedKeys.includes(seriesKey)}
                  onChange={() => handleSeriesToggle(seriesKey)}
                />
                {`${getSeriesDisplayName(item.name)} (${item.unit})`}
              </label>
            )
          })}
        </div>
      ) : null}

      {chartOptionState.error ? (
        <div className="chart-placeholder">
          {`该图表配置失败：${chartOptionState.error}`}
        </div>
      ) : visibleSeries.length === 0 ? (
        <div className="chart-placeholder">{'当前图表暂无可显示字段'}</div>
      ) : (
        <div className="chart-canvas-shell">
          <ReactECharts
            option={chartOptionState.option}
            lazyUpdate
            style={{ height: 360 }}
            onChartReady={handleChartReady}
          />
          {selectionBox ? (
            <div
              className="chart-selection-box"
              style={{
                left: selectionBox.left,
                top: selectionBox.top,
                width: selectionBox.width,
                height: selectionBox.height,
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
      )}
    </div>
  )
})

function ChartPanel({
  activeLogMeta,
  topicCharts,
  seriesData,
  modeSegments,
  diagnostics,
  selectionBox,
  timelinePointer,
  isTimelinePlaying = false,
  activeChartTopic,
  activeChartBadgeLabel,
  chartHint,
  emptyStateMessage,
  showDefaultSeriesFallback = true,
  onChartReady,
  onChartDispose,
  onTimelineSeek,
  onToggleTimelinePlayback,
}: ChartPanelProps) {
  const [selectedSeriesMap, setSelectedSeriesMap] = useState<SelectedSeriesMap>(
    {},
  )

  const handleSeriesToggle = useCallback(
    (chartId: string, series: ChartSeries[], seriesKey: string) => {
      const allKeys = series.map(getSeriesKey)

      setSelectedSeriesMap((current) => {
        const currentKeys = current[chartId] ?? allKeys
        const nextKeys = currentKeys.includes(seriesKey)
          ? currentKeys.filter((key) => key !== seriesKey)
          : [...currentKeys, seriesKey]

        return {
          ...current,
          [chartId]: nextKeys,
        }
      })
    },
    [],
  )

  const chartCards = useMemo(
    () =>
      topicCharts.map((topicChart, index) => {
        const chartId = buildChartId(topicChart, index)
        return {
          chartId,
          topic: topicChart.topic,
          title: topicChart.title,
          series: topicChart.series,
          selectedKeys: selectedSeriesMap[chartId],
          isActive:
            typeof activeChartTopic === 'string' &&
            activeChartTopic.length > 0 &&
            topicChart.topic === activeChartTopic,
        }
      }),
    [activeChartTopic, selectedSeriesMap, topicCharts],
  )

  const resolvedEmptyStateMessage =
    emptyStateMessage ||
    (activeLogMeta
      ? '暂无可展示图表'
      : chartHint && chartHint !== '图表组件占位区'
        ? chartHint
        : '暂无图表数据')

  return (
    <>
      {activeLogMeta && (
        <p className="hint">
          {`当前已加载：${activeLogMeta.fileName} (logId: ${activeLogMeta.logId})${
            activeLogMeta.uploadedAt
              ? ` / ${new Date(activeLogMeta.uploadedAt).toLocaleString()}`
              : ''
          }`}
        </p>
      )}
      {chartCards.length > 0 ? (
        <div className="topic-chart-list">
          {chartCards.map((item) => (
            <ChartCard
              key={item.chartId}
              chartId={item.chartId}
              topic={item.topic}
              title={item.title}
              series={item.series}
              modeSegments={modeSegments}
              selectedKeys={item.selectedKeys}
              selectionBox={
                selectionBox?.chartId === item.chartId ? selectionBox : null
              }
              timelinePointer={timelinePointer ?? null}
              isTimelinePlaying={isTimelinePlaying}
              isActive={item.isActive}
              activeBadgeLabel={activeChartBadgeLabel}
              onChartReady={onChartReady}
              onChartDispose={onChartDispose}
              onTimelineSeek={onTimelineSeek}
              onToggleTimelinePlayback={onToggleTimelinePlayback}
              onToggleSeries={handleSeriesToggle}
            />
          ))}
        </div>
      ) : showDefaultSeriesFallback && seriesData.length > 0 ? (
        <ChartCard
          key="default"
          chartId="default"
          topic="default"
          title="默认图表"
          series={seriesData}
          modeSegments={modeSegments}
          selectedKeys={selectedSeriesMap.default}
          selectionBox={
            selectionBox?.chartId === 'default' ? selectionBox : null
          }
          timelinePointer={timelinePointer ?? null}
          isTimelinePlaying={isTimelinePlaying}
          onChartReady={onChartReady}
          onChartDispose={onChartDispose}
          onTimelineSeek={onTimelineSeek}
          onToggleTimelinePlayback={onToggleTimelinePlayback}
          onToggleSeries={handleSeriesToggle}
        />
      ) : (
        <div className="chart-placeholder">{resolvedEmptyStateMessage}</div>
      )}
      <DiagnosticsPanel diagnostics={diagnostics} />
    </>
  )
}

export default memo(ChartPanel)
