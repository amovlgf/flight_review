import type { ReactNode } from 'react'

type AdvancedRawDataPanelProps = {
  children: ReactNode
}

function AdvancedRawDataPanel({ children }: AdvancedRawDataPanelProps) {
  return (
    <details className="advanced-raw-data-panel">
      <summary>
        <span>高级原始数据</span>
        <small>原始 topic 图表、诊断卡片和调试信息</small>
      </summary>
      <div className="advanced-raw-data-content">{children}</div>
    </details>
  )
}

export default AdvancedRawDataPanel
