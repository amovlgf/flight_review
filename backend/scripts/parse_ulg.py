import json
import math
import sys

from pyulog import ULog


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


def is_numeric_series(values):
    if values is None or len(values) == 0:
        return False
    try:
        sample = float(values[0])
    except Exception:
        return False
    return not (math.isnan(sample) or math.isinf(sample))


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
    append_if_exists(series, data, "q[0]", "q[0]", "")
    append_if_exists(series, data, "q[1]", "q[1]", "")
    append_if_exists(series, data, "q[2]", "q[2]", "")
    append_if_exists(series, data, "q[3]", "q[3]", "")

    if all(k in data for k in ("q[0]", "q[1]", "q[2]", "q[3]", "timestamp")):
        xs = normalize_time_us(data["timestamp"])
        roll_points = []
        pitch_points = []
        yaw_points = []
        for i in range(len(xs)):
            q0 = float(data["q[0]"][i])
            q1 = float(data["q[1]"][i])
            q2 = float(data["q[2]"][i])
            q3 = float(data["q[3]"][i])

            roll = math.atan2(2.0 * (q0 * q1 + q2 * q3), 1.0 - 2.0 * (q1 * q1 + q2 * q2))
            pitch = math.asin(max(-1.0, min(1.0, 2.0 * (q0 * q2 - q3 * q1))))
            yaw = math.atan2(2.0 * (q0 * q3 + q1 * q2), 1.0 - 2.0 * (q2 * q2 + q3 * q3))

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


def append_vehicle_attitude_setpoint(topic_charts, used_topics, ds):
    if not ds:
        return

    data = ds.data
    if "timestamp" not in data:
        return

    series = []
    append_if_exists(
        series, data, "roll_body", "roll_sp", "deg", lambda y: math.degrees(y)
    )
    append_if_exists(
        series, data, "pitch_body", "pitch_sp", "deg", lambda y: math.degrees(y)
    )
    append_if_exists(
        series, data, "yaw_body", "yaw_sp", "deg", lambda y: math.degrees(y)
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
        and all(k in data for k in ("q_d[0]", "q_d[1]", "q_d[2]", "q_d[3]"))
    ):
        xs = normalize_time_us(data["timestamp"])
        roll_points = []
        pitch_points = []
        yaw_points = []
        for i in range(len(xs)):
            q0 = float(data["q_d[0]"][i])
            q1 = float(data["q_d[1]"][i])
            q2 = float(data["q_d[2]"][i])
            q3 = float(data["q_d[3]"][i])

            roll = math.atan2(
                2.0 * (q0 * q1 + q2 * q3), 1.0 - 2.0 * (q1 * q1 + q2 * q2)
            )
            pitch = math.asin(max(-1.0, min(1.0, 2.0 * (q0 * q2 - q3 * q1))))
            yaw = math.atan2(
                2.0 * (q0 * q3 + q1 * q2), 1.0 - 2.0 * (q2 * q2 + q3 * q3)
            )

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

    file_path = sys.argv[1]
    ulog = ULog(file_path, message_name_filter_list=None)

    local_position = find_dataset(ulog, ["vehicle_local_position"])
    battery_status = find_dataset(ulog, ["battery_status", "battery_status_0"])
    vehicle_attitude = find_dataset(ulog, ["vehicle_attitude"])
    vehicle_attitude_setpoint = find_dataset(ulog, ["vehicle_attitude_setpoint"])
    vehicle_gps = find_dataset(ulog, ["vehicle_gps_position"])
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

    if not topic_charts:
        payload = {
            "dataSource": "px4-topics-derived",
            "topicCharts": [],
            "usedTopics": []
        }
        print(json.dumps(payload))
        return

    payload = {
        "dataSource": "px4-topics-derived",
        "usedTopics": used_topics,
        "topicCharts": topic_charts,
    }
    print(json.dumps(payload))


if __name__ == "__main__":
    main()
