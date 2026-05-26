# Batch Analyze Data Contract

## POST /api/logs/batch-analyze

Batch analyzes uploaded ULog files and returns only the file names that contain
an unlocked/armed flight state. This endpoint is additive and does not change
`POST /api/logs/upload`.

### Request

```http
POST /api/logs/batch-analyze
Content-Type: multipart/form-data
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `logFiles` | `File[]` | yes | One or more `.ulg` files. |

### Success Response

The endpoint returns `200` even when some or all individual files fail to parse.

```ts
type BatchAnalyzeLogsResponse = {
  unlockedLogs: string[];
  unlockedLogDetails: Array<{
    fileName: string;
    flightTimeS: number | null;
    logStartTimestampUs: number | null;
  }>;
  failedLogs: Array<{
    fileName: string;
    reason: string;
  }>;
  total: number;
  unlockedCount: number;
  failedCount: number;
};
```

`unlockedLogs` is derived from parsed log content, currently from
`actuator_armed.armed` or `vehicle_status.arming_state`, and never from the file
name.

`flightTimeS` is the estimated total time in seconds while the log reported an
armed/unlocked state. It is `null` when the log confirms unlock but does not
include enough timestamp data to estimate a duration.

`logStartTimestampUs` comes from the ULog header and is used by the frontend to
sort unlocked logs chronologically. When it is missing or zero, the frontend
keeps those logs in upload order.
