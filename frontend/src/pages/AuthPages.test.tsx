import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../app/auth'
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
  it('stops pending and explains when registration API is missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ detail: 'Not Found' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    )))
    const user = userEvent.setup()

    render(<MemoryRouter><AuthProvider><AuthPage mode="register" /></AuthProvider></MemoryRouter>)

    await user.type(screen.getByLabelText('Full name'), 'Test Person')
    await user.type(screen.getByLabelText('Username'), 'testperson')
    await user.type(screen.getByLabelText('Email address'), 'test@example.com')
    await user.type(screen.getByLabelText('Password'), 'abcdef')
    await user.type(screen.getByLabelText('Confirm password'), 'abcdef')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByText(/backend registration endpoint is not implemented/i)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled())
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
