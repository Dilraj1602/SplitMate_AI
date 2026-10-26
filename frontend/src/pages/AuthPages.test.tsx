import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from '../app/auth'
import { ToastProvider } from '../components/ui/ToastProvider'
import { AuthPage, LandingPage } from './AuthPages'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('LandingPage', () => {
  it('offers real navigation to sign in and sign up', () => {
    render(<MemoryRouter><LandingPage /></MemoryRouter>)

    expect(screen.getAllByRole('link', { name: 'Sign in' }).some(link => link.getAttribute('href') === '/login')).toBe(true)
    expect(screen.getByRole('link', { name: 'Create an account' }).getAttribute('href')).toBe('/signup')
  })

  it('does not present example financial values as live data', () => {
    render(<MemoryRouter><LandingPage /></MemoryRouter>)

    expect(document.body.textContent).not.toMatch(/₹\s?1,250/)
    expect(document.body.textContent).toContain('No AI required')
  })
})

describe('AuthPage registration feedback', () => {
  it('shows and hides a password with an accessible toggle', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><AuthProvider><AuthPage mode="login" /></AuthProvider></MemoryRouter>)
    const password = screen.getByLabelText('Password')
    expect(password).toHaveAttribute('type', 'password')
    await user.click(screen.getByRole('button', { name: 'Show password' }))
    expect(password).toHaveAttribute('type', 'text')
    await user.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(password).toHaveAttribute('type', 'password')
  })
  it('submits registration through the authentication API', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ message: 'Registration started.' }),
      { status: 202, headers: { 'Content-Type': 'application/json' } },
    ))
    vi.stubGlobal('fetch', fetch)
    const user = userEvent.setup()

    render(<MemoryRouter><AuthProvider><AuthPage mode="register" /></AuthProvider></MemoryRouter>)

    await user.type(screen.getByLabelText('Full name'), 'Test Person')
    await user.type(screen.getByLabelText('Username'), 'testperson')
    await user.type(screen.getByLabelText('Email address'), 'test@example.com')
    await user.type(screen.getByLabelText('Password'), 'abcdef')
    await user.type(screen.getByLabelText('Confirm password'), 'abcdef')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    expect(fetch.mock.calls[0][0]).toContain('/api/v1/auth/register')
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ display_name: 'Test Person', username: 'testperson', email: 'test@example.com', password: 'abcdef' })
  })

  it('requires six characters and does not call the API for shorter passwords', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const user = userEvent.setup()

    render(<MemoryRouter><AuthProvider><AuthPage mode="register" /></AuthProvider></MemoryRouter>)

    await user.type(screen.getByLabelText('Full name'), 'Test Person')
    await user.type(screen.getByLabelText('Username'), 'testperson')
    await user.type(screen.getByLabelText('Email address'), 'test@example.com')
    await user.type(screen.getByLabelText('Password'), 'abcde')
    await user.type(screen.getByLabelText('Confirm password'), 'abcde')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(screen.getByText('Password must be at least 6 characters.')).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('OTP authentication screens', () => {
  it('submits the email and six-digit verification code without persisting it', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Email verified.' }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetch)
    const user = userEvent.setup()
    render(<ToastProvider><MemoryRouter initialEntries={['/verify-email?email=person%40example.com']}><AuthProvider><Routes><Route path="/verify-email" element={<AuthPage mode="verify" />} /><Route path="/login" element={<AuthPage mode="login" />} /></Routes></AuthProvider></MemoryRouter></ToastProvider>)
    await user.type(screen.getByLabelText('Six-digit code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Verify email' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Email verified. You can sign in now.')
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/v1/auth/verify-email'), expect.objectContaining({
      body: JSON.stringify({ email: 'person@example.com', code: '123456' }),
    }))
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
  })

  it('shows a resend cooldown after a code was issued', () => {
    render(<MemoryRouter initialEntries={['/verify-email?email=person%40example.com']}><AuthProvider><AuthPage mode="verify" /></AuthProvider></MemoryRouter>)
    expect(screen.getByRole('button', { name: /resend available in 60s/i })).toBeDisabled()
  })

  it('submits a reset code and new password to the password-reset endpoint', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Password updated.' }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetch)
    const user = userEvent.setup()
    render(<ToastProvider><MemoryRouter initialEntries={['/reset-password?email=person%40example.com']}><AuthProvider><Routes><Route path="/reset-password" element={<AuthPage mode="reset" />} /><Route path="/login" element={<AuthPage mode="login" />} /></Routes></AuthProvider></MemoryRouter></ToastProvider>)
    await user.type(screen.getByLabelText('Six-digit code'), '654321')
    await user.type(screen.getByLabelText('New password'), 'newpass123')
    await user.type(screen.getByLabelText('Confirm password'), 'newpass123')
    await user.click(screen.getByRole('button', { name: 'Update password' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Password updated. Sign in with your new password.')
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/v1/auth/password-reset/confirm'), expect.objectContaining({
      body: JSON.stringify({ email: 'person@example.com', code: '654321', new_password: 'newpass123' }),
    }))
  })
})

function SessionStatus() {
  const auth = useAuth()
  return <p>{auth.loading ? 'Loading session' : auth.authenticated ? 'Signed in' : 'Signed out'}</p>
}

describe('session restoration', () => {
  it('validates a saved session before exposing authenticated state', async () => {
    window.sessionStorage.setItem('splitmate_access_token', 'valid-token')
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { id: 'user-1' } }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetch)
    render(<AuthProvider><SessionStatus /></AuthProvider>)
    expect(await screen.findByText('Signed in')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/v1/auth/me'), expect.objectContaining({ headers: expect.any(Headers) }))
  })

  it('clears an expired saved session and completes restoration as signed out', async () => {
    window.sessionStorage.setItem('splitmate_access_token', 'expired-token')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'The access token is invalid or expired.' }), { status: 401, headers: { 'Content-Type': 'application/json' } })))
    render(<AuthProvider><SessionStatus /></AuthProvider>)
    expect(await screen.findByText('Signed out')).toBeInTheDocument()
    expect(window.sessionStorage.getItem('splitmate_access_token')).toBeNull()
  })
})
