import { describe, expect, it } from 'vitest'
import {
  alignModeSegmentsToEvidenceTime,
  getEvidenceChart,
  getEvidenceDisplayRange,
  getEvidenceTimelineRange,
} from '../utils/incidentEvidenceChart'
import {
  anomalyFindingToTimelineEvent,
  evidenceAssessmentToTimelineEvent,
} from '../utils/incidentAnomalyView'
import type {
  IncidentAnalysisResponse,
  IncidentAnomalyFinding,
  IncidentEvidenceAssessment,
  IncidentTimelineEvent,
  ModeSegment,
} from '../types/log'

function buildReport(): IncidentAnalysisResponse {
  return {
    contractVersion: 'incident-analysis.v1.3',
    analysisId: 'analysis-1',
    logId: 'log-1',
    fileName: 'sample.ulg',
    dataQuality: {
      level: 'complete',
      rules: [],
      parser: {
        success: true,
        error: null,
      },
    },
    analysisCapability: {
      timeline: true,
      phaseDetection: true,
      eventExtraction: true,
      attitudeAnalysis: false,
      rateAnalysis: false,
      actuatorAnalysis: false,
      batteryAnalysis: false,
      estimatorAnalysis: false,
      reasons: [],
    },
    signalMappingReport: [],
    flightSummary: {
      durationS: 80,
      armedFlightTimeS: 20,
      unlockCount: 1,
    },
    phases: [],
    timeline: [],
    chartGroups: [
      {
        id: 'v1_3_state_signals',
        title: 'V1.3 state evidence signals',
        series: [
          {
            id: 'takeoff.state',
            label: 'takeoff.state',
            unit: '',
            points: [
              [0, 3],
              [4.8, 3],
              [9.573, 5],
            ],
            source: {
              topic: 'takeoff_status',
              instance: 0,
              field: 'takeoff_state',
            },
          },
        ],
      },
    ],
    warnings: [],
    missingSignals: [],
  }
}

function buildEvent(): IncidentTimelineEvent {
  return {
    id: 'TAKEOFF_COMPLETED_66.44',
    code: 'TAKEOFF_COMPLETED',
    type: 'state',
    timeS: 66.44,
    severity: 'info',
    title: 'Takeoff complete',
    detail: 'takeoff.state changed.',
    phase: 'takeoff_complete',
    rawEvent: null,
    confidence: 'high',
    evidence: ['takeoff.state'],
    evidenceDetails: [],
    evidenceLinks: [
      {
        id: 'TAKEOFF_COMPLETED_66.44__takeoff.state',
        eventId: 'TAKEOFF_COMPLETED_66.44',
        standardSignal: 'takeoff.state',
        chartGroupId: 'v1_3_state_signals',
        seriesId: 'takeoff.state',
        chartTopic: 'takeoff_status',
        targetTimeS: 66.44,
        timeWindow: {
          startS: 63.44,
          endS: 71.44,
        },
        source: {
          topic: 'takeoff_status',
          instance: 0,
          field: 'takeoff_state',
        },
      },
    ],
  }
}

