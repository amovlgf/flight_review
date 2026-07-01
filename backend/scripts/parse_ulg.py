import json
import math
import sys

from pyulog import ULog

NAV_STATE_NAME_MAP = {
    0: "MANUAL",
    1: "ALTCTL",
    2: "POSCTL",
    3: "AUTO_MISSION",
    4: "AUTO_LOITER",
    5: "AUTO_RTL",
    6: "ACRO",
    7: "OFFBOARD",
    8: "STABILIZED",
    9: "AUTO_TAKEOFF",
    10: "AUTO_LAND",
    11: "AUTO_FOLLOW_TARGET",
    12: "AUTO_PRECLAND",
    13: "ORBIT",
    14: "AUTO_VTOL_TAKEOFF",
    15: "EXTERNAL1",
    16: "EXTERNAL2",
    17: "EXTERNAL3",
    18: "EXTERNAL4",
    19: "EXTERNAL5",
    20: "EXTERNAL6",
    21: "EXTERNAL7",
    22: "EXTERNAL8",
    23: "DESCEND",
    24: "TERMINATION",
}

NAV_STATE_COLOR_MAP = {
    "MANUAL": "#d62728",
    "ALTCTL": "#bcbd22",
    "POSCTL": "#2ca02c",
    "AUTO_MISSION": "#9467bd",
    "AUTO_LOITER": "#9467bd",
    "AUTO_RTL": "#9467bd",
    "ACRO": "#808000",
    "OFFBOARD": "#17becf",
    "STABILIZED": "#1f77b4",
    "AUTO_TAKEOFF": "#9467bd",
    "AUTO_LAND": "#9467bd",
    "AUTO_FOLLOW_TARGET": "#9467bd",
    "AUTO_PRECLAND": "#9467bd",
    "ORBIT": "#9467bd",
    "AUTO_VTOL_TAKEOFF": "#9467bd",
    "EXTERNAL1": "#e377c2",
    "EXTERNAL2": "#e377c2",
    "EXTERNAL3": "#e377c2",
    "EXTERNAL4": "#e377c2",
    "EXTERNAL5": "#e377c2",
    "EXTERNAL6": "#e377c2",
    "EXTERNAL7": "#e377c2",
    "EXTERNAL8": "#e377c2",
    "DESCEND": "#9467bd",
    "TERMINATION": "#7f7f7f",
    "UNKNOWN": "#9ca3af",
}

SHORT_MODE_SEGMENT_THRESHOLD_S = 1.0

PX4_ARMED_STATE_VALUES = {2, 5}

ACTUAL_QUATERNION_FIELD_CANDIDATES = {
    "q0": ["q[0]", "q.00", "q0"],
    "q1": ["q[1]", "q.01", "q1"],
    "q2": ["q[2]", "q.02", "q2"],
    "q3": ["q[3]", "q.03", "q3"],
}

SETPOINT_QUATERNION_FIELD_CANDIDATES = {
    "q0": ["q_d[0]", "q_d.00", "q_d0"],
    "q1": ["q_d[1]", "q_d.01", "q_d1"],
    "q2": ["q_d[2]", "q_d.02", "q_d2"],
    "q3": ["q_d[3]", "q_d.03", "q_d3"],
}

ACTUAL_EULER_FIELD_CANDIDATES = {
    "roll": ["roll"],
    "pitch": ["pitch"],
    "yaw": ["yaw"],
}

SETPOINT_EULER_FIELD_CANDIDATES = {
    "roll": ["roll_body", "roll"],
    "pitch": ["pitch_body", "pitch"],
    "yaw": ["yaw_body", "yaw"],
}

