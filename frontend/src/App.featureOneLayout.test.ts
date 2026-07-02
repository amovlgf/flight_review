import { describe, expect, it } from 'vitest'
import appSource from './App.tsx?raw'

describe('feature one layout boundaries', () => {
  it('keeps evidence charts inline instead of rendering a standalone evidence chart section', () => {
    expect(appSource).not.toContain('evidence-chart-section')
    expect(appSource).not.toContain('<h3>证据图表</h3>')
    expect(appSource).not.toContain('evidenceTopicCharts')
    expect(appSource).toContain('<AdvancedRawDataPanel>')
    expect(appSource).toContain("viewMode === 'batch'")
    expect(appSource).toContain("viewMode === 'control-analysis'")
  })
})
