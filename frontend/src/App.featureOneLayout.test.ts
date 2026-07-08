import { describe, expect, it } from 'vitest'
import appSource from './App.tsx?raw'

describe('feature one layout boundaries', () => {
  it('shows feature one without changing feature two and feature three boundaries', () => {
    expect(appSource).toContain('功能 1')
    expect(appSource).toContain('FlightSummaryPage')
    expect(appSource).toContain("viewMode === 'flight-summary'")
    expect(appSource).not.toContain('evidence-chart-section')
    expect(appSource).not.toContain('<h3>证据图表</h3>')
    expect(appSource).not.toContain('evidenceTopicCharts')
    expect(appSource).not.toContain('<AdvancedRawDataPanel>')
    expect(appSource).toContain("viewMode === 'batch'")
    expect(appSource).toContain("viewMode === 'control-analysis'")
    expect(appSource).toContain('<BatchLogUpload />')
    expect(appSource).toContain('<ControlQualityPanel')
  })

  it('opens function three from the feature card through an entry file picker', () => {
    expect(appSource).toContain('controlAnalysisEntryFileInputRef')
    expect(appSource).toContain('handleRequestControlAnalysisLogs')
    expect(appSource).toContain(
      'controlAnalysisEntryFileInputRef.current?.click()',
    )
    expect(appSource).toContain('handleControlAnalysisEntryFileChange')
    expect(appSource).toContain('handleStartControlAnalysisFromFiles(files)')
    expect(appSource).toContain('onClick={handleRequestControlAnalysisLogs}')
  })

  it('keeps function three entry cancellation on the feature list', () => {
    const entryChangeSource = appSource.slice(
      appSource.indexOf('const handleControlAnalysisEntryFileChange'),
      appSource.indexOf('const handleStartControlAnalysisFromFiles'),
    )

    expect(entryChangeSource).toContain('if (files.length === 0)')
    expect(entryChangeSource).toContain('return')
    expect(entryChangeSource).not.toContain("setViewMode('control-analysis')")
  })

  it('keeps function three as an analysis-only page after entry selection', () => {
    const controlAnalysisPageSource = appSource.slice(
      appSource.indexOf("viewMode === 'control-analysis'"),
    )

    expect(controlAnalysisPageSource).toContain('control-analysis-page')
    expect(controlAnalysisPageSource).not.toContain(
      'handleChooseControlAnalysisFile',
    )
    expect(controlAnalysisPageSource).not.toContain(
      'handleUploadControlAnalysisLog',
    )
    expect(controlAnalysisPageSource).not.toContain('control-analysis-toolbar')
    expect(controlAnalysisPageSource).not.toContain('control-compare-selected')
    expect(controlAnalysisPageSource).not.toContain('选择日志文件')
    expect(controlAnalysisPageSource).not.toContain('上传并分析')
    expect(controlAnalysisPageSource).not.toContain('清空')
  })
})
