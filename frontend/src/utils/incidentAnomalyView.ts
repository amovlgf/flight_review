import type {
  IncidentAnomalyFinding,
  IncidentEvidenceAssessment,
  IncidentTimelineEvent,
} from '../types/log'

export function anomalyFindingToTimelineEvent(finding: IncidentAnomalyFinding): IncidentTimelineEvent {
  return {
    id: finding.id,
    code: `ANOMALY_${finding.detectorId.toUpperCase()}`,
    type: finding.category,
    timeS: finding.startTimeS,
    severity: finding.severity,
    title: finding.title,
    detail: finding.summary,
    phase: 'unknown',
    rawEvent: null,
    confidence: finding.confidence,
    evidence: finding.evidenceSignals,
    evidenceDetails: [],
    evidenceLinks: finding.evidenceLinks ?? [],
  }
}

export function evidenceAssessmentToTimelineEvent(
  finding: IncidentAnomalyFinding,
  evidence: IncidentEvidenceAssessment,
): IncidentTimelineEvent {
  return {
    id: evidence.id,
    code: `EVIDENCE_${finding.detectorId.toUpperCase()}`,
    type: evidence.type,
    timeS: evidence.timeWindow.startS,
    severity: finding.severity,
    title: evidence.summary,
    detail: evidence.summary,
    phase: finding.timelineRelation?.phase ?? 'unknown',
    rawEvent: null,
    confidence: evidence.confidence,
    evidence: evidence.signal ? [evidence.signal] : [],
    evidenceDetails: [],
    evidenceLinks: evidence.evidenceLinks,
  }
}
