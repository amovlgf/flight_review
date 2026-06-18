const REQUIRED_SIGNALS = new Set([
  'log.timeS',
  'vehicle.armed',
  'vehicle.landed',
  'vehicle.navState',
  'vehicle.failsafe',
]);

const STANDARD_SIGNAL_SPECS = [
  {
    id: 'vehicle.armingState',
    required: false,
    candidates: [
      {
        topic: 'vehicle_status',
        field: 'arming_state',
        unit: '',
      },
    ],
  },
  {
    id: 'vehicle.armed',
    required: true,
    candidates: [
      {
        topic: 'vehicle_status',
        field: 'arming_state',
        unit: '',
        transform: (value) => (Number(value) === 2 || Number(value) === 5 ? 1 : 0),
      },
      {
        topic: 'actuator_armed',
        field: 'armed',
        unit: '',
        transform: (value) => (Number(value) > 0.5 ? 1 : 0),
      },
    ],
  },
  {
    id: 'vehicle.landed',
    required: true,
    candidates: [
      {
        topic: 'vehicle_land_detected',
        field: 'landed',
        unit: '',
        transform: (value) => (Number(value) > 0.5 ? 1 : 0),
      },
    ],
  },
  {
    id: 'vehicle.maybeLanded',
    required: false,
    candidates: [
      {
        topic: 'vehicle_land_detected',
        field: 'maybe_landed',
        unit: '',
        transform: (value) => (Number(value) > 0.5 ? 1 : 0),
      },
    ],
  },
  {
    id: 'vehicle.groundContact',
    required: false,
    candidates: [
      {
        topic: 'vehicle_land_detected',
        field: 'ground_contact',
        unit: '',
        transform: (value) => (Number(value) > 0.5 ? 1 : 0),
      },
    ],
  },
  {
    id: 'vehicle.atRest',
    required: false,
    candidates: [
      {
        topic: 'vehicle_land_detected',
        field: 'at_rest',
        unit: '',
        transform: (value) => (Number(value) > 0.5 ? 1 : 0),
      },
    ],
  },
  {
    id: 'vehicle.inGroundEffect',
    required: false,
    candidates: [
      {
        topic: 'vehicle_land_detected',
        field: 'in_ground_effect',
        unit: '',
        transform: (value) => (Number(value) > 0.5 ? 1 : 0),
      },
    ],
  },
  {
    id: 'vehicle.navState',
    required: true,
    candidates: [
      {
        topic: 'vehicle_status',
        field: 'nav_state',
        unit: '',
      },
    ],
  },
  {
    id: 'vehicle.navStateUserIntention',
    required: false,
    candidates: [
      {
        topic: 'vehicle_status',
        field: 'nav_state_user_intention',
        unit: '',
      },
    ],
  },
  {
    id: 'vehicle.navStateTimestamp',
    required: false,
    candidates: [
      {
        topic: 'vehicle_status',
        field: 'nav_state_timestamp',
        unit: 'us',
      },
    ],
  },
  {
    id: 'vehicle.takeoffTime',
    required: false,
    candidates: [
      {
        topic: 'vehicle_status',
        field: 'takeoff_time',
        unit: 'us',
      },
    ],
  },
  {
    id: 'vehicle.latestDisarmingReason',
    required: false,
    candidates: [
      {
        topic: 'vehicle_status',
        field: 'latest_disarming_reason',
        unit: '',
      },
    ],
  },
  {
    id: 'vehicle.failsafe',
    required: true,
    candidates: [
      {
        topic: 'vehicle_status',
        field: 'failsafe',
        unit: '',
        transform: (value) => (Number(value) > 0.5 ? 1 : 0),
      },
      {
        topic: 'vehicle_status',
        field: 'failsafe_and_user_took_over',
        unit: '',
        transform: (value) => (Number(value) > 0.5 ? 1 : 0),
      },
    ],
  },
  {
    id: 'takeoff.state',
    required: false,
    candidates: [
      {
        topic: 'takeoff_status',
        field: 'takeoff_state',
        unit: '',
      },
    ],
  },
  {
    id: 'positionSetpoint.currentType',
    required: false,
    candidates: [
      {
        topic: 'position_setpoint_triplet',
        field: 'current.type',
        unit: '',
      },
      {
        topic: 'position_setpoint_triplet',
        field: 'current_type',
        unit: '',
      },
    ],
  },
  {
    id: 'estimator.primaryInstance',
    required: false,
    candidates: [
      {
        topic: 'estimator_selector_status',
        field: 'primary_instance',
        unit: '',
      },
    ],
  },
  {
    id: 'estimator.instanceChangedCount',
    required: false,
    candidates: [
      {
        topic: 'estimator_selector_status',
        field: 'instance_changed_count',
        unit: '',
      },
    ],
  },
  {
    id: 'estimator.lastInstanceChange',
    required: false,
    candidates: [
      {
        topic: 'estimator_selector_status',
        field: 'last_instance_change',
        unit: 'us',
      },
    ],
  },
  {
    id: 'estimator.csInAir',
    required: false,
    candidates: [
      {
        topic: 'estimator_status_flags',
        field: 'cs_in_air',
        unit: '',
        transform: (value) => (Number(value) > 0.5 ? 1 : 0),
      },
    ],
  },
  {
    id: 'estimator.csGroundEffect',
    required: false,
    candidates: [
      {
        topic: 'estimator_status_flags',
        field: 'cs_gnd_effect',
        unit: '',
        transform: (value) => (Number(value) > 0.5 ? 1 : 0),
      },
    ],
  },
  {
    id: 'estimator.csGnssPos',
    required: false,
    candidates: [
      {
        topic: 'estimator_status_flags',
        field: 'cs_gnss_pos',
        unit: '',
        transform: (value) => (Number(value) > 0.5 ? 1 : 0),
      },
      {
        topic: 'estimator_status_flags',
        field: 'cs_gps',
        unit: '',
        transform: (value) => (Number(value) > 0.5 ? 1 : 0),
      },
    ],
  },
  {
    id: 'estimator.csOptFlow',
    required: false,
    candidates: [
      {
        topic: 'estimator_status_flags',
        field: 'cs_opt_flow',
        unit: '',
        transform: (value) => (Number(value) > 0.5 ? 1 : 0),
      },
    ],
  },
  {
    id: 'estimator.csEvPos',
    required: false,
    candidates: [
      {
        topic: 'estimator_status_flags',
        field: 'cs_ev_pos',
        unit: '',
        transform: (value) => (Number(value) > 0.5 ? 1 : 0),
      },
    ],
  },
  {
    id: 'estimator.csEvVel',
    required: false,
    candidates: [
      {
        topic: 'estimator_status_flags',
        field: 'cs_ev_vel',
        unit: '',
        transform: (value) => (Number(value) > 0.5 ? 1 : 0),
      },
    ],
  },
  {
    id: 'estimator.csBaroHgt',
    required: false,
    candidates: [
      {
        topic: 'estimator_status_flags',
        field: 'cs_baro_hgt',
        unit: '',
        transform: (value) => (Number(value) > 0.5 ? 1 : 0),
      },
    ],
  },
  {
    id: 'estimator.csRngHgt',
    required: false,
    candidates: [
      {
        topic: 'estimator_status_flags',
        field: 'cs_rng_hgt',
        unit: '',
        transform: (value) => (Number(value) > 0.5 ? 1 : 0),
      },
    ],
  },
  {
    id: 'estimator.csGpsHgt',
    required: false,
    candidates: [
      {
        topic: 'estimator_status_flags',
        field: 'cs_gps_hgt',
        unit: '',
        transform: (value) => (Number(value) > 0.5 ? 1 : 0),
      },
    ],
  },
  {
    id: 'estimator.csEvHgt',
    required: false,
    candidates: [
      {
        topic: 'estimator_status_flags',
        field: 'cs_ev_hgt',
        unit: '',
        transform: (value) => (Number(value) > 0.5 ? 1 : 0),
      },
    ],
  },
  {
    id: 'estimator.csMagFault',
    required: false,
    candidates: [
      {
        topic: 'estimator_status_flags',
        field: 'cs_mag_fault',
        unit: '',
        transform: (value) => (Number(value) > 0.5 ? 1 : 0),
      },
    ],
  },
  {
    id: 'estimator.controlStatusChanges',
    required: false,
    candidates: [
      {
        topic: 'estimator_status_flags',
        field: 'control_status_changes',
        unit: '',
      },
    ],
  },
  {
    id: 'failsafeFlag.localPosition',
    required: false,
    candidates: [
      {
        topic: 'failsafe_flags',
        field: 'local_position_invalid',
        unit: '',
        transform: (value) => (Number(value) > 0.5 ? 1 : 0),
      },
      {
        topic: 'failsafe_flags',
        field: 'local_position_accuracy_low',
        unit: '',
        transform: (value) => (Number(value) > 0.5 ? 1 : 0),
      },
    ],
  },
  {
    id: 'failsafeFlag.globalPosition',
    required: false,
    candidates: [
      {
        topic: 'failsafe_flags',
        field: 'global_position_invalid',
        unit: '',
        transform: (value) => (Number(value) > 0.5 ? 1 : 0),
      },
    ],
  },
  {
    id: 'failsafeFlag.manualControlSignalLost',
    required: false,
    candidates: [
      {
        topic: 'failsafe_flags',
        field: 'manual_control_signal_lost',
        unit: '',
        transform: (value) => (Number(value) > 0.5 ? 1 : 0),
      },
    ],
  },
  {
    id: 'failsafeFlag.gcsConnectionLost',
    required: false,
    candidates: [
      {
        topic: 'failsafe_flags',
        field: 'gcs_connection_lost',
        unit: '',
        transform: (value) => (Number(value) > 0.5 ? 1 : 0),
      },
    ],
  },
  {
    id: 'failsafeFlag.offboardControlSignalLost',
    required: false,
    candidates: [
      {
        topic: 'failsafe_flags',
        field: 'offboard_control_signal_lost',
        unit: '',
        transform: (value) => (Number(value) > 0.5 ? 1 : 0),
      },
    ],
  },
  {
    id: 'failsafeFlag.batteryWarning',
    required: false,
    candidates: [
      {
        topic: 'failsafe_flags',
        field: 'battery_warning',
        unit: '',
      },
    ],
  },
  {
    id: 'failsafeFlag.geofenceBreached',
    required: false,
    candidates: [
      {
        topic: 'failsafe_flags',
        field: 'geofence_breached',
        unit: '',
        transform: (value) => (Number(value) > 0.5 ? 1 : 0),
      },
    ],
  },
  {
    id: 'failsafeFlag.windLimitExceeded',
    required: false,
    candidates: [
      {
        topic: 'failsafe_flags',
        field: 'wind_limit_exceeded',
        unit: '',
        transform: (value) => (Number(value) > 0.5 ? 1 : 0),
      },
    ],
  },
  {
    id: 'failsafeFlag.failureDetector',
    required: false,
    candidates: [
      {
        topic: 'failsafe_flags',
        field: 'fd_critical_failure',
        unit: '',
        transform: (value) => (Number(value) > 0.5 ? 1 : 0),
      },
      {
        topic: 'failsafe_flags',
        field: 'failure_detector_status',
        unit: '',
        transform: (value) => (Number(value) > 0.5 ? 1 : 0),
      },
    ],
  },
  ...['x', 'y', 'z'].flatMap((axis) => [
    {
      id: `position.actual.${axis}`,
      required: false,
      candidates: [
        {
          topic: 'vehicle_local_position',
          field: axis,
          unit: 'm',
        },
      ],
    },
    {
      id: `position.setpoint.${axis}`,
      required: false,
      candidates: [
        {
          topic: 'trajectory_setpoint',
          field: `position[${['x', 'y', 'z'].indexOf(axis)}]`,
          unit: 'm',
        },
        {
          topic: 'trajectory_setpoint',
          field: axis,
          unit: 'm',
        },
        {
          topic: 'vehicle_local_position_setpoint',
          field: axis,
          unit: 'm',
        },
      ],
    },
    {
      id: `position.vision.${axis}`,
      required: false,
      candidates: [
        {
          topic: 'vehicle_visual_odometry',
          field: `position[${['x', 'y', 'z'].indexOf(axis)}]`,
          unit: 'm',
        },
        {
          topic: 'vehicle_visual_odometry',
          field: axis,
          unit: 'm',
        },
        {
          topic: 'vehicle_odometry',
          field: `position[${['x', 'y', 'z'].indexOf(axis)}]`,
          unit: 'm',
        },
        {
          topic: 'vehicle_odometry',
          field: axis,
          unit: 'm',
        },
      ],
    },
  ]),
  {
    id: 'vehicleCommand.command',
    required: false,
    candidates: [
      {
        topic: 'vehicle_command',
        field: 'command',
        unit: '',
      },
    ],
  },
  {
    id: 'vehicleCommand.fromExternal',
    required: false,
    candidates: [
      {
        topic: 'vehicle_command',
        field: 'from_external',
        unit: '',
        transform: (value) => (Number(value) > 0.5 ? 1 : 0),
      },
    ],
  },
  {
    id: 'vehicleCommandAck.command',
    required: false,
    candidates: [
      {
        topic: 'vehicle_command_ack',
        field: 'command',
        unit: '',
      },
    ],
  },
  {
    id: 'vehicleCommandAck.result',
    required: false,
    candidates: [
      {
        topic: 'vehicle_command_ack',
        field: 'result',
        unit: '',
      },
    ],
  },
  {
    id: 'position.altitudeRelative',
    required: false,
    candidates: [
      {
        topic: 'vehicle_local_position',
        field: 'z',
        unit: 'm',
        transform: (value) => -Number(value),
      },
    ],
  },
  {
    id: 'battery.voltage',
    required: false,
    candidates: [
      {
        topic: 'battery_status',
        field: 'voltage_v',
        unit: 'V',
      },
      {
        topic: 'battery_status_0',
        field: 'voltage_v',
        unit: 'V',
      },
    ],
  },
  {
    id: 'battery.current',
    required: false,
    candidates: [
      {
        topic: 'battery_status',
        field: 'current_a',
        unit: 'A',
      },
      {
        topic: 'battery_status_0',
        field: 'current_a',
        unit: 'A',
      },
    ],
  },
  {
    id: 'battery.remaining',
    required: false,
    candidates: [
      {
        topic: 'battery_status',
        field: 'remaining',
        unit: '%',
        transform: (value) => Number(value) * 100,
      },
      {
        topic: 'battery_status_0',
        field: 'remaining',
        unit: '%',
        transform: (value) => Number(value) * 100,
      },
    ],
  },
  {
    id: 'estimator.flags',
    required: false,
    candidates: [
      {
        topic: 'estimator_status_flags',
        field: 'control_status_flags',
        unit: '',
      },
      {
        topic: 'estimator_status',
        field: 'control_mode_flags',
        unit: '',
      },
      {
        topic: 'estimator_status',
        field: 'innovation_check_flags',
        unit: '',
      },
    ],
  },
];

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function buildMissingSignal(id, required, reason = 'source topic or field is unavailable') {
  return {
    id,
    required,
    reason,
  };
}

