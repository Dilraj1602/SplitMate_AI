import { useEffect, useState, type FormEvent, type InputHTMLAttributes } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { api, ApiError } from '../services/api'
import { ErrorState } from '../components/ui/Feedback'
import { useAuth } from '../app/auth'
import { useToast } from '../components/ui/ToastProvider'

type AuthMode = 'login' | 'register' | 'forgot' | 'reset-code' | 'new-password' | 'verify'
type CredentialMode = 'login' | 'register' | 'verify'

const copy: Record<CredentialMode, { title: string; note: string; submit: string; path: string }> = {
  login: { title: 'Welcome back', note: 'Sign in to pick up where you left off.', submit: 'Sign in', path: '/auth/login' },
  register: { title: 'Create your account', note: 'Start organizing shared expenses with your group.', submit: 'Create account', path: '/auth/register' },
  verify: { title: 'Verify your email', note: 'Enter the six-digit code if it arrived. Check spam, then request another code if needed.', submit: 'Verify email', path: '/auth/verify-email' },
}

export function AuthPage({ mode }: { mode: AuthMode }) {
  if (mode === 'forgot') return <ForgotPasswordPage />
  if (mode === 'reset-code') return <PasswordResetCodePage />
  if (mode === 'new-password') return <NewPasswordPage />
  return <CredentialAuthPage mode={mode} />
}