describe('IncidentAnalysisPanel evidence chart helpers', () => {
  it('aligns local evidence series to the absolute event time window', () => {
    const chart = getEvidenceChart(buildReport(), buildEvent())

    expect(chart).not.toBeNull()
    expect(chart?.targetTimeS).toBe(66.44)
    expect(chart?.timeOffsetS).toBeCloseTo(56.867)
    expect(chart?.series[0]?.points).toEqual([
      [56.867, 3],
      [61.667, 3],
      [66.44, 5],
    ])
    expect(getEvidenceDisplayRange(chart!)).toEqual({
      start: 61.44,
      end: 71.44,
    })
    expect(getEvidenceDisplayRange(chart!, 61.667)).toEqual({
      start: 56.667,
      end: 66.667,
    })
  })

  it('keeps the first evidence view focused while allowing the scrubber to span the whole series', () => {
    const chart = getEvidenceChart(buildReport(), buildEvent())

    expect(chart).not.toBeNull()
    expect(getEvidenceDisplayRange(chart!)).toEqual({
      start: 61.44,
      end: 71.44,
    })
    expect(getEvidenceTimelineRange(chart!)).toEqual({
      start: 0,
      end: 80,
    })
  })

  it('renders global incident evidence on the flight-relative time axis', () => {
    const report = buildReport()
    report.flightSummary = {
      ...report.flightSummary,
      durationS: 154.179,
      armedFlightTimeS: 84.739,
      displayTimeOffsetS: 69.44,
      flightWindow: {
        startS: 69.44,
        endS: 154.179,
        durationS: 84.739,
        source: 'vehicle.armed',
      },
    }
    report.chartGroups[0].series[0].points = [
      [133.20319, 0],
      [138.2, 1],
      [143.20319, 1],
    ]
    const event = buildEvent()
    event.timeS = 138.2
    event.evidenceLinks![0].targetTimeS = 138.2
    event.evidenceLinks![0].timeWindow = {
      startS: 135.2,
      endS: 143.2,
    }

    const chart = getEvidenceChart(report, event)

    expect(chart).not.toBeNull()
    expect(chart?.targetTimeS).toBeCloseTo(68.76)
    expect(chart?.timeOffsetS).toBe(0)
    expect(chart?.series[0]?.points).toEqual([
      [63.76319, 0],
      [68.76, 1],
      [73.76319, 1],
    ])
    expect(getEvidenceDisplayRange(chart!)).toEqual({
      start: 63.76,
      end: 73.76,
    })
    expect(getEvidenceTimelineRange(chart!)).toEqual({
      start: 0,
      end: 84.739,
    })
  })

  it('shifts mode segments by the same evidence time offset', () => {
    const modeSegments: ModeSegment[] = [
      {
        start: 0,
        end: 9.573,
        mode: 'POSCTL',
        mode_code: 3,
        color: '#bbf7d0',
      },
    ]

    expect(alignModeSegmentsToEvidenceTime(modeSegments, 56.867)).toEqual([
      {
        start: 56.867,
        end: 66.44,
        mode: 'POSCTL',
        mode_code: 3,
        color: '#bbf7d0',
      },
    ])
  })

  it('converts V3 anomaly findings and evidence assessments into chartable timeline events', () => {
    const finding: IncidentAnomalyFinding = {
      id: 'battery_voltage_drop_10',
      detectorId: 'battery_voltage_drop',
      category: 'battery',
      severity: 'warning',
      title: 'Large battery voltage drop recorded',
      summary: 'Battery voltage dropped sharply.',
      startTimeS: 10,
      endTimeS: 20,
      confidence: 'confirmed',
      evidenceSignals: ['battery.voltage'],
      missingSignals: ['battery.current'],
      source: null,
      thresholds: [],
      evidenceLinks: [
        {
          id: 'battery_voltage_drop_10__battery.voltage',
          eventId: 'battery_voltage_drop_10',
          standardSignal: 'battery.voltage',
          chartGroupId: 'v1_3_optional_signals',
          seriesId: 'battery.voltage',
          chartTopic: 'battery_status',
          targetTimeS: 10,
          timeWindow: {
            startS: 7,
            endS: 15,
          },
          source: {
            topic: 'battery_status',
            instance: 0,
            field: 'voltage_v',
          },
        },
      ],
      supportingEvidence: [],
      counterEvidence: [],
      missingEvidence: [],
      timelineRelation: {
        phase: 'normal_flight',
        nearestPreviousEventId: null,
        nearestNextEventId: null,
        nearbyEventIds: [],
        summary: 'No deterministic timeline event is close.',
      },
      propagationRole: 'primary_suspect_event',
      limitations: [],
    }
    const evidence: IncidentEvidenceAssessment = {
      id: 'battery_voltage_drop_10_supporting_signal_battery.voltage',
      type: 'supporting_signal',
      signal: 'battery.voltage',
      timeWindow: {
        startS: 7,
        endS: 25,
      },
      summary: 'battery.voltage supports this finding.',
      confidence: 'confirmed',
      evidenceLinks: finding.evidenceLinks ?? [],
    }

    expect(anomalyFindingToTimelineEvent(finding)).toMatchObject({
      id: finding.id,
      code: 'ANOMALY_BATTERY_VOLTAGE_DROP',
      evidence: ['battery.voltage'],
    })
    expect(evidenceAssessmentToTimelineEvent(finding, evidence)).toMatchObject({
      id: evidence.id,
      type: 'supporting_signal',
      evidence: ['battery.voltage'],
      evidenceLinks: finding.evidenceLinks,
    })
  })
})
