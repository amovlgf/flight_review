const { randomUUID } = require('crypto');
const { parsePx4RawSignals } = require('./logParserService');
const { mapStandardSignals } = require('./px4TopicAdapterService');
const { evaluateDataQuality } = require('./dataQualityService');

const CONTRACT_VERSION = 'incident-analysis.v1.3';
const EVENT_EVIDENCE_WINDOW_BEFORE_S = 3;
const EVENT_EVIDENCE_WINDOW_AFTER_S = 5;
const STABILITY_WINDOW_S = 0.5;
const EVENT_SUPPRESSION_WINDOW_S = 1.0;
const EVENT_GROUP_WINDOW_S = 5;

const NAV_STATE_NAMES = {
  0: 'MANUAL',
  1: 'ALTCTL',
  2: 'POSCTL',
  3: 'AUTO_MISSION',
  4: 'AUTO_LOITER',
  5: 'AUTO_RTL',
  6: 'ACRO',
  7: 'OFFBOARD',
  8: 'STABILIZED',
  9: 'AUTO_TAKEOFF',
  10: 'AUTO_LAND',
  11: 'AUTO_FOLLOW_TARGET',
  12: 'AUTO_PRECLAND',
  13: 'ORBIT',
  14: 'AUTO_VTOL_TAKEOFF',
};

const ARMING_STATE_NAMES = {
  0: 'INIT',
  1: 'STANDBY',
  2: 'ARMED',
  3: 'STANDBY_ERROR',
  4: 'SHUTDOWN',
  5: 'IN_AIR_RESTORE',
};

const TAKEOFF_STATE_NAMES = {
  0: 'DISARMED',
  1: 'SPOOLUP',
  2: 'READY_FOR_TAKEOFF',
  3: 'RAMPUP',
  4: 'FLIGHT',
};

const POSITION_SETPOINT_TYPE_NAMES = {
  0: 'POSITION',
  1: 'VELOCITY',
  2: 'LOITER',
  3: 'TAKEOFF',
  4: 'LAND',
  5: 'IDLE',
  6: 'FOLLOW_TARGET',
};

const DISARMING_REASON_NAMES = {
  0: 'TRANSITION_TO_STANDBY',
  1: 'STICK_GESTURE',
  2: 'RC_SWITCH',
  3: 'COMMAND_INTERNAL',
  4: 'COMMAND_EXTERNAL',
  5: 'MISSION_START',
  6: 'SAFETY_BUTTON',
  7: 'AUTO_DISARM_LAND',
  8: 'AUTO_DISARM_PREFLIGHT',
  9: 'KILL_SWITCH',
  10: 'LOCKDOWN',
  11: 'FAILURE_DETECTOR',
  12: 'SHUTDOWN',
  13: 'UNIT_TEST',
};

const FLYING_NAV_STATES = new Set([
  'ALTCTL',
  'POSCTL',
  'AUTO_MISSION',
  'AUTO_LOITER',
  'AUTO_RTL',
  'OFFBOARD',
  'AUTO_FOLLOW_TARGET',
  'ORBIT',
]);

const AIRBORNE_END_ALTITUDE_M = 1;

const ESTIMATOR_FLAG_LABELS = [
  'tilt aligned',
  'yaw aligned',
  'GPS fused',
  'optical flow fused',
  'mag heading fused',
  'mag 3D fused',
  'mag declination fused',
  'in air',
  'wind estimated',
  'baro height fused',
  'range height fused',
  'GPS height fused',
  'external vision position fused',
  'external vision yaw fused',
  'external vision height fused',
  'beta fused',
  'mag field disturbed',
  'fixed wing',
  'mag fault',
  'airspeed fused',
  'ground effect',
  'range finder stuck',
  'GPS yaw fused',
  'mag aligned in flight',
  'external vision velocity fused',
  'synthetic mag Z fused',
  'vehicle at rest',
  'GPS yaw fault',
  'range finder fault',
  'inertial dead reckoning',
  'wind dead reckoning',
  'baro fault',
];

const LOCALIZATION_SOURCE_SPECS = [
  ['gnss_pos', 'GNSS 位置', 'estimator.csGnssPos'],
  ['optical_flow', '光流', 'estimator.csOptFlow'],
  ['vision_pos', '视觉位置', 'estimator.csEvPos'],
  ['baro_height', '气压计高度', 'estimator.csBaroHgt'],
  ['range_height', '测距高度', 'estimator.csRngHgt'],
  ['gnss_height', 'GNSS 高度', 'estimator.csGpsHgt'],
  ['vision_height', '视觉高度', 'estimator.csEvHgt'],
  ['vision_velocity', '视觉速度', 'estimator.csEvVel'],
];

const FAILSAFE_FLAG_SPECS = [
  ['local_position', '本地位置', 'failsafeFlag.localPosition'],
  ['global_position', '全局位置', 'failsafeFlag.globalPosition'],
  ['manual_control_signal_lost', '遥控信号丢失', 'failsafeFlag.manualControlSignalLost'],
  ['gcs_connection_lost', '地面站连接丢失', 'failsafeFlag.gcsConnectionLost'],
  ['offboard_control_signal_lost', 'Offboard 控制信号丢失', 'failsafeFlag.offboardControlSignalLost'],
  ['battery_warning', '电池告警', 'failsafeFlag.batteryWarning'],
  ['geofence_breached', '地理围栏触发', 'failsafeFlag.geofenceBreached'],
  ['wind_limit_exceeded', '风限制超限', 'failsafeFlag.windLimitExceeded'],
  ['failure_detector', 'Failure Detector', 'failsafeFlag.failureDetector'],
];

const POSITION_COMPARISON_AXES = [
  ['x', 'X 位置'],
  ['y', 'Y 位置'],
  ['z', 'Z 位置'],
];

function buildWarning(code, level, message) {
  return { code, level, message };
}

function roundTime(value) {
  return Number(Number(value).toFixed(3));
}

function formatNavState(value) {
  const code = Math.round(Number(value));
  return NAV_STATE_NAMES[code] || `UNKNOWN_${code}`;
}

function formatArmingState(value) {
  const code = Math.round(Number(value));
  return ARMING_STATE_NAMES[code] || `UNKNOWN_${code}`;
}

function formatTakeoffState(value) {
  const code = Math.round(Number(value));
  return TAKEOFF_STATE_NAMES[code] || `UNKNOWN_${code}`;
}

function formatPositionSetpointType(value) {
  const code = Math.round(Number(value));
  return POSITION_SETPOINT_TYPE_NAMES[code] || `UNKNOWN_${code}`;
}

function formatDisarmingReason(value) {
  const code = Math.round(Number(value));
  return DISARMING_REASON_NAMES[code] || `UNKNOWN_${code}`;
}

function formatBitmask(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return `0x${Math.trunc(numeric).toString(16).toUpperCase()}`;
}

function estimatorFlagSeriesId(bitIndex) {
  const label = ESTIMATOR_FLAG_LABELS[bitIndex] || `bit ${bitIndex}`;
  return `estimator.flags.${label}`;
}

function bitmaskToBigInt(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0n;
  return BigInt(Math.max(0, Math.trunc(numeric)));
}

function getChangedEstimatorFlagIndexes(changes) {
  const changedIndexes = new Set();

  changes.forEach((change) => {
    const previous = bitmaskToBigInt(change.previous);
    const current = bitmaskToBigInt(change.current);
    const changed = previous ^ current;

    for (let bitIndex = 0; bitIndex < ESTIMATOR_FLAG_LABELS.length; bitIndex += 1) {
      if ((changed & (1n << BigInt(bitIndex))) !== 0n) {
        changedIndexes.add(bitIndex);
      }
    }
  });

  return Array.from(changedIndexes).sort((a, b) => a - b);
}

function formatEstimatorFlagNames(bitIndexes) {
  if (!Array.isArray(bitIndexes) || bitIndexes.length === 0) return 'unknown flags';
  return bitIndexes.map((bitIndex) => ESTIMATOR_FLAG_LABELS[bitIndex] || `bit ${bitIndex}`).join(', ');
}

function pointsFor(signals, id) {
  return Array.isArray(signals?.[id]?.points) ? signals[id].points : [];
}

function sourceTopicKey(signal) {
  if (!signal || typeof signal.topic !== 'string') return '';
  const instance = Number.isInteger(signal.instance) ? signal.instance : 0;
  return instance > 0 ? `${signal.topic}_${instance}` : signal.topic;
}

function chartGroupIdForSignalId(signalId) {
  if (
    typeof signalId === 'string' &&
    (signalId.startsWith('position.setpoint.') ||
      signalId.startsWith('position.actual.') ||
      signalId.startsWith('position.vision.'))
  ) {
    return 'flight_process_position_comparison';
  }

  if (
    [
      'vehicle.armed',
      'vehicle.armingState',
      'vehicle.landed',
      'vehicle.maybeLanded',
      'vehicle.groundContact',
      'vehicle.atRest',
      'vehicle.inGroundEffect',
      'vehicle.navState',
      'vehicle.navStateUserIntention',
      'vehicle.failsafe',
      'takeoff.state',
      'positionSetpoint.currentType',
    ].includes(signalId)
  ) {
    return 'v1_3_state_signals';
  }
  return 'v1_3_optional_signals';
}

function valueAtOrBefore(points, timeS) {
  if (!Array.isArray(points) || points.length === 0) return null;
  let selected = points[0][1];
  for (const point of points) {
    if (point[0] > timeS) break;
    selected = point[1];
  }
  return selected;
}

function signalSource(signals, signalId) {
  const signal = signals?.[signalId];
  if (!signal) {
    return {
      topic: '',
      field: '',
      instance: 0,
    };
  }
  return {
    topic: typeof signal.topic === 'string' ? signal.topic : '',
    field: typeof signal.field === 'string' ? signal.field : '',
    instance: Number.isInteger(signal.instance) ? signal.instance : 0,
  };
}

function evidenceItem(signals, signalId, message, value = undefined) {
  const source = signalSource(signals, signalId);
  return {
    signal: signalId,
    message,
    value,
    source_topic: source.topic,
    source_field: source.field,
  };
}