function CredentialAuthPage({ mode }: { mode: CredentialMode }) {
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const toast = useToast()
  const [params] = useSearchParams()
  const location = useLocation()
  const [cooldown, setCooldown] = useState(() => params.get('email') && mode === 'verify' ? 60 : 0)
  const navigate = useNavigate()
  const auth = useAuth()
  const current = copy[mode]
  useEffect(() => {
    if (!cooldown) return
    const timer = window.setTimeout(() => setCooldown(value => Math.max(0, value - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown])
  useEffect(() => {
    const incomingNotice = (location.state as { notice?: string } | null)?.notice
    if (mode !== 'login' || !incomingNotice) return
    toast.success(incomingNotice)
  }, [location.state, mode, toast])

  async function resendCode() {
    const email = String(params.get('email') || '')
    if (!email || busy || cooldown) return
    setError(''); setBusy(true)
    try {
      await api.post('/auth/resend-verification', { email })
      toast.info('If an unverified account matches that email, a code will be sent.')
      setCooldown(60)
    } catch (cause) { toast.error(cause instanceof ApiError ? cause.message : 'The request could not be completed.') }
    finally { setBusy(false) }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    const form = new FormData(event.currentTarget)
    const values = Object.fromEntries(form.entries())
    if (mode === 'register' && values.password !== values.confirm_password) {
      setError('Passwords do not match.')
      return
    }
    if (mode === 'register' && String(values.password || '').length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    setBusy(true)
    try {
      if (mode === 'login') {
        const session = await api.post<{ data?: { access_token?: string } }>(current.path, values)
        if (!session.data?.access_token) throw new ApiError('We couldn’t sign you in. Please try again.')
        auth.startSession(session.data.access_token)
        navigate('/app')
        return
      }
      const payload = mode === 'register'
        ? { display_name: values.name, username: values.username, email: values.email, password: values.password }
        : mode === 'verify'
        ? { email: values.email, code: values.code }
          : values
      const result = await api.post<{ message?: string }>(current.path, payload)
      if (mode === 'register') {
        const message = result.message || 'Account created. Check your email for a verification code.'
        if (message.toLowerCase().includes('email was not sent')) toast.info(message)
        else toast.success(message)
        navigate(`/verify-email?email=${encodeURIComponent(String(values.email))}`)
      } else if (mode === 'verify') {
        toast.success('Email verified. You can sign in now.')
        navigate('/login', { replace: true })
      } else {
        toast.success('Password updated. Sign in with your new password.')
        navigate('/login')
      }
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : 'The request could not be completed.')
    } finally {
      setBusy(false)
    }
  }

  return <main className="auth-page">
    <div className="auth-topline"><Link to="/" className="wordmark"><span className="brand-mark" aria-hidden="true"><i /><i /></span><span>splitmate</span></Link><Link className="text-button" to="/">Back to home</Link></div>
    <section className="auth-panel">
      <p className="eyebrow">Your shared money, in order</p><h1>{current.title}</h1><p className="auth-note">{current.note}</p>
      <form onSubmit={submit} className="form-stack" noValidate>
        {mode === 'register' && <Field name="name" label="Full name" autoComplete="name" required />}
        {mode === 'register' && <Field name="username" label="Username" autoComplete="username" required hint="Used by group members to find you." />}
        {(mode === 'login' || mode === 'register') && <Field name="email" label="Email address" type="email" autoComplete="email" required />}
        {mode === 'verify' && <Field name="email" label="Email address" type="email" autoComplete="email" required defaultValue={params.get('email') || ''} />}
        {mode === 'verify' && <Field name="code" label="Six-digit code" inputMode="numeric" autoComplete="one-time-code" minLength={6} maxLength={6} pattern="[0-9]{6}" required />}
        {(mode === 'login' || mode === 'register') && <div className="field-wrap"><div className="field-label-row"><label htmlFor="password">Password</label>{mode === 'login' && <Link to="/forgot-password" className="text-button">Forgot password?</Link>}</div><div className="password-control"><input id="password" name="password" type={visible ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'login' ? undefined : 6} required aria-describedby="password-hint" /><button type="button" className="password-toggle" onClick={() => setVisible(!visible)} aria-label={visible ? 'Hide password' : 'Show password'}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>{mode === 'register' && <small id="password-hint" className="field-hint">Use at least 6 characters.</small>}</div>}
        {mode === 'register' && <div className="field-wrap"><label htmlFor="confirm_password">Confirm password</label><div className="password-control"><input id="confirm_password" name="confirm_password" type={visible ? 'text' : 'password'} autoComplete="new-password" required /><button type="button" className="password-toggle" onClick={() => setVisible(value => !value)} aria-label={visible ? 'Hide password' : 'Show password'}>{visible ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div></div>}
        {error && <ErrorState message={error} />}
        <button className="button button-primary button-full" disabled={busy}>{busy ? 'Please wait…' : current.submit}</button>
      </form>
      {mode === 'verify' && <button type="button" className="text-button" disabled={busy || cooldown > 0} onClick={resendCode}>{cooldown ? `Resend available in ${cooldown}s` : 'Resend code'}</button>}
      <div className="auth-switch">{mode === 'login' ? <>New to SplitMate? <Link to="/signup">Create an account</Link></> : mode === 'register' ? <>Already have an account? <Link to="/login">Sign in</Link></> : <Link to="/login">Return to sign in</Link>}</div>
    </section>
    <p className="auth-footnote">Your financial records stay private to your groups.</p>
  </main>
}

function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const navigate = useNavigate()
  const location = useLocation()
  const toast = useToast()
  useEffect(() => {
    const incoming = (location.state as { notice?: string } | null)?.notice
    if (incoming) setNotice(incoming)
  }, [location.state])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError('')
    setNotice('')
    setBusy(true)
    const normalizedEmail = email.trim().toLowerCase()
    try {
      const result = await api.post<{ message?: string; resend_after_seconds?: number }>('/auth/password-reset/request', { email: normalizedEmail })
      if (result.message?.toLowerCase().includes('email was not sent')) toast.info(result.message)
      else toast.success(result.message || 'Verification code sent.')
      navigate(`/reset-password/verify?email=${encodeURIComponent(normalizedEmail)}`, {
        state: { resendAfterSeconds: result.resend_after_seconds || 60 },
      })
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'The request could not be completed.')
    } finally { setBusy(false) }
  }

  return <main className="auth-page">
    <div className="auth-topline"><Link to="/" className="wordmark"><span className="brand-mark" aria-hidden="true"><i /><i /></span><span>splitmate</span></Link><Link className="text-button" to="/login">Back to Login</Link></div>
    <section className="auth-panel">
      <p className="eyebrow">Account recovery</p><h1>Forgot password?</h1>
      {notice && <p className="field-hint" role="status">{notice}</p>}
      <form onSubmit={submit} className="form-stack" noValidate>
        <Field name="email" label="Email address" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required />
        {error && <ErrorState message={error} />}
        <button className="button button-primary button-full" disabled={busy || !email.trim()}>{busy ? 'Sending code…' : 'Send reset code'}</button>
      </form>
    </section>
  </main>
}

function PasswordResetCodePage() {
  const [params] = useSearchParams()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [cooldown, setCooldown] = useState(60)
  const [error, setError] = useState('')
  const [resendError, setResendError] = useState('')
  const navigate = useNavigate()
  const location = useLocation()
  useEffect(() => {
    setEmail(String(params.get('email') || '').trim().toLowerCase())
    const requestedCooldown = (location.state as { resendAfterSeconds?: number } | null)?.resendAfterSeconds
    if (requestedCooldown) setCooldown(requestedCooldown)
  }, [location.state, params])
  useEffect(() => {
    if (!cooldown) return
    const timer = window.setTimeout(() => setCooldown(value => Math.max(0, value - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown])
  useEffect(() => {
    if (!params.get('email')) navigate('/forgot-password', { replace: true })
  }, [navigate, params])

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !email) return
    setError('')
    setBusy(true)
    try {
      await api.post('/auth/password-reset/verify', { email, code })
      navigate('/reset-password/new', { replace: true })
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'The code could not be verified.') }
    finally { setBusy(false) }
  }

  async function resend() {
    if (busy || cooldown || !email) return
    setResendError('')
    setBusy(true)
    try {
      const result = await api.post<{ message?: string; resend_after_seconds?: number }>('/auth/password-reset/request', { email })
      setCooldown(result.resend_after_seconds || 60)
    } catch (cause) { setResendError(cause instanceof ApiError ? cause.message : 'A new code could not be sent.') }
    finally { setBusy(false) }
  }

  if (!email) return <main className="auth-page" aria-live="polite">Opening password recovery…</main>
  return <main className="auth-page">
    <div className="auth-topline"><Link to="/" className="wordmark"><span className="brand-mark" aria-hidden="true"><i /><i /></span><span>splitmate</span></Link><Link className="text-button" to="/forgot-password">Back</Link></div>
    <section className="auth-panel">
      <p className="eyebrow">Password recovery · Step 2 of 3</p><h1>Enter your code</h1>
      <p className="auth-note">We sent a six-digit code to {maskEmail(email)}.</p>
      <form onSubmit={verify} className="form-stack" noValidate>
        <Field name="code" label="Six-digit code" inputMode="numeric" autoComplete="one-time-code" minLength={6} maxLength={6} pattern="[0-9]{6}" value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} required />
        {error && <ErrorState message={error} />}
        <button className="button button-primary button-full" disabled={busy || code.length !== 6}>{busy ? 'Verifying…' : 'Verify code'}</button>
      </form>
      {resendError && <ErrorState message={resendError} />}
      <button type="button" className="text-button" disabled={busy || cooldown > 0} onClick={() => void resend()}>{cooldown ? `Resend available in ${cooldown}s` : 'Resend code'}</button>
    </section>
  </main>
}

