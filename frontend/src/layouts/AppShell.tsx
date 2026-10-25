import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { NavLink, Outlet } from 'react-router-dom'
import { Bell, ChevronDown, LayoutDashboard, Menu, Settings, Users, X, Activity } from 'lucide-react'
import { useAuth } from '../app/auth'
import { api } from '../services/api'

const mainNav = [
  { to: '/app', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/app/groups', label: 'Groups', icon: Users },
  { to: '/app/activity', label: 'Activity', icon: Activity },
]

export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [logoutError, setLogoutError] = useState('')
  const auth = useAuth()
  const profile = useQuery({ queryKey: ['profile'], queryFn: ({ signal }) => api.get<{ data: { display_name: string; username: string; email: string } }>('/users/me', signal) })
  const unread = useQuery({ queryKey: ['notification-count'], queryFn: ({ signal }) => api.get<{ data: { unread_count: number } }>('/notifications/unread-count', signal) })
  const displayName = profile.data?.data.display_name || profile.data?.data.username || 'Your account'
  const avatar = displayName.slice(0, 1).toUpperCase()

  async function signOut() {
    setLogoutError('')
    try {
      await api.post('/auth/logout')
      auth.endSession()
      window.location.assign('/login')
    } catch {
      setLogoutError('The session could not be revoked. Try again before closing this page.')
    }
  }
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`} aria-label="Main navigation">
      <div className="brand-row"><NavLink to="/app" className="wordmark" aria-label="SplitMate overview"><span className="brand-mark" aria-hidden="true"><i /><i /></span><span>splitmate</span></NavLink><button className="icon-button mobile-close" aria-label="Close navigation" onClick={() => setMenuOpen(false)}><X size={18} /></button></div>
      <nav className="nav-list">
        <p className="nav-caption">Workspace</p>
        {mainNav.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} onClick={() => setMenuOpen(false)} className={({ isActive }) => `nav-link ${isActive ? 'nav-link-active' : ''}`}><Icon size={19} strokeWidth={1.8} /><span>{label}</span></NavLink>)}
      </nav>
      <div className="sidebar-bottom">
        <NavLink to="/app/notifications" className="nav-link"><Bell size={19} strokeWidth={1.8} /><span>Notifications</span></NavLink>
        <NavLink to="/app/settings/profile" className="nav-link"><Settings size={19} strokeWidth={1.8} /><span>Settings</span></NavLink>
        <p className="sidebar-help">Help and feedback will be available when support is configured.</p>
        <div className="account-mini"><span className="avatar" aria-hidden="true">{avatar}</span><span className="account-copy"><strong>{displayName}</strong><small>{profile.data?.data.email || 'Loading account'}</small></span><ChevronDown size={15} /></div>
      </div>
    </aside>
    {menuOpen && <button className="drawer-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
    <div className="workspace">
      <header className="topbar"><button className="icon-button menu-toggle" aria-label="Open navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><Menu size={20} /></button><div className="topbar-context">Shared expenses, made clear.</div><div className="topbar-actions"><NavLink to="/app/notifications" className="icon-button" aria-label={unread.data?.data.unread_count ? `Notifications, ${unread.data.data.unread_count} unread` : 'Notifications'}><Bell size={19} />{Boolean(unread.data?.data.unread_count) && <span className="notification-count">{unread.data?.data.unread_count}</span>}</NavLink><button type="button" className="button button-small button-outline" onClick={signOut}>Sign out</button></div></header>
      <main id="main-content" className="main-content">{logoutError && <p className="feedback feedback-error" role="alert">{logoutError}</p>}<Outlet /></main>
    </div>
  </div>
}
