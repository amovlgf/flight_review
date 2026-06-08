import { useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { batchAnalyzeLogFiles } from '../services/api'
import type { BatchAnalyzeLogsResponse } from '../types/log'

type BatchSortMode = 'logTime' | 'flightTime'

function BatchLogUpload() {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [result, setResult] = useState<BatchAnalyzeLogsResponse | null>(null)
  const [errorText, setErrorText] = useState('')
  const [sortMode, setSortMode] = useState<BatchSortMode>('logTime')

  const selectedFileNames = selectedFiles.map((file) => file.name)
  const unlockedLogDetails = useMemo(
    () =>
      result?.unlockedLogDetails && result.unlockedLogDetails.length > 0
        ? result.unlockedLogDetails
        : result?.unlockedLogs.map((fileName) => ({
            fileName,
            flightTimeS: null,
            logStartTimestampUs: null,
          })) ?? [],
    [result],
  )

  const sortedUnlockedLogDetails = useMemo(() => {
    return unlockedLogDetails
      .map((item, uploadIndex) => ({ ...item, uploadIndex }))
      .sort((a, b) => {
        if (sortMode === 'flightTime') {
          const aFlightTime =
            typeof a.flightTimeS === 'number' && Number.isFinite(a.flightTimeS)
              ? a.flightTimeS
              : -1
          const bFlightTime =
            typeof b.flightTimeS === 'number' && Number.isFinite(b.flightTimeS)
              ? b.flightTimeS
              : -1

          if (bFlightTime !== aFlightTime) {
            return bFlightTime - aFlightTime
          }

          return a.uploadIndex - b.uploadIndex
        }

        const aLogTime =
          typeof a.logStartTimestampUs === 'number' &&
          Number.isFinite(a.logStartTimestampUs) &&
          a.logStartTimestampUs > 0
            ? a.logStartTimestampUs
            : null
        const bLogTime =
          typeof b.logStartTimestampUs === 'number' &&
          Number.isFinite(b.logStartTimestampUs) &&
          b.logStartTimestampUs > 0
            ? b.logStartTimestampUs
            : null

        if (aLogTime !== null && bLogTime !== null && aLogTime !== bLogTime) {
          return aLogTime - bLogTime
        }

        return a.uploadIndex - b.uploadIndex
      })
  }, [sortMode, unlockedLogDetails])

  const formatFlightTime = (flightTimeS: number | null) => {
    if (typeof flightTimeS !== 'number' || !Number.isFinite(flightTimeS)) {
      return '--'
    }
    return `${flightTimeS.toFixed(1)} s`
  }

  const handleChooseFiles = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    setSelectedFiles(files)
    setResult(null)
    setErrorText('')
  }

  const handleAnalyze = async () => {
    if (selectedFiles.length === 0) {
      setErrorText(
        '\u8bf7\u5148\u9009\u62e9\u9700\u8981\u6279\u91cf\u89e3\u6790\u7684\u65e5\u5fd7\u6587\u4ef6\u3002',
      )
      return
    }

    try {
      setIsAnalyzing(true)
      setResult(null)
      setErrorText('')
      const batchResult = await batchAnalyzeLogFiles(selectedFiles)
      setSortMode('logTime')
      setResult(batchResult)
    } catch (error) {
      setErrorText(
        error instanceof Error
          ? error.message
          : '\u6279\u91cf\u89e3\u6790\u5931\u8d25\u3002',
      )
    } finally {
      setIsAnalyzing(false)
    }
  }

  return (
    <section className="card">
      <h2>{'\u529f\u80fd 2\uff1a\u6279\u91cf\u4e0a\u4f20\u7b5b\u9009\u65e5\u5fd7'}</h2>
      <input
        ref={fileInputRef}
        type="file"
        className="hidden-input"
        accept=".ulg"
        multiple
        onChange={handleFileChange}
      />
      <div className="actions">
        <button type="button" className="button" onClick={handleChooseFiles}>
          {'\u9009\u62e9\u591a\u4e2a\u65e5\u5fd7'}
        </button>
        <button
          type="button"
          className="button"
          onClick={handleAnalyze}
          disabled={isAnalyzing || selectedFiles.length === 0}
        >
          {isAnalyzing
            ? '\u6b63\u5728\u89e3\u6790...'
            : '\u6279\u91cf\u89e3\u6790'}
        </button>
      </div>

      {selectedFileNames.length > 0 && (
        <div className="batch-result-block">
          <p className="hint">{'\u5df2\u9009\u6587\u4ef6\uff1a'}</p>
          <ol className="batch-list batch-selected-list">
            {selectedFileNames.map((fileName, index) => (
              <li key={`${fileName}-${index}`}>{fileName}</li>
            ))}
          </ol>
        </div>
      )}
      {isAnalyzing && <p className="hint">{'\u6b63\u5728\u89e3\u6790...'}</p>}
      {errorText && <p className="hint batch-error-text">{errorText}</p>}

      {result && (
        <div className="batch-result">
          <p className="hint">
            {`\u5171\u89e3\u6790 ${result.total} \u4e2a\u65e5\u5fd7\uff0c\u53d1\u73b0 ${result.unlockedCount} \u4e2a\u89e3\u9501\u98de\u884c\u65e5\u5fd7\uff0c${result.failedCount} \u4e2a\u5931\u8d25\u3002`}
          </p>

          <div className="batch-result-block">
            <div className="batch-result-title-row">
              <h3>{'\u89e3\u9501\u98de\u884c\u65e5\u5fd7'}</h3>
              {unlockedLogDetails.length > 0 && (
                <div
                  className="batch-sort-actions"
                  aria-label="\u89e3\u9501\u65e5\u5fd7\u6392\u5e8f"
                >
                  <button
                    type="button"
                    className={`batch-sort-button ${
                      sortMode === 'logTime' ? 'batch-sort-button-active' : ''
                    }`}
                    onClick={() => setSortMode('logTime')}
                  >
                    {'\u65e5\u5fd7\u65f6\u95f4'}
                  </button>
                  <button
                    type="button"
                    className={`batch-sort-button ${
                      sortMode === 'flightTime'
                        ? 'batch-sort-button-active'
                        : ''
                    }`}
                    onClick={() => setSortMode('flightTime')}
                  >
                    {'\u98de\u884c\u65f6\u95f4'}
                  </button>
                </div>
              )}
            </div>
            {unlockedLogDetails.length > 0 ? (
              <table className="batch-table">
                <thead>
                  <tr>
                    <th>{'\u65e5\u5fd7\u6587\u4ef6\u540d'}</th>
                    <th>{'\u98de\u884c\u65f6\u95f4'}</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedUnlockedLogDetails.map((item, index) => (
                    <tr key={`${item.fileName}-${index}`}>
                      <td>{item.fileName}</td>
                      <td>{formatFlightTime(item.flightTimeS)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="hint">{'\u672a\u53d1\u73b0\u89e3\u9501\u98de\u884c\u65e5\u5fd7'}</p>
            )}
          </div>

          {result.failedLogs.length > 0 && (
            <div className="batch-result-block">
              <h3>{'\u4ee5\u4e0b\u65e5\u5fd7\u89e3\u6790\u5931\u8d25'}</h3>
              <ol className="batch-list">
                {result.failedLogs.map((item, index) => (
                  <li key={`${item.fileName}-${index}`}>
                    <span>{item.fileName}</span>
                    {'\uff1a'}
                    <span>{item.reason}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

export default BatchLogUpload