TUNING_PARAMETER_NAMES = [
    "MC_ROLLRATE_P",
    "MC_ROLLRATE_I",
    "MC_ROLLRATE_D",
    "MC_RR_INT_LIM",
    "MC_ROLLRATE_FF",
    "MC_ROLLRATE_K",
    "MC_PITCHRATE_P",
    "MC_PITCHRATE_I",
    "MC_PITCHRATE_D",
    "MC_PR_INT_LIM",
    "MC_PITCHRATE_FF",
    "MC_PITCHRATE_K",
    "MC_YAWRATE_P",
    "MC_YAWRATE_I",
    "MC_YAWRATE_D",
    "MC_YR_INT_LIM",
    "MC_YAWRATE_FF",
    "MC_YAWRATE_K",
    "MC_ROLL_P",
    "MC_PITCH_P",
    "MC_YAW_P",
    "MC_YAW_WEIGHT",
    "MC_ROLLRATE_MAX",
    "MC_PITCHRATE_MAX",
    "MC_YAWRATE_MAX",
    "MC_REF_W_N",
    "MC_REF_FF",
    "MC_REF_FF_MAX",
    "MPC_XY_VEL_P_ACC",
    "MPC_XY_VEL_I_ACC",
    "MPC_XY_VEL_D_ACC",
    "MPC_Z_VEL_P_ACC",
    "MPC_Z_VEL_I_ACC",
    "MPC_Z_VEL_D_ACC",
    "MPC_XY_P",
    "MPC_Z_P",
]


def normalize_time_us(timestamp_array):
    if timestamp_array is None or len(timestamp_array) == 0:
        return []
    start = float(timestamp_array[0])
    return [round((float(ts) - start) / 1_000_000.0, 3) for ts in timestamp_array]


def find_dataset(ulog, names):
    for ds in ulog.data_list:
        if ds.name in names:
            return ds
    return None


def find_datasets(ulog, names):
    result = []
    name_set = set(names)
    for ds in ulog.data_list:
        if ds.name in name_set:
            result.append(ds)
    return result


def build_series(ds, time_field, value_field):
    data = ds.data
    if time_field not in data or value_field not in data:
        return []

    xs = normalize_time_us(data[time_field])
    ys = data[value_field]
    points = []
    for i in range(min(len(xs), len(ys))):
        y = float(ys[i])
        if math.isnan(y) or math.isinf(y):
            continue
        points.append([xs[i], round(y, 3)])
    return points


def find_first_existing_field(data, candidate_names):
    for field_name in candidate_names:
        if field_name in data:
            return field_name
    return None


def resolve_quaternion_fields(data, field_candidates):
    resolved = {}
    for key, candidate_names in field_candidates.items():
        field_name = find_first_existing_field(data, candidate_names)
        if not field_name:
            return None
        resolved[key] = field_name
    return resolved


def quaternion_to_euler_px4(q0, q1, q2, q3):
    norm = math.sqrt(q0 * q0 + q1 * q1 + q2 * q2 + q3 * q3)
    if norm <= 1e-9:
        return None

    w = q0 / norm
    x = q1 / norm
    y = q2 / norm
    z = q3 / norm

    sinr_cosp = 2.0 * (w * x + y * z)
    cosr_cosp = 1.0 - 2.0 * (x * x + y * y)
    roll = math.atan2(sinr_cosp, cosr_cosp)

    sinp = 2.0 * (w * y - z * x)
    pitch = math.asin(max(-1.0, min(1.0, sinp)))

    siny_cosp = 2.0 * (w * z + x * y)
    cosy_cosp = 1.0 - 2.0 * (y * y + z * z)
    yaw = math.atan2(siny_cosp, cosy_cosp)

    return roll, pitch, yaw


def derive_speed_from_local_position(ds):
    data = ds.data
    if "timestamp" not in data:
        return []
    if not all(k in data for k in ("vx", "vy", "vz")):
        return []

    xs = normalize_time_us(data["timestamp"])
    points = []
    for i in range(len(xs)):
        vx = float(data["vx"][i])
        vy = float(data["vy"][i])
        vz = float(data["vz"][i])
        speed = math.sqrt(vx * vx + vy * vy + vz * vz)
        if math.isnan(speed) or math.isinf(speed):
            continue
        points.append([xs[i], round(speed, 3)])
    return points


