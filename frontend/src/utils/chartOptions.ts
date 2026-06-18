import type { ModeSegment, TopicChart } from '../types/log'

type ChartSeriesLike = {
  name?: string
  unit?: string
  points?: unknown
}

export type ChartTimeBounds = {
  start: number
  end: number
  hasData: boolean
}

const DEFAULT_CHART_COLORS = [
  '#1d4ed8',
  '#f97316',
  '#059669',
  '#7c3aed',
  '#dc2626',
  '#0891b2',
  '#ca8a04',
  '#475569',
]

const MODE_BACKGROUND_OPACITY = 0.09
const MODE_TRACK_HEIGHT = 18
const SHORT_MODE_SEGMENT_THRESHOLD_S = 1

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function getSeriesVisualStyle(name: string, index: number) {
  const normalizedName = name.trim().toLowerCase()
  const isSetpoint =
    normalizedName.includes('setpoint') ||
    normalizedName.endsWith('_sp') ||
    normalizedName.includes('desired') ||
    normalizedName.includes('target')
  const isActual =
    normalizedName.includes('actual') ||
    ['roll', 'pitch', 'yaw'].includes(normalizedName)

  if (isSetpoint) {
    return {
      color: '#f97316',
      width: 2.4,
      type: 'solid' as const,
      opacity: 0.98,
    }
  }

  if (isActual) {
    return {
      color: '#1d4ed8',
      width: 2.75,
      type: 'solid' as const,
      opacity: 0.98,
    }
  }

  return {
    color: DEFAULT_CHART_COLORS[index % DEFAULT_CHART_COLORS.length],
    width: 2.2,
    type: 'solid' as const,
    opacity: 0.96,
  }
}

function isDiscreteStateSeries(name: string) {
  const normalizedName = name.trim().toLowerCase()
  return (
    normalizedName.endsWith('.state') ||
    normalizedName.endsWith('state') ||
    normalizedName.includes('armed') ||
    normalizedName.includes('landed') ||
    normalizedName.includes('failsafe') ||
    normalizedName.includes('groundcontact') ||
    normalizedName.includes('atrest') ||
    normalizedName.includes('ingroundeffect') ||
    normalizedName.includes('currenttype') ||
    normalizedName.includes('primaryinstance') ||
    normalizedName.includes('instancechangedcount')
  )
}

function normalizeSeriesPoints(points: unknown): Array<[number, number]> {
  if (!Array.isArray(points)) {
    return []
  }

  const normalized: Array<[number, number]> = []
  for (const point of points) {
    if (!Array.isArray(point) || point.length < 2) {
      continue
    }

    const time = point[0]
    const value = point[1]
    if (!isFiniteNumber(time) || !isFiniteNumber(value)) {
      continue
    }

    normalized.push([time, value])
  }

  return normalized
}

function normalizeSeries(series: unknown): Array<{
  name: string
  unit: string
  points: Array<[number, number]>
}> {
  if (!Array.isArray(series)) {
    return []
  }

  return series.map((item) => {
    const safeItem = (item ?? {}) as ChartSeriesLike
    return {
      name: typeof safeItem.name === 'string' ? safeItem.name : 'unknown',
      unit: typeof safeItem.unit === 'string' ? safeItem.unit : '',
      points: normalizeSeriesPoints(safeItem.points),
    }
  })
}

function formatDuration(durationS: number) {
  if (durationS >= 60) {
    const minutes = Math.floor(durationS / 60)
    const seconds = Math.round(durationS % 60)
    return `${minutes}m ${seconds}s`
  }

  return `${durationS.toFixed(durationS >= 10 ? 1 : 2)}s`
}

function normalizeModeSegments(modeSegments: unknown): Array<
  ModeSegment & {
    durationS: number
    isShortMode: boolean
  }
