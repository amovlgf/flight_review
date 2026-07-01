const test = require('node:test');
const assert = require('node:assert/strict');
const { buildIncidentEvidenceLayer } = require('./incidentEvidenceService');

function makeFinding(overrides = {}) {
  return {
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
    evidenceLinks: [],
    limitations: [],
    ...overrides,
  };
}

function makeSummary(findings) {
  return {
    version: 'incident-anomaly.v2.0',
    status: findings.length > 0 ? 'needs_review' : 'no_critical_detected',
    severity: findings.length > 0 ? 'warning' : 'none',
    earliestAnomalyTimeS: findings[0]?.startTimeS ?? null,
    findings,
    detectorResults: [
      {
        id: 'battery_voltage_drop',
        category: 'battery',
        version: 'v2.4',
        status: findings.length > 0 ? 'triggered' : 'not_triggered',
        severity: findings.length > 0 ? 'warning' : 'info',
        title: 'Battery voltage abnormal drop',
        summary: '',
        evidenceSignals: [],
        missingSignals: [],
        thresholds: [],
        findings,
        limitations: [],
      },
    ],
    limitations: [],
  };
}

function buildEvidenceLinksForEvent(event) {
  return event.evidence.map((signal) => ({
    id: `${event.id}_${signal}`,
    eventId: event.id,
    standardSignal: signal,
    chartGroupId: 'v1_3_optional_signals',
    seriesId: signal,
    chartTopic: signal.replace('.', '_'),
    targetTimeS: event.timeS,
    timeWindow: {
      startS: Math.max(0, event.timeS - 3),
      endS: event.timeS + 5,
    },
    source: {
      topic: signal.replace('.', '_'),
      instance: 0,
      field: signal.split('.').at(-1),
    },
  }));
}

test('V3 evidence layer adds supporting evidence with evidence links and missing evidence', () => {
  const finding = makeFinding();
  const layer = buildIncidentEvidenceLayer({
    anomalySummary: makeSummary([finding]),
    timeline: [
      {
        id: 'FAILSAFE_STARTED_12',
        code: 'FAILSAFE_STARTED',
        title: 'Failsafe triggered',
        timeS: 12,
        evidence: ['vehicle.failsafe'],
        evidenceLinks: [],
        confidence: 'high',
      },
    ],
    phases: [{ phase: 'normal_flight', startS: 0, endS: 30 }],
    signals: {},
    buildEvidenceLinksForEvent,
  });

  const enriched = layer.anomalySummary.findings[0];
  assert.equal(enriched.supportingEvidence[0].type, 'supporting_signal');
  assert.equal(enriched.supportingEvidence[0].evidenceLinks[0].standardSignal, 'battery.voltage');
  assert.equal(enriched.missingEvidence[0].signal, 'battery.current');
  assert.equal(enriched.timelineRelation.phase, 'normal_flight');
  assert.ok(enriched.timelineRelation.nearbyEventIds.includes('FAILSAFE_STARTED_12'));
});

test('V3 propagation stays empty for normal logs without findings', () => {
  const layer = buildIncidentEvidenceLayer({
    anomalySummary: makeSummary([]),
    timeline: [],
    phases: [],
    signals: {},
    buildEvidenceLinksForEvent,
  });

  assert.equal(layer.incidentPropagation.status, 'no_anomalies');
  assert.deepEqual(layer.incidentPropagation.events, []);
});

test('V3 propagation does not mark late airborne log end as primary event', () => {
  const first = makeFinding({
    id: 'battery_voltage_drop_10',
    detectorId: 'battery_voltage_drop',
    category: 'battery',
    startTimeS: 10,
    endTimeS: 20,
  });
  const late = makeFinding({
    id: 'airborne_log_end_30',
    detectorId: 'airborne_log_end',
    category: 'safety',
    title: 'Log ended while airborne suspected',
    startTimeS: 30,
    endTimeS: 30,
    evidenceSignals: ['vehicle.landed'],
    missingSignals: [],
  });
  const layer = buildIncidentEvidenceLayer({
    anomalySummary: makeSummary([late, first]),
    timeline: [],
    phases: [],
    signals: {},
    buildEvidenceLinksForEvent,
  });

  assert.equal(layer.incidentPropagation.events[0].findingId, first.id);
  assert.equal(layer.incidentPropagation.events[0].role, 'primary_suspect_event');
  assert.equal(layer.incidentPropagation.events[1].findingId, late.id);
  assert.equal(layer.incidentPropagation.events[1].role, 'consequence_event');
  assert.equal(layer.incidentPropagation.links[0].relation, 'temporal_sequence');
});