def append_if_exists(series_list, data, field, display_name, unit, transform=None):
    if field not in data or "timestamp" not in data:
        return
    xs = normalize_time_us(data["timestamp"])
    ys = data[field]
    points = []
    for i in range(min(len(xs), len(ys))):
        y = float(ys[i])
        if transform:
            y = transform(y)
        if math.isnan(y) or math.isinf(y):
            continue
        points.append([xs[i], round(y, 3)])
    if points:
        series_list.append({"name": display_name, "unit": unit, "points": points})


def append_prefixed_fields(series_list, data, field_prefixes, unit):
    if "timestamp" not in data:
        return
    for field_name in data.keys():
        if any(field_name.startswith(prefix) for prefix in field_prefixes):
            append_if_exists(series_list, data, field_name, field_name, unit)


def append_euler_triplet_if_exists(series_list, data, field_candidates, name_map):
    if "timestamp" not in data:
        return False

    appended = False
    for axis, candidate_names in field_candidates.items():
        field_name = find_first_existing_field(data, candidate_names)
        if not field_name:
            continue
        append_if_exists(
            series_list,
            data,
            field_name,
            name_map[axis],
            "deg",
            lambda y: math.degrees(y),
        )
        appended = appended or any(item["name"] == name_map[axis] for item in series_list)

    return appended


def is_numeric_series(values):
    if values is None or len(values) == 0:
        return False
    for value in values:
        try:
            sample = float(value)
        except Exception:
            continue
        if not math.isnan(sample) and not math.isinf(sample):
            return True
    return False


def has_truthy_sample(values):
    if values is None or len(values) == 0:
        return False
    for value in values:
        try:
            numeric_value = float(value)
        except Exception:
            continue
        if math.isnan(numeric_value) or math.isinf(numeric_value):
            continue
        if numeric_value > 0.5:
            return True
    return False


def has_armed_state_sample(values):
    if values is None or len(values) == 0:
        return False
    for value in values:
        try:
            numeric_value = int(round(float(value)))
        except Exception:
            continue
        if numeric_value in PX4_ARMED_STATE_VALUES:
            return True
    return False


def get_state_duration_s(data, state_field, is_unlocked_state):
    if "timestamp" not in data or state_field not in data:
        return None

    timestamps = data["timestamp"]
    states = data[state_field]
    sample_count = min(len(timestamps), len(states))
    if sample_count < 2:
        try:
            return 0.0 if sample_count == 1 and is_unlocked_state(states[0]) else None
        except Exception:
            return None

    duration_us = 0.0
    for i in range(sample_count - 1):
        try:
            is_unlocked = is_unlocked_state(states[i])
        except Exception:
            is_unlocked = False
        if not is_unlocked:
            continue
        try:
            start_us = float(timestamps[i])
            end_us = float(timestamps[i + 1])
        except Exception:
            continue
        if math.isnan(start_us) or math.isnan(end_us):
            continue
        if end_us > start_us:
            duration_us += end_us - start_us

    return round(duration_us / 1_000_000.0, 3)


def build_unlock_summary(vehicle_status_ds, actuator_armed_ds):
    sources = []
    flight_time_candidates = []

    if actuator_armed_ds:
        data = actuator_armed_ds.data
        # PX4 actuator_armed.armed is the direct motor unlock/armed flag.
        if "armed" in data and has_truthy_sample(data["armed"]):
            duration_s = get_state_duration_s(data, "armed", lambda value: float(value) > 0.5)
            source = {"topic": "actuator_armed", "field": "armed"}
            if duration_s is not None:
                source["flightTimeS"] = duration_s
                flight_time_candidates.append(duration_s)
            sources.append(source)

    if vehicle_status_ds:
        data = vehicle_status_ds.data
        # PX4 vehicle_status.arming_state uses 2 for ARMED and 5 for in-air restore.
        if "arming_state" in data and has_armed_state_sample(data["arming_state"]):
            duration_s = get_state_duration_s(
                data,
                "arming_state",
                lambda value: int(round(float(value))) in PX4_ARMED_STATE_VALUES,
            )
            source = {"topic": "vehicle_status", "field": "arming_state"}
            if duration_s is not None:
                source["flightTimeS"] = duration_s
                flight_time_candidates.append(duration_s)
            sources.append(source)

    return {
        "hasUnlockedFlight": len(sources) > 0,
        "sources": sources,
        "flightTimeS": max(flight_time_candidates) if flight_time_candidates else None,
    }