function buildMappingReport(entry) {
  return {
    standardSignal: entry.standardSignal,
    status: entry.status,
    required: entry.required,
    source: entry.source || null,
    sampleCount: entry.sampleCount || 0,
    missingRatio: entry.missingRatio ?? 1,
  };
}

function findRawTopic(rawTopics, topicName) {
  return rawTopics.find(
    (item) =>
      item &&
      item.topic === topicName &&
      Array.isArray(item.timeS) &&
      item.fields &&
      typeof item.fields === 'object',
  );
}

function getFieldValues(rawTopic, fieldName) {
  const values = rawTopic?.fields?.[fieldName];
  return Array.isArray(values) ? values : null;
}

function estimateSampleRateHz(points) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const start = points[0][0];
  const end = points[points.length - 1][0];
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return Number(((points.length - 1) / (end - start)).toFixed(3));
}

function makeSignal({ id, rawTopic, field, unit, source, transform }) {
  const values = getFieldValues(rawTopic, field);
  if (!values) return null;

  const sampleCount = Math.min(rawTopic.timeS.length, values.length);
  const points = [];
  let missingCount = 0;

  for (let index = 0; index < sampleCount; index += 1) {
    const timeS = rawTopic.timeS[index];
    const rawValue = values[index];
    if (!isFiniteNumber(timeS) || !isFiniteNumber(rawValue)) {
      missingCount += 1;
      continue;
    }
    const value = transform ? transform(rawValue) : Number(rawValue);
    if (!isFiniteNumber(value)) {
      missingCount += 1;
      continue;
    }
    points.push([Number(timeS.toFixed(6)), Number(value.toFixed(6))]);
  }

  if (!points.length) return null;

  return {
    id,
    topic: rawTopic.topic,
    instance: Number.isInteger(rawTopic.instance) ? rawTopic.instance : 0,
    field,
    unit,
    source,
    points,
    sampleRateHz: estimateSampleRateHz(points),
    missingRatio: sampleCount > 0 ? Number((missingCount / sampleCount).toFixed(4)) : 1,
  };
}

