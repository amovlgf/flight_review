import { describe, expect, test, vi, afterEach } from 'vitest'
import { fetchFlightSummary, uploadLogFile } from './api'

function mockFetchResponse(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('feature one API errors', () => {
  test('uploadLogFile preserves backend parsing message and reason', async () => {
    mockFetchResponse({
      ok: false,
      status: 400,
      json: async () => ({
        message: 'ULG parsing failed.',
        reason: 'INVALID_ULG_MAGIC',
      }),
    })

    const file = new File(['bad'], 'bad.ulg')

    await expect(uploadLogFile(file)).rejects.toThrow(
      'ULG parsing failed. INVALID_ULG_MAGIC',
    )
  })

  test('fetchFlightSummary includes HTTP status when backend route is unavailable', async () => {
    mockFetchResponse({
      ok: false,
      status: 404,
      json: async () => {
        throw new Error('not json')
      },
    })

    await expect(fetchFlightSummary('missing-route')).rejects.toThrow(
      'FLIGHT_SUMMARY_FAILED (HTTP 404)',
    )
  })
})