def parse_unlock_summary(file_path):
    ulog = ULog(
        file_path,
        message_name_filter_list=["actuator_armed", "vehicle_status"],
    )
    vehicle_status = find_dataset(ulog, ["vehicle_status"])
    actuator_armed = find_dataset(ulog, ["actuator_armed"])
    print(json.dumps({"unlockSummary": build_unlock_summary(vehicle_status, actuator_armed)}))


RAW_SIGNAL_TOPIC_NAMES = [
    "actuator_armed",
    "battery_status",
    "battery_status_0",
    "estimator_selector_status",
    "estimator_status",
    "estimator_status_flags",
    "failsafe_flags",
    "mode_completed",
    "position_setpoint_triplet",
    "takeoff_status",
    "trajectory_setpoint",
    "vehicle_command",
    "vehicle_command_ack",
    "vehicle_land_detected",
    "vehicle_local_position",
    "vehicle_local_position_setpoint",
    "vehicle_status",
    "vehicle_visual_odometry",
    "vehicle_odometry",
]


def get_dataset_instance(ds):
    if hasattr(ds, "multi_id"):
        try:
            return int(ds.multi_id)
        except Exception:
            return 0
    return 0


def get_global_time_range(datasets):
    timestamps = []
    for ds in datasets:
        data = ds.data
        if "timestamp" not in data:
            continue
        for value in data["timestamp"]:
            try:
                timestamp = float(value)
            except Exception:
                continue
            if math.isnan(timestamp) or math.isinf(timestamp):
                continue
            timestamps.append(timestamp)

    if not timestamps:
        return None

    return min(timestamps), max(timestamps)


def normalize_time_us_from_start(timestamp_array, start_us):
    if timestamp_array is None or len(timestamp_array) == 0:
        return []
    result = []
    for ts in timestamp_array:
        try:
            timestamp = float(ts)
        except Exception:
            result.append(None)
            continue
        if math.isnan(timestamp) or math.isinf(timestamp):
            result.append(None)
            continue
        result.append(round((timestamp - start_us) / 1_000_000.0, 6))
    return result


def to_json_number(value):
    try:
        numeric_value = float(value)
    except Exception:
        return None
    if math.isnan(numeric_value) or math.isinf(numeric_value):
        return None
    return numeric_value


def build_parameter_profile(ulog, start_us=None):
    initial_parameters = {}
    source_parameters = getattr(ulog, "initial_parameters", {}) or {}
    for name in TUNING_PARAMETER_NAMES:
        value = to_json_number(source_parameters.get(name))
        if value is not None:
            initial_parameters[name] = value

    changed_parameters = []
    for item in getattr(ulog, "changed_parameters", []) or []:
        if len(item) < 3:
            continue
        timestamp_us, name, value = item[0], item[1], item[2]
        if name not in TUNING_PARAMETER_NAMES:
            continue
        numeric_value = to_json_number(value)
        numeric_timestamp = to_json_number(timestamp_us)
        if numeric_value is None or numeric_timestamp is None:
            continue
        if start_us is not None:
            time_s = (numeric_timestamp - start_us) / 1_000_000.0
        else:
            time_s = numeric_timestamp / 1_000_000.0
        changed_parameters.append(
            {
                "timeS": round(time_s, 6),
                "timestampUs": numeric_timestamp,
                "name": name,
                "value": numeric_value,
            }
        )

    changed_parameters.sort(key=lambda item: item["timeS"])

    return {
        "initialParameters": initial_parameters,
        "changedParameters": changed_parameters,
    }


