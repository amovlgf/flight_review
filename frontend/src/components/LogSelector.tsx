import RoleSwitcher from './RoleSwitcher'
import type { RoleOption } from './RoleSwitcher'

export type LogListItem = {
  logId: string
  fileName: string
  uploadedAt: string
}

type LogSelectorProps = {
  selectedLogId: string
  viewRole: string
  roleOptions: RoleOption[]
  searchKeyword: string
  logList: LogListItem[]
  listPage: number
  listPageCount: number
  listTotal: number
  onRoleChange: (role: string) => void
  onSearchKeywordChange: (keyword: string) => void
  onSearch: () => void
  onLogSelect: (logId: string) => void
  onRefreshLogList: () => void
  onPrevPage: () => void
  onNextPage: () => void
  onLoadChart: () => void
}

function LogSelector({
  selectedLogId,
  viewRole,
  roleOptions,
  searchKeyword,
  logList,
  listPage,
  listPageCount,
  listTotal,
  onRoleChange,
  onSearchKeywordChange,
  onSearch,
  onLogSelect,
  onRefreshLogList,
  onPrevPage,
  onNextPage,
  onLoadChart,
}: LogSelectorProps) {
  return (
    <>
      <div className="actions">
        <RoleSwitcher
          value={viewRole}
          options={roleOptions}
          onChange={onRoleChange}
        />
        <input
          className="input"
          value={searchKeyword}
          onChange={(event) => onSearchKeywordChange(event.target.value)}
          placeholder={'\u6309\u6587\u4ef6\u540d\u641c\u7d22\u65e5\u5fd7'}
        />
        <button type="button" className="button" onClick={onSearch}>
          {'\u641c\u7d22'}
        </button>
      </div>

      <div className="actions">
        <select
          className="select"
          value={selectedLogId}
          onChange={(event) => onLogSelect(event.target.value)}
        >
          <option value="">{'\u8bf7\u9009\u62e9\u65e5\u5fd7'}</option>
          {logList.map((item) => (
            <option key={item.logId} value={item.logId}>
              {`${item.fileName} (${new Date(item.uploadedAt).toLocaleString()})`}
            </option>
          ))}
        </select>
        <button type="button" className="button" onClick={onRefreshLogList}>
          {'\u5237\u65b0\u65e5\u5fd7\u5217\u8868'}
        </button>
      </div>

      <div className="actions">
        <button
          type="button"
          className="button"
          disabled={listPage <= 1}
          onClick={onPrevPage}
        >
          {'\u4e0a\u4e00\u9875'}
        </button>
        <button
          type="button"
          className="button"
          disabled={listPage >= listPageCount}
          onClick={onNextPage}
        >
          {'\u4e0b\u4e00\u9875'}
        </button>
        <p className="hint-inline">
          {`\u7b2c ${listPage} / ${listPageCount} \u9875\uff0c\u5171 ${listTotal} \u6761`}
        </p>
      </div>

      <button
        type="button"
        className="button"
        onClick={onLoadChart}
        disabled={!selectedLogId}
      >
        {selectedLogId
          ? '\u6253\u5f00\u56fe\u8868\u6a21\u5757'
          : '\u8bf7\u5148\u4e0a\u4f20\u6216\u9009\u62e9\u5386\u53f2\u65e5\u5fd7'}
      </button>
    </>
  )
}

export default LogSelector
