import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ControlQualityPanel from './ControlQualityPanel'
import type {
  ControlQualityParameterTuningItem,
  ControlQualityReport,
} from '../types/log'

function buildRecommendation(
  overrides: Partial<ControlQualityParameterTuningItem> = {},
): ControlQualityParameterTuningItem {
  return {
    loop: 'rate',
    axis: 'roll',
    axes: ['roll'],
    gain: 'P',
    role: 'pid_gain',
    targetable: true,
    parameter: 'MC_ROLLRATE_P',
    description: '横滚角速度比例增益，影响角速度误差响应强度。',
    currentValue: 0.15,
    currentSource: 'initial',
    currentTimeS: null,
    bounds: null,
    metricSummary: {},
    status: 'target_generated',
    targetValue: 0.1425,
    changePercent: -5,
    reason: 'Overshoot is high, reduce gain conservatively.',
    ...overrides,
  }
}

function buildReport(
  parameters: ControlQualityParameterTuningItem[],
): ControlQualityReport {
  const emptyLoop = { status: 'available', axis: {}, charts: [] }
  return {
    log_file: 'sample.ulg',
    analysis_time_range: {
      start_s: 0,
      end_s: 10,
      source: 'manual',
    },
    summary: {
      available_loops: ['rate'],
      unavailable_loops: [],
      main_hints: [],
    },
    loops: {
      actuator: { status: 'available', metrics: {}, channels: [], chart: [] },
      rate: emptyLoop,
      attitude: emptyLoop,
      velocity: emptyLoop,
      position: emptyLoop,
    },
    parameterTuning: {
      actuatorBlocksIncrease: false,
      loops: {
        actuator: { status: 'not_applicable', parameters: [], notes: [] },
        rate: { status: 'available', parameters, notes: [] },
        attitude: { status: 'no_recommendation', parameters: [], notes: [] },
        velocity: { status: 'no_recommendation', parameters: [], notes: [] },
        position: { status: 'no_recommendation', parameters: [], notes: [] },
      },
      warnings: [],
    },
    estimator_quality: {},
    missing_topics: [],
    missing_fields: [],
    warnings: [],
  }
}

describe('ControlQualityPanel parameter recommendations', () => {
  it('renders only recommended PID parameters with current and target values', () => {
    const html = renderToStaticMarkup(
      <ControlQualityPanel
        chartKeyPrefix="test"
        report={buildReport([
          buildRecommendation(),
          buildRecommendation({
            parameter: 'MC_ROLLRATE_FF',
            targetable: false,
            status: 'display_only',
            targetValue: null,
          }),
        ])}
        isLoading={false}
        errorText=""
        onApplyRange={() => {}}
      />,
    )

    expect(html).toContain('MC_ROLLRATE_P')
    expect(html).toContain('0.15')
    expect(html).toContain('0.1425')
    expect(html).toContain('control-parameter-tooltip-trigger')
    expect(html).toContain('type="button"')
    expect(html).toContain('aria-describedby=')
    expect(html).not.toContain('data-tooltip=')
    expect(html).toContain('横滚角速度比例增益')
    expect(html).not.toContain('MC_ROLLRATE_FF')
    expect(html).not.toContain('Max Step')
    expect(html).not.toContain('bounds_required')
  })

  it('renders an empty recommendation state when no parameter changes are suggested', () => {
    const html = renderToStaticMarkup(
      <ControlQualityPanel
        chartKeyPrefix="test"
        report={buildReport([])}
        isLoading={false}
        errorText=""
        onApplyRange={() => {}}
      />,
    )

    expect(html).toContain('当前区间未发现需要调整的 PID 参数。')
  })
  it('renders blocker reasons when recommendations are suppressed', () => {
    const report = buildReport([])
    const rateTuning = report.parameterTuning?.loops.rate
    if (rateTuning) {
      rateTuning.blockers = [
        'Rate loop is not healthy enough for downstream tuning.',
      ]
    }

    const html = renderToStaticMarkup(
      <ControlQualityPanel
        chartKeyPrefix="test"
        report={report}
        isLoading={false}
        errorText=""
        onApplyRange={() => {}}
      />,
    )

    expect(html).toContain(
      'Rate loop is not healthy enough for downstream tuning.',
    )
  })
})