def serialize_numeric_field(values):
    serialized = []
    for value in values:
        try:
            numeric_value = float(value)
        except Exception:
            serialized.append(None)
            continue
        if math.isnan(numeric_value) or math.isinf(numeric_value):
            serialized.append(None)
            continue
        serialized.append(numeric_value)
    return serialized


def parse_raw_signals(file_path):
    ulog = ULog(file_path, message_name_filter_list=RAW_SIGNAL_TOPIC_NAMES)
    datasets = [
        ds
        for ds in ulog.data_list
        if ds.name in RAW_SIGNAL_TOPIC_NAMES and "timestamp" in ds.data
    ]
    time_range = get_global_time_range(datasets)

    if not time_range:
        print(
            json.dumps(
                {
                    "dataSource": "px4-raw-signals",
                    "timeRange": None,
                    "rawTopics": [],
                }
            )
        )
        return

    start_us, end_us = time_range
    raw_topics = []
    ignored_exact = {"timestamp", "timestamp_sample"}
    ignored_prefixes = ("_padding",)

    for ds in datasets:
        data = ds.data
        timestamps = normalize_time_us_from_start(data["timestamp"], start_us)
        fields = {}
        sample_count = len(timestamps)

        for field_name in sorted(data.keys()):
            if field_name in ignored_exact:
                continue
            if any(field_name.startswith(prefix) for prefix in ignored_prefixes):
                continue

            values = data[field_name]
            if not is_numeric_series(values):
                continue
            field_values = serialize_numeric_field(values)
            fields[field_name] = field_values[:sample_count]

        raw_topics.append(
            {
                "topic": ds.name,
                "instance": get_dataset_instance(ds),
                "timeS": timestamps,
                "fields": fields,
            }
        )

    payload = {
        "dataSource": "px4-raw-signals",
        "timeRange": {
            "startS": 0,
            "endS": round((end_us - start_us) / 1_000_000.0, 6),
            "startTimestampUs": start_us,
            "endTimestampUs": end_us,
        },
        "rawTopics": raw_topics,
    }
    print(json.dumps(payload))


def append_generic_topic(topic_charts, used_topics, ds, max_fields=24):
    if not ds:
        return
    data = ds.data
    if "timestamp" not in data:
        return

    ignored_prefixes = ("_padding",)
    ignored_exact = {"timestamp", "timestamp_sample"}

    series = []
    added = 0
    for field_name in sorted(data.keys()):
        if field_name in ignored_exact:
            continue
        if any(field_name.startswith(prefix) for prefix in ignored_prefixes):
            continue
        if added >= max_fields:
            break
        values = data[field_name]
        if not is_numeric_series(values):
            continue
        append_if_exists(series, data, field_name, field_name, "")
        if series:
            added += 1

    if series:
        title = ds.name if not hasattr(ds, "multi_id") else f"{ds.name}_{ds.multi_id}"
        topic_charts.append({"topic": title, "title": title, "series": series})
        used_topics.append(title)