> {
  if (!Array.isArray(modeSegments)) {
    return []
  }

  return modeSegments
    .filter(
      (seg) =>
        isFiniteNumber(seg?.start) &&
        isFiniteNumber(seg?.end) &&
        seg.end >= seg.start,
    )
    .map((seg) => {
      const durationS = isFiniteNumber(seg.durationS)
        ? seg.durationS
        : Math.max(0, seg.end - seg.start)

      return {
        ...seg,
        mode: typeof seg.mode === 'string' && seg.mode ? seg.mode : 'UNKNOWN',
        mode_code: isFiniteNumber(seg.mode_code) ? seg.mode_code : -1,
        color:
          typeof seg.color === 'string' && seg.color ? seg.color : '#9ca3af',
        durationS,
        isShortMode:
          typeof seg.isShortMode === 'boolean'
            ? seg.isShortMode
            : durationS < SHORT_MODE_SEGMENT_THRESHOLD_S,
      }
    })
}

export function getSeriesTimeBounds(
  series: Array<ChartSeriesLike> | null | undefined,
): ChartTimeBounds {
  if (!Array.isArray(series) || series.length === 0) {
    return { start: 0, end: 0, hasData: false }
  }

  let minTime = Infinity
  let maxTime = -Infinity

  for (const item of series) {
    const points = normalizeSeriesPoints(item?.points)
    for (const point of points) {
      const time = point[0]
      if (time < minTime) {
        minTime = time
      }
      if (time > maxTime) {
        maxTime = time
      }
    }
  }

  if (!Number.isFinite(minTime) || !Number.isFinite(maxTime)) {
    return { start: 0, end: 0, hasData: false }
  }

  return {
    start: minTime,
    end: maxTime,
    hasData: true,
  }
}

export function getChartTimeRange(
  chart: Pick<TopicChart, 'series'> | null | undefined,
) {
  const timeBounds = getSeriesTimeBounds(chart?.series)
  if (!timeBounds.hasData) {
    return 0
  }

  return Math.max(0, timeBounds.end - timeBounds.start)
}

export function getSeriesDisplayName(name: string) {
  if (name === 'Altitude' || name === 'altitude') return '\u9ad8\u5ea6'
  if (name === 'Speed' || name === 'speed' || name === 'speed_3d')
    return '\u901f\u5ea6'
  if (name === 'Voltage') return '\u7535\u538b'
  if (name === 'voltage_v') return '\u7535\u538b'
  if (name === 'current_a') return '\u7535\u6d41'
  if (name === 'remaining') return '\u5269\u4f59\u7535\u91cf'
  if (name === 'temperature') return '\u6e29\u5ea6'
  if (name === 'discharged_mah') return '\u5df2\u8017\u7535\u91cf'
  if (name === 'roll') return '\u6eda\u8f6c\u89d2'
  if (name === 'pitch') return '\u4fef\u4ef0\u89d2'
  if (name === 'yaw') return '\u822a\u5411\u89d2'
  if (name === 'roll_sp') return '\u671f\u671b\u6eda\u8f6c\u89d2'
  if (name === 'pitch_sp') return '\u671f\u671b\u4fef\u4ef0\u89d2'
  if (name === 'yaw_sp') return '\u671f\u671b\u822a\u5411\u89d2'
  if (name === 'yaw_sp_move_rate') return '\u671f\u671b\u504f\u822a\u53d8\u5316\u7387'
  if (name === 'lat') return '\u7eac\u5ea6'
  if (name === 'lon') return '\u7ecf\u5ea6'
  if (name === 'alt') return 'GPS\u9ad8\u5ea6'
  if (name === 'alt_ellipsoid') return '\u692d\u7403\u9ad8'
  if (name === 'eph') return '\u6c34\u5e73\u7cbe\u5ea6'
  if (name === 'epv') return '\u5782\u76f4\u7cbe\u5ea6'
  if (name === 'fix_type') return '\u5b9a\u4f4d\u72b6\u6001'
  if (name === 'satellites_used') return '\u53ef\u89c1\u536b\u661f'
  if (name === 'vel_m_s') return 'GPS\u901f\u5ea6'
  if (name === 'vel_n_m_s') return '\u5317\u5411\u901f\u5ea6'
  if (name === 'vel_e_m_s') return '\u4e1c\u5411\u901f\u5ea6'
  if (name === 'vel_d_m_s') return '\u5929\u5411\u901f\u5ea6'
  if (name === 'q[0]') return 'q0'
  if (name === 'q[1]') return 'q1'
  if (name === 'q[2]') return 'q2'
  if (name === 'q[3]') return 'q3'
  if (name.startsWith('output[')) return `\u8f93\u51fa${name.slice(6)}`
  return name
}

