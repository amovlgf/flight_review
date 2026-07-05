import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ControlQualityPanel from './ControlQualityPanel'
import type {
  ControlQualityParameterTuningItem,
  ControlQualityReport,
} from '../types/log'

function buildRecommendation(
  overrides: Partial<ControlQualityParameterTuningItem> & Record<string, unknown> = {},
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
  } as ControlQualityParameterTuningItem
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
  it('renders blocked display parameters with Chinese recommendation text', () => {
    const report = buildReport([])
    const rateTuning = report.parameterTuning?.loops.rate
    if (rateTuning) {
      rateTuning.blockers = [
        'Rate loop is not healthy enough for downstream tuning.',
      ]
      ;(
        rateTuning as typeof rateTuning & {
          displayParameters: Array<
            ControlQualityParameterTuningItem & { blockers: string[] }
          >
        }
      ).displayParameters = [
        {
          ...buildRecommendation({
            status: 'blocked',
            targetValue: null,
            changePercent: null,
            reason: 'Rate loop is not healthy enough for downstream tuning.',
          }),
          blockers: ['Rate loop is not healthy enough for downstream tuning.'],
        },
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

    expect(html).toContain('MC_ROLLRATE_P')
    expect(html).toContain('0.15')
    expect(html).toContain('暂不推荐')
    expect(html).toContain('上游角速度环状态不健康，暂不生成下游 PID 推荐。')
    expect(html).not.toContain(
      'Rate loop is not healthy enough for downstream tuning.',
    )
  })

  it('renders risk-limited recommendations with manual review warning', () => {
    const report = buildReport([])
    const rateTuning = report.parameterTuning?.loops.rate
    if (rateTuning) {
      rateTuning.displayParameters = [
        buildRecommendation({
          recommendationLevel: 'risk_limited',
          nextAction:
            'Manual review is required before applying this risk-limited recommendation.',
          reason:
            'Severe oscillation is present; reduce P conservatively and review manually.',
        }),
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

    expect(html).toContain('MC_ROLLRATE_P')
    expect(html).toContain('0.1425')
    expect(html).toContain('人工复核')
    expect(html).toContain('需人工复核')
  })

  it('renders diagnostic-first text for severe vibration blockers', () => {
    const report = buildReport([])
    const rateTuning = report.parameterTuning?.loops.rate
    if (rateTuning) {
      rateTuning.displayParameters = [
        buildRecommendation({
          status: 'blocked',
          targetValue: null,
          changePercent: null,
          recommendationLevel: 'deferred',
          phenomenon: 'severe_vibration',
          reason:
            'Severe vibration or severe oscillation is present; PID recommendations are blocked.',
          nextAction:
            'Diagnostic first: inspect mechanical vibration, sensors, estimator health, and filter settings before changing PID gains.',
        }),
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

    expect(html).toContain('诊断优先')
    expect(html).toContain('暂不推荐')
    expect(html).toContain('严重振荡或严重震动')
    expect(html).not.toContain('Severe vibration or severe oscillation')
  })

  it('renders conservative D-term noise guidance', () => {
    const report = buildReport([])
    const rateTuning = report.parameterTuning?.loops.rate
    if (rateTuning) {
      rateTuning.displayParameters = [
        buildRecommendation({
          parameter: 'MC_ROLLRATE_D',
          gain: 'D',
          recommendationLevel: 'actionable',
          phenomenon: 'd_term_noise',
          reason:
            'D-term or actuator high-frequency noise is present; reduce RATE_D conservatively.',
        }),
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

    expect(html).toContain('MC_ROLLRATE_D')
    expect(html).toContain('仅保守降低')
    expect(html).toContain('优先保守降低 RATE_D')
    expect(html).not.toContain('D-term or actuator high-frequency noise')
  })

  it('renders upstream reference for deferred downstream recommendations', () => {
    const report = buildReport([])
    const attitudeTuning = report.parameterTuning?.loops.attitude
    if (attitudeTuning) {
      attitudeTuning.displayParameters = [
        buildRecommendation({
          loop: 'attitude',
          parameter: 'MC_ROLL_P',
          currentValue: 6,
          status: 'blocked',
          targetValue: null,
          changePercent: null,
          recommendationLevel: 'deferred',
          reason: 'Rate loop is not healthy enough for downstream tuning.',
          nextAction:
            'Handle upstream rate loop recommendation first: MC_ROLLRATE_D.',
          upstreamReference: {
            loop: 'rate',
            parameters: ['MC_ROLLRATE_D'],
          },
        }),
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

    expect(html).toContain('MC_ROLL_P')
    expect(html).toContain('暂不推荐')
    expect(html).toContain('先处理上游角速度环推荐：MC_ROLLRATE_D')
    expect(html).not.toContain('Rate loop is not healthy enough')
  })

  it('renders low-excitation next action instead of a generic blocker', () => {
    const report = buildReport([])
    const rateTuning = report.parameterTuning?.loops.rate
    if (rateTuning) {
      rateTuning.displayParameters = [
        buildRecommendation({
          status: 'blocked',
          targetValue: null,
          changePercent: null,
          recommendationLevel: 'deferred',
          reason: 'rate roll: setpoint excitation is too low for PID recommendation.',
          nextAction:
            'Select an analysis range with clear setpoint movement before generating PID targets.',
        }),
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

    expect(html).toContain('请重新框选包含明显指令变化的片段')
    expect(html).not.toContain('setpoint excitation is too low')
  })
})