def append_vehicle_attitude(topic_charts, used_topics, attitude_ds):
    if not attitude_ds:
        return

    series = []
    data = attitude_ds.data
    append_euler_triplet_if_exists(
        series,
        data,
        ACTUAL_EULER_FIELD_CANDIDATES,
        {"roll": "roll", "pitch": "pitch", "yaw": "yaw"},
    )
    quaternion_fields = resolve_quaternion_fields(data, ACTUAL_QUATERNION_FIELD_CANDIDATES)
    if quaternion_fields and not any(
        item["name"] in ("roll", "pitch", "yaw") for item in series
    ):
        append_if_exists(series, data, quaternion_fields["q0"], "q[0]", "")
        append_if_exists(series, data, quaternion_fields["q1"], "q[1]", "")
        append_if_exists(series, data, quaternion_fields["q2"], "q[2]", "")
        append_if_exists(series, data, quaternion_fields["q3"], "q[3]", "")

    if quaternion_fields and "timestamp" in data and not any(
        item["name"] in ("roll", "pitch", "yaw") for item in series
    ):
        xs = normalize_time_us(data["timestamp"])
        roll_points = []
        pitch_points = []
        yaw_points = []
        for i in range(len(xs)):
            q0 = float(data[quaternion_fields["q0"]][i])
            q1 = float(data[quaternion_fields["q1"]][i])
            q2 = float(data[quaternion_fields["q2"]][i])
            q3 = float(data[quaternion_fields["q3"]][i])

            euler = quaternion_to_euler_px4(q0, q1, q2, q3)
            if not euler:
                continue
            roll, pitch, yaw = euler

            roll_points.append([xs[i], round(math.degrees(roll), 3)])
            pitch_points.append([xs[i], round(math.degrees(pitch), 3)])
            yaw_points.append([xs[i], round(math.degrees(yaw), 3)])

        series.append({"name": "roll", "unit": "deg", "points": roll_points})
        series.append({"name": "pitch", "unit": "deg", "points": pitch_points})
        series.append({"name": "yaw", "unit": "deg", "points": yaw_points})

    if series:
        topic_charts.append(
            {
                "topic": "vehicle_attitude",
                "title": "vehicle_attitude",
                "series": series,
            }
        )
        used_topics.append("vehicle_attitude")


def append_vehicle_gps(topic_charts, used_topics, gps_ds):
    if not gps_ds:
        return

    series = []
    data = gps_ds.data
    append_if_exists(series, data, "lat", "lat", "deg", lambda y: y / 1e7)
    append_if_exists(series, data, "lon", "lon", "deg", lambda y: y / 1e7)
    append_if_exists(series, data, "alt", "alt", "m", lambda y: y / 1e3)
    append_if_exists(series, data, "alt_ellipsoid", "alt_ellipsoid", "m", lambda y: y / 1e3)
    append_if_exists(series, data, "eph", "eph", "m")
    append_if_exists(series, data, "epv", "epv", "m")
    append_if_exists(series, data, "fix_type", "fix_type", "")
    append_if_exists(series, data, "satellites_used", "satellites_used", "")
    append_if_exists(series, data, "vel_m_s", "vel_m_s", "m/s")
    append_if_exists(series, data, "vel_n_m_s", "vel_n_m_s", "m/s")
    append_if_exists(series, data, "vel_e_m_s", "vel_e_m_s", "m/s")
    append_if_exists(series, data, "vel_d_m_s", "vel_d_m_s", "m/s")
    if series:
        topic_charts.append(
            {
                "topic": "vehicle_gps_position",
                "title": "vehicle_gps_position",
                "series": series,
            }
        )
        used_topics.append("vehicle_gps_position")


def append_actuator_outputs(topic_charts, used_topics, datasets):
    if not datasets:
        return

    for ds in datasets:
        series = []
        data = ds.data
        append_prefixed_fields(series, data, ["output["], "")
        append_if_exists(series, data, "noutputs", "noutputs", "")
        if not series:
            continue

        topic_name = "actuator_outputs"
        title = "actuator_outputs"
        if hasattr(ds, "multi_id"):
            topic_name = f"actuator_outputs_{ds.multi_id}"
            title = topic_name

        topic_charts.append(
            {
                "topic": topic_name,
                "title": title,
                "series": series,
            }
        )
        used_topics.append(topic_name)


def build_mode_segments(vehicle_status_ds):
    if not vehicle_status_ds:
        return []

    data = vehicle_status_ds.data
    if "timestamp" not in data or "nav_state" not in data:
        return []

    times = normalize_time_us(data["timestamp"])
    nav_states = data["nav_state"]
    if not times or len(times) != len(nav_states):
        return []

    segments = []
    current_mode_code = int(nav_states[0])
    current_start = times[0]

    def make_segment(start, end, mode_code):
        mode_name = NAV_STATE_NAME_MAP.get(mode_code, "UNKNOWN")
        duration_s = max(0, end - start)
        return {
            "start": start,
            "end": end,
            "durationS": duration_s,
            "mode": mode_name,
            "mode_code": mode_code,
            "color": NAV_STATE_COLOR_MAP.get(mode_name, NAV_STATE_COLOR_MAP["UNKNOWN"]),
            "isShortMode": duration_s < SHORT_MODE_SEGMENT_THRESHOLD_S,
        }

    for i in range(1, len(times)):
        mode_code = int(nav_states[i])
        if mode_code != current_mode_code:
            segments.append(make_segment(current_start, times[i], current_mode_code))
            current_mode_code = mode_code
            current_start = times[i]

    segments.append(make_segment(current_start, times[-1], current_mode_code))

    return segments


