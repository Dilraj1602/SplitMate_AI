import { useEffect, useState, type FormEvent, type InputHTMLAttributes } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { api, ApiError } from '../services/api'
import { ErrorState, Notice } from '../components/ui/Feedback'
import { useAuth } from '../app/auth'

type AuthMode = 'login' | 'register' | 'forgot' | 'reset' | 'verify'

const copy: Record<AuthMode, { title: string; note: string; submit: string; path: string }> = {
  login: { title: 'Welcome back', note: 'Sign in to pick up where you left off.', submit: 'Sign in', path: '/auth/login' },
  register: { title: 'Create your account', note: 'Start organizing shared expenses with your group.', submit: 'Create account', path: '/auth/register' },
  forgot: { title: 'Reset your password', note: 'We’ll send a code if an account matches that email.', submit: 'Send reset code', path: '/auth/password-reset/request' },
  reset: { title: 'Choose a new password', note: 'Enter the code from your email and choose a new password.', submit: 'Update password', path: '/auth/password-reset/confirm' },
  verify: { title: 'Verify your email', note: 'Enter the six-digit code if it arrived. Check spam, then request another code if needed.', submit: 'Verify email', path: '/auth/verify-email' },
}

export function AuthPage({ mode }: { mode: AuthMode }) {
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [params] = useSearchParams()
  const [cooldown, setCooldown] = useState(() => params.get('email') && (mode === 'verify' || mode === 'reset') ? 60 : 0)
  const navigate = useNavigate()
  const auth = useAuth()
  const current = copy[mode]
  useEffect(() => {
    if (!cooldown) return
    const timer = window.setTimeout(() => setCooldown(value => Math.max(0, value - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown])

  async function resendCode() {
    const email = String(params.get('email') || '')
    if (!email || busy || cooldown) return
    setError(''); setNotice(''); setBusy(true)
    try {
      await api.post(mode === 'verify' ? '/auth/resend-verification' : '/auth/password-reset/request', { email })
      setNotice(mode === 'verify' ? 'If an unverified account matches that email, a code will be sent.' : 'If an eligible account matches that email, reset instructions will be sent.')
      setCooldown(60)
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'The request could not be completed.') }
    finally { setBusy(false) }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setNotice('')
    const form = new FormData(event.currentTarget)
    const values = Object.fromEntries(form.entries())
    if ((mode === 'register' || mode === 'reset') && values.password !== values.confirm_password) {
      setError('Passwords do not match.')
      return
    }
    if ((mode === 'register' || mode === 'reset') && String(values.password || '').length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    setBusy(true)
    try {
      if (mode === 'login') {
        const session = await api.post<{ data?: { access_token?: string } }>(current.path, values)
        if (!session.data?.access_token) throw new ApiError('The API response did not include an access token.')
        auth.startSession(session.data.access_token)
        navigate('/app')
        return
      }
      const payload = mode === 'register'
        ? { display_name: values.name, username: values.username, email: values.email, password: values.password }
        : mode === 'verify'
        ? { email: values.email, code: values.code }
        : mode === 'reset'
          ? { email: values.email, code: values.code, new_password: values.password }
            : values
      await api.post(current.path, payload)
      if (mode === 'register') {
        navigate(`/verify-email?email=${encodeURIComponent(String(values.email))}`)
      } else if (mode === 'forgot') {
        navigate(`/reset-password?email=${encodeURIComponent(String(values.email))}`)
      } else if (mode === 'verify') {
        setNotice('Email verified. You can sign in now.')
      } else {
        setNotice('Password update request accepted. Sign in with your new password.')
      }
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'The request could not be completed.')
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
        {(mode === 'login' || mode === 'register' || mode === 'forgot') && <Field name="email" label="Email address" type="email" autoComplete="email" required />}
        {(mode === 'verify' || mode === 'reset') && <Field name="email" label="Email address" type="email" autoComplete="email" required defaultValue={params.get('email') || ''} />}
        {(mode === 'verify' || mode === 'reset') && <Field name="code" label="Six-digit code" inputMode="numeric" autoComplete="one-time-code" minLength={6} maxLength={6} pattern="[0-9]{6}" required />}
        {(mode === 'login' || mode === 'register' || mode === 'reset') && <div className="field-wrap"><div className="field-label-row"><label htmlFor="password">{mode === 'reset' ? 'New password' : 'Password'}</label>{mode === 'login' && <Link to="/forgot-password" className="text-button">Forgot password?</Link>}</div><div className="password-control"><input id="password" name="password" type={visible ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'login' ? undefined : 6} required aria-describedby="password-hint" /><button type="button" className="password-toggle" onClick={() => setVisible(!visible)} aria-label={visible ? 'Hide password' : 'Show password'}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>{mode !== 'login' && <small id="password-hint" className="field-hint">Use at least 6 characters.</small>}</div>}
        {(mode === 'register' || mode === 'reset') && <Field name="confirm_password" label="Confirm password" type={visible ? 'text' : 'password'} autoComplete="new-password" required />}
        {error && <ErrorState message={error} />}{notice && <Notice>{notice}</Notice>}
        <button className="button button-primary button-full" disabled={busy}>{busy ? 'Please wait…' : current.submit}</button>
      </form>
      {(mode === 'verify' || mode === 'reset') && <button type="button" className="text-button" disabled={busy || cooldown > 0} onClick={resendCode}>{cooldown ? `Resend available in ${cooldown}s` : 'Resend code'}</button>}
      <div className="auth-switch">{mode === 'login' ? <>New to SplitMate? <Link to="/signup">Create an account</Link></> : mode === 'register' ? <>Already have an account? <Link to="/login">Sign in</Link></> : <Link to="/login">Return to sign in</Link>}</div>
    </section>
    <p className="auth-footnote">Your financial records stay private to your groups.</p>
  </main>
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
