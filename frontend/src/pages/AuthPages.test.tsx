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

    render(<ToastProvider><MemoryRouter><AuthProvider><AuthPage mode="register" /></AuthProvider></MemoryRouter></ToastProvider>)

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

  it('shows email delivery failure and stays on registration instead of claiming success', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ detail: 'Email delivery is temporarily unavailable. Please try again later.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    ))
    vi.stubGlobal('fetch', fetch)
    const user = userEvent.setup()
    render(<ToastProvider><MemoryRouter><AuthProvider><AuthPage mode="register" /></AuthProvider></MemoryRouter></ToastProvider>)
    await user.type(screen.getByLabelText('Full name'), 'Test Person')
    await user.type(screen.getByLabelText('Username'), 'testperson')
    await user.type(screen.getByLabelText('Email address'), 'test@example.com')
    await user.type(screen.getByLabelText('Password'), 'abcdef')
    await user.type(screen.getByLabelText('Confirm password'), 'abcdef')
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Email delivery is temporarily unavailable.')
    expect(screen.getByRole('heading', { name: 'Create your account' })).toBeInTheDocument()
    expect(screen.queryByText('Account created. Check your email for a verification code.')).not.toBeInTheDocument()
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
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument()
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

  it('keeps an invalid password-reset code on the code page', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'The code is invalid or expired.' }), { status: 400, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetch)
    const user = userEvent.setup()
    render(<ToastProvider><MemoryRouter initialEntries={['/reset-password/verify?email=person%40example.com']}><AuthProvider><Routes><Route path="/reset-password/verify" element={<AuthPage mode="reset-code" />} /><Route path="/reset-password/new" element={<AuthPage mode="new-password" />} /></Routes></AuthProvider></MemoryRouter></ToastProvider>)
    await user.type(await screen.findByLabelText('Six-digit code'), '654321')
    await user.click(screen.getByRole('button', { name: 'Verify code' }))
    expect(await screen.findByText('The code is invalid or expired.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Enter your code' })).toBeInTheDocument()
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument()
  })

  it('does not advance for an unregistered email and displays the requested exact message', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "This email isn't registered." }), { status: 404, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetch)
    const user = userEvent.setup()
    render(<ToastProvider><MemoryRouter initialEntries={['/forgot-password']}><Routes><Route path="/forgot-password" element={<AuthPage mode="forgot" />} /><Route path="/reset-password/verify" element={<AuthPage mode="reset-code" />} /></Routes></MemoryRouter></ToastProvider>)
    await user.type(screen.getByLabelText('Email address'), 'missing@example.com')
    await user.click(screen.getByRole('button', { name: 'Send reset code' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("This email isn't registered.")
    expect(screen.getByRole('heading', { name: 'Forgot password?' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Enter your code' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Six-digit code')).not.toBeInTheDocument()
  })

  it('completes email, OTP, cookie authorization, and password stages separately', async () => {
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      void init
      const url = String(input)
      if (url.endsWith('/auth/password-reset/request')) return new Response(JSON.stringify({ message: 'Verification code sent.', resend_after_seconds: 60 }), { status: 202, headers: { 'Content-Type': 'application/json' } })
      if (url.endsWith('/auth/password-reset/verify')) return new Response(JSON.stringify({ data: { valid: true, expires_in_seconds: 900 } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (url.endsWith('/auth/password-reset/session')) return new Response(JSON.stringify({ data: { valid: true } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (url.endsWith('/auth/password-reset/confirm')) return new Response(JSON.stringify({ message: 'Password updated successfully.' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      return new Response(JSON.stringify({ data: { access_token: 'new-login-token' } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetch)
    const user = userEvent.setup()
    render(<ToastProvider><MemoryRouter initialEntries={['/forgot-password']}><AuthProvider><Routes>
      <Route path="/forgot-password" element={<AuthPage mode="forgot" />} />
      <Route path="/reset-password/verify" element={<AuthPage mode="reset-code" />} />
      <Route path="/reset-password/new" element={<AuthPage mode="new-password" />} />
      <Route path="/login" element={<AuthPage mode="login" />} />
    </Routes></AuthProvider></MemoryRouter></ToastProvider>)

    await user.type(screen.getByLabelText('Email address'), 'Person@example.com')
    await user.click(screen.getByRole('button', { name: 'Send reset code' }))
    expect(await screen.findByRole('heading', { name: 'Enter your code' })).toBeInTheDocument()
    expect(screen.getByText(/We sent a six-digit code to p\*\*\*@example\.com\./)).toBeInTheDocument()
    await user.type(screen.getByLabelText('Six-digit code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Verify code' }))
    expect(await screen.findByRole('heading', { name: 'Choose a new password' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Email address')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Six-digit code')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('New password'), 'newpass123')
    await user.type(screen.getByLabelText('Confirm password'), 'newpass123')
    await user.click(screen.getByRole('button', { name: 'Update Password' }))
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument()
    expect(await screen.findByText('Password updated successfully.')).toBeInTheDocument()

    const verificationCall = fetch.mock.calls.find(([url]) => String(url).endsWith('/auth/password-reset/verify'))
    expect(verificationCall?.[1]).toMatchObject({ credentials: 'include' })
    expect(new Headers(verificationCall?.[1]?.headers).get('Authorization')).toBeNull()
    const confirmCall = fetch.mock.calls.find(([url]) => String(url).endsWith('/auth/password-reset/confirm'))
    expect(JSON.parse(confirmCall?.[1]?.body as string)).toEqual({ new_password: 'newpass123', confirm_password: 'newpass123' })
    expect(confirmCall?.[1]).toMatchObject({ credentials: 'include' })
  })

  it('shows the minimal expired page for direct access and clears the session with Start again', async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/auth/password-reset/session/revoke')) return new Response(null, { status: 204 })
      return new Response(JSON.stringify({ detail: 'The password-reset session is invalid or expired.' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetch)
    render(<ToastProvider><MemoryRouter initialEntries={['/reset-password/new']}><Routes><Route path="/forgot-password" element={<AuthPage mode="forgot" />} /><Route path="/reset-password/new" element={<AuthPage mode="new-password" />} /></Routes></MemoryRouter></ToastProvider>)
    expect(await screen.findByRole('heading', { name: 'Link expired' })).toBeInTheDocument()
    expect(screen.getByText('This password reset link is no longer valid.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start again' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Email address')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send reset code' })).not.toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/v1/auth/password-reset/session'), expect.objectContaining({ credentials: 'include' }))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Start again' }))
    expect(await screen.findByRole('heading', { name: 'Forgot password?' })).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/v1/auth/password-reset/session/revoke'), expect.objectContaining({ method: 'POST', credentials: 'include' }))
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