function makeTimeSignal(timeRange, rawTopics) {
  const rawTimes = rawTopics
    .flatMap((item) => (Array.isArray(item.timeS) ? item.timeS : []))
    .filter(isFiniteNumber);
  const uniqueTimes = Array.from(new Set(rawTimes.map((timeS) => Number(timeS.toFixed(6))))).sort(
    (a, b) => a - b,
  );
  const points = uniqueTimes.map((timeS) => [timeS, timeS]);

  if (!points.length && timeRange && isFiniteNumber(timeRange.endS)) {
    points.push([0, 0], [Number(timeRange.endS.toFixed(6)), Number(timeRange.endS.toFixed(6))]);
  }

  if (!points.length) return null;

  return {
    id: 'log.timeS',
    topic: 'ulog',
    instance: 0,
    field: 'timestamp',
    unit: 's',
    source: 'derived',
    points,
    sampleRateHz: estimateSampleRateHz(points),
    missingRatio: 0,
  };
}

function mapStandardSignals(rawSignalPayload) {
  const rawTopics = Array.isArray(rawSignalPayload?.rawTopics) ? rawSignalPayload.rawTopics : [];
  const signals = {};
  const signalMappingReport = [];
  const missingSignals = [];
  const timeSignal = makeTimeSignal(rawSignalPayload?.timeRange, rawTopics);

  if (timeSignal) {
    signals[timeSignal.id] = timeSignal;
    signalMappingReport.push(
      buildMappingReport({
        standardSignal: timeSignal.id,
        status: 'mapped',
        required: true,
        source: {
          topic: timeSignal.topic,
          instance: timeSignal.instance,
          field: timeSignal.field,
          source: timeSignal.source,
        },
        sampleCount: timeSignal.points.length,
        missingRatio: timeSignal.missingRatio,
      }),
    );
  } else {
    missingSignals.push(buildMissingSignal('log.timeS', true, 'no valid timestamp axis'));
    signalMappingReport.push(
      buildMappingReport({
        standardSignal: 'log.timeS',
        status: 'missing',
        required: true,
      }),
    );
  }

  for (const spec of STANDARD_SIGNAL_SPECS) {
    let signal = null;

    for (const candidate of spec.candidates) {
      const rawTopic = findRawTopic(rawTopics, candidate.topic);
      if (!rawTopic || !getFieldValues(rawTopic, candidate.field)) continue;
      signal = makeSignal({
        id: spec.id,
        rawTopic,
        field: candidate.field,
        unit: candidate.unit,
        source: 'raw',
        transform: candidate.transform,
      });
      if (signal) break;
    }

    if (signal) {
      signals[spec.id] = signal;
      signalMappingReport.push(
        buildMappingReport({
          standardSignal: spec.id,
          status: 'mapped',
          required: spec.required,
          source: {
            topic: signal.topic,
            instance: signal.instance,
            field: signal.field,
            source: signal.source,
          },
          sampleCount: signal.points.length,
          missingRatio: signal.missingRatio,
        }),
      );
    } else {
      missingSignals.push(buildMissingSignal(spec.id, spec.required));
      signalMappingReport.push(
        buildMappingReport({
          standardSignal: spec.id,
          status: 'missing',
          required: spec.required,
        }),
      );
    }
  }

  return {
    contractVersion: 'incident-analysis.v1.2',
    timeRange: rawSignalPayload?.timeRange || null,
    signals,
    signalMappingReport,
    missingSignals,
  };
}

function hasRequiredSignal(signals, id) {
  return REQUIRED_SIGNALS.has(id) && Array.isArray(signals?.[id]?.points) && signals[id].points.length > 0;
}

module.exports = {
  mapStandardSignals,
  hasRequiredSignal,
};