function createEvent({
  code,
  type,
  timeS,
  severity = 'info',
  title,
  detail,
  description,
  phase = 'unknown',
  rawEvent = null,
  confidence = 'medium',
  evidence = [],
  evidenceDetails = [],
  sourceTopic = '',
  sourceField = '',
}) {
  return {
    id: `${code}_${roundTime(timeS)}`,
    code,
    type,
    timeS: roundTime(timeS),
    severity,
    title,
    detail,
    description: description || detail,
    phase,
    rawEvent,
    confidence,
    evidence,
    evidenceDetails,
    source_topic: sourceTopic,
    source_field: sourceField,
    chart_hint: null,
    evidenceLinks: [],
  };
}

function buildEvidenceLinksForEvent(event, signals) {
  if (!event || !Array.isArray(event.evidence)) return [];

  const startS = Math.max(0, roundTime(event.timeS - EVENT_EVIDENCE_WINDOW_BEFORE_S));
  const endS = roundTime(event.timeS + EVENT_EVIDENCE_WINDOW_AFTER_S);

  return event.evidence
    .map((standardSignal) => {
      const signal = signals?.[standardSignal];
      if (!signal || !Array.isArray(signal.points) || signal.points.length === 0) {
        return null;
      }

      const source = {
        topic: typeof signal.topic === 'string' ? signal.topic : '',
        instance: Number.isInteger(signal.instance) ? signal.instance : 0,
        field: typeof signal.field === 'string' ? signal.field : '',
      };

      return {
        id: `${event.id}__${standardSignal}`,
        eventId: event.id,
        standardSignal,
        chartGroupId: chartGroupIdForSignalId(standardSignal),
        seriesId: event.evidenceSeriesId || standardSignal,
        chartTopic: sourceTopicKey(signal),
        targetTimeS: event.timeS,
        timeWindow: {
          startS,
          endS,
        },
        source,
      };
    })
    .filter(Boolean);
}

function attachEvidenceLinks(timeline, signals) {
  return timeline.map((event) => ({
    ...event,
    evidenceLinks: buildEvidenceLinksForEvent(event, signals),
  })).map((event) => ({
    ...event,
    chart_hint: event.evidenceLinks?.[0]
      ? {
          chartGroupId: event.evidenceLinks[0].chartGroupId,
          seriesId: event.evidenceLinks[0].seriesId,
          chartTopic: event.evidenceLinks[0].chartTopic,
          targetTimeS: event.evidenceLinks[0].targetTimeS,
          timeWindow: event.evidenceLinks[0].timeWindow,
        }
      : null,
  }));
}

