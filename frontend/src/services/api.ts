export type ApiErrorBody = {
  error?: { code?: string; message?: string; details?: unknown[] }
  detail?: string
}

export type Collection<T> = {
  data: T[]
  pagination?: { limit: number; offset: number; total: number }
}

export type GroupSummary = {
  id: string
  name: string
  description?: string | null
  member_count?: number
  status?: 'active' | 'archived'
}

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '')
const API_REQUEST_TIMEOUT_MS = 15_000
let accessToken: string | undefined

export function setAccessToken(token?: string) {
  accessToken = token
}

export class ApiError extends Error {
  readonly status?: number
  readonly code?: string

  constructor(message: string, status?: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  headers.set('Accept', 'application/json')
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)

  let response: Response
  const timeoutSignal = AbortSignal.timeout(API_REQUEST_TIMEOUT_MS)
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal
  try {
    response = await fetch(`${apiBaseUrl}/api/v1${path}`, { ...init, headers, signal })
  } catch (cause) {
    if (typeof cause === 'object' && cause !== null && 'name' in cause && cause.name === 'TimeoutError') {
      throw new ApiError('The request timed out. Please try again.')
    }
      throw new ApiError('We couldn’t connect. Check your internet connection and try again.')
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody
    if (response.status === 401) window.dispatchEvent(new Event('splitmate:unauthorized'))
    const message = response.status >= 500
      ? 'We couldn’t complete that request. Please try again.'
      : response.status === 422 && typeof body.detail !== 'string'
        ? 'Please check the information and try again.'
        : body.error?.message || (typeof body.detail === 'string' ? body.detail : undefined) || 'We couldn’t complete that request. Please try again.'
    throw new ApiError(message, response.status, body.error?.code)
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => apiRequest<T>(path, { method: 'GET', signal }),
  post: <T>(path: string, body?: unknown) =>
    apiRequest<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    apiRequest<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
}

export const endpoints = {
  dashboard: '/dashboard',
  groups: '/groups',
  invitations: '/invitations',
  notifications: '/notifications',
  activity: '/activity',
}