function NewPasswordPage() {
  const [authorized, setAuthorized] = useState(false)
  const [expired, setExpired] = useState(false)
  const [checking, setChecking] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmation, setShowConfirmation] = useState(false)
  const navigate = useNavigate()

  async function checkSession() {
    setChecking(true)
    setError('')
    try {
      await api.get('/auth/password-reset/session')
      setAuthorized(true)
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        setAuthorized(false)
        setExpired(true)
      } else {
        setAuthorized(false)
        setError(cause instanceof ApiError ? cause.message : 'The reset session could not be checked.')
      }
    } finally { setChecking(false) }
  }

  useEffect(() => { void checkSession() }, [])

  async function startAgain() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await api.post('/auth/password-reset/session/revoke')
      navigate('/forgot-password', { replace: true })
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'The reset session could not be cleared.')
    } finally { setBusy(false) }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError('')
    if (!password || password.length < 6) { setError('Password must be at least 6 characters.'); return }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return }
    setBusy(true)
    try {
      await api.post('/auth/password-reset/confirm', { new_password: password, confirm_password: confirmPassword })
      navigate('/login', { replace: true, state: { notice: 'Password updated successfully.' } })
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        setAuthorized(false)
        setExpired(true)
      } else setError(cause instanceof ApiError ? cause.message : 'The password could not be updated.')
    } finally { setBusy(false) }
  }

  if (checking) return <main className="auth-page" aria-live="polite">Checking password-reset authorization…</main>
  if (expired) return <main className="auth-page"><section className="auth-panel">
    <p className="eyebrow">Account recovery</p><h1>Link expired</h1>
    <p className="auth-note">This password reset link is no longer valid.</p>
    {error && <ErrorState message={error} />}
    <button className="button button-primary button-full" disabled={busy} onClick={() => void startAgain()}>{busy ? 'Please wait…' : 'Start again'}</button>
  </section></main>
  if (!authorized) return <main className="auth-page"><section className="auth-panel"><ErrorState message={error || 'A valid password-reset session is required.'} /><button className="button button-outline" onClick={() => void checkSession()}>Try again</button></section></main>
  return <main className="auth-page">
    <div className="auth-topline"><Link to="/" className="wordmark"><span className="brand-mark" aria-hidden="true"><i /><i /></span><span>splitmate</span></Link></div>
    <section className="auth-panel">
      <p className="eyebrow">Password recovery · Step 3 of 3</p><h1>Choose a new password</h1>
      <form onSubmit={submit} className="form-stack" noValidate>
        <div className="field-wrap"><label htmlFor="new-password">New password</label><div className="password-control"><input id="new-password" name="new_password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={6} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} required aria-describedby="reset-password-hint"/><button type="button" className="password-toggle" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div><small id="reset-password-hint" className="field-hint">Use at least 6 characters.</small></div>
        <div className="field-wrap"><label htmlFor="confirm-new-password">Confirm password</label><div className="password-control"><input id="confirm-new-password" name="confirm_password" type={showConfirmation ? 'text' : 'password'} autoComplete="new-password" minLength={6} maxLength={128} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} required/><button type="button" className="password-toggle" onClick={() => setShowConfirmation(value => !value)} aria-label={showConfirmation ? 'Hide password' : 'Show password'}>{showConfirmation ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div></div>
        {error && <ErrorState message={error} />}
        <button className="button button-primary button-full" disabled={busy}>{busy ? 'Updating password…' : 'Update Password'}</button>
      </form>
    </section>
  </main>
}