def append_vehicle_attitude_setpoint(topic_charts, used_topics, ds):
    if not ds:
        return

    data = ds.data
    if "timestamp" not in data:
        return

    series = []
    quaternion_fields = resolve_quaternion_fields(
        data, SETPOINT_QUATERNION_FIELD_CANDIDATES
    )
    append_euler_triplet_if_exists(
        series,
        data,
        SETPOINT_EULER_FIELD_CANDIDATES,
        {"roll": "roll_sp", "pitch": "pitch_sp", "yaw": "yaw_sp"},
    )
    append_if_exists(
        series,
        data,
        "yaw_sp_move_rate",
        "yaw_sp_move_rate",
        "deg/s",
        lambda y: math.degrees(y),
    )

    # If roll/pitch/yaw are unavailable, derive expected Euler angles from q_d.
    if (
        not any(item["name"] == "roll_sp" for item in series)
        and quaternion_fields
    ):
        xs = normalize_time_us(data["timestamp"])
        roll_points = []
        pitch_points = []
        yaw_points = []
        for i in range(len(xs)):
            q0 = float(data[quaternion_fields["q0"]][i])
            q1 = float(data[quaternion_fields["q1"]][i])
            q2 = float(data[quaternion_fields["q2"]][i])
            q3 = float(data[quaternion_fields["q3"]][i])

            euler = quaternion_to_euler_px4(q0, q1, q2, q3)
            if not euler:
                continue
            roll, pitch, yaw = euler

            roll_points.append([xs[i], round(math.degrees(roll), 3)])
            pitch_points.append([xs[i], round(math.degrees(pitch), 3)])
            yaw_points.append([xs[i], round(math.degrees(yaw), 3)])

        series.append({"name": "roll_sp", "unit": "deg", "points": roll_points})
        series.append({"name": "pitch_sp", "unit": "deg", "points": pitch_points})
        series.append({"name": "yaw_sp", "unit": "deg", "points": yaw_points})

    if series:
        topic_charts.append(
            {
                "topic": "vehicle_attitude_setpoint",
                "title": "vehicle_attitude_setpoint",
                "series": series,
            }
        )
        used_topics.append("vehicle_attitude_setpoint")