export function buildTopicChartOption(
  chart: TopicChart,
  modeSegments: ModeSegment[],
  options: { showModeTrack?: boolean } = {},
) {
  const normalizedSeries = normalizeSeries(chart?.series)
  const normalizedModeSegments = normalizeModeSegments(modeSegments)
  const chartTimeRange = getChartTimeRange({ series: normalizedSeries })
  const minModeLabelDuration = Math.max(
    SHORT_MODE_SEGMENT_THRESHOLD_S,
    chartTimeRange * 0.06,
  )
  const hasModeTrack =
    options.showModeTrack !== false &&
    normalizedSeries.length > 0 &&
    normalizedModeSegments.length > 0
  const xAxis = [
    {
      type: 'value',
      name: '\u65f6\u95f4 (s)',
      nameGap: 28,
      axisLabel: { margin: 12 },
      splitLine: {
        lineStyle: {
          color: 'rgba(148, 163, 184, 0.22)',
        },
      },
      axisLine: {
        lineStyle: {
          color: '#64748b',
        },
      },
    },
    ...(hasModeTrack
      ? [
          {
            type: 'value',
            gridIndex: 1,
            min: 'dataMin',
            max: 'dataMax',
            axisLabel: { show: false },
            axisTick: { show: false },
            axisLine: { show: false },
            splitLine: { show: false },
          },
        ]
      : []),
  ]
  const yAxis = [
    {
      type: 'value',
      name: '\u6570\u503c',
      nameGap: 22,
      axisLabel: { margin: 10 },
      splitLine: {
        lineStyle: {
          color: 'rgba(148, 163, 184, 0.22)',
        },
      },
      axisLine: {
        lineStyle: {
          color: '#64748b',
        },
      },
    },
    ...(hasModeTrack
      ? [
          {
            type: 'value',
            gridIndex: 1,
            min: 0,
            max: 1,
            axisLabel: { show: false },
            axisTick: { show: false },
            axisLine: { show: false },
            splitLine: { show: false },
          },
        ]
      : []),
  ]
  const lineSeries: Array<Record<string, unknown>> = normalizedSeries.map((item, idx) => {
    const visualStyle = getSeriesVisualStyle(item.name, idx)
    const isStateSeries = isDiscreteStateSeries(item.name)

    return {
      name: `${getSeriesDisplayName(item.name)} (${item.unit})`,
      type: 'line',
      smooth: false,
      step: isStateSeries ? ('end' as const) : false,
      showSymbol: isStateSeries || item.points.length <= 1,
      symbol: 'circle',
      symbolSize: item.points.length <= 1 ? 7 : 5,
      data: item.points,
      lineStyle: {
        color: visualStyle.color,
        width: isStateSeries ? Math.max(visualStyle.width, 2.8) : visualStyle.width,
        type: visualStyle.type,
        opacity: visualStyle.opacity,
      },
      itemStyle: {
        color: visualStyle.color,
      },
      emphasis: {
        focus: 'series',
        lineStyle: {
          width: visualStyle.width + 0.6,
        },
      },
      markArea:
        idx === 0 && normalizedModeSegments.length > 0
          ? {
              silent: true,
              label: {
                show: true,
                position: 'insideTop',
                color: '#475569',
                fontSize: 10,
                width: 82,
                overflow: 'truncate',
              },
              itemStyle: {
                opacity: MODE_BACKGROUND_OPACITY,
              },
              data: normalizedModeSegments.map((seg) => [
                {
                  name:
                    !seg.isShortMode && seg.durationS >= minModeLabelDuration
                      ? seg.mode
                      : '',
                  xAxis: seg.start,
                  itemStyle: {
                    color: seg.color,
                    opacity: MODE_BACKGROUND_OPACITY,
                  },
                },
                { xAxis: seg.end },
              ]),
            }
          : undefined,
    }
  })
  const modeTrackSeries: Array<Record<string, unknown>> = hasModeTrack
    ? [
        {
          name: '\u98de\u884c\u6a21\u5f0f',
          type: 'custom',
          xAxisIndex: 1,
          yAxisIndex: 1,
          silent: false,
          tooltip: {
            formatter: (params: { data?: unknown }) => {
              const data = Array.isArray(params.data) ? params.data : []
              const mode = String(data[2] ?? 'UNKNOWN')
              const durationS =
                typeof data[5] === 'number' && Number.isFinite(data[5])
                  ? data[5]
                  : Math.max(0, Number(data[1] ?? 0) - Number(data[0] ?? 0))
              return [
                `<strong>${mode}</strong>`,
                `${Number(data[0] ?? 0).toFixed(2)}s - ${Number(
                  data[1] ?? 0,
                ).toFixed(2)}s`,
                `\u6301\u7eed ${formatDuration(durationS)}`,
                `nav_state: ${String(data[3] ?? '-')}`,
              ].join('<br/>')
            },
          },
          encode: { x: [0, 1], y: 4 },
          data: normalizedModeSegments.map((seg) => [
            seg.start,
            seg.end,
            seg.mode,
            seg.mode_code,
            0,
            seg.durationS,
            seg.color,
          ]),
          renderItem: (
            _params: unknown,
            api: {
              value: (index: number) => unknown
              coord: (value: [number, number]) => [number, number]
              size: (value: [number, number]) => [number, number]
              style: (extra?: Record<string, unknown>) => Record<string, unknown>
            },
          ) => {
            const start = Number(api.value(0))
            const end = Number(api.value(1))
            const mode = String(api.value(2) ?? 'UNKNOWN')
            const durationS = Number(api.value(5))
            const color = String(api.value(6) ?? '#9ca3af')
            const startPoint = api.coord([start, 0])
            const endPoint = api.coord([end, 0])
            const size = api.size([0, 1])
            const width = Math.max(1, endPoint[0] - startPoint[0])
            const height = Math.max(MODE_TRACK_HEIGHT, size[1] * 0.8)
            const showLabel =
              Number.isFinite(durationS) && durationS >= minModeLabelDuration

            return {
              type: 'group',
              children: [
                {
                  type: 'rect',
                  shape: {
                    x: startPoint[0],
                    y: startPoint[1] - height / 2,
                    width,
                    height,
                  },
                  style: api.style({
                    fill: color,
                    opacity: 0.88,
                    stroke: 'rgba(15, 23, 42, 0.16)',
                    lineWidth: 0.5,
                  }),
                },
                ...(showLabel
                  ? [
                      {
                        type: 'text',
                        style: {
                          text: mode,
                          x: startPoint[0] + Math.min(6, width / 2),
                          y: startPoint[1],
                          fill: '#ffffff',
                          font: '10px sans-serif',
                          textVerticalAlign: 'middle',
                          textAlign: 'left',
                          width: Math.max(0, width - 8),
                          overflow: 'truncate',
                        },
                      },
                    ]
                  : []),
              ],
            }
          },
        },
      ]
    : []

  return {
    backgroundColor: '#ffffff',
    color: DEFAULT_CHART_COLORS,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
    },
    toolbox: {
      orient: 'vertical',
      right: 8,
      top: 84,
      feature: {
        dataZoom: {
          yAxisIndex: 'none',
          title: {
            zoom: '\u533a\u95f4\u7f29\u653e',
            back: '\u8fd8\u539f\u7f29\u653e',
          },
        },
        restore: { title: '\u8fd8\u539f' },
      },
    },
    legend: {
      type: 'scroll',
      top: 8,
      textStyle: {
        color: '#334155',
      },
      data: normalizedSeries.map(
        (item) => `${getSeriesDisplayName(item.name)} (${item.unit})`,
      ),
    },
    grid: hasModeTrack
      ? [
          { left: 56, right: 76, top: 74, bottom: 92 },
          { left: 56, right: 76, bottom: 58, height: MODE_TRACK_HEIGHT },
        ]
      : { left: 56, right: 76, top: 74, bottom: 64 },
    xAxis,
    yAxis,
    dataZoom: [
      {
        type: 'inside',
        xAxisIndex: hasModeTrack ? [0, 1] : 0,
        filterMode: 'none',
        moveOnMouseMove: false,
      },
    ],
    series: [...lineSeries, ...modeTrackSeries],
  }
}
