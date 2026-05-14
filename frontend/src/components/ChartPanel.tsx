import { useState } from 'react'
import ReactECharts from 'echarts-for-react'
import DiagnosticsPanel from './DiagnosticsPanel'
import type { DiagnosticItem } from './DiagnosticsPanel'
import { buildTopicChartOption, getSeriesDisplayName } from '../utils/chartOptions'

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

type ChartPanelProps = {
  activeLogMeta: ActiveLogMeta | null
  topicCharts: TopicChart[]
  seriesData: ChartSeries[]
  modeSegments: ModeSegment[]
  diagnostics: DiagnosticItem[]
  chartHint: string
  onChartReady: (
    chartKey: string,
    instance: unknown,
    timeRange: ChartTimeRange,
  ) => void
}

type SelectedSeriesMap = Record<string, string[]>

export type ChartTimeRange = {
  start: number
  end: number
}

function getSeriesKey(series: ChartSeries, index: number) {
  return `${series.name}__${series.unit}__${index}`
}

function getVisibleSeries(
  topicKey: string,
  series: ChartSeries[],
  selectedSeriesMap: SelectedSeriesMap,
) {
  const selectedKeys = selectedSeriesMap[topicKey]
  if (!selectedKeys) return series

  return series.filter((item, index) =>
    selectedKeys.includes(getSeriesKey(item, index)),
  )
}

function getSeriesTimeRange(series: ChartSeries[]): ChartTimeRange {
  const times = series.flatMap((item) =>
    item.points.map((point) => point[0]).filter(Number.isFinite),
  )
  if (times.length === 0) return { start: 0, end: 0 }

  return {
    start: Math.min(...times),
    end: Math.max(...times),
  }
}

function ChartPanel({
  activeLogMeta,
  topicCharts,
  seriesData,
  modeSegments,
  diagnostics,
  chartHint,
  onChartReady,
}: ChartPanelProps) {
  const [selectedSeriesMap, setSelectedSeriesMap] = useState<SelectedSeriesMap>({})

  const handleSeriesToggle = (
    topicKey: string,
    series: ChartSeries[],
    seriesKey: string,
  ) => {
    const allKeys = series.map(getSeriesKey)
    const currentKeys = selectedSeriesMap[topicKey] ?? allKeys
    const nextKeys = currentKeys.includes(seriesKey)
      ? currentKeys.filter((key) => key !== seriesKey)
      : [...currentKeys, seriesKey]

    setSelectedSeriesMap((current) => ({
      ...current,
      [topicKey]: nextKeys,
    }))
  }

  const renderSeriesSelector = (topicKey: string, series: ChartSeries[]) => {
    if (series.length === 0) return null

    const allKeys = series.map(getSeriesKey)
    const selectedKeys = selectedSeriesMap[topicKey] ?? allKeys

    return (
      <div className="series-selector">
        <span className="series-selector-label">{'\u663e\u793a\u5b57\u6bb5\uff1a'}</span>
        {series.map((item, index) => {
          const seriesKey = getSeriesKey(item, index)
          return (
            <label key={seriesKey} className="series-option">
              <input
                type="checkbox"
                checked={selectedKeys.includes(seriesKey)}
                onChange={() => handleSeriesToggle(topicKey, series, seriesKey)}
              />
              {`${getSeriesDisplayName(item.name)} (${item.unit})`}
            </label>
          )
        })}
      </div>
    )
  }

  return (
    <>
      {activeLogMeta && (
        <p className="hint">
          {`\u5f53\u524d\u5df2\u52a0\u8f7d\uff1a${activeLogMeta.fileName} (logId: ${activeLogMeta.logId})${
            activeLogMeta.uploadedAt
              ? ` / ${new Date(activeLogMeta.uploadedAt).toLocaleString()}`
              : ''
          }`}
        </p>
      )}
      {topicCharts.length > 0 ? (
        <div className="topic-chart-list">
          {topicCharts.map((topicChart) => (
            <div key={topicChart.topic} className="chart-wrap">
              <h3 className="topic-title">{topicChart.title}</h3>
              {renderSeriesSelector(topicChart.topic, topicChart.series)}
              <ReactECharts
                option={buildTopicChartOption(
                  {
                    ...topicChart,
                    series: getVisibleSeries(
                      topicChart.topic,
                      topicChart.series,
                      selectedSeriesMap,
                    ),
                  },
                  modeSegments,
                )}
                style={{ height: 360 }}
                onChartReady={(instance) =>
                  onChartReady(
                    topicChart.topic,
                    instance,
                    getSeriesTimeRange(topicChart.series),
                  )
                }
              />
            </div>
          ))}
        </div>
      ) : seriesData.length > 0 ? (
        <div className="chart-wrap">
          {renderSeriesSelector('default', seriesData)}
          <ReactECharts
            option={buildTopicChartOption(
              {
                topic: 'default',
                title: '\u9ed8\u8ba4\u56fe\u8868',
                series: getVisibleSeries(
                  'default',
                  seriesData,
                  selectedSeriesMap,
                ),
              },
              modeSegments,
            )}
            style={{ height: 360 }}
            onChartReady={(instance) =>
              onChartReady('default', instance, getSeriesTimeRange(seriesData))
            }
          />
        </div>
      ) : (
        <div className="chart-placeholder">{chartHint}</div>
      )}
      <DiagnosticsPanel diagnostics={diagnostics} />
    </>
  )
}

export default ChartPanel
