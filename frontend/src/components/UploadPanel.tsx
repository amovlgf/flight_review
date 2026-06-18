import { useRef } from 'react'

type UploadPanelProps = {
  selectedFileName: string
  isUploading: boolean
  statusText: string
  onFileSelected: (fileName: string) => void
  onUpload: (file: File | null) => void
}

function UploadPanel({
  selectedFileName,
  isUploading,
  statusText,
  onFileSelected,
  onUpload,
}: UploadPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const handleChooseFile = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    onFileSelected(file.name)
  }

  const handleUpload = () => {
    onUpload(fileInputRef.current?.files?.[0] ?? null)
  }

  return (
    <section className="card">
      <h2>{'\u529f\u80fd 1\uff1a\u65e5\u5fd7\u4e0a\u4f20\u5206\u6790'}</h2>
      <ul>
        <li>{'\u524d\u7aef\u4e0a\u4f20\u5165\u53e3'}</li>
        <li>{'\u540e\u7aef\u6587\u4ef6\u63a5\u6536\u63a5\u53e3'}</li>
        <li>{'\u65e5\u5fd7\u89e3\u6790\u670d\u52a1\u5360\u4f4d'}</li>
      </ul>
      <input
        ref={fileInputRef}
        type="file"
        className="hidden-input"
        accept=".ulg"
        onChange={handleFileChange}
      />
      <div className="actions">
        <button type="button" className="button" onClick={handleChooseFile}>
          {'\u9009\u62e9\u65e5\u5fd7\u6587\u4ef6'}
        </button>
        <button
          type="button"
          className="button"
          onClick={handleUpload}
          disabled={isUploading}
        >
          {isUploading ? '\u4e0a\u4f20\u4e2d...' : '\u4e0a\u4f20\u6587\u4ef6'}
        </button>
      </div>
      {selectedFileName && (
        <p className="hint">
          {'\u5df2\u9009\u6587\u4ef6\uff1a'}
          {selectedFileName}
        </p>
      )}
      {statusText && <p className="hint">{statusText}</p>}
    </section>
  )
}

export default UploadPanel
