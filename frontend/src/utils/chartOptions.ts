import type { ModeSegment, TopicChart } from '../types/log'

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

function getChartTimeRange(chart: TopicChart) {
  const times = chart.series.flatMap((item) =>
    item.points.map((point) => point[0]).filter(Number.isFinite),
  )
  if (times.length === 0) return 0

  return Math.max(...times) - Math.min(...times)
}

export function buildTopicChartOption(
  chart: TopicChart,
  modeSegments: ModeSegment[],
) {
  const chartTimeRange = getChartTimeRange(chart)
  const minModeLabelDuration = Math.max(5, chartTimeRange * 0.08)

  return {
    tooltip: { trigger: 'axis' },
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
      data: chart.series.map(
        (item) => `${getSeriesDisplayName(item.name)} (${item.unit})`,
      ),
    },
    grid: { left: 56, right: 76, top: 74, bottom: 64 },
    xAxis: {
      type: 'value',
      name: '\u65f6\u95f4 (s)',
      nameGap: 28,
      axisLabel: { margin: 12 },
    },
    yAxis: {
      type: 'value',
      name: '\u6570\u503c',
      nameGap: 22,
      axisLabel: { margin: 10 },
    },
    dataZoom: [
      {
        type: 'inside',
        xAxisIndex: 0,
        filterMode: 'none',
      },
      {
        type: 'slider',
        xAxisIndex: 0,
        filterMode: 'none',
        bottom: 16,
        height: 18,
      },
    ],
    series: chart.series.map((item, idx) => ({
      name: `${getSeriesDisplayName(item.name)} (${item.unit})`,
      type: 'line',
      smooth: false,
      showSymbol: false,
      data: item.points,
      markArea:
        idx === 0 && modeSegments.length > 0
          ? {
              silent: true,
              label: {
                show: true,
                position: 'insideTop',
                color: '#334155',
                fontSize: 10,
                width: 72,
                overflow: 'truncate',
              },
              itemStyle: {
                opacity: 0.1,
              },
              data: modeSegments
                .filter((seg) => Number.isFinite(seg.start) && Number.isFinite(seg.end))
                .map((seg) => [
                  {
                    name:
                      seg.end - seg.start >= minModeLabelDuration ? seg.mode : '',
                    xAxis: seg.start,
                    itemStyle: {
                      color: seg.color || '#94a3b8',
                      opacity: 0.12,
                    },
                  },
                  { xAxis: seg.end },
                ]),
            }
          : undefined,
    })),
  }
}
