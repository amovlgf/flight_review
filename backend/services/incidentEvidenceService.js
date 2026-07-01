const EVIDENCE_WINDOW_BEFORE_S = 3;
const EVIDENCE_WINDOW_AFTER_S = 5;
const NEARBY_EVENT_WINDOW_S = 5;

function roundTime(value) {
  return Number(Number(value).toFixed(3));
}

function makeWindow(startTimeS, endTimeS = null) {
  const start = Number(startTimeS);
  const end = endTimeS === null ? start : Number(endTimeS);
  const safeStart = Number.isFinite(start) ? start : 0;
  const safeEnd = Number.isFinite(end) ? end : safeStart;

  return {
    startS: Math.max(0, roundTime(safeStart - EVIDENCE_WINDOW_BEFORE_S)),
    endS: roundTime(safeEnd + EVIDENCE_WINDOW_AFTER_S),
  };
}

function phaseAt(phases, timeS) {
  if (!Array.isArray(phases)) return 'unknown';
  const match = phases.find((phase) => timeS >= phase.startS && timeS <= phase.endS);
  return match?.phase || 'unknown';
}

function nearbyTimelineEvents(timeline, finding) {
  if (!Array.isArray(timeline)) return [];
  return timeline.filter((event) =>
    Math.abs(Number(event.timeS) - Number(finding.startTimeS)) <= NEARBY_EVENT_WINDOW_S,
  );
}

function relationForFinding(finding, timeline, phases) {
  const sortedTimeline = Array.isArray(timeline)
    ? [...timeline].sort((a, b) => a.timeS - b.timeS || a.id.localeCompare(b.id))
    : [];
  const previous = [...sortedTimeline].reverse().find((event) => event.timeS <= finding.startTimeS) || null;
  const next = sortedTimeline.find((event) => event.timeS > finding.startTimeS) || null;
  const nearby = nearbyTimelineEvents(sortedTimeline, finding);

  return {
    phase: phaseAt(phases, finding.startTimeS),
    nearestPreviousEventId: previous?.id || null,
    nearestNextEventId: next?.id || null,
    nearbyEventIds: nearby.map((event) => event.id),
    summary:
      nearby.length > 0
        ? `${nearby.length} deterministic timeline event(s) are near this anomaly phenomenon.`
        : 'No deterministic timeline event is close to this anomaly phenomenon.',
  };
}

function evidenceLinksForSignal(finding, signalId, buildEvidenceLinksForEvent, signals) {
  if (typeof buildEvidenceLinksForEvent !== 'function') return [];

  return buildEvidenceLinksForEvent(
    {
      id: `${finding.id}_${signalId}`,
      timeS: finding.startTimeS,
      evidence: [signalId],
    },
    signals,
  );
}

function makeSignalEvidence({ finding, signalId, type, summary, confidence, buildEvidenceLinksForEvent, signals }) {
  return {
    id: `${finding.id}_${type}_${signalId}`,
    type,
    signal: signalId,
    timeWindow: makeWindow(finding.startTimeS, finding.endTimeS),
    summary,
    confidence,
    evidenceLinks: evidenceLinksForSignal(finding, signalId, buildEvidenceLinksForEvent, signals),
  };
}

function buildSupportingEvidence(finding, timeline, buildEvidenceLinksForEvent, signals) {
  const signalEvidence = (finding.evidenceSignals || []).map((signalId) =>
    makeSignalEvidence({
      finding,
      signalId,
      type: 'supporting_signal',
      summary: `${signalId} is the logged signal used by detector ${finding.detectorId}.`,
      confidence: finding.confidence || 'confirmed',
      buildEvidenceLinksForEvent,
      signals,
    }),
  );

  const eventEvidence = nearbyTimelineEvents(timeline, finding).slice(0, 3).map((event) => ({
    id: `${finding.id}_nearby_event_${event.id}`,
    type: 'nearby_timeline_event',
    signal: event.evidence?.[0] || '',
    timeWindow: makeWindow(event.timeS, event.timeS),
    summary: `${event.title || event.code} is near the anomaly time.`,
    confidence: event.confidence || 'medium',
    evidenceLinks: event.evidenceLinks || [],
  }));

  return [...signalEvidence, ...eventEvidence];
}

function buildCounterEvidence(finding, signals, buildEvidenceLinksForEvent) {
  const counterEvidence = [];

  if (finding.category === 'battery' && signals?.['battery.current']?.points?.length > 0) {
    counterEvidence.push(
      makeSignalEvidence({
        finding,
        signalId: 'battery.current',
        type: 'counter_or_context_signal',
        summary: 'Battery current is available for load-context review; V3 does not infer battery health from voltage alone.',
        confidence: 'medium',
        buildEvidenceLinksForEvent,
        signals,
      }),
    );
  }

  if (finding.category === 'safety' && signals?.['vehicle.landed']?.points?.length > 0) {
    counterEvidence.push(
      makeSignalEvidence({
        finding,
        signalId: 'vehicle.landed',
        type: 'counter_or_context_signal',
        summary: 'Landed state is available to review whether this safety finding is a state transition or log-end condition.',
        confidence: 'medium',
        buildEvidenceLinksForEvent,
        signals,
      }),
    );
  }

  return counterEvidence;
}

