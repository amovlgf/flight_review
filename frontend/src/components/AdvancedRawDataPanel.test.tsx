import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import AdvancedRawDataPanel from './AdvancedRawDataPanel'

describe('AdvancedRawDataPanel', () => {
  it('keeps raw topic charts in a collapsed advanced section by default', () => {
    const html = renderToStaticMarkup(
      <AdvancedRawDataPanel>
        <div>原始 topic 图表内容</div>
      </AdvancedRawDataPanel>,
    )

    expect(html).toContain('<details class="advanced-raw-data-panel">')
    expect(html).toContain('高级原始数据')
    expect(html).toContain('原始 topic 图表内容')
    expect(html).not.toContain('<details class="advanced-raw-data-panel" open')
  })
})
