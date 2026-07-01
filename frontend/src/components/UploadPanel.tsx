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
      <h2>{'\u529f\u80fd 1\uff1a\u5e38\u89c4\u65e5\u5fd7\u5206\u6790'}</h2>
      <ul>
        <li>{'\u4e0a\u4f20\u5355\u4efd PX4 .ulg \u65e5\u5fd7'}</li>
        <li>{'\u751f\u6210\u65e5\u5fd7\u6982\u89c8\u548c\u98de\u884c\u4e8b\u4ef6\u65f6\u95f4\u7ebf'}</li>
        <li>{'\u4fdd\u7559\u539f\u59cb topic \u56fe\u8868\u5230\u9ad8\u7ea7\u539f\u59cb\u6570\u636e'}</li>
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