function uniqueBy(items, keyForItem) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyForItem(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function maxSeverity(events) {
  if (events.some((event) => event.severity === 'error' || event.severity === 'critical')) return 'critical';
  if (events.some((event) => event.severity === 'warning')) return 'warning';
  if (events.some((event) => event.severity === 'notice')) return 'notice';
  return 'info';
}

function groupPhaseForEvent(event) {
  if (!event) return 'unknown';
  if (event.type === 'failsafe' || event.code === 'LOG_ENDED_WHILE_AIRBORNE_SUSPECTED') return 'failsafe';
  if (event.code === 'ARMED') return 'arming';
  if (event.code === 'DISARMED') return 'disarming';
  if (event.type === 'command') return 'command';
  if (event.type === 'mode_change') return 'flight_mode';
  if (event.code === 'TAKEOFF_STATE_CHANGED') {
    if (
      event.phase === 'landing_process' ||
      event.phase === 'ground_contact_process' ||
      event.phase === 'landed_complete' ||
      event.phase === 'auto_disarmed_after_landing'
    ) {
      return 'landing';
    }
    if (event.phase === 'takeoff_process' || event.rawEvent?.previousLabel === 'FLIGHT') {
      return 'takeoff';
    }
  }
  if (
    event.code === 'LANDING_STARTED' ||
    event.code === 'GROUND_CONTACT_STARTED' ||
    event.code === 'MAYBE_LANDED_STARTED' ||
    event.code === 'AT_REST_STARTED' ||
    event.code === 'LANDED_DETECTED' ||
    event.phase === 'landing_process' ||
    event.phase === 'ground_contact_process' ||
    event.phase === 'landed_complete' ||
    event.phase === 'auto_disarmed_after_landing'
  ) {
    return 'landing';
  }
  if (
    event.code === 'TAKEOFF_COMPLETED' ||
    event.code === 'TAKEOFF_DETECTED' ||
    event.phase === 'takeoff_process' ||
    event.phase === 'liftoff_confirmed' ||
    event.phase === 'takeoff_complete'
  ) {
    return 'takeoff';
  }
  if (event.type === 'estimator') return 'estimator';
  return event.phase || 'unknown';
}

function groupTitleForPhase(phase) {
  return {
    arming: '解锁',
    takeoff: '起飞阶段',
    flight: '飞行阶段',
    flight_mode: '飞行模式变化',
    landing: '着陆与上锁阶段',
    disarming: '上锁',
    command: '命令请求',
    failsafe: 'Failsafe / 告警',
    flight_process: '飞行过程',
    estimator: '估计器状态',
    mission: '任务 / Offboard',
    unknown: '未分类事件',
  }[phase] || phase;
}

function chartPresetForPhase(phase) {
  return {
    arming: 'modeTimeline',
    takeoff: 'takeoffEvidence',
    flight_mode: 'modeTimeline',
    landing: 'landingEvidence',
    disarming: 'landingEvidence',
    command: 'commandAck',
    failsafe: 'failsafeWindow',
    flight_process: 'flightProcess',
    estimator: 'estimatorFlags',
  }[phase] || null;
}

function roleForEventInGroup(event, groupPhase) {
  const eventPhase = groupPhaseForEvent(event);
  if (eventPhase === groupPhase) return 'primary';
  if (event.type === 'estimator' || event.type === 'command') return 'evidence';
  return 'raw';
}

function makeGroupSummary(events) {
  const titles = uniqueBy(events, (event) => event.code)
    .slice(0, 4)
    .map((event) => event.title);
  if (events.length <= 4) return titles.join(', ');
  return `${titles.join(', ')} and ${events.length - 4} more events`;
}

function createEventGroup(phase, events) {
  const sortedEvents = [...events].sort((a, b) => a.timeS - b.timeS || a.code.localeCompare(b.code));
  const primaryEvents = sortedEvents.filter((event) => roleForEventInGroup(event, phase) === 'primary');
  const evidenceEvents = sortedEvents.filter((event) => roleForEventInGroup(event, phase) === 'evidence');
  const evidenceSignals = uniqueBy(
    sortedEvents.flatMap((event) => event.evidence || []),
    (signal) => signal,
  );
  const evidenceLinks = uniqueBy(
    sortedEvents.flatMap((event) => event.evidenceLinks || []),
    (link) => `${link.chartGroupId}:${link.seriesId}:${link.standardSignal}`,
  );

  return {
    id: `${phase}_${roundTime(sortedEvents[0].timeS)}_${roundTime(sortedEvents[sortedEvents.length - 1].timeS)}`,
    phase,
    severity: maxSeverity(sortedEvents),
    startTimeS: roundTime(sortedEvents[0].timeS),
    endTimeS: roundTime(sortedEvents[sortedEvents.length - 1].timeS),
    title: groupTitleForPhase(phase),
    summary: makeGroupSummary(sortedEvents),
    primaryEvents,
    evidenceEvents,
    rawEvents: sortedEvents,
    evidenceSignals,
    evidenceLinks,
    chartPreset: chartPresetForPhase(phase),
  };
}

function eventBelongsToGroup(event, group) {
  const eventPhase = groupPhaseForEvent(event);
  if (eventPhase === group.phase) return true;
  if (group.phase === 'takeoff' && ['estimator', 'flight_mode'].includes(eventPhase)) return true;
  if (group.phase === 'landing' && ['estimator', 'command', 'disarming', 'flight_mode'].includes(eventPhase)) return true;
  return false;
}

function buildEventGroups(timeline) {
  if (!Array.isArray(timeline) || timeline.length === 0) return [];

  const groups = [];
  const sortedEvents = [...timeline].sort((a, b) => a.timeS - b.timeS || a.code.localeCompare(b.code));

  sortedEvents.forEach((event) => {
    const phase = groupPhaseForEvent(event);
    const attachableGroup = [...groups]
      .reverse()
      .find(
        (group) =>
          eventBelongsToGroup(event, group) &&
          event.timeS - group.events[group.events.length - 1].timeS <= EVENT_GROUP_WINDOW_S,
      );

    if (attachableGroup) {
      attachableGroup.events.push(event);
      return;
    }

    groups.push({
      phase,
      events: [event],
    });
  });

  return groups.map((group) => createEventGroup(group.phase, group.events));
}

function createPhase({ phase, startS, endS, source, confidence = 'medium', evidenceCount = 1 }) {
  return {
    phase,
    startS: roundTime(startS),
    endS: roundTime(endS),
    source,
    confidence,
    evidenceCount,
  };
}

function buildStateChangeEvents(points, predicate, enterEvent, exitEvent) {
  if (!Array.isArray(points) || points.length === 0) return [];

  const events = [];
  let previous = predicate(points[0][1]);

  for (let index = 1; index < points.length; index += 1) {
    const current = predicate(points[index][1]);
    if (current === previous) continue;
    events.push((current ? enterEvent : exitEvent)?.(points[index][0]));
    previous = current;
  }

  return events.filter(Boolean);
}

function stableStateChangeEvents(points, predicate, minStableS, enterEvent, exitEvent, endS = null) {
  if (!Array.isArray(points) || points.length === 0) return [];

  const events = [];
  let previous = predicate(points[0][1]);

  for (let index = 1; index < points.length; index += 1) {
    const current = predicate(points[index][1]);
    if (current === previous) continue;

    const changeTimeS = points[index][0];
    let stableUntilS = points[index][0];
    let isStable = true;
    for (let checkIndex = index; checkIndex < points.length; checkIndex += 1) {
      const checkTimeS = points[checkIndex][0];
      if (checkTimeS - changeTimeS >= minStableS) {
        stableUntilS = checkTimeS;
        break;
      }
      if (predicate(points[checkIndex][1]) !== current) {
        isStable = false;
        break;
      }
      stableUntilS = checkTimeS;
    }
    if (isStable && stableUntilS - changeTimeS < minStableS && typeof endS === 'number' && endS - changeTimeS >= minStableS) {
      stableUntilS = endS;
    }

    const observedDurationS = stableUntilS - changeTimeS;
    if (isStable && observedDurationS >= minStableS) {
      events.push((current ? enterEvent : exitEvent)?.(changeTimeS, observedDurationS));
      previous = current;
    }
  }

  return events.filter(Boolean);
}

function suppressRepeatedEvents(events) {
  const lastByCode = new Map();
  return events.filter((event) => {
    const key = `${event.code}:${event.source_topic}:${event.source_field}`;
    const previousTime = lastByCode.get(key);
    if (typeof previousTime === 'number' && event.timeS - previousTime < EVENT_SUPPRESSION_WINDOW_S) {
      return false;
    }
    lastByCode.set(key, event.timeS);
    return true;
  });
}

function buildNavStateEvents(points, signals) {
  if (!Array.isArray(points) || points.length === 0) return [];

  const events = [];
  let previous = Math.round(Number(points[0][1]));

  for (let index = 1; index < points.length; index += 1) {
    const current = Math.round(Number(points[index][1]));
    if (current === previous) continue;
    const previousName = formatNavState(previous);
    const currentName = formatNavState(current);
    const evidenceDetails = [
      evidenceItem(signals, 'vehicle.navState', `nav_state changed ${previousName} -> ${currentName}`, current),
    ];
    events.push(
      createEvent({
        code: 'MODE_CHANGED',
        type: 'mode_change',
        timeS: points[index][0],
        title: 'Flight mode changed',
        detail: `${previousName} -> ${currentName}`,
        description: `vehicle_status.nav_state actually changed from ${previousName} to ${currentName}.`,
        phase: inferPhaseAt(signals, points[index][0]),
        rawEvent: {
          kind: 'field_change',
          signal: 'vehicle.navState',
          previous,
          current,
          previousLabel: previousName,
          currentLabel: currentName,
        },
        confidence: 'high',
        evidence: ['vehicle.navState'],
        evidenceDetails,
        sourceTopic: signalSource(signals, 'vehicle.navState').topic,
        sourceField: signalSource(signals, 'vehicle.navState').field,
      }),
    );
    previous = current;
  }

  return events;
}

function buildEstimatorEvents(points, signals) {
  if (!Array.isArray(points) || points.length === 0) return [];

  const changes = [];
  let previous = Math.round(Number(points[0][1]));

  for (let index = 1; index < points.length; index += 1) {
    const current = Math.round(Number(points[index][1]));
    if (current === previous) continue;
    changes.push({
      timeS: points[index][0],
      previous,
      current,
    });
    previous = current;
  }

  if (changes.length === 0) return [];

  const firstChange = changes[0];
  const lastChange = changes[changes.length - 1];
  const changedFlagIndexes = getChangedEstimatorFlagIndexes(changes);
  const changedFlagNames = formatEstimatorFlagNames(changedFlagIndexes);
  const changeSummary =
    changes.length === 1
      ? `${formatBitmask(firstChange.previous)} -> ${formatBitmask(firstChange.current)}; changed: ${changedFlagNames}`
      : `${changes.length} changes from ${roundTime(firstChange.timeS)}s to ${roundTime(lastChange.timeS)}s; latest ${formatBitmask(
          lastChange.previous,
        )} -> ${formatBitmask(lastChange.current)}; changed: ${changedFlagNames}`;

  const summaryEvent = createEvent({
    code: 'ESTIMATOR_FLAGS_SUMMARY',
    type: 'estimator',
    timeS: firstChange.timeS,
    severity: 'info',
    title: 'Estimator status flags changed',
    detail: changeSummary,
    description: `Estimator status flags changed fields: ${changedFlagNames}.`,
    phase: inferPhaseAt(signals, firstChange.timeS),
    rawEvent: {
      kind: 'field_change_summary',
      signal: 'estimator.flags',
      changeCount: changes.length,
      changedFields: changedFlagNames.split(', '),
      firstPrevious: firstChange.previous,
      latestCurrent: lastChange.current,
    },
    confidence: 'medium',
    evidence: ['estimator.flags'],
    evidenceDetails: [
      evidenceItem(signals, 'estimator.flags', `changed fields: ${changedFlagNames}`, lastChange.current),
    ],
    sourceTopic: signalSource(signals, 'estimator.flags').topic,
    sourceField: signalSource(signals, 'estimator.flags').field,
  });
  summaryEvent.evidenceSeriesId = estimatorFlagSeriesId(changedFlagIndexes[0] ?? 0);

  return [summaryEvent];
}

function inferPhaseAt(signals, timeS) {
  const armed = Number(valueAtOrBefore(pointsFor(signals, 'vehicle.armed'), timeS)) > 0.5;
  const landedValue = valueAtOrBefore(pointsFor(signals, 'vehicle.landed'), timeS);
  const landed = landedValue === null ? null : Number(landedValue) > 0.5;
  const maybeLanded = Number(valueAtOrBefore(pointsFor(signals, 'vehicle.maybeLanded'), timeS)) > 0.5;
  const groundContact = Number(valueAtOrBefore(pointsFor(signals, 'vehicle.groundContact'), timeS)) > 0.5;
  const navState = formatNavState(valueAtOrBefore(pointsFor(signals, 'vehicle.navState'), timeS));
  const takeoffState = formatTakeoffState(valueAtOrBefore(pointsFor(signals, 'takeoff.state'), timeS));
  const setpointType = formatPositionSetpointType(valueAtOrBefore(pointsFor(signals, 'positionSetpoint.currentType'), timeS));

  if (!armed && landed === true) return 'ground_standby';
  if (armed && landed === true) return 'armed_waiting_takeoff';
  if (takeoffState === 'SPOOLUP' || takeoffState === 'RAMPUP' || navState === 'AUTO_TAKEOFF') return 'takeoff_process';
  if (landed === false && (takeoffState === 'FLIGHT' || FLYING_NAV_STATES.has(navState))) return 'normal_flight';
  if (navState === 'AUTO_LAND' || navState === 'AUTO_PRECLAND' || navState === 'DESCEND' || setpointType === 'LAND') {
    return 'landing_process';
  }
  if (groundContact || maybeLanded) return 'ground_contact_process';
  if (!armed && landed === false) return 'disarmed_airborne_suspected';
  if (landed === false) return 'airborne';
  return 'unknown';
}

function confidenceFromEvidence(evidenceIds) {
  const uniqueTopics = new Set(evidenceIds.map((id) => id.split('.')[0]));
  return evidenceIds.length >= 3 || uniqueTopics.size >= 3 ? 'high' : evidenceIds.length >= 2 ? 'medium' : 'low';
}

function buildLandingEvents(landedPoints, signals) {
  const timePoints = pointsFor(signals, 'log.timeS');
  const endS = timePoints.length > 0 ? timePoints[timePoints.length - 1][0] : null;
  return stableStateChangeEvents(
    landedPoints,
    (value) => Number(value) > 0.5,
    STABILITY_WINDOW_S,
    (timeS, stableDurationS) => {
      const evidence = ['vehicle.landed'];
      if (Number(valueAtOrBefore(pointsFor(signals, 'vehicle.groundContact'), timeS)) > 0.5) {
        evidence.push('vehicle.groundContact');
      }
      if (Number(valueAtOrBefore(pointsFor(signals, 'vehicle.maybeLanded'), timeS)) > 0.5) {
        evidence.push('vehicle.maybeLanded');
      }
      const reason = formatDisarmingReason(valueAtOrBefore(pointsFor(signals, 'vehicle.latestDisarmingReason'), timeS + 2));
      const source = signalSource(signals, 'vehicle.landed');
      return createEvent({
        code: 'LANDED_DETECTED',
        type: 'landing',
        timeS,
        title: 'Landing confirmed',
        detail: `vehicle.landed changed false -> true and stayed stable for ${roundTime(stableDurationS)}s.`,
        description: `Landed state is stable. Disarming reason near this time: ${reason}.`,
        phase: 'landed_complete',
        rawEvent: {
          kind: 'field_change',
          signal: 'vehicle.landed',
          previous: false,
          current: true,
          stableDurationS: roundTime(stableDurationS),
        },
        confidence: confidenceFromEvidence(evidence),
        evidence,
        evidenceDetails: evidence.map((id) => evidenceItem(signals, id, `${id} supports landing confirmation`)),
        sourceTopic: source.topic,
        sourceField: source.field,
      });
    },
    (timeS, stableDurationS) => {
      const evidence = ['vehicle.landed'];
      if (formatTakeoffState(valueAtOrBefore(pointsFor(signals, 'takeoff.state'), timeS)) === 'FLIGHT') {
        evidence.push('takeoff.state');
      }
      if (formatNavState(valueAtOrBefore(pointsFor(signals, 'vehicle.navState'), timeS)) === 'AUTO_TAKEOFF') {
        evidence.push('vehicle.navState');
      }
      const source = signalSource(signals, 'vehicle.landed');
      return createEvent({
        code: 'TAKEOFF_DETECTED',
        type: 'takeoff',
        timeS,
        title: 'Liftoff confirmed',
        detail: `vehicle.landed changed true -> false and stayed stable for ${roundTime(stableDurationS)}s.`,
        description: 'Liftoff is inferred from a stable landed=false state, not a single-sample jump.',
        phase: 'liftoff_confirmed',
        rawEvent: {
          kind: 'field_change',
          signal: 'vehicle.landed',
          previous: true,
          current: false,
          stableDurationS: roundTime(stableDurationS),
        },
        confidence: confidenceFromEvidence(evidence),
        evidence,
        evidenceDetails: evidence.map((id) => evidenceItem(signals, id, `${id} supports liftoff confirmation`)),
        sourceTopic: source.topic,
        sourceField: source.field,
      });
    },
    endS,
  );
}

function buildGroundContactEvents(signals) {
  const events = [];
  const contactSpecs = [
    ['vehicle.groundContact', 'GROUND_CONTACT_STARTED', 'Ground contact started', 'ground_contact_process'],
    ['vehicle.maybeLanded', 'MAYBE_LANDED_STARTED', 'Maybe landed started', 'ground_contact_process'],
    ['vehicle.atRest', 'AT_REST_STARTED', 'Vehicle at rest', 'landed_complete'],
  ];

  contactSpecs.forEach(([signalId, code, title, phase]) => {
    const source = signalSource(signals, signalId);
    const signalEvents = stableStateChangeEvents(
      pointsFor(signals, signalId),
      (value) => Number(value) > 0.5,
      STABILITY_WINDOW_S,
      (timeS, stableDurationS) =>
        createEvent({
          code,
          type: 'landing',
          timeS,
          title,
          detail: `${signalId} changed to true and stayed stable for ${roundTime(stableDurationS)}s.`,
          phase,
          rawEvent: {
            kind: 'field_change',
            signal: signalId,
            previous: false,
            current: true,
            stableDurationS: roundTime(stableDurationS),
          },
          confidence: 'medium',
          evidence: [signalId],
          evidenceDetails: [evidenceItem(signals, signalId, `${signalId} became true`)],
          sourceTopic: source.topic,
          sourceField: source.field,
        }),
      null,
      (pointsFor(signals, 'log.timeS').at(-1) || [null])[0],
    );
    events.push(...signalEvents);
  });

  return events;
}

function buildArmEvents(armedPoints, signals) {
  return buildStateChangeEvents(
    armedPoints,
    (value) => Number(value) > 0.5,
    (timeS) => {
      const source = signalSource(signals, 'vehicle.armed');
      const armingState = formatArmingState(valueAtOrBefore(pointsFor(signals, 'vehicle.armingState'), timeS));
      return createEvent({
        code: 'ARMED',
        type: 'arm',
        timeS,
        title: 'Vehicle armed',
        detail: `vehicle.armed changed to true (${armingState}).`,
        phase: inferPhaseAt(signals, timeS),
        rawEvent: {
          kind: 'field_change',
          signal: 'vehicle.armed',
          previous: false,
          current: true,
          currentLabel: armingState,
        },
        confidence: 'medium',
        evidence: ['vehicle.armed'],
        evidenceDetails: [evidenceItem(signals, 'vehicle.armed', `arming_state is ${armingState}`)],
        sourceTopic: source.topic,
        sourceField: source.field,
      });
    },
    (timeS) => {
      const source = signalSource(signals, 'vehicle.armed');
      const reason = formatDisarmingReason(valueAtOrBefore(pointsFor(signals, 'vehicle.latestDisarmingReason'), timeS));
      const isAutoLandingDisarm = reason === 'AUTO_DISARM_LAND';
      return createEvent({
        code: 'DISARMED',
        type: 'disarm',
        timeS,
        title: isAutoLandingDisarm ? 'Auto disarmed after landing' : 'Vehicle disarmed',
        detail: `vehicle.armed changed to false. latest_disarming_reason=${reason}.`,
        phase: isAutoLandingDisarm ? 'auto_disarmed_after_landing' : inferPhaseAt(signals, timeS),
        rawEvent: {
          kind: 'field_change',
          signal: 'vehicle.armed',
          previous: true,
          current: false,
          disarmingReason: reason,
        },
        confidence: isAutoLandingDisarm ? 'high' : 'medium',
        evidence: ['vehicle.armed', 'vehicle.latestDisarmingReason'].filter((id) => pointsFor(signals, id).length > 0),
        evidenceDetails: [
          evidenceItem(signals, 'vehicle.armed', 'armed state became false'),
          evidenceItem(signals, 'vehicle.latestDisarmingReason', `latest_disarming_reason=${reason}`),
        ],
        sourceTopic: source.topic,
        sourceField: source.field,
      });
    },
  );
}

function buildFailsafeEvents(failsafePoints, signals) {
  return buildStateChangeEvents(
    failsafePoints,
    (value) => Number(value) > 0.5,
    (timeS) => {
      const source = signalSource(signals, 'vehicle.failsafe');
      const navState = formatNavState(valueAtOrBefore(pointsFor(signals, 'vehicle.navState'), timeS));
      const intention = formatNavState(valueAtOrBefore(pointsFor(signals, 'vehicle.navStateUserIntention'), timeS));
      return createEvent({
        code: 'FAILSAFE_STARTED',
        type: 'failsafe',
        timeS,
        severity: 'warning',
        title: 'Failsafe became active',
        detail: `vehicle.failsafe changed to true. nav_state=${navState}, user_intention=${intention}.`,
        phase: inferPhaseAt(signals, timeS),
        rawEvent: {
          kind: 'field_change',
          signal: 'vehicle.failsafe',
          previous: false,
          current: true,
        },
        confidence: 'high',
        evidence: ['vehicle.failsafe', 'vehicle.navState', 'vehicle.navStateUserIntention'].filter(
          (id) => pointsFor(signals, id).length > 0,
        ),
        evidenceDetails: [
          evidenceItem(signals, 'vehicle.failsafe', 'failsafe became true'),
          evidenceItem(signals, 'vehicle.navState', `actual nav_state=${navState}`),
          evidenceItem(signals, 'vehicle.navStateUserIntention', `user intention=${intention}`),
        ],
        sourceTopic: source.topic,
        sourceField: source.field,
      });
    },
    (timeS) => {
      const source = signalSource(signals, 'vehicle.failsafe');
      return createEvent({
        code: 'FAILSAFE_ENDED',
        type: 'failsafe',
        timeS,
        title: 'Failsafe cleared',
        detail: 'vehicle.failsafe changed to false.',
        phase: inferPhaseAt(signals, timeS),
        rawEvent: {
          kind: 'field_change',
          signal: 'vehicle.failsafe',
          previous: true,
          current: false,
        },
        confidence: 'medium',
        evidence: ['vehicle.failsafe'],
        evidenceDetails: [evidenceItem(signals, 'vehicle.failsafe', 'failsafe became false')],
        sourceTopic: source.topic,
        sourceField: source.field,
      });
    },
  );
}

function buildTakeoffStatusEvents(signals) {
  const points = pointsFor(signals, 'takeoff.state');
  if (!Array.isArray(points) || points.length === 0) return [];

  const events = [];
  let previous = Math.round(Number(points[0][1]));
  for (let index = 1; index < points.length; index += 1) {
    const current = Math.round(Number(points[index][1]));
    if (current === previous) continue;
    const previousName = formatTakeoffState(previous);
    const currentName = formatTakeoffState(current);
    const timeS = points[index][0];
    const landedAtTime = Number(valueAtOrBefore(pointsFor(signals, 'vehicle.landed'), timeS)) > 0.5;
    const phase = currentName === 'FLIGHT'
      ? 'takeoff_complete'
      : landedAtTime
        ? 'landed_complete'
        : ['SPOOLUP', 'RAMPUP'].includes(currentName)
          ? 'takeoff_process'
          : inferPhaseAt(signals, timeS);
    const source = signalSource(signals, 'takeoff.state');
    events.push(
      createEvent({
        code: currentName === 'FLIGHT' ? 'TAKEOFF_COMPLETED' : 'TAKEOFF_STATE_CHANGED',
        type: 'takeoff',
        timeS,
        title: currentName === 'FLIGHT' ? 'Takeoff completed' : 'Takeoff state changed',
        detail: `${previousName} -> ${currentName}`,
        phase,
        rawEvent: {
          kind: 'field_change',
          signal: 'takeoff.state',
          previous,
          current,
          previousLabel: previousName,
          currentLabel: currentName,
        },
        confidence: currentName === 'FLIGHT' && !landedAtTime ? 'high' : 'medium',
        evidence: ['takeoff.state', 'vehicle.landed'].filter((id) => pointsFor(signals, id).length > 0),
        evidenceDetails: [
          evidenceItem(signals, 'takeoff.state', `takeoff_state ${previousName} -> ${currentName}`),
          evidenceItem(
            signals,
            'vehicle.landed',
            landedAtTime ? 'landed=true places this takeoff_state change after landing' : 'landed=false confirms airborne state',
          ),
        ],
        sourceTopic: source.topic,
        sourceField: source.field,
      }),
    );
    previous = current;
  }
  return events;
}

function buildLandingIntentEvents(signals) {
  const events = [];
  const navPoints = pointsFor(signals, 'vehicle.navState');
  const spPoints = pointsFor(signals, 'positionSetpoint.currentType');

  buildNavStateEvents(navPoints, signals)
    .filter((event) => ['AUTO_LAND', 'AUTO_PRECLAND'].includes(event.rawEvent?.currentLabel))
    .forEach((event) => {
      events.push({
        ...event,
        code: 'LANDING_STARTED',
        type: 'landing',
        title: 'Landing process started',
        phase: 'landing_process',
        detail: `nav_state entered ${event.rawEvent.currentLabel}.`,
      });
    });

  let previous = spPoints.length ? Math.round(Number(spPoints[0][1])) : null;
  for (let index = 1; index < spPoints.length; index += 1) {
    const current = Math.round(Number(spPoints[index][1]));
    if (current === previous) continue;
    const currentName = formatPositionSetpointType(current);
    if (currentName === 'LAND') {
      const source = signalSource(signals, 'positionSetpoint.currentType');
      events.push(
        createEvent({
          code: 'LANDING_STARTED',
          type: 'landing',
          timeS: spPoints[index][0],
          title: 'Landing process started',
          detail: `position_setpoint_triplet.current.type changed to LAND.`,
          phase: 'landing_process',
          rawEvent: {
            kind: 'field_change',
            signal: 'positionSetpoint.currentType',
            previous,
            current,
            currentLabel: currentName,
          },
          confidence: 'medium',
          evidence: ['positionSetpoint.currentType'],
          evidenceDetails: [evidenceItem(signals, 'positionSetpoint.currentType', 'current setpoint type is LAND')],
          sourceTopic: source.topic,
          sourceField: source.field,
        }),
      );
    }
    previous = current;
  }

  return events;
}

function buildEstimatorInstanceEvents(signals) {
  const points = pointsFor(signals, 'estimator.primaryInstance');
  if (!Array.isArray(points) || points.length === 0) return [];

  const events = [];
  let previous = Math.round(Number(points[0][1]));
  for (let index = 1; index < points.length; index += 1) {
    const current = Math.round(Number(points[index][1]));
    if (current === previous) continue;
    const timeS = points[index][0];
    const count = valueAtOrBefore(pointsFor(signals, 'estimator.instanceChangedCount'), timeS);
    const source = signalSource(signals, 'estimator.primaryInstance');
    events.push(
      createEvent({
        code: 'EKF_PRIMARY_INSTANCE_CHANGED',
        type: 'estimator',
        timeS,
        title: 'EKF primary instance changed',
        detail: `primary_instance ${previous} -> ${current}${count !== null ? `; instance_changed_count=${count}` : ''}.`,
        phase: inferPhaseAt(signals, timeS),
        rawEvent: {
          kind: 'field_change',
          signal: 'estimator.primaryInstance',
          previous,
          current,
          instanceChangedCount: count,
        },
        confidence: count !== null ? 'high' : 'medium',
        evidence: ['estimator.primaryInstance', 'estimator.instanceChangedCount'].filter(
          (id) => pointsFor(signals, id).length > 0,
        ),
        evidenceDetails: [
          evidenceItem(signals, 'estimator.primaryInstance', `primary_instance ${previous} -> ${current}`),
          evidenceItem(signals, 'estimator.instanceChangedCount', `instance_changed_count=${count}`),
        ],
        sourceTopic: source.topic,
        sourceField: source.field,
      }),
    );
    previous = current;
  }
  return events;
}

function buildEstimatorFlagFieldEvents(signals) {
  const signalIds = [
    'estimator.csInAir',
    'estimator.csGroundEffect',
    'estimator.csGnssPos',
    'estimator.csBaroHgt',
    'estimator.csMagFault',
  ];
  const changedFields = [];
  let firstTimeS = null;

  signalIds.forEach((signalId) => {
    const points = pointsFor(signals, signalId);
    if (!Array.isArray(points) || points.length === 0) return;
    let previous = Number(points[0][1]) > 0.5;
    for (let index = 1; index < points.length; index += 1) {
      const current = Number(points[index][1]) > 0.5;
      if (current === previous) continue;
      firstTimeS = firstTimeS ?? points[index][0];
      changedFields.push(`${signalId.replace('estimator.', '')}=${current}`);
      previous = current;
      break;
    }
  });

  if (changedFields.length === 0 || firstTimeS === null) return [];
  const firstSignal = signalIds.find((id) => pointsFor(signals, id).length > 0) || signalIds[0];
  const source = signalSource(signals, firstSignal);
  return [
    createEvent({
      code: 'ESTIMATOR_FLAGS_SUMMARY',
      type: 'estimator',
      timeS: firstTimeS,
      title: 'Estimator status flags changed',
      detail: `changed fields: ${changedFields.join(', ')}`,
      phase: inferPhaseAt(signals, firstTimeS),
      rawEvent: {
        kind: 'field_change_summary',
        changedFields,
      },
      confidence: 'medium',
      evidence: signalIds.filter((id) => pointsFor(signals, id).length > 0),
      evidenceDetails: signalIds
        .filter((id) => pointsFor(signals, id).length > 0)
        .map((id) => evidenceItem(signals, id, `${id} is decoded from estimator_status_flags`)),
      sourceTopic: source.topic,
      sourceField: source.field,
    }),
  ];
}

function buildCommandEvents(signals) {
  const commandPoints = pointsFor(signals, 'vehicleCommand.command');
  if (!Array.isArray(commandPoints) || commandPoints.length === 0) return [];
  const source = signalSource(signals, 'vehicleCommand.command');
  return buildStateChangeEvents(
    commandPoints,
    (value) => Math.round(Number(value)),
    (timeS) =>
      createEvent({
        code: 'VEHICLE_COMMAND_REQUESTED',
        type: 'command',
        timeS,
        title: 'Vehicle command requested',
        detail: 'vehicle_command.command changed. This is only a request, not actual mode effect.',
        phase: inferPhaseAt(signals, timeS),
        confidence: 'low',
        evidence: ['vehicleCommand.command', 'vehicleCommand.fromExternal'].filter((id) => pointsFor(signals, id).length > 0),
        evidenceDetails: [evidenceItem(signals, 'vehicleCommand.command', 'command request observed')],
        sourceTopic: source.topic,
        sourceField: source.field,
      }),
    null,
  );
}

function buildTimeline(signals, analysisCapability) {
  if (!analysisCapability.timeline) return [];

  const estimatorFieldEvents = buildEstimatorFlagFieldEvents(signals);
  const estimatorBitmaskEvents = estimatorFieldEvents.length > 0 ? [] : buildEstimatorEvents(pointsFor(signals, 'estimator.flags'), signals);
  const events = suppressRepeatedEvents([
    ...buildArmEvents(pointsFor(signals, 'vehicle.armed'), signals),
    ...buildLandingEvents(pointsFor(signals, 'vehicle.landed'), signals),
    ...buildGroundContactEvents(signals),
    ...buildNavStateEvents(pointsFor(signals, 'vehicle.navState'), signals),
    ...buildFailsafeEvents(pointsFor(signals, 'vehicle.failsafe'), signals),
    ...buildTakeoffStatusEvents(signals),
    ...buildLandingIntentEvents(signals),
    ...buildEstimatorInstanceEvents(signals),
    ...estimatorFieldEvents,
    ...estimatorBitmaskEvents,
    ...buildCommandEvents(signals),
  ]);

  const timePoints = pointsFor(signals, 'log.timeS');
  const lastTimeS = timePoints.length > 0 ? timePoints[timePoints.length - 1][0] : null;
  if (typeof lastTimeS === 'number' && Number.isFinite(lastTimeS)) {
    const landed = valueAtOrBefore(pointsFor(signals, 'vehicle.landed'), lastTimeS);
    const armed = valueAtOrBefore(pointsFor(signals, 'vehicle.armed'), lastTimeS);
    const altitude = valueAtOrBefore(pointsFor(signals, 'position.altitudeRelative'), lastTimeS);
    const likelyAirborne =
      Number(landed) <= 0.5 &&
      (Number(armed) > 0.5 ||
        (typeof altitude === 'number' && Number.isFinite(altitude) && altitude > AIRBORNE_END_ALTITUDE_M));

    if (likelyAirborne) {
      events.push(
        createEvent({
          code: 'LOG_ENDED_WHILE_AIRBORNE_SUSPECTED',
          type: 'risk',
          timeS: lastTimeS,
          severity: 'warning',
          title: 'Log ended while likely airborne',
          detail:
            'The final landed state is false, so this is reported as a suspected state rather than an accident cause.',
          phase: inferPhaseAt(signals, lastTimeS),
          confidence: 'medium',
          evidence: ['vehicle.landed', 'vehicle.armed', 'position.altitudeRelative'],
          evidenceDetails: [
            evidenceItem(signals, 'vehicle.landed', 'final landed=false'),
            evidenceItem(signals, 'vehicle.armed', 'final armed state or altitude suggests airborne'),
            evidenceItem(signals, 'position.altitudeRelative', 'relative altitude supports airborne suspicion'),
          ],
        }),
      );
    }
  }

  return attachEvidenceLinks(
    events.sort((a, b) => a.timeS - b.timeS || a.code.localeCompare(b.code)),
    signals,
  );
}

function buildPhases(signals, analysisCapability) {
  if (!analysisCapability.phaseDetection) return [];

  const timePoints = pointsFor(signals, 'log.timeS');
  const landedPoints = pointsFor(signals, 'vehicle.landed');
  if (timePoints.length === 0 || landedPoints.length === 0) return [];

  const startS = timePoints[0][0];
  const endS = timePoints[timePoints.length - 1][0];
  const timelineEvents = [
    ...buildArmEvents(pointsFor(signals, 'vehicle.armed'), signals),
    ...buildLandingEvents(landedPoints, signals),
    ...buildTakeoffStatusEvents(signals),
    ...buildLandingIntentEvents(signals),
    ...buildGroundContactEvents(signals),
  ].sort((a, b) => a.timeS - b.timeS || a.code.localeCompare(b.code));
  const takeoffEvents = timelineEvents.filter((item) => item.code === 'TAKEOFF_DETECTED');
  const landingEvents = timelineEvents.filter((item) => item.code === 'LANDED_DETECTED');
  const armedEvents = timelineEvents.filter((item) => item.code === 'ARMED');
  const disarmedEvents = timelineEvents.filter((item) => item.code === 'DISARMED');
  const takeoffProcessEvents = timelineEvents.filter(
    (item) => item.phase === 'takeoff_process' || item.code === 'TAKEOFF_STATE_CHANGED',
  );
  const takeoffCompletedEvents = timelineEvents.filter((item) => item.code === 'TAKEOFF_COMPLETED');
  const landingProcessEvents = timelineEvents.filter((item) => item.code === 'LANDING_STARTED');
  const groundContactEvents = timelineEvents.filter((item) => item.phase === 'ground_contact_process');
  const firstTakeoffS = takeoffEvents[0]?.timeS ?? null;
  const firstLandingAfterTakeoffS =
    firstTakeoffS === null ? null : landingEvents.find((item) => item.timeS > firstTakeoffS)?.timeS ?? null;
  const phases = [];

  const firstArmedS = armedEvents[0]?.timeS ?? null;
  const takeoffProcessS =
    takeoffProcessEvents.find((item) => firstTakeoffS === null || item.timeS <= firstTakeoffS + 2)?.timeS ?? null;
  const takeoffCompleteS =
    takeoffCompletedEvents.find((item) => firstTakeoffS !== null && item.timeS >= firstTakeoffS)?.timeS ??
    (firstTakeoffS !== null ? Math.min(firstTakeoffS + 5, firstLandingAfterTakeoffS ?? endS) : null);

  if (firstArmedS !== null && firstArmedS > startS) {
    phases.push(
      createPhase({
        phase: 'ground_standby',
        startS,
        endS: firstArmedS,
        source: 'vehicle.landed + vehicle.armed',
        confidence: pointsFor(signals, 'vehicle.armed').length > 0 ? 'high' : 'medium',
        evidenceCount: 2,
      }),
    );
  }

  if (firstArmedS !== null && firstTakeoffS !== null && firstTakeoffS > firstArmedS) {
    phases.push(
      createPhase({
        phase: 'armed_waiting_takeoff',
        startS: firstArmedS,
        endS: takeoffProcessS ?? firstTakeoffS,
        source: 'vehicle.armed + vehicle.landed',
        confidence: 'high',
        evidenceCount: 2,
      }),
    );
  } else if (firstTakeoffS !== null && firstTakeoffS > startS && firstArmedS === null) {
    phases.push(
      createPhase({
        phase: 'ground_standby',
        startS,
        endS: firstTakeoffS,
        source: 'vehicle.landed',
        confidence: 'medium',
        evidenceCount: 1,
      }),
    );
  }

  if (takeoffProcessS !== null && firstTakeoffS !== null && firstTakeoffS > takeoffProcessS) {
    phases.push(
      createPhase({
        phase: 'takeoff_process',
        startS: takeoffProcessS,
        endS: firstTakeoffS,
        source: 'takeoff_status or vehicle.navState',
        confidence: pointsFor(signals, 'takeoff.state').length > 0 ? 'high' : 'medium',
        evidenceCount: 2,
      }),
    );
  }

  if (firstTakeoffS !== null) {
    const liftoffEndS = takeoffCompleteS ?? Math.min(firstTakeoffS + 5, firstLandingAfterTakeoffS ?? endS);
    if (liftoffEndS > firstTakeoffS) {
      phases.push(
        createPhase({
          phase: 'liftoff_confirmed',
          startS: firstTakeoffS,
          endS: liftoffEndS,
          source: 'vehicle.landed stable transition',
          confidence: pointsFor(signals, 'takeoff.state').length > 0 ? 'high' : 'medium',
          evidenceCount: pointsFor(signals, 'takeoff.state').length > 0 ? 2 : 1,
        }),
      );
    }

    const landingStartS =
      landingProcessEvents.find((item) => firstLandingAfterTakeoffS === null || item.timeS <= firstLandingAfterTakeoffS)
        ?.timeS ?? (firstLandingAfterTakeoffS !== null ? Math.max(firstTakeoffS, firstLandingAfterTakeoffS - 5) : null);
    const airborneEndS = landingStartS ?? firstLandingAfterTakeoffS ?? endS;
    if (airborneEndS > liftoffEndS) {
      phases.push(
        createPhase({
          phase: 'normal_flight',
          startS: liftoffEndS,
          endS: airborneEndS,
          source: 'vehicle.armed + vehicle.landed + vehicle.navState',
          confidence: pointsFor(signals, 'vehicle.navState').length > 0 ? 'high' : 'medium',
          evidenceCount: 3,
        }),
      );
    }
  }

  if (firstLandingAfterTakeoffS !== null) {
    const landingStartS =
      landingProcessEvents.find((item) => item.timeS <= firstLandingAfterTakeoffS)?.timeS ??
      Math.max(firstTakeoffS, firstLandingAfterTakeoffS - 5);
    if (firstLandingAfterTakeoffS > landingStartS) {
      phases.push(
        createPhase({
          phase: 'landing_process',
          startS: landingStartS,
          endS: firstLandingAfterTakeoffS,
          source: 'vehicle.navState or positionSetpoint.currentType',
          confidence: landingProcessEvents.length > 0 ? 'high' : 'medium',
          evidenceCount: landingProcessEvents.length > 0 ? 2 : 1,
        }),
      );
    }
    const groundContactS =
      groundContactEvents.find((item) => item.timeS <= firstLandingAfterTakeoffS + 2 && item.timeS >= landingStartS)?.timeS ??
      null;
    if (groundContactS !== null && firstLandingAfterTakeoffS > groundContactS) {
      phases.push(
        createPhase({
          phase: 'ground_contact_process',
          startS: groundContactS,
          endS: firstLandingAfterTakeoffS,
          source: 'vehicle_land_detected.ground_contact or maybe_landed',
          confidence: 'high',
          evidenceCount: 2,
        }),
      );
    }
    if (endS > firstLandingAfterTakeoffS) {
      const autoDisarmAfterLandingS =
        disarmedEvents.find(
          (item) => item.timeS >= firstLandingAfterTakeoffS && item.phase === 'auto_disarmed_after_landing',
        )?.timeS ?? null;
      const firstDisarmAfterLandingS = autoDisarmAfterLandingS;
      const landedEndS = firstDisarmAfterLandingS ?? endS;
      phases.push(
        createPhase({
          phase: 'landed_complete',
          startS: firstLandingAfterTakeoffS,
          endS: landedEndS,
          source: 'vehicle.landed stable transition',
          confidence: 'high',
          evidenceCount: 2,
        }),
      );
      if (firstDisarmAfterLandingS !== null && endS > firstDisarmAfterLandingS) {
        phases.push(
          createPhase({
            phase: 'auto_disarmed_after_landing',
            startS: firstDisarmAfterLandingS,
            endS,
            source: 'vehicle.armed + latest_disarming_reason',
            confidence: pointsFor(signals, 'vehicle.latestDisarmingReason').length > 0 ? 'high' : 'medium',
            evidenceCount: 2,
          }),
        );
      }
    }
  } else if (firstTakeoffS === null && endS > startS) {
    const initialLanded = Number(valueAtOrBefore(landedPoints, startS)) > 0.5;
    const initialArmed = Number(valueAtOrBefore(pointsFor(signals, 'vehicle.armed'), startS)) > 0.5;
    phases.push(
      createPhase({
        phase: initialLanded ? (initialArmed ? 'armed_waiting_takeoff' : 'ground_standby') : 'normal_flight',
        startS,
        endS,
        source: 'vehicle.landed + vehicle.armed',
        confidence: initialLanded ? 'medium' : 'low',
        evidenceCount: initialArmed ? 2 : 1,
      }),
    );
  }

  return phases.filter((item) => item.endS > item.startS);
}

function buildEmptyV11Response(stored, parserError) {
  const signals = {};
  const missingSignals = [
    {
      id: 'log.timeS',
      required: true,
      reason: 'raw signal parser did not return a usable time axis',
    },
  ];
  const { dataQuality, analysisCapability } = evaluateDataQuality({
    signals,
    parserFailed: true,
    parseError: parserError,
  });

  return {
    contractVersion: CONTRACT_VERSION,
    analysisId: randomUUID(),
    logId: stored.logId,
    fileName: stored.fileName,
    dataQuality,
    analysisCapability,
    signalMappingReport: [
      {
        standardSignal: 'log.timeS',
        status: 'missing',
        required: true,
        source: null,
        sampleCount: 0,
        missingRatio: 1,
      },
    ],
    flightSummary: {
      durationS: null,
      armedFlightTimeS: stored.unlockSummary?.flightTimeS ?? null,
      displayTimeOffsetS: 0,
      flightWindow: null,
      unlockCount: null,
    },
    phases: [],
    timeline: [],
    eventGroups: [],
    flightProcess: {
      localizationSources: [],
      failsafeEvents: [],
      positionComparison: [],
      missingSignals: [{ signal: 'log.timeS', label: 'log time' }],
    },
    chartGroups: [],
    warnings: [
      buildWarning('INCIDENT_ANALYSIS_PARSE_FAILED', 'error', 'ULog raw signal parsing failed.'),
    ],
    missingSignals,
  };
}

function countRisingEdges(points) {
  if (!Array.isArray(points) || points.length === 0) return null;
  let previous = Number(points[0][1]) > 0.5;
  let count = previous ? 1 : 0;
  for (let index = 1; index < points.length; index += 1) {
    const current = Number(points[index][1]) > 0.5;
    if (current && !previous) count += 1;
    previous = current;
  }
  return count;
}

function buildFlightTimeWindow(timeRange, armedPoints) {
  const logStartS = 0;
  const logEndS =
    timeRange && typeof timeRange.endS === 'number' && Number.isFinite(timeRange.endS)
      ? Number(timeRange.endS)
      : null;

  if (Array.isArray(armedPoints) && armedPoints.length > 0) {
    let startS = null;
    let endS = null;

    for (const point of armedPoints) {
      const timeS = Number(point?.[0]);
      const armed = Number(point?.[1]) > 0.5;
      if (!Number.isFinite(timeS)) continue;

      if (armed && startS === null) {
        startS = timeS;
      }

      if (startS !== null && armed) {
        endS = timeS;
      }

      if (startS !== null && !armed && timeS >= startS) {
        endS = timeS;
        break;
      }
    }

    if (startS !== null) {
      const safeEndS =
        endS !== null && endS >= startS
          ? endS
          : logEndS !== null && logEndS >= startS
            ? logEndS
            : startS;
      return {
        startS: Number(startS.toFixed(6)),
        endS: Number(safeEndS.toFixed(6)),
        durationS: Number(Math.max(0, safeEndS - startS).toFixed(3)),
        source: 'vehicle.armed',
      };
    }
  }

  if (logEndS !== null) {
    return {
      startS: logStartS,
      endS: Number(logEndS.toFixed(6)),
      durationS: Number(Math.max(0, logEndS - logStartS).toFixed(3)),
      source: 'log.timeS',
    };
  }

  return null;
}

function buildFlightSummary(stored, normalized) {
  const timeRange = normalized.timeRange;
  const timePoints = normalized.signals['log.timeS']?.points || [];
  const armedPoints = normalized.signals['vehicle.armed']?.points || [];
  const flightWindow = buildFlightTimeWindow(timeRange, armedPoints);
  const durationS =
    timeRange && typeof timeRange.endS === 'number'
      ? timeRange.endS
      : timePoints.length >= 2
        ? timePoints[timePoints.length - 1][0] - timePoints[0][0]
        : null;

  return {
    durationS: typeof durationS === 'number' && Number.isFinite(durationS) ? Number(durationS.toFixed(3)) : null,
    armedFlightTimeS: stored.unlockSummary?.flightTimeS ?? null,
    displayTimeOffsetS: flightWindow?.startS ?? 0,
    flightWindow,
    unlockCount: countRisingEdges(armedPoints),
  };
}

function buildWarnings(dataQuality, missingSignals) {
  const warnings = [];

  if (dataQuality.level === 'invalid') {
    warnings.push(
      buildWarning('INCIDENT_ANALYSIS_INVALID_DATA', 'error', 'Incident analysis cannot run without valid parsed log data.'),
    );
  }

  if (dataQuality.level === 'insufficient') {
    warnings.push(
      buildWarning('INCIDENT_ANALYSIS_INSUFFICIENT_DATA', 'warning', 'The log is missing required V1.3 signals.'),
    );
  }

  const optionalMissing = missingSignals.filter((item) => !item.required);
  if (optionalMissing.length > 0) {
    warnings.push(
      buildWarning('INCIDENT_ANALYSIS_OPTIONAL_SIGNALS_MISSING', 'info', 'Some optional V1.3 signals are unavailable.'),
    );
  }

  return warnings;
}

function signalMeta(signal) {
  return signal
    ? {
        topic: signal.topic,
        instance: signal.instance,
        field: signal.field,
      }
    : null;
}

function buildBooleanIntervals(points) {
  if (!Array.isArray(points) || points.length === 0) return [];

  const intervals = [];
  let active = Number(points[0][1]) > 0.5;
  let startS = active ? points[0][0] : null;

  for (let index = 1; index < points.length; index += 1) {
    const current = Number(points[index][1]) > 0.5;
    if (current === active) continue;
    if (current) {
      startS = points[index][0];
    } else if (startS !== null) {
      intervals.push({
        startS: roundTime(startS),
        endS: roundTime(points[index][0]),
      });
      startS = null;
    }
    active = current;
  }

  if (active && startS !== null) {
    intervals.push({
      startS: roundTime(startS),
      endS: roundTime(points[points.length - 1][0]),
    });
  }

  return intervals;
}

function buildBooleanChanges(points) {
  if (!Array.isArray(points) || points.length === 0) return [];

  const changes = [];
  let previous = Number(points[0][1]) > 0.5;
  for (let index = 1; index < points.length; index += 1) {
    const current = Number(points[index][1]) > 0.5;
    if (current === previous) continue;
    changes.push({
      timeS: roundTime(points[index][0]),
      active: current,
    });
    previous = current;
  }
  return changes;
}

function buildLocalizationSources(signals) {
  return LOCALIZATION_SOURCE_SPECS.map(([id, label, signalId]) => {
    const signal = signals[signalId];
    const points = Array.isArray(signal?.points) ? signal.points : [];
    return {
      id,
      label,
      signal: signalId,
      available: points.length > 0,
      activeIntervals: buildBooleanIntervals(points),
      changes: buildBooleanChanges(points),
      source: signalMeta(signal),
    };
  });
}

function buildFailsafeWindows(signals) {
  const failsafePoints = pointsFor(signals, 'vehicle.failsafe');
  if (failsafePoints.length === 0) return [];

  const windows = [];
  let active = Number(failsafePoints[0][1]) > 0.5;
  let startS = active ? failsafePoints[0][0] : null;

  for (let index = 1; index < failsafePoints.length; index += 1) {
    const current = Number(failsafePoints[index][1]) > 0.5;
    if (current === active) continue;

    if (current) {
      startS = failsafePoints[index][0];
    } else if (startS !== null) {
      windows.push({
        startS: roundTime(startS),
        endS: roundTime(failsafePoints[index][0]),
      });
      startS = null;
    }
    active = current;
  }

  if (active && startS !== null) {
    windows.push({
      startS: roundTime(startS),
      endS: roundTime(failsafePoints[failsafePoints.length - 1][0]),
    });
  }

  return windows;
}

function activeFailsafeFlagsAt(signals, timeS) {
  return FAILSAFE_FLAG_SPECS.map(([id, label, signalId]) => {
    const signal = signals[signalId];
    if (!signal) return null;
    const rawValue = valueAtOrBefore(pointsFor(signals, signalId), timeS);
    const value = Number(rawValue);
    const active = Number.isFinite(value) && value > 0;
    return active
      ? {
          id,
          label,
          signal: signalId,
          value,
          source: signalMeta(signal),
        }
      : null;
  }).filter(Boolean);
}

function buildFailsafeProcessEvents(signals) {
  return buildFailsafeWindows(signals).map((window, index) => {
    const endS = window.endS;
    const durationS =
      typeof endS === 'number' && Number.isFinite(endS) ? roundTime(endS - window.startS) : null;
    const activeFlags = activeFailsafeFlagsAt(signals, window.startS);
    const navState = valueAtOrBefore(pointsFor(signals, 'vehicle.navState'), window.startS);
    const userIntention = valueAtOrBefore(pointsFor(signals, 'vehicle.navStateUserIntention'), window.startS);

    return {
      id: `failsafe_${index + 1}_${window.startS}`,
      startS: window.startS,
      endS,
      durationS,
      navState: navState === null ? null : formatNavState(navState),
      navStateUserIntention: userIntention === null ? null : formatNavState(userIntention),
      activeFlags,
      source: signalMeta(signals['vehicle.failsafe']),
    };
  });
}

function buildPositionComparison(signals) {
  return POSITION_COMPARISON_AXES.map(([axis, label]) => {
    const seriesSpecs = [
      ['setpoint', 'local position setpoint', `position.setpoint.${axis}`],
      ['actual', 'local position actual', `position.actual.${axis}`],
      ['vision', 'vision input position', `position.vision.${axis}`],
    ];
    return {
      axis,
      label,
      unit: 'm',
      series: seriesSpecs
        .map(([kind, seriesLabel, signalId]) => {
          const signal = signals[signalId];
          if (!signal || !Array.isArray(signal.points) || signal.points.length === 0) return null;
          return {
            kind,
            label: seriesLabel,
            signal: signalId,
            unit: signal.unit || 'm',
            points: signal.points,
            source: signalMeta(signal),
          };
        })
        .filter(Boolean),
    };
  });
}

function buildFlightProcess(normalized) {
  const signals = normalized.signals || {};
  const localizationSources = buildLocalizationSources(signals);
  const failsafeEvents = buildFailsafeProcessEvents(signals);
  const positionComparison = buildPositionComparison(signals);
  const missingSignals = [
    ...LOCALIZATION_SOURCE_SPECS.filter(([, , signalId]) => !signals[signalId]).map(([, label, signalId]) => ({
      signal: signalId,
      label,
    })),
    ...FAILSAFE_FLAG_SPECS.filter(([, , signalId]) => !signals[signalId]).map(([, label, signalId]) => ({
      signal: signalId,
      label,
    })),
    ...POSITION_COMPARISON_AXES.flatMap(([axis, label]) =>
      ['setpoint', 'actual', 'vision']
        .map((kind) => `position.${kind}.${axis}`)
        .filter((signalId) => !signals[signalId])
        .map((signalId) => ({ signal: signalId, label })),
    ),
  ];

  return {
    localizationSources,
    failsafeEvents,
    positionComparison,
    missingSignals,
  };
}

function boundsForSignalIds(signals, signalIds) {
  const times = signalIds
    .flatMap((signalId) => pointsFor(signals, signalId).map(([timeS]) => timeS))
    .filter((timeS) => typeof timeS === 'number' && Number.isFinite(timeS));
  if (times.length === 0) return null;
  return {
    startS: Math.min(...times),
    endS: Math.max(...times),
  };
}

function inferFlightProcessRange(signals, eventGroups, flightProcess) {
  const takeoffEndS = eventGroups
    .filter((group) => group.phase === 'takeoff')
    .reduce((latest, group) => Math.max(latest, group.endTimeS), -Infinity);
  const landingStartS = eventGroups
    .filter((group) => group.phase === 'landing')
    .reduce((earliest, group) => Math.min(earliest, group.startTimeS), Infinity);
  if (Number.isFinite(takeoffEndS) && Number.isFinite(landingStartS) && landingStartS > takeoffEndS) {
    return {
      startS: takeoffEndS,
      endS: landingStartS,
    };
  }

  const evidenceSignals = [
    ...flightProcess.localizationSources.filter((item) => item.available).map((item) => item.signal),
    ...flightProcess.failsafeEvents.flatMap((event) => event.activeFlags.map((flag) => flag.signal)),
    ...flightProcess.positionComparison.flatMap((axis) => axis.series.map((series) => series.signal)),
    'log.timeS',
  ];
  const bounds = boundsForSignalIds(signals, evidenceSignals);
  if (bounds && bounds.endS > bounds.startS) return bounds;
  return null;
}

function countActiveLocalizationSources(flightProcess) {
  return flightProcess.localizationSources.filter((source) => source.activeIntervals.length > 0).length;
}

function describeLocalizationSources(flightProcess) {
  const activeSources = flightProcess.localizationSources.filter((source) => source.activeIntervals.length > 0);
  if (activeSources.length === 0) return 'No active localization source interval was decoded.';
  return `${activeSources.length} localization sources active: ${activeSources.map((source) => source.label).join(', ')}.`;
}

function describeFailsafeEvents(flightProcess) {
  if (flightProcess.failsafeEvents.length === 0) return 'No vehicle.failsafe trigger window was decoded.';
  const flagLabels = uniqueBy(
    flightProcess.failsafeEvents.flatMap((event) => event.activeFlags.map((flag) => flag.label)),
    (label) => label,
  );
  return flagLabels.length > 0
    ? `${flightProcess.failsafeEvents.length} failsafe windows: ${flagLabels.join(', ')}.`
    : `${flightProcess.failsafeEvents.length} failsafe windows, without detailed failsafe_flags.`;
}

function describePositionComparison(flightProcess) {
  const axes = flightProcess.positionComparison.filter((axis) => axis.series.length > 0);
  if (axes.length === 0) return 'No position comparison series was decoded.';
  return `${axes.length} position axes available: ${axes
    .map((axis) => `${axis.axis.toUpperCase()}(${axis.series.map((series) => series.kind).join('/')})`)
    .join(', ')}.`;
}

function buildFlightProcessRawEvents(signals, flightProcess, range) {
  const localizationEvidence = flightProcess.localizationSources
    .filter((source) => source.available)
    .map((source) => source.signal);
  const failsafeEvidence = uniqueBy(
    [
      ...(pointsFor(signals, 'vehicle.failsafe').length > 0 ? ['vehicle.failsafe'] : []),
      ...flightProcess.failsafeEvents.flatMap((event) => event.activeFlags.map((flag) => flag.signal)),
    ],
    (signal) => signal,
  );
  const positionEvidence = flightProcess.positionComparison.flatMap((axis) => axis.series.map((series) => series.signal));
  const events = [
    createEvent({
      code: 'FLIGHT_PROCESS_LOCALIZATION',
      type: 'flight_process',
      timeS: range.startS,
      title: 'Localization sources',
      detail: describeLocalizationSources(flightProcess),
      phase: 'flight_process',
      rawEvent: {
        kind: 'flight_process_summary',
        activeSourceCount: countActiveLocalizationSources(flightProcess),
      },
      confidence: localizationEvidence.length > 0 ? 'high' : 'low',
      evidence: localizationEvidence,
      evidenceDetails: localizationEvidence.map((signalId) => evidenceItem(signals, signalId, `${signalId} is decoded`)),
    }),
    createEvent({
      code: 'FLIGHT_PROCESS_FAILSAFE',
      type: 'flight_process',
      timeS: (range.startS + range.endS) / 2,
      severity: flightProcess.failsafeEvents.length > 0 ? 'warning' : 'info',
      title: 'Failsafe status',
      detail: describeFailsafeEvents(flightProcess),
      phase: 'flight_process',
      rawEvent: {
        kind: 'flight_process_summary',
        failsafeCount: flightProcess.failsafeEvents.length,
      },
      confidence: pointsFor(signals, 'vehicle.failsafe').length > 0 ? 'high' : 'low',
      evidence: failsafeEvidence,
      evidenceDetails: failsafeEvidence.map((signalId) => evidenceItem(signals, signalId, `${signalId} supports failsafe status`)),
    }),
    createEvent({
      code: 'FLIGHT_PROCESS_POSITION_COMPARISON',
      type: 'flight_process',
      timeS: range.endS,
      title: 'Position comparison',
      detail: describePositionComparison(flightProcess),
      phase: 'flight_process',
      rawEvent: {
        kind: 'flight_process_summary',
        axes: flightProcess.positionComparison
          .filter((axis) => axis.series.length > 0)
          .map((axis) => axis.axis),
      },
      confidence: positionEvidence.length >= 2 ? 'high' : positionEvidence.length > 0 ? 'medium' : 'low',
      evidence: positionEvidence,
      evidenceDetails: positionEvidence.map((signalId) => evidenceItem(signals, signalId, `${signalId} is available`)),
    }),
  ];

  return attachEvidenceLinks(events, signals);
}

function buildFlightProcessEventGroup(signals, eventGroups, flightProcess) {
  const hasProcessData =
    flightProcess.localizationSources.some((source) => source.available) ||
    flightProcess.failsafeEvents.length > 0 ||
    flightProcess.positionComparison.some((axis) => axis.series.length > 0);
  if (!hasProcessData) return null;

  const range = inferFlightProcessRange(signals, eventGroups, flightProcess);
  if (!range || range.endS < range.startS) return null;

  const rawEvents = buildFlightProcessRawEvents(signals, flightProcess, range);
  const evidenceSignals = uniqueBy(rawEvents.flatMap((event) => event.evidence || []), (signal) => signal);
  const evidenceLinks = uniqueBy(
    rawEvents.flatMap((event) => event.evidenceLinks || []),
    (link) => `${link.chartGroupId}:${link.seriesId}:${link.standardSignal}`,
  );
  const summaryParts = [
    `${countActiveLocalizationSources(flightProcess)} active localization sources`,
    `${flightProcess.failsafeEvents.length} failsafe windows`,
    `${flightProcess.positionComparison.filter((axis) => axis.series.length > 0).length} position axes`,
  ];

  return {
    id: `flight_process_${roundTime(range.startS)}_${roundTime(range.endS)}`,
    phase: 'flight_process',
    severity: flightProcess.failsafeEvents.length > 0 ? 'warning' : 'info',
    startTimeS: roundTime(range.startS),
    endTimeS: roundTime(range.endS),
    title: groupTitleForPhase('flight_process'),
    summary: summaryParts.join(', '),
    primaryEvents: rawEvents,
    evidenceEvents: [],
    rawEvents,
    evidenceSignals,
    evidenceLinks,
    chartPreset: chartPresetForPhase('flight_process'),
  };
}

function mergeFlightProcessEventGroup(eventGroups, flightProcessGroup) {
  if (!flightProcessGroup) return eventGroups;
  return [...eventGroups, flightProcessGroup].sort(
    (a, b) => a.startTimeS - b.startTimeS || a.endTimeS - b.endTimeS || a.phase.localeCompare(b.phase),
  );
}

function buildEstimatorFlagChartSeries(signal) {
  if (!signal || !Array.isArray(signal.points) || signal.points.length === 0) return [];

  const changes = [];
  let previous = Math.round(Number(signal.points[0][1]));
  for (let index = 1; index < signal.points.length; index += 1) {
    const current = Math.round(Number(signal.points[index][1]));
    if (current !== previous) {
      changes.push({
        timeS: signal.points[index][0],
        previous,
        current,
      });
    }
    previous = current;
  }

  return getChangedEstimatorFlagIndexes(changes).map((bitIndex) => ({
    id: estimatorFlagSeriesId(bitIndex),
    label: estimatorFlagSeriesId(bitIndex),
    unit: '',
    points: signal.points.map(([timeS, value]) => [
      timeS,
      Number((bitmaskToBigInt(value) & (1n << BigInt(bitIndex))) !== 0n),
    ]),
    source: {
      topic: signal.topic,
      instance: signal.instance,
      field: `${signal.field}.${ESTIMATOR_FLAG_LABELS[bitIndex] || `bit_${bitIndex}`}`,
    },
  }));
}

function buildChartGroups(normalized) {
  const groups = [];
  const stateSeries = [
    'vehicle.armed',
    'vehicle.armingState',
    'vehicle.landed',
    'vehicle.maybeLanded',
    'vehicle.groundContact',
    'vehicle.atRest',
    'vehicle.inGroundEffect',
    'vehicle.navState',
    'vehicle.navStateUserIntention',
    'vehicle.failsafe',
    'takeoff.state',
    'positionSetpoint.currentType',
  ]
    .map((id) => normalized.signals[id])
    .filter(Boolean)
    .map((signal) => ({
      id: signal.id,
      label: signal.id,
      unit: signal.unit,
      points: signal.points,
      source: {
        topic: signal.topic,
        instance: signal.instance,
        field: signal.field,
      },
    }));

  if (stateSeries.length > 0) {
    groups.push({
      id: 'v1_3_state_signals',
      title: 'V1.3 state evidence signals',
      series: stateSeries,
    });
  }

  const optionalSeries = [
    'position.altitudeRelative',
    'battery.voltage',
    'battery.current',
    'battery.remaining',
    'vehicle.latestDisarmingReason',
    'estimator.primaryInstance',
    'estimator.instanceChangedCount',
    'estimator.lastInstanceChange',
    'estimator.csInAir',
    'estimator.csGroundEffect',
    'estimator.csGnssPos',
    'estimator.csOptFlow',
    'estimator.csEvPos',
    'estimator.csEvVel',
    'estimator.csBaroHgt',
    'estimator.csRngHgt',
    'estimator.csGpsHgt',
    'estimator.csEvHgt',
    'estimator.csMagFault',
    'estimator.controlStatusChanges',
    ...FAILSAFE_FLAG_SPECS.map(([, , signalId]) => signalId),
    'vehicleCommand.command',
    'vehicleCommand.fromExternal',
    'vehicleCommandAck.command',
    'vehicleCommandAck.result',
  ]
    .map((id) => normalized.signals[id])
    .filter(Boolean)
    .map((signal) => ({
      id: signal.id,
      label: signal.id,
      unit: signal.unit,
      points: signal.points,
      source: {
        topic: signal.topic,
        instance: signal.instance,
        field: signal.field,
      },
    }));
  const estimatorSeries = buildEstimatorFlagChartSeries(normalized.signals['estimator.flags']);
  optionalSeries.push(...estimatorSeries);

  if (optionalSeries.length > 0) {
    groups.push({
      id: 'v1_3_optional_signals',
      title: 'V1.3 optional evidence signals',
      series: optionalSeries,
    });
  }

  const positionSeries = POSITION_COMPARISON_AXES.flatMap(([axis]) =>
    [
      [`position.setpoint.${axis}`, `setpoint.${axis}`],
      [`position.actual.${axis}`, `actual.${axis}`],
      [`position.vision.${axis}`, `vision.${axis}`],
    ].map(([signalId, label]) => {
      const signal = normalized.signals[signalId];
      if (!signal) return null;
      return {
        id: signal.id,
        label,
        unit: signal.unit,
        points: signal.points,
        source: {
          topic: signal.topic,
          instance: signal.instance,
          field: signal.field,
        },
      };
    }),
  ).filter(Boolean);

  if (positionSeries.length > 0) {
    groups.push({
      id: 'flight_process_position_comparison',
      title: 'Flight process position comparison',
      series: positionSeries,
    });
  }

  return groups;
}

function buildIncidentAnalysisV13(stored) {
  let rawSignalPayload;

  try {
    rawSignalPayload = parsePx4RawSignals(stored.storedPath);
  } catch (error) {
    return buildEmptyV11Response(stored, error);
  }

  const normalized = mapStandardSignals(rawSignalPayload);
  const { dataQuality, analysisCapability } = evaluateDataQuality({
    signals: normalized.signals,
  });
  const phases = buildPhases(normalized.signals, analysisCapability);
  const timeline = buildTimeline(normalized.signals, analysisCapability);
  const baseEventGroups = buildEventGroups(timeline);
  const flightProcess = buildFlightProcess(normalized);
  const flightProcessGroup = buildFlightProcessEventGroup(normalized.signals, baseEventGroups, flightProcess);
  const eventGroups = mergeFlightProcessEventGroup(baseEventGroups, flightProcessGroup);

  return {
    contractVersion: CONTRACT_VERSION,
    analysisId: randomUUID(),
    logId: stored.logId,
    fileName: stored.fileName,
    dataQuality,
    analysisCapability,
    signalMappingReport: normalized.signalMappingReport,
    flightSummary: buildFlightSummary(stored, normalized),
    phases,
    timeline,
    eventGroups,
    flightProcess,
    chartGroups: buildChartGroups(normalized),
    warnings: buildWarnings(dataQuality, normalized.missingSignals),
    missingSignals: normalized.missingSignals,
  };
}

module.exports = {
  buildIncidentAnalysisV13,
  buildIncidentAnalysisV12: buildIncidentAnalysisV13,
  buildIncidentAnalysisV11: buildIncidentAnalysisV13,
  buildEvidenceLinksForEvent,
  buildEventGroups,
  buildFlightProcess,
  buildFlightProcessEventGroup,
  buildPhases,
  buildTimeline,
};
