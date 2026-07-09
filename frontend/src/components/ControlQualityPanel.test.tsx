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
      />,
    )

    expect(html).toContain('MC_ROLLRATE_P')
    expect(html).toContain('0.15')
    expect(html).toContain('0.1425')
    expect(html).toContain('control-parameter-tooltip-trigger')
    expect(html).toContain('control-parameter-reason-tooltip-trigger')
    expect(html).toContain('type="button"')
    expect(html).toContain('aria-describedby=')
    expect(html).not.toContain('data-tooltip=')
    expect(html).not.toContain('风险级别')
    expect(html).not.toContain('control-parameter-level')
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
      />,
    )

    expect(html).toContain('当前区间未发现需要调整的 PID 参数。')
  })

  it('keeps the panel chrome compact inside the function three page', () => {
    const html = renderToStaticMarkup(
      <ControlQualityPanel
        chartKeyPrefix="test"
        report={buildReport([])}
        isLoading={false}
        errorText=""
      />,
    )

    expect(html).not.toContain('分析区间：')
    expect(html).not.toContain('control-quality-range-note')
    expect(html).not.toContain('control-quality-summary')
    expect(html).not.toContain('可分析环路')
    expect(html).not.toContain('不可用环路')
    expect(html).not.toContain('开始时间')
    expect(html).not.toContain('结束时间')
    expect(html).not.toContain('重新计算')
    expect(html).not.toContain('class="control-quality-range"')
    expect(html).not.toContain('control-quality-range-input')
    expect(html).not.toContain('控制环质量')
    expect(html).not.toContain('page-title-row')
  })

  it('filters rate PID recommendations to the currently displayed chart axis', () => {
    const report = buildReport([])
    report.loops.rate = {
      status: 'available',
      axis: {
        roll: { status: 'available', unit: 'rad/s', metrics: {} },
        pitch: { status: 'available', unit: 'rad/s', metrics: {} },
        yaw: { status: 'available', unit: 'rad/s', metrics: {} },
      },
      charts: [],
    }
    const rateTuning = report.parameterTuning?.loops.rate
    if (rateTuning) {
      rateTuning.displayParameters = [
        buildRecommendation(),
        buildRecommendation({
          axis: 'pitch',
          axes: ['pitch'],
          parameter: 'MC_PITCHRATE_P',
          currentValue: 0.16,
          targetValue: 0.152,
        }),
        buildRecommendation({
          axis: 'yaw',
          axes: ['yaw'],
          parameter: 'MC_YAWRATE_P',
          currentValue: 0.2,
          targetValue: 0.19,
        }),
      ]
    }

    const html = renderToStaticMarkup(
      <ControlQualityPanel
        chartKeyPrefix="test"
        report={report}
        isLoading={false}
        errorText=""
      />,
    )

    expect(html).toContain('MC_ROLLRATE_P')
    expect(html).not.toContain('MC_PITCHRATE_P')
    expect(html).not.toContain('MC_YAWRATE_P')
  })

  it('keeps shared velocity PID recommendations visible for the displayed vx axis', () => {
    const report = buildReport([])
    report.loops.velocity = {
      status: 'available',
      axis: {
        vx: { status: 'available', unit: 'm/s', metrics: {} },
        vy: { status: 'available', unit: 'm/s', metrics: {} },
        vz: { status: 'available', unit: 'm/s', metrics: {} },
      },
      charts: [],
    }
    const velocityTuning = report.parameterTuning?.loops.velocity
    if (velocityTuning) {
      velocityTuning.displayParameters = [
        buildRecommendation({
          loop: 'velocity',
          axis: 'vx/vy',
          axes: ['vx', 'vy'],
          parameter: 'MPC_XY_VEL_P_ACC',
          currentValue: 4,
          targetValue: 3.8,
        }),
        buildRecommendation({
          loop: 'velocity',
          axis: 'vz',
          axes: ['vz'],
          parameter: 'MPC_Z_VEL_P_ACC',
          currentValue: 4,
          targetValue: 3.8,
        }),
      ]
    }

    const html = renderToStaticMarkup(
      <ControlQualityPanel
        chartKeyPrefix="test"
        report={report}
        isLoading={false}
        errorText=""
      />,
    )

    expect(html).toContain('MPC_XY_VEL_P_ACC')
    expect(html).not.toContain('MPC_Z_VEL_P_ACC')
  })

  it('renders executable recommendations and diagnostic guidance in one table', () => {
    const rateD = buildRecommendation({
      parameter: 'MC_ROLLRATE_D',
      gain: 'D',
      currentValue: 0.003,
      targetValue: 0.002925,
      changePercent: -2.5,
      recommendationLevel: 'risk_limited',
      allowedDirection: 'decrease',
      stepLimitPercent: 2.5,
      riskReason:
        'Mechanical or IMU high-frequency noise is present; gain increases are limited.',
      reason:
        'Mechanical or IMU high-frequency noise is present without control oscillation; reduce RATE_D with a small step.',
    })
    const rateP = buildRecommendation({
      parameter: 'MC_ROLLRATE_P',
      gain: 'P',
      status: 'unchanged',
      targetValue: 0.15,
      changePercent: 0,
      recommendationLevel: 'unchanged',
      allowedDirection: 'decrease',
      stepLimitPercent: 2.5,
      riskReason:
        'Mechanical or IMU high-frequency noise is present; gain increases are limited.',
      reason:
        'Mechanical or IMU high-frequency noise is present; automatic gain increases are not allowed in this risk state.',
    })
    const report = buildReport([rateD])
    const rateTuning = report.parameterTuning?.loops.rate
    if (rateTuning) {
      rateTuning.displayParameters = [rateD, rateP]
    }

    const html = renderToStaticMarkup(
      <ControlQualityPanel
        chartKeyPrefix="test"
        report={report}
        isLoading={false}
        errorText=""
      />,
    )

    expect(html).toContain('control-parameter-unified-table')
    expect(html).not.toContain('control-parameter-guidance-table')
    expect(html).toContain('MC_ROLLRATE_D')
    expect(html).toContain('0.002925')
    expect(html).toContain('MC_ROLLRATE_P')
    expect(html).toContain('保持当前值')

    const tableHtml = html.slice(html.indexOf('control-parameter-unified-table'))
    expect(tableHtml).toContain('推荐/候选值')
    expect(tableHtml).not.toContain('档位')
    expect(tableHtml).not.toContain('风险受限')
    expect(tableHtml).toContain('保持当前')
    expect(tableHtml).toContain('control-parameter-reason-tooltip-trigger')
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
      />,
    )

    expect(html).toContain('MC_ROLLRATE_P')
    expect(html).toContain('0.15')
    expect(html).toContain('暂不推荐')
    expect(html).toContain('control-parameter-blocker-summary')
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
      />,
    )

    expect(html).toContain('MC_ROLLRATE_P')
    expect(html).toContain('0.1425')
    expect(html).not.toContain('control-parameter-level-risk_limited')
    expect(html).not.toContain('>人工复核<')
    expect(html).toContain('需人工复核')
  })

  it('renders normal, risk-limited, and manual-review rows in one recommendation table', () => {
    const normalP = buildRecommendation({
      parameter: 'MC_PITCHRATE_P',
      currentValue: 0.16,
      targetValue: 0.152,
      changePercent: -5,
      recommendationLevel: 'actionable',
    })
    const riskLimitedD = buildRecommendation({
      parameter: 'MC_ROLLRATE_D',
      gain: 'D',
      targetValue: 0.002925,
      changePercent: -2.5,
      recommendationLevel: 'risk_limited',
    })
    const manualP = buildRecommendation({
      status: 'manual_candidate',
      targetValue: 0.14625,
      changePercent: -2.5,
      recommendationLevel: 'manual_review',
      reason:
        'Severe control oscillation requires manual review; candidate reduces RATE_P conservatively.',
      nextAction:
        'Manual review is required before applying this diagnostic-only candidate.',
      allowedDirection: 'decrease',
      stepLimitPercent: 2.5,
      riskReason:
        'Severe control oscillation is present; this value is for manual review only.',
    })
    const report = buildReport([normalP, riskLimitedD])
    const rateTuning = report.parameterTuning?.loops.rate
    if (rateTuning) {
      rateTuning.displayParameters = [normalP, riskLimitedD, manualP]
    }

    const html = renderToStaticMarkup(
      <ControlQualityPanel
        chartKeyPrefix="test"
        report={report}
        isLoading={false}
        errorText=""
      />,
    )

    expect(html).toContain('control-parameter-unified-table')
    expect(html).not.toContain('control-parameter-manual-candidate-table')
    expect(html).not.toContain('control-parameter-guidance-table')

    const tableHtml = html.slice(html.indexOf('control-parameter-unified-table'))
    expect(tableHtml).toContain('MC_PITCHRATE_P')
    expect(tableHtml).toContain('MC_ROLLRATE_D')
    expect(tableHtml).toContain('MC_ROLLRATE_P')
    expect(tableHtml).toContain('0.152')
    expect(tableHtml).toContain('0.002925')
    expect(tableHtml).toContain('0.14625')
    expect(tableHtml).not.toContain('档位')
    expect(tableHtml).not.toContain('正常推荐')
    expect(tableHtml).not.toContain('风险受限')
    expect(tableHtml).not.toContain('人工复核候选')
    expect(tableHtml).toContain('control-parameter-reason-tooltip-trigger')
    expect(tableHtml).not.toContain('target_generated')
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
      />,
    )

    expect(html).not.toContain('control-parameter-level-deferred')
    expect(html).toContain('control-parameter-unified-table')
    expect(html).not.toContain('>诊断优先<')
    expect(html).toContain('>暂不推荐<')
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
      />,
    )

    expect(html).toContain('MC_ROLLRATE_D')
    expect(html).not.toContain('control-parameter-level-actionable')
    expect(html).not.toContain('>仅保守降低<')
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
      />,
    )

    expect(html).toContain('MC_ROLL_P')
    expect(html).toContain('暂不推荐')
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
      />,
    )

    expect(html).toContain('暂不推荐')
    expect(html).not.toContain('setpoint excitation is too low')
  })
})