def main():
    if len(sys.argv) < 2:
        raise RuntimeError("FILE_PATH_REQUIRED")

    if sys.argv[1] == "--unlock-summary":
        if len(sys.argv) < 3:
            raise RuntimeError("FILE_PATH_REQUIRED")
        parse_unlock_summary(sys.argv[2])
        return

    if sys.argv[1] == "--raw-signals":
        if len(sys.argv) < 3:
            raise RuntimeError("FILE_PATH_REQUIRED")
        parse_raw_signals(sys.argv[2])
        return

    file_path = sys.argv[1]
    ulog = ULog(file_path, message_name_filter_list=None)

    local_position = find_dataset(ulog, ["vehicle_local_position"])
    battery_status = find_dataset(ulog, ["battery_status", "battery_status_0"])
    vehicle_attitude = find_dataset(ulog, ["vehicle_attitude"])
    vehicle_attitude_setpoint = find_dataset(ulog, ["vehicle_attitude_setpoint"])
    vehicle_gps = find_dataset(ulog, ["vehicle_gps_position"])
    vehicle_status = find_dataset(ulog, ["vehicle_status"])
    actuator_armed = find_dataset(ulog, ["actuator_armed"])
    actuator_outputs_list = find_datasets(ulog, ["actuator_outputs"])
    generic_topic_names = [
        "vehicle_angular_velocity",
        "vehicle_acceleration",
        "vehicle_visual_odometry",
        "vehicle_rates_setpoint",
        "vehicle_local_position_setpoint",
        "vehicle_air_data",
        "vehicle_status",
        "estimator_status",
        "estimator_innovations",
        "estimator_innovation_variances",
        "estimator_innovation_test_ratios",
        "rate_ctrl_status",
        "actuator_motors",
        "actuator_controls_0",
        "actuator_controls_3",
        "sensor_accel",
        "sensor_gyro",
        "sensor_baro",
        "sensor_combined",
        "sensor_mag",
        "input_rc",
        "manual_control_setpoint",
        "trajectory_setpoint",
    ]
    generic_datasets = find_datasets(ulog, generic_topic_names)

    topic_charts = []
    used_topics = []

    if local_position:
        local_series = []
        data = local_position.data
        append_if_exists(local_series, data, "x", "x", "m")
        append_if_exists(local_series, data, "y", "y", "m")
        append_if_exists(local_series, data, "z", "z", "m")
        append_if_exists(local_series, data, "z", "altitude", "m", lambda y: -y)
        append_if_exists(local_series, data, "vx", "vx", "m/s")
        append_if_exists(local_series, data, "vy", "vy", "m/s")
        append_if_exists(local_series, data, "vz", "vz", "m/s")
        speed_points = derive_speed_from_local_position(local_position)
        if speed_points:
            local_series.append({"name": "speed", "unit": "m/s", "points": speed_points})
        if local_series:
            topic_charts.append(
                {
                    "topic": "vehicle_local_position",
                    "title": "vehicle_local_position",
                    "series": local_series,
                }
            )
            used_topics.append("vehicle_local_position")

    if battery_status:
        battery_series = []
        data = battery_status.data
        append_if_exists(battery_series, data, "voltage_v", "voltage_v", "V")
        append_if_exists(battery_series, data, "current_a", "current_a", "A")
        append_if_exists(battery_series, data, "remaining", "remaining", "%", lambda y: y * 100.0)
        append_if_exists(battery_series, data, "temperature", "temperature", "C")
        append_if_exists(battery_series, data, "discharged_mah", "discharged_mah", "mAh")
        if battery_series:
            topic_charts.append(
                {
                    "topic": "battery_status",
                    "title": "battery_status",
                    "series": battery_series,
                }
            )
            used_topics.append("battery_status")

    append_vehicle_attitude(topic_charts, used_topics, vehicle_attitude)
    append_vehicle_attitude_setpoint(topic_charts, used_topics, vehicle_attitude_setpoint)
    append_vehicle_gps(topic_charts, used_topics, vehicle_gps)
    append_actuator_outputs(topic_charts, used_topics, actuator_outputs_list)
    for ds in generic_datasets:
        append_generic_topic(topic_charts, used_topics, ds)

    mode_segments = build_mode_segments(vehicle_status)
    unlock_summary = build_unlock_summary(vehicle_status, actuator_armed)
    global_time_range = get_global_time_range(ulog.data_list)
    parameter_profile = build_parameter_profile(
        ulog,
        global_time_range[0] if global_time_range else None,
    )

    if not topic_charts:
        payload = {
            "dataSource": "px4-topics-derived",
            "topicCharts": [],
            "usedTopics": [],
            "modeSegments": mode_segments,
            "unlockSummary": unlock_summary,
            "parameterProfile": parameter_profile,
        }
        print(json.dumps(payload))
        return

    payload = {
        "dataSource": "px4-topics-derived",
        "usedTopics": used_topics,
        "topicCharts": topic_charts,
        "modeSegments": mode_segments,
        "unlockSummary": unlock_summary,
        "parameterProfile": parameter_profile,
    }
    print(json.dumps(payload))


if __name__ == "__main__":
    main()
