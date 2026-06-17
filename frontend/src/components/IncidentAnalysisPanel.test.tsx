import { describe, expect, it } from 'vitest'
import {
  alignModeSegmentsToEvidenceTime,
  getEvidenceChart,
  getEvidenceDisplayRange,
} from '../utils/incidentEvidenceChart'
import type { IncidentAnalysisResponse, IncidentTimelineEvent, ModeSegment } from '../types/log'

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
})