function buildMissingEvidence(finding) {
  return (finding.missingSignals || []).map((signalId) => ({
    id: `${finding.id}_missing_${signalId}`,
    type: 'missing_signal',
    signal: signalId,
    timeWindow: makeWindow(finding.startTimeS, finding.endTimeS),
    summary: `${signalId} is not available, so this finding cannot be expanded into a stronger conclusion.`,
    confidence: 'confirmed',
    evidenceLinks: [],
  }));
}

function propagationRoleForFinding(finding, index) {
  if (finding.detectorId === 'airborne_log_end') return 'consequence_event';
  if (index === 0 && ['warning', 'critical'].includes(finding.severity)) return 'primary_suspect_event';
  if (finding.category === 'safety') return 'consequence_event';
  if (finding.category === 'battery' || finding.category === 'estimator') return 'contributing_event';
  if (finding.category === 'attitude' || finding.category === 'rate' || finding.category === 'actuator') return 'context_event';
  return 'unknown';
}

function enrichFindingsWithEvidence({ anomalySummary, timeline, phases, signals, buildEvidenceLinksForEvent }) {
  const sortedFindings = [...(anomalySummary?.findings || [])].sort(
    (a, b) => a.startTimeS - b.startTimeS || a.id.localeCompare(b.id),
  );
  const enrichedFindings = sortedFindings.map((finding, index) => ({
    ...finding,
    supportingEvidence: buildSupportingEvidence(finding, timeline, buildEvidenceLinksForEvent, signals),
    counterEvidence: buildCounterEvidence(finding, signals, buildEvidenceLinksForEvent),
    missingEvidence: buildMissingEvidence(finding),
    timelineRelation: relationForFinding(finding, timeline, phases),
    propagationRole: propagationRoleForFinding(finding, index),
  }));
  const findingsById = new Map(enrichedFindings.map((finding) => [finding.id, finding]));

  return {
    ...anomalySummary,
    findings: enrichedFindings,
    detectorResults: (anomalySummary?.detectorResults || []).map((result) => ({
      ...result,
      findings: (result.findings || []).map((finding) => findingsById.get(finding.id) || finding),
    })),
  };
}

function buildIncidentPropagation(anomalySummary) {
  const findings = [...(anomalySummary?.findings || [])].sort(
    (a, b) => a.startTimeS - b.startTimeS || a.id.localeCompare(b.id),
  );
  const events = findings.map((finding, index) => ({
    id: `propagation_${finding.id}`,
    findingId: finding.id,
    title: finding.title,
    startTimeS: finding.startTimeS,
    endTimeS: finding.endTimeS,
    severity: finding.severity,
    role: finding.propagationRole || propagationRoleForFinding(finding, index),
    phase: finding.timelineRelation?.phase || 'unknown',
    summary: finding.timelineRelation?.summary || finding.summary,
    previousEventId: index > 0 ? `propagation_${findings[index - 1].id}` : null,
    nextEventId: index < findings.length - 1 ? `propagation_${findings[index + 1].id}` : null,
    relatedTimelineEventIds: finding.timelineRelation?.nearbyEventIds || [],
  }));

  return {
    version: 'incident-propagation.v3.0',
    status: events.length > 0 ? 'built' : 'no_anomalies',
    events,
    links: events.slice(1).map((event, index) => ({
      id: `propagation_link_${events[index].findingId}_${event.findingId}`,
      sourceFindingId: events[index].findingId,
      targetFindingId: event.findingId,
      relation: 'temporal_sequence',
      confidence: 'low',
      summary: 'Events are ordered by time only; V3 does not infer root cause.',
    })),
    limitations: [
      'Propagation describes temporal ordering of anomaly phenomena only.',
      'V3 does not rank root causes or claim hardware failure.',
    ],
  };
}

function buildIncidentEvidenceLayer({ anomalySummary, timeline, phases, signals, buildEvidenceLinksForEvent }) {
  const enrichedSummary = enrichFindingsWithEvidence({
    anomalySummary,
    timeline,
    phases,
    signals,
    buildEvidenceLinksForEvent,
  });

  return {
    anomalySummary: enrichedSummary,
    incidentPropagation: buildIncidentPropagation(enrichedSummary),
  };
}

module.exports = {
  buildIncidentEvidenceLayer,
};