function maskEmail(email: string) {
  const [local, domain] = email.split('@')
  return `${local.slice(0, 1)}***@${domain}`
}

function Field({ name, label, type = 'text', hint, ...props }: InputHTMLAttributes<HTMLInputElement> & { name: string; label: string; hint?: string }) {
  const id = name
  return <div className="field-wrap"><label htmlFor={id}>{label}</label><input id={id} name={name} type={type} {...props} />{hint && <small className="field-hint">{hint}</small>}</div>
}

export function LandingPage() {
  return <main className="landing-page"><header className="landing-nav"><Link to="/" className="wordmark"><span className="brand-mark" aria-hidden="true"><i /><i /></span><span>splitmate</span></Link><div><Link to="/login" className="text-button">Sign in</Link><Link to="/signup" className="button button-primary">Get started</Link></div></header><section className="landing-hero"><p className="eyebrow">Shared expenses, made clear</p><h1>Good groups deserve<br />clearer money.</h1><p>Keep group expenses, balances, and settlements in one calm place. SplitMate helps everyone see what was paid and what is still owed.</p><div className="hero-actions"><Link to="/signup" className="button button-primary">Create an account</Link><Link to="/login" className="button button-outline">Sign in</Link></div><div className="hero-footnote"><span className="trust-dot" /> No AI required. No automatic currency conversion.</div></section><section className="landing-features"><article><span className="feature-number">01</span><h2>Know where you stand</h2><p>See group balances by currency, with pending payments kept separate from confirmed settlements.</p></article><article><span className="feature-number">02</span><h2>Keep every split clear</h2><p>Review who paid, who participated, and how an expense was divided.</p></article><article><span className="feature-number">03</span><h2>Settle with confidence</h2><p>Record a payment and let the recipient confirm it before balances change.</p></article></section><footer className="landing-footer">SplitMate is for organizing shared expenses. It does not move money.</footer></main>
}

export function NotFoundPage() {
  return <main className="auth-page"><section className="auth-panel"><p className="eyebrow">Page not found</p><h1>That link has expired or moved.</h1><p className="auth-note">Check the address, or return to SplitMate.</p><Link to="/" className="button button-primary button-full">Go to home</Link></section></main>
}
