export type DiagnosticItem = {
  level: 'ok' | 'warning' | 'info'
  ruleCode: string
  title: string
  detail: string
}

type DiagnosticsPanelProps = {
  diagnostics: DiagnosticItem[]
}

function getDiagnosticZh(item: DiagnosticItem) {
  if (item.ruleCode === 'LOW_BATTERY') {
    return {
      title: '\u68c0\u6d4b\u5230\u7535\u6c60\u7535\u538b\u4e0b\u964d',
      detail: item.detail.replace('Minimum voltage', '\u6700\u4f4e\u7535\u538b'),
    }
  }
  if (item.ruleCode === 'BATTERY_NORMAL') {
    return {
      title: '\u7535\u6c60\u7535\u538b\u7a33\u5b9a',
      detail: item.detail.replace('Minimum voltage', '\u6700\u4f4e\u7535\u538b'),
    }
  }
  if (item.ruleCode === 'HIGH_SPEED') {
    return {
      title: '\u901f\u5ea6\u5cf0\u503c\u8d85\u8fc7\u9884\u671f\u8303\u56f4',
      detail: item.detail.replace('Peak speed', '\u901f\u5ea6\u5cf0\u503c'),
    }
  }
  if (item.ruleCode === 'SPEED_NORMAL') {
    return {
      title: '\u901f\u5ea6\u5904\u4e8e\u9884\u671f\u8303\u56f4',
      detail: item.detail.replace('Peak speed', '\u901f\u5ea6\u5cf0\u503c'),
    }
  }
  if (item.ruleCode === 'ALTITUDE_SUMMARY') {
    return {
      title: '\u9ad8\u5ea6\u6982\u89c8',
      detail: item.detail.replace('Maximum altitude', '\u6700\u5927\u9ad8\u5ea6'),
    }
  }

  return { title: item.title, detail: item.detail }
}

function DiagnosticsPanel({ diagnostics }: DiagnosticsPanelProps) {
  if (diagnostics.length === 0) return null

  return (
    <div className="diag-list">
      {diagnostics.map((item) => (
        <div key={item.ruleCode} className={`diag-item diag-${item.level}`}>
          <strong>{getDiagnosticZh(item).title}</strong>
          <p>{getDiagnosticZh(item).detail}</p>
        </div>
      ))}
    </div>
  )
}

export default DiagnosticsPanel
