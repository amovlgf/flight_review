function formatSeconds(value) {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(2)} s` : '-';
}

function formatBoolean(value) {
  if (value === true) return '是';
  if (value === false) return '否';
  return '-';
}

function formatModes(modeChanges) {
  const modes = (Array.isArray(modeChanges) ? modeChanges : [])
    .map((item) => item.mode)
    .filter(Boolean);
  return Array.from(new Set(modes)).join(', ') || '-';
}

function formatMissing(values) {
  return Array.isArray(values) && values.length > 0 ? values.join(', ') : '无';
}

function firstFailsafeEvent(failsafe) {
  return Array.isArray(failsafe?.events) && failsafe.events.length > 0 ? failsafe.events[0] : null;
}

function generateFlightSummaryMarkdown({ fileName, summary, phases, flightStatus, dataGate }) {
  const failsafe = flightStatus?.failsafe || {};
  const estimator = flightStatus?.estimator || {};
  const firstFailsafe = firstFailsafeEvent(failsafe);
  const phaseRows = (Array.isArray(phases) ? phases : []).map(
    (phase) =>
      `| ${phase.name} | ${formatSeconds(phase.startS)} | ${formatSeconds(phase.endS)} | ${formatSeconds(
        phase.durationS,
      )} | ${formatModes(phase.modeChanges)} |`,
  );
  const statusChanges = [
    ...(Array.isArray(failsafe.mainChanges) ? failsafe.mainChanges : []),
    ...(Array.isArray(estimator.changes)
      ? estimator.changes.slice(0, 6).map((item) => `${item.signal} @ ${formatSeconds(item.timeS)} = ${item.value}`)
      : []),
  ];

  return [
    '# 飞行日志简短报告',
    '',
    '## 1. 日志基本信息',
    '',
    `- 文件名：${fileName || '-'}`,
    `- 日志总时长：${formatSeconds(summary?.totalDurationS)}`,
    `- 解锁时间：${formatSeconds(summary?.armedAtS)}`,
    `- 起飞时间：${formatSeconds(summary?.takeoffAtS)}`,
    `- 降落时间：${formatSeconds(summary?.landingAtS)}`,
    `- 是否触发故障保护：${formatBoolean(summary?.failsafeTriggered)}`,
    '',
    '## 2. 飞行阶段',
    '',
    '| 阶段 | 开始时间 | 结束时间 | 持续时间 | 飞行模式 |',
    '|---|---:|---:|---:|---|',
    ...(phaseRows.length > 0 ? phaseRows : ['| - | - | - | - | - |']),
    '',
    '## 3. 飞行状态',
    '',
    '### 3.1 故障保护状态',
    '',
    `- 是否触发 failsafe：${formatBoolean(failsafe.triggered)}`,
    `- 触发时间：${formatSeconds(firstFailsafe?.startS)}`,
    `- 结束时间：${formatSeconds(firstFailsafe?.endS)}`,
    `- 关联飞行阶段：${firstFailsafe?.phaseName || '-'}`,
    `- 关联飞行模式：${firstFailsafe?.mode || '-'}`,
    `- 主要状态变化：${statusChanges.length > 0 ? statusChanges.join('; ') : '-'}`,
    '',
    '### 3.2 传感器融合状态',
    '',
    `- EKF / estimator 状态：${estimator.status || '-'}`,
    `- 本地位置是否有效：${formatBoolean(estimator.localPositionValid)}`,
    `- 全局位置是否有效：${formatBoolean(estimator.globalPositionValid)}`,
    `- GPS 状态：${estimator.gpsStatus || '-'}`,
    `- 高度源状态：${estimator.heightSource || '-'}`,
    `- 主要状态变化：${Array.isArray(estimator.changes) && estimator.changes.length > 0 ? estimator.changes
      .slice(0, 8)
      .map((item) => `${item.signal} @ ${formatSeconds(item.timeS)} = ${item.value}`)
      .join('; ') : '-'}`,
    '',
    '## 4. 数据限制',
    '',
    `- 缺失字段：${formatMissing([...(dataGate?.missingRequired || []), ...(dataGate?.missingOptional || [])])}`,
    `- 因数据缺失无法分析的内容：${formatMissing(dataGate?.limitations)}`,
    '',
    '## 5. 工程师备注',
    '',
    '本报告只整理日志中的飞行阶段、飞行模式、故障保护状态和传感器融合状态，不直接判断根因，不输出硬件故障结论，不提供 PID 参数建议。',
  ].join('\n');
}

module.exports = {
  generateFlightSummaryMarkdown,
};
