import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiRequest, setAccessToken } from './api'

afterEach(() => { vi.unstubAllGlobals(); setAccessToken(undefined) })

describe('apiRequest', () => {
  it('surfaces backend error messages without reporting success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Resource unavailable.' } }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    )))

    await expect(apiRequest('/groups')).rejects.toMatchObject<ApiError>({
      name: 'ApiError',
      message: 'Resource unavailable.',
      status: 404,
      code: 'NOT_FOUND',
    })
  })

  it('reports an unreachable backend clearly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network failure')))

    await expect(apiRequest('/groups')).rejects.toThrow('Could not reach the SplitMate API')
  })

  it('turns request timeouts into a retryable API error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('timed out', 'TimeoutError')))

    await expect(apiRequest('/auth/register')).rejects.toMatchObject({
      message: 'The request timed out. Please try again.',
    })
  })

  it('sends the current in-memory access token as a bearer credential', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    setAccessToken('test-access-token')

    await apiRequest('/groups')

    expect(fetch.mock.calls[0][1].headers.get('Authorization')).toBe('Bearer test-access-token')
  })
})
