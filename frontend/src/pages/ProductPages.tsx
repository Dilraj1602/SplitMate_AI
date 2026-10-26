import { useRef, useState, type FormEvent, type HTMLAttributes, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowRight, Plus, Users, WalletCards, ReceiptText, CircleDollarSign, HandCoins, Activity, Eye, EyeOff, UserRound, Settings } from 'lucide-react'
import { useAuth } from '../app/auth'
import { api, ApiError, type Collection, type GroupSummary } from '../services/api'
import { EmptyState, ErrorState, LoadingState, Notice } from '../components/ui/Feedback'
import { PageHeader } from '../components/ui/PageHeader'
import { useToast } from '../components/ui/ToastProvider'
import { allocateShares, localDateForInput, type SplitMode } from '../features/expenses/splitMath'

type PageInfo = { title: string; description: string; endpoint?: string; unavailable?: string }
type MemberSummary = { user_id: string; username?: string | null; display_name?: string | null; role?: string }
type InvitationSummary = { id: string; group_name?: string; inviter_name?: string; status: string; expires_at?: string }
type SettlementSummary = { id: string; group_id: string; payer_user_id: string; recipient_user_id: string; payer_name?: string; recipient_name?: string; amount: string; currency: string; status: string }
type NotificationSummary = { id: string; type: string; title: string; body: string; is_read: boolean; created_at: string; group_id?: string | null; related_entity_type?: string | null; related_entity_id?: string | null }
type DashboardData = { data: Array<{ id: string; group_id: string; description: string; total_amount: string; currency: string; expense_date: string; payer_name?: string | null; paid_by_user_id:string }>; summary: { groups_count: number; expense_count: number; total_owed_by_you: string; total_owed_to_you: string; currency: string }; groups: GroupSummary[] }

const pathConfig: Record<string, PageInfo> = {
  '/app': { title: 'Your overview', description: 'A clear view of the groups and activity you can access.', endpoint: '/dashboard' },
  '/app/groups': { title: 'Groups', description: 'Shared spaces for trips, homes, and everyday plans.', endpoint: '/groups' },
  '/app/activity': { title: 'Activity', description: 'A record of changes across the groups you belong to.', endpoint: '/activity' },
  '/app/notifications': { title: 'Notifications', description: 'Updates about invitations, expenses, and settlements.', endpoint: '/notifications' },
  '/app/invitations': { title: 'Invitations', description: 'Review invitations addressed to your account.', endpoint: '/invitations' },
}

export function OverviewPage() {
  const query = useQuery({ queryKey: ['dashboard'], queryFn: ({ signal }) => api.get<DashboardData>('/dashboard', signal) })
  const profile = useQuery({ queryKey:['profile'], queryFn:({signal})=>api.get<{data:{id:string}}>('/users/me',signal) })
  const activity = useQuery({ queryKey: ['activity', 'dashboard'], queryFn: ({ signal }) => api.get<Collection<{ id:string; description:string; actor_name:string; created_at:string }>>('/activity?limit=4', signal) })
  const currency = (value: string) => `₹${Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  return <><PageHeader title="Your overview" description="A clear view of your groups, expenses, and current balances." />
    {query.isPending ? <LoadingState label="Loading your dashboard" /> : query.isError ? <ErrorState message={messageFor(query.error)} onRetry={() => void query.refetch()} /> : <>
      <section className="dashboard-stats" aria-label="Expense summary">
        <article className="stat-card stat-green"><span className="stat-icon"><Users size={19}/></span><small>Total groups</small><strong>{query.data.summary.groups_count}</strong></article>
        <article className="stat-card stat-blue"><span className="stat-icon"><ReceiptText size={19}/></span><small>Total expenses</small><strong>{query.data.summary.expense_count} {query.data.summary.expense_count === 1 ? 'expense' : 'expenses'}</strong><span className="stat-caption">Active records in your groups</span></article>
        <article className="stat-card stat-orange"><span className="stat-icon"><CircleDollarSign size={19}/></span><small>You owe</small><strong>{currency(query.data.summary.total_owed_by_you)}</strong><span className="stat-caption">Outstanding balance</span></article>
        <article className="stat-card stat-purple"><span className="stat-icon"><HandCoins size={19}/></span><small>Owed to you</small><strong>{currency(query.data.summary.total_owed_to_you)}</strong><span className="stat-caption">Outstanding balance</span></article>
      </section>
      <div className="split-section section-gap"><section className="panel"><div className="panel-heading"><h2>Your groups</h2><Link className="inline-link" to="/app/groups">View all <ArrowRight size={15}/></Link></div>{query.data.groups.length ? <div className="resource-list">{query.data.groups.map(group => <Link className="resource-row" key={group.id} to={`/app/groups/${group.id}`}><span className="group-symbol"><Users size={17}/></span><span className="row-copy"><strong>{group.name}</strong><small>{group.member_count} members · {group.status}</small></span><ArrowRight size={16} /></Link>)}</div> : <EmptyState title="No groups yet"><span>Create your first group to start sharing expenses.</span><Link className="button button-primary empty-action" to="/app/groups/new"><Plus size={16}/>Create group</Link></EmptyState>}</section>
        <section className="panel"><div className="panel-heading"><h2>Recent expenses</h2><Link className="inline-link" to="/app/expenses">View all expenses <ArrowRight size={15}/></Link></div>{query.data.data.length ? <><p className="payer-legend"><span className="payer-dot payer-dot-you"/> Paid by you <span className="payer-dot payer-dot-other"/> Paid by another member</p><div className="resource-list">{query.data.data.map(expense => { const known=Boolean(profile.data);const paidByYou=profile.data?.data.id===expense.paid_by_user_id;return <Link className="resource-row expense-list-row" key={expense.id} to={`/app/expenses/${expense.id}`}><span className={`avatar payer-avatar ${known?(paidByYou?'payer-you':'payer-other'):''}`}>{(expense.payer_name||'?').slice(0,1).toUpperCase()}</span><span className="row-copy"><strong>{expense.description}</strong><small><span className={`payer-label ${known?(paidByYou?'payer-label-you':'payer-label-other'):''}`}>Paid by {known&&paidByYou?'you':expense.payer_name||'a group member'}</span> · {expense.expense_date}</small></span><strong className="tabular-amount">{currency(expense.total_amount)}</strong></Link>})}</div></> : <EmptyState title="No expenses yet">Expenses from your groups will appear here.</EmptyState>}</section></div>
      <div className="split-section"><section className="panel"><div className="panel-heading"><h2>Recent activity</h2><Link className="inline-link" to="/app/activity">View all <ArrowRight size={15}/></Link></div>{activity.isPending ? <LoadingState label="Loading activity"/> : activity.isError ? <ErrorState message="Activity could not be loaded." onRetry={() => void activity.refetch()}/> : activity.data.data.length ? <div className="resource-list">{activity.data.data.map(item => <div className="resource-row" key={item.id}><span className="group-symbol"><Activity size={17}/></span><span className="row-copy"><strong>{item.description}</strong><small>{item.actor_name} · {new Date(item.created_at).toLocaleString()}</small></span></div>)}</div> : <EmptyState title="No recent activity">Updates from your groups will appear here.</EmptyState>}</section><section className="panel"><h2>Quick actions</h2><div className="quick-actions"><Link className="button button-primary" to="/app/groups/new"><Plus size={16}/>Create group</Link><Link className="button button-outline" to="/app/groups"><ReceiptText size={16}/>Add expense</Link><Link className="button button-outline" to="/app/settlements"><WalletCards size={16}/>Settle up</Link><Link className="button button-outline" to="/app/expenses"><ArrowRight size={16}/>View all expenses</Link></div><p className="field-hint">Choose a group to add an expense or record a settlement.</p></section></div>
    </>}
  </>
}
export function GroupsPage() { return <GroupsListPage /> }
export function ActivityPage() { return <ResourcePage info={pathConfig['/app/activity']} /> }
export function NotificationsPage() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['notifications'], queryFn: ({ signal }) => api.get<Collection<NotificationSummary>>('/notifications', signal) })
  const unread = useQuery({ queryKey: ['notification-count'], queryFn: ({ signal }) => api.get<{ data: { unread_count: number } }>('/notifications/unread-count', signal) })
  async function markRead(id?: string) {
    try {
      await api.post(id ? `/notifications/${id}/read` : '/notifications/read-all')
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['notifications'] }), queryClient.invalidateQueries({ queryKey: ['notification-count'] })])
      toast.success(id ? 'Notification marked as read.' : 'All notifications marked as read.')
    } catch (cause) { toast.error(messageFor(cause)) }
  }
  return <><PageHeader title="Notifications" description="Updates about invitations, expenses, and settlements." action={unread.data?.data.unread_count ? <button className="button button-outline" onClick={() => void markRead()}>Mark all read</button> : undefined} />
    {query.isPending ? <LoadingState label="Loading notifications" /> : query.isError ? <ErrorState message={messageFor(query.error)} onRetry={() => void query.refetch()} /> : query.data.data.length === 0 ? <EmptyState title="No notifications">Updates about your groups will appear here.</EmptyState> : <div className="resource-list">{query.data.data.map(item => <article className="resource-row resource-row-wrap" key={item.id}><span className="row-copy"><strong>{item.title}</strong><small>{item.body} · {new Date(item.created_at).toLocaleString()}</small></span>{item.type === 'invitation' && item.related_entity_type === 'invitation' && <Link className="button button-small button-primary" to="/app/invitations">Review invitation</Link>}{!item.is_read && <button className="button button-small button-outline" onClick={() => void markRead(item.id)}>Mark read</button>}</article>)}</div>}
  </>
}
export function InvitationsPage() {
  const query = useQuery({ queryKey: ['invitations'], queryFn: ({ signal }) => api.get<Collection<InvitationSummary>>('/invitations', signal) })
  return <><PageHeader title="Invitations" description="Review group invitations addressed to your account." />
    {query.isPending ? <LoadingState label="Loading invitations" /> : query.isError ? <ErrorState message={messageFor(query.error)} onRetry={() => void query.refetch()} /> : query.data.data.length === 0 ? <EmptyState title="No invitations">New invitations will appear here when someone adds you to a group.</EmptyState> : <div className="resource-list">{query.data.data.map(invitation => <InvitationRow key={invitation.id} item={invitation} />)}</div>}
  </>
}

export function GroupPage() {
  const { groupId = '' } = useParams()
  const query = useQuery({ queryKey: ['group', groupId], queryFn: ({ signal }) => api.get<{ data: GroupSummary }>(`/groups/${groupId}`, signal), enabled: Boolean(groupId) })
  if (query.isPending) return <LoadingState label="Loading group" />
  if (query.isError) return <><PageHeader title="Group" description="Group details are available to active members." /><ErrorState message={messageFor(query.error)} onRetry={() => void query.refetch()} /></>
  const group = query.data.data
  return <><PageHeader eyebrow="Groups" title={group.name} description={group.description || 'Group overview'} action={<Link className="button button-primary" to={`/app/groups/${groupId}/expenses/new`}><Plus size={16} />Add expense</Link>} /><GroupTabs groupId={groupId} /><div className="split-section"><section className="panel"><h2>Recent expenses</h2><ExpenseRows endpoint={`/groups/${groupId}/expenses?limit=5`} /></section><section className="panel"><h2>Group summary</h2><p className="muted-copy">{group.member_count ?? '—'} active members</p><Link className="inline-link" to={`/app/groups/${groupId}/balances`}>View balances <ArrowRight size={15} /></Link></section></div></>
}

export function GroupCreatePage() { return <MutationPage title="Create a group" description="Bring your shared expenses together in one place." endpoint="/groups" fields={[{ name: 'name', label: 'Group name', required: true, maxLength: 100 }, { name: 'description', label: 'Description', required: false, maxLength: 500 }]} submit="Create group" successMessage="Group created successfully." redirectOnSuccess="group" /> }
export function GroupSettingsPage() { const { groupId = '' } = useParams(); return <MutationPage title="Group settings" description="Update the group details you are allowed to manage." endpoint={`/groups/${groupId}`} method="patch" fields={[{ name: 'name', label: 'Group name', required: true }, { name: 'description', label: 'Description', required: false }]} submit="Save changes" /> }
export function MembersPage() {
  const { groupId = '' } = useParams()
  const query = useQuery({ queryKey: ['members', groupId], queryFn: ({ signal }) => api.get<Collection<MemberSummary>>(`/groups/${groupId}/members`, signal) })
  return <><PageHeader title="Members and invitations" description="Active members and pending invitations for this group." action={<><Link className="button button-primary" to={`/app/groups/${groupId}/members/invite`}>Invite a member</Link><Link className="button button-outline" to={`/app/groups/${groupId}/members/invite-link`}>Create invite link</Link></>} /><GroupTabs groupId={groupId} />
    {query.isPending ? <LoadingState label="Loading members" /> : query.isError ? <ErrorState message={messageFor(query.error)} onRetry={() => void query.refetch()} /> : query.data.data.length === 0 ? <EmptyState title="No members yet">Group members will appear here.</EmptyState> : <div className="resource-list">{query.data.data.map(member => <div className="resource-row" key={member.user_id}><span className="avatar" aria-hidden="true">{(member.display_name || member.username || 'M').slice(0, 1).toUpperCase()}</span><span className="row-copy"><strong>{member.display_name || member.username || 'Group member'}</strong><small>{member.username ? `@${member.username} · ` : ''}{member.role || 'Member'}</small></span></div>)}</div>}
    <section className="panel section-gap"><h2>Membership actions</h2><p className="muted-copy">Removing members and leaving groups are not enabled until outstanding-balance and administrator-transfer rules are resolved.</p></section>
  </>
}
export function InviteMemberPage() { const { groupId = '' } = useParams(); return <InviteMemberForm groupId={groupId}/> }
export function InviteLinkPage() { const { groupId = '' } = useParams(); return <InviteLinkCreator groupId={groupId} /> }
export function BalancesPage() { const { groupId = '' } = useParams(); return <GroupBalancesPage groupId={groupId}/> }
export function SettlementsPage() {
  const { groupId = '' } = useParams()
  const query = useQuery({ queryKey: ['settlements', groupId], queryFn: ({ signal }) => api.get<Collection<SettlementSummary>>(`/groups/${groupId}/settlements`, signal) })
  return <><PageHeader title="Settlements" description="A proposed settlement changes balances only after the recipient confirms it." action={<Link to={`/app/groups/${groupId}/settlements/new`} className="button button-primary"><Plus size={16} />Record settlement</Link>} /><GroupTabs groupId={groupId} />
    <Notice>Pending settlements do not reduce the official outstanding balance.</Notice>
    {query.isPending ? <LoadingState label="Loading settlements" /> : query.isError ? <ErrorState message={messageFor(query.error)} onRetry={() => void query.refetch()} /> : query.data.data.length === 0 ? <EmptyState title="No settlements yet">Recorded payments will appear here with their confirmation status.</EmptyState> : <div className="resource-list">{query.data.data.map(item => <SettlementRow key={item.id} item={item} groupId={groupId} />)}</div>}
  </>
}
export function PersonalSettlementsPage() {
  const query = useQuery({ queryKey: ['settlements', 'personal'], queryFn: ({ signal }) => api.get<Collection<SettlementSummary>>('/settlements', signal) })
  return <><PageHeader title="Settlements" description="Proposed and confirmed payments across your groups." />{query.isPending ? <LoadingState /> : query.isError ? <ErrorState message={messageFor(query.error)} onRetry={() => void query.refetch()} /> : query.data.data.length === 0 ? <EmptyState title="No settlements yet">Proposed payments across your groups will appear here.</EmptyState> : <div className="resource-list">{query.data.data.map(item => <div key={item.id}><SettlementRow item={item} groupId={item.group_id} /><Link className="inline-link settlement-detail-link" to={`/app/settlements/${item.id}`}>View details <ArrowRight size={14} /></Link></div>)}</div>}</>
}
export function SettlementCreatePage() { const { groupId = '' } = useParams(); return <SettlementProposalForm groupId={groupId}/> }
export function SettlementDetailPage() {
  const { settlementId = '' } = useParams()
  const query = useQuery({ queryKey: ['settlement', settlementId], queryFn: ({ signal }) => api.get<{ data: SettlementSummary }>(`/settlements/${settlementId}`, signal), enabled: Boolean(settlementId) })
  return <><PageHeader title="Settlement details" description="Settlement status and participants." />{query.isPending ? <LoadingState /> : query.isError ? <ErrorState message={messageFor(query.error)} onRetry={() => void query.refetch()} /> : <div className="resource-list"><SettlementRow item={query.data.data} groupId={query.data.data.group_id} /></div>}</>
}
export function InvitePreviewPage() { return <InvitePreview /> }
export function ExpensesPage() { const { groupId = '' } = useParams(); return <><PageHeader title="Expenses" description="Shared expenses in your group." action={<Link className="button button-primary" to={`/app/groups/${groupId}/expenses/new`}><Plus size={16} />Add expense</Link>} /><GroupTabs groupId={groupId}/><ExpenseRows endpoint={`/groups/${groupId}/expenses`}/></> }
export function AllExpensesPage() { return <><PageHeader title="All expenses" description="Active expenses across the groups you belong to."/><ExpenseRows endpoint="/expenses"/></> }
export function ExpenseCreatePage() { const { groupId = '' } = useParams(); return <ExpenseEditor groupId={groupId} /> }
export function ExpenseEditPage() { const { expenseId = '' } = useParams(); return <MutationPage title="Edit expense" description="Update the expense details." endpoint={`/expenses/${expenseId}`} method="patch" fields={[{ name: 'description', label: 'Description', required: true }, { name: 'total_amount', label: 'Total amount', inputMode: 'decimal', required: true }]} submit="Save changes" /> }
export function ExpenseDetailPage() { const { expenseId = '' } = useParams(); return <ExpenseDetail expenseId={expenseId} /> }
export function ExpenseHistoryPage() { const { expenseId = '' } = useParams(); return <ResourcePage info={{ title: 'Expense history', description: 'Audited changes for this expense.', endpoint: `/expenses/${expenseId}/history` }} /> }
export function PersonalBalancesPage() { return <ResourcePage info={{ title: 'Your balances', description: 'Your net position in each group, with currencies kept separate.', endpoint: '/balances' }} /> }
export function ProfilePage() { return <ProfileEditor /> }
export function AccountSettingsPage() { return <><PageHeader title="Account settings" description="Manage your account details and sign-in security."/><section className="settings-options"><Link className="panel settings-option" to="/app/settings/profile"><span className="group-symbol"><UserRound size={18}/></span><span className="row-copy"><strong>Profile information</strong><small>Username, display name, and email address</small></span><ArrowRight size={17}/></Link><Link className="panel settings-option" to="/app/settings/security"><span className="group-symbol"><Settings size={18}/></span><span className="row-copy"><strong>Password and security</strong><small>Change your account password</small></span><ArrowRight size={17}/></Link></section></> }
export function SecurityPage() { return <MutationPage title="Change password" description="Choose a strong password to protect your account." endpoint="/auth/change-password" fields={[{ name: 'current_password', label: 'Current password', type: 'password', required: true }, { name: 'new_password', label: 'New password', type: 'password', required: true }, { name: 'confirm_password', label: 'Confirm new password', type: 'password', required: true }]} submit="Update password" successMessage="Password updated. Sign in again with your new password." /> }
function ProfileEditor() {
  type Profile = { id: string; username: string; email: string; display_name: string; is_email_verified: boolean; created_at: string; next_username_change_at: string | null; username_change_cooldown_days: number }
  const client = useQueryClient()
  const toast = useToast()
  const profile = useQuery({ queryKey: ['profile'], queryFn: ({ signal }) => api.get<{ data: Profile }>('/users/me', signal) })
  const [displayName, setDisplayName] = useState<string | null>(null)
  const [username, setUsername] = useState<string | null>(null)
  async function save(event: FormEvent) {
    event.preventDefault()
    try { await api.patch('/users/me', { display_name: displayName ?? profile.data?.data.display_name, username: username ?? profile.data?.data.username }); toast.success('Profile updated.'); setDisplayName(null); setUsername(null); await client.invalidateQueries({ queryKey: ['profile'] }) }
    catch (cause) { toast.error(messageFor(cause)) }
  }
  const data = profile.data?.data
  const cooldown = data?.next_username_change_at ? new Date(data.next_username_change_at) : null
  const cooldownActive = Boolean(cooldown && cooldown.getTime() > Date.now())
  return <><PageHeader title="My profile" description="Manage the personal details associated with your account." />{profile.isPending ? <LoadingState label="Loading your profile"/> : profile.isError ? <ErrorState message={messageFor(profile.error)} onRetry={() => void profile.refetch()}/> : <div className="profile-layout"><section className="panel profile-summary"><span className="avatar avatar-large">{(data?.display_name || data?.username || '?').slice(0,1).toUpperCase()}</span><div><h2>{data?.display_name || data?.username}</h2><p>{data?.email}</p><small>Member since {data?.created_at ? new Date(data.created_at).toLocaleDateString() : '—'}</small></div></section><form className="form-panel profile-form" onSubmit={save}><h2>Profile details</h2><div className="field-wrap"><label htmlFor="display-name">Display name</label><input id="display-name" value={displayName ?? data?.display_name ?? ''} onChange={e => setDisplayName(e.target.value)} required maxLength={100}/></div><div className="field-wrap"><label htmlFor="profile-username">Username</label><input id="profile-username" value={username ?? data?.username ?? ''} onChange={e => setUsername(e.target.value)} required minLength={3} maxLength={30} pattern="[A-Za-z0-9_]+" aria-describedby="username-help"/><small id="username-help" className="field-hint">3–30 letters, numbers, or underscores.{cooldownActive ? ` You can change your username again on ${cooldown!.toLocaleDateString()}.` : data?.username_change_cooldown_days ? ` Changes are limited to once every ${data.username_change_cooldown_days} days.` : ''}</small></div><div className="field-wrap"><label htmlFor="profile-email">Email address</label><input id="profile-email" value={data?.email ?? ''} readOnly/><small className="field-hint">Email changes require verification and aren’t available yet.</small></div><button className="button button-primary" type="submit">Save profile</button></form><section className="panel profile-security"><div><h2>Sign-in security</h2><p className="muted-copy">Password-based accounts can update their password at any time.</p></div><Link className="button button-outline" to="/app/settings/security">Change password <ArrowRight size={15}/></Link></section></div>}</>
}
function InvitePreview() {
  const toast=useToast()
  const { token = '' } = useParams()
  const query = useQuery({ queryKey: ['invite-preview', token], queryFn: ({ signal }) => api.get<{ data: { name?: string; description?: string } }>(`/invite-links/${encodeURIComponent(token)}/preview`, signal), enabled: Boolean(token) })
  const [busy, setBusy] = useState(false)
  const { authenticated } = useAuth()
  const queryClient = useQueryClient()
  async function requestJoin() {
    setBusy(true)
    try {
      await api.post(`/invite-links/${encodeURIComponent(token)}/join-requests`)
      toast.success('Your request was sent. Group membership is pending administrator approval.')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['invitations'] }),
        queryClient.invalidateQueries({ queryKey: ['notifications'] }),
        queryClient.invalidateQueries({ queryKey: ['notification-count'] }),
        queryClient.invalidateQueries({ queryKey: ['groups'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['activity'] }),
      ])
    } catch (cause) { toast.error(messageFor(cause)) }
    finally { setBusy(false) }
  }
  return <><PageHeader title="Group invitation" description="Review this group before requesting to join." />
    {query.isPending ? <LoadingState label="Loading invitation" /> : query.isError ? <ErrorState message={messageFor(query.error)} onRetry={() => void query.refetch()} /> : <section className="panel"><h2>{query.data.data.name || 'Invitation link'}</h2><p className="muted-copy">{query.data.data.description || 'The invitation preview contains limited group information.'}</p></section>}
    {authenticated ? <button className="button button-primary" onClick={requestJoin} disabled={busy || query.isError}>{busy ? 'Sending…' : 'Request to join'}</button> : <Link to="/login" className="button button-primary">Sign in to continue</Link>}
    <p className="auth-contract-note">Opening this link does not add you to the group.</p>
  </>
}
export function AccessDeniedPage() { return <><PageHeader title="Sign in required" description="Sign in to continue." /><Link className="button button-primary" to="/login">Go to sign in</Link></> }

function GroupsListPage() {
  const query = useQuery({ queryKey: ['groups'], queryFn: ({ signal }) => api.get<Collection<GroupSummary>>('/groups?limit=20&offset=0', signal) })
  return <><PageHeader title="Groups" description="Shared spaces for trips, homes, and everyday plans." action={<Link to="/app/groups/new" className="button button-primary"><Plus size={16} />Create group</Link>} />
    {query.isPending ? <LoadingState label="Loading groups" /> : query.isError ? <ErrorState message={messageFor(query.error)} onRetry={() => void query.refetch()} /> : query.data.data.length === 0 ? <EmptyState title="No groups yet">Create a group to start organizing shared expenses.</EmptyState> : <div className="resource-list">{query.data.data.map(group => <Link key={group.id} className="resource-row group-row" to={`/app/groups/${group.id}`}><span className="row-icon"><WalletCards size={18} /></span><span className="row-copy"><strong>{group.name}</strong><small>{group.description || `${group.member_count ?? '—'} members`}</small></span><span className="status-label">{group.status === 'archived' ? 'Archived' : 'Active'}</span><ArrowRight size={16} /></Link>)}</div>}
  </>
}

function ResourcePage({ info, action, tabs }: { info: PageInfo; action?: ReactNode; tabs?: ReactNode }) {
  const query = useQuery({ queryKey: ['resource', info.endpoint], queryFn: ({ signal }) => api.get<unknown>(info.endpoint as string, signal), enabled: Boolean(info.endpoint) })
  return <><PageHeader title={info.title} description={info.description} action={action} />{tabs}
    {!info.endpoint ? <EmptyState title="Nothing to show yet">This information is not available yet.</EmptyState> : query.isPending ? <LoadingState /> : query.isError ? <ErrorState message={messageFor(query.error)} onRetry={() => void query.refetch()} /> : <ApiDataState data={query.data} title={info.title} unavailable={info.unavailable} />}
  </>
}

type GroupBalance = { user_id: string; username: string; display_name: string; net_amount: string; currency: string; position: 'owed_to' | 'owes' | 'settled' }
export function GroupBalancesPage({ groupId }: { groupId: string }) {
  const balances = useQuery({ queryKey: ['resource', `/groups/${groupId}/balances`], queryFn: ({ signal }) => api.get<Collection<GroupBalance>>(`/groups/${groupId}/balances`, signal) })
  const profile = useQuery({ queryKey: ['profile'], queryFn: ({ signal }) => api.get<{ data: { id: string } }>('/users/me', signal) })
  const money = (value: string, currency = 'INR') => `${currency === 'INR' ? '₹' : currency} ${Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  return <><PageHeader title="Balances" description="See what each group member owes and is owed."/><GroupTabs groupId={groupId}/>{balances.isPending || profile.isPending ? <LoadingState label="Loading group balances"/> : balances.isError ? <ErrorState message={messageFor(balances.error)} onRetry={() => void balances.refetch()}/> : profile.isError ? <ErrorState message={messageFor(profile.error)} onRetry={() => void profile.refetch()}/> : balances.data.data.length === 0 ? <EmptyState title="No group members">Active members will appear here.</EmptyState> : <section className="panel balance-panel"><div className="balance-intro"><h2>Member balances</h2><p className="muted-copy">Positive amounts are owed to that member. Negative amounts are what they owe.</p></div><div className="resource-list">{balances.data.data.map(row => { const current = row.user_id === profile.data.data.id; const amount = Number(row.net_amount); const label = amount > 0 ? 'Owed to them' : amount < 0 ? 'They owe' : 'Settled'; return <article className={`resource-row balance-row ${current ? 'balance-current' : ''}`} key={row.user_id}><span className={`avatar ${current ? 'avatar-current' : ''}`}>{(row.display_name || row.username || '?').slice(0,1).toUpperCase()}</span><span className="row-copy"><strong>{row.display_name || row.username || 'Group member'}{current && <span className="you-tag">You</span>}</strong><small>{label}</small></span><strong className={`balance-amount ${amount > 0 ? 'balance-positive' : amount < 0 ? 'balance-negative' : ''}`}>{amount < 0 ? '−' : ''}{money(Math.abs(amount).toFixed(2), row.currency)}</strong></article> })}</div></section>}</>
}

type ExpenseListItem = { id:string; group_id:string; group_name?:string; description:string; total_amount:string; currency:string; expense_date:string; paid_by_user_id:string; payer_name:string|null }
export function ExpenseRows({ endpoint }: { endpoint:string }) {
  const expenses = useQuery({ queryKey:['resource',endpoint], queryFn:({signal})=>api.get<Collection<ExpenseListItem>>(endpoint,signal) })
  const profile = useQuery({ queryKey:['profile'], queryFn:({signal})=>api.get<{data:{id:string}}>('/users/me',signal) })
  const money = (value:string,currency:string) => `${currency === 'INR' ? '₹' : `${currency} `}${Number(value).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}`
  return <>{expenses.isPending || profile.isPending ? <LoadingState label="Loading expenses"/> : expenses.isError ? <ErrorState message={messageFor(expenses.error)} onRetry={()=>void expenses.refetch()}/> : profile.isError ? <ErrorState message={messageFor(profile.error)} onRetry={()=>void profile.refetch()}/> : expenses.data.data.length === 0 ? <EmptyState title="No expenses yet">{endpoint === '/expenses' ? 'Expenses from your groups will appear here.' : 'Expenses added to this group will appear here.'}</EmptyState> : <><p className="payer-legend"><span className="payer-dot payer-dot-you"/> Paid by you <span className="payer-dot payer-dot-other"/> Paid by another member</p><div className="resource-list">{expenses.data.data.map(item=>{const paidByYou=item.paid_by_user_id===profile.data.data.id;const payer=item.payer_name||'Group member';return <Link className="resource-row expense-list-row" key={item.id} to={`/app/expenses/${item.id}`}><span className={`avatar payer-avatar ${paidByYou?'payer-you':'payer-other'}`}>{payer.slice(0,1).toUpperCase()}</span><span className="row-copy"><strong>{item.description}</strong><small><span className={`payer-label ${paidByYou?'payer-label-you':'payer-label-other'}`}>Paid by {paidByYou?'you':payer}</span> · {item.expense_date}{item.group_name ? ` · ${item.group_name}` : ''}</small></span><strong className="tabular-amount">{money(item.total_amount,item.currency)}</strong></Link>})}</div></>}</>
}

function InviteMemberForm({groupId}:{groupId:string}) {
  const toast=useToast()
  const [recipientType,setRecipientType]=useState<'email'|'username'>('email')
  const [recipient,setRecipient]=useState('')
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  const queryClient=useQueryClient()
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();setError('')
    const value=recipient.trim()
    if(!value){setError(recipientType==='email'?'Enter an email address.':'Enter a username.');return}
    if(recipientType==='username'&&!/^[A-Za-z0-9_]{3,30}$/.test(value)){setError('Usernames must be 3–30 letters, numbers, or underscores.');return}
    setBusy(true)
    try {
      await api.post(`/groups/${groupId}/invitations`,{[recipientType]:value})
      toast.success('Invitation sent successfully.');setRecipient('')
      await Promise.all([
        queryClient.invalidateQueries({queryKey:['invitations']}),
        queryClient.invalidateQueries({queryKey:['resource']}),
        queryClient.invalidateQueries({queryKey:['activity']}),
      ])
    } catch(cause) { toast.error(cause instanceof ApiError&&cause.status===404?cause.message:messageFor(cause)) }
    finally { setBusy(false) }
  }
  return <><PageHeader title="Invite a member" description="Invite someone by their unique username or email address."/><GroupTabs groupId={groupId}/><section className="form-panel"><form className="form-stack" onSubmit={submit}><div className="field-wrap"><label htmlFor="recipient-type">Invite using</label><select id="recipient-type" value={recipientType} onChange={event=>{setRecipientType(event.target.value as 'email'|'username');setRecipient('');setError('')}}><option value="email">Email address</option><option value="username">Username</option></select></div><div className="field-wrap"><label htmlFor="invite-recipient">{recipientType==='email'?'Email address':'Username'}</label><input id="invite-recipient" name={recipientType} type={recipientType==='email'?'email':'text'} autoComplete={recipientType==='email'?'email':'username'} value={recipient} onChange={event=>setRecipient(event.target.value)} maxLength={recipientType==='email'?255:30} minLength={recipientType==='username'?3:undefined} pattern={recipientType==='username'?'[A-Za-z0-9_]{3,30}':undefined} placeholder={recipientType==='email'?'name@example.com':'e.g. rahul_23'} required aria-describedby="invite-hint"/><small className="field-hint" id="invite-hint">{recipientType==='username'?'Usernames are unique and are not case-sensitive. The person must already have a Splitmate account.':'They can accept after signing in or creating an account with this email.'}</small></div>{error&&<ErrorState message={error} />}<button className="button button-primary" type="submit" disabled={busy}>{busy?'Sending invitation…':'Send invitation'}</button></form></section></>
}

type SettlementOption = { user_id:string; username:string; display_name:string; currency:string; outstanding_amount:string; pending_amount:string; available_amount:string }
function SettlementProposalForm({groupId}:{groupId:string}) {
  const toast=useToast()
  const queryClient=useQueryClient()
  const options=useQuery({queryKey:['settlement-options',groupId],queryFn:({signal})=>api.get<Collection<SettlementOption>>(`/groups/${groupId}/settlement-options`,signal)})
  const [recipientId,setRecipientId]=useState('')
  const [amount,setAmount]=useState('')
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  const idempotencyKey=useRef(crypto.randomUUID())
  const recipient=options.data?.data.find(option=>option.user_id===recipientId)
  const available=Number(recipient?.available_amount||0)
  const remaining=Math.max(0,available-(Number(amount)||0))
  const money=(value:number,currency='INR')=>`${currency==='INR'?'₹':`${currency} `}${value.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}`

  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();setError('')
    const entered=Number(amount)
    if(!recipient){setError('Choose a member you owe.');return}
    if(!Number.isFinite(entered)||entered<=0){setError('Enter an amount greater than zero.');return}
    if(!/^\d+(\.\d{1,2})?$/.test(amount)){setError('Enter an amount with no more than two decimal places.');return}
    if(entered>available){setError(`Amount cannot exceed ${money(available,recipient.currency)} available to propose.`);return}
    setBusy(true)
    try {
      await api.post(`/groups/${groupId}/settlements`,{recipient_user_id:recipient.user_id,amount:amount.trim(),currency:recipient.currency,idempotency_key:idempotencyKey.current})
      toast.success(`Settlement proposal sent to ${recipient.display_name||recipient.username}. They must confirm before balances change.`)
      idempotencyKey.current=crypto.randomUUID();setRecipientId('');setAmount('')
      await Promise.all([
        queryClient.invalidateQueries({queryKey:['settlement-options',groupId]}),
        queryClient.invalidateQueries({queryKey:['settlements',groupId]}),
        queryClient.invalidateQueries({queryKey:['settlements','personal']}),
        queryClient.invalidateQueries({queryKey:['resource',`/groups/${groupId}/balances`]}),
        queryClient.invalidateQueries({queryKey:['dashboard']}),
        queryClient.invalidateQueries({queryKey:['activity']}),
      ])
    } catch(cause){toast.error(messageFor(cause))}
    finally{setBusy(false)}
  }
  return <><PageHeader title="Record a settlement" description="Propose a payment to a group member you owe. The recipient must confirm before the group balance changes."/><GroupTabs groupId={groupId}/>{options.isPending?<LoadingState label="Checking outstanding balances"/>:options.isError?<ErrorState message={messageFor(options.error)} onRetry={()=>void options.refetch()}/>:options.data.data.length===0?<EmptyState title="No available payments to settle">You have no unsettled amounts to propose right now. Existing proposals may already cover the balances and need confirmation.</EmptyState>:<section className="form-panel"><form className="form-stack" onSubmit={submit}>
    <div className="field-wrap"><label htmlFor="settlement-recipient">Pay to / Settle with</label><select id="settlement-recipient" value={recipientId} onChange={event=>{const next=options.data.data.find(option=>option.user_id===event.target.value);setRecipientId(event.target.value);setAmount(next?.available_amount||'');setError('')}} required><option value="">Select a member you owe</option>{options.data.data.map(option=><option key={option.user_id} value={option.user_id}>{option.display_name||option.username} · {money(Number(option.available_amount),option.currency)} available</option>)}</select></div>
    {recipient&&<><div className="settlement-balance-note"><span>Outstanding balance</span><strong>{money(Number(recipient.outstanding_amount),recipient.currency)}</strong>{Number(recipient.pending_amount)>0&&<small>{money(Number(recipient.pending_amount),recipient.currency)} already in pending proposals</small>}</div><div className="field-wrap"><label htmlFor="settlement-amount">Amount</label><input id="settlement-amount" name="amount" type="number" inputMode="decimal" min="0.01" max={recipient.available_amount} step="0.01" value={amount} onChange={event=>setAmount(event.target.value)} required aria-describedby="settlement-amount-hint"/><small id="settlement-amount-hint" className="field-hint">You can record a partial settlement up to {money(available,recipient.currency)}.</small></div><div className="field-wrap"><label htmlFor="settlement-currency">Currency</label><input id="settlement-currency" value={recipient.currency} readOnly/></div><div className="settlement-confirmation">You are paying <strong>{recipient.display_name||recipient.username}</strong> {money(Number(amount)||0,recipient.currency)}.{Number(amount)>0&&<small>{money(remaining,recipient.currency)} will remain available for a later proposal.</small>}</div></>}
    {error&&<ErrorState message={error} />}<button className="button button-primary" type="submit" disabled={busy||!recipient}>{busy?'Recording…':'Record proposed settlement'}</button>
  </form></section>}</>
}

function ApiDataState({ data, title, unavailable }: { data: unknown; title: string; unavailable?: string }) {
  if (isRecord(data) && Array.isArray(data.data)) return <ApiCollectionState items={data.data} emptyTitle={`No ${title.toLowerCase()} yet`} emptyText={unavailable || `Your ${title.toLowerCase()} will appear here.`} />
  return <EmptyState title="Nothing to show yet">{unavailable || `${title} are not available right now.`}</EmptyState>
}

function ApiCollectionState({ items, emptyTitle, emptyText }: { items: unknown[]; emptyTitle: string; emptyText: string }) {
  if (items.length === 0) return <EmptyState title={emptyTitle}>{emptyText}</EmptyState>
  return <div className="resource-list">{items.map((item, index) => {
    if (!isRecord(item)) return <div className="resource-row" key={index}><span className="row-copy"><strong>Item</strong></span></div>
    const title = firstText(item, ['name', 'description', 'group_name', 'title', 'id']) || `Record ${index + 1}`
    const subtitle = firstText(item, ['display_name', 'username', 'status', 'created_at', 'expense_date'])
    const amount = firstText(item, ['total_amount', 'amount'])
    const currency = firstText(item, ['currency'])
    return <div className="resource-row" key={firstText(item, ['id']) || index}><span className="row-copy"><strong>{title}</strong>{subtitle && <small>{subtitle}</small>}</span>{amount && <strong className="tabular-amount">{currency ? `${currency} ` : ''}{amount}</strong>}</div>
  })}</div>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function firstText(record: Record<string, unknown>, fields: string[]): string | undefined {
  for (const field of fields) if (typeof record[field] === 'string') return record[field] as string
  return undefined
}

function InvitationRow({ item }: { item: InvitationSummary }) {
  const toast=useToast()
  const [busy, setBusy] = useState(false)
  const queryClient = useQueryClient()
  async function respond(decision: 'accept' | 'decline') {
    setBusy(true)
    try {
      await api.post(`/invitations/${item.id}/${decision}`)
      toast.success(decision === 'accept' ? 'Invitation accepted.' : 'Invitation declined.')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['invitations'] }),
        queryClient.invalidateQueries({ queryKey: ['notifications'] }),
        queryClient.invalidateQueries({ queryKey: ['notification-count'] }),
        queryClient.invalidateQueries({ queryKey: ['groups'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['activity'] }),
      ])
    } catch (cause) { toast.error(messageFor(cause)) }
    finally { setBusy(false) }
  }
  return <article className="resource-row resource-row-wrap"><span className="row-icon"><Users size={18} /></span><span className="row-copy"><strong>{item.group_name || 'Group invitation'}</strong><small>{item.inviter_name ? `Invited by ${item.inviter_name} · ` : ''}{item.status}{item.expires_at ? ` · Expires ${new Date(item.expires_at).toLocaleDateString()}` : ''}</small></span>{item.status === 'pending' && <span className="row-actions"><button className="button button-small button-primary" disabled={busy} onClick={() => respond('accept')}>Accept</button><button className="button button-small button-outline" disabled={busy} onClick={() => respond('decline')}>Decline</button></span>}</article>
}

function SettlementRow({ item, groupId }: { item: SettlementSummary; groupId: string }) {
  const toast=useToast()
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(item.status)
  const queryClient = useQueryClient()
  const profile = useQuery({ queryKey: ['profile'], queryFn: ({ signal }) => api.get<{ data: { id: string } }>('/users/me', signal) })
  async function respond(action: 'confirm' | 'reject' | 'cancel') {
    if (action === 'confirm' && !window.confirm(`Confirm ${item.currency} ${item.amount} from ${item.payer_name || 'the payer'} to ${item.recipient_name || 'the recipient'}?`)) return
    setBusy(true)
    try { await api.post(`/settlements/${item.id}/${action}`); setStatus(action === 'confirm' ? 'confirmed' : action === 'reject' ? 'rejected' : 'cancelled'); toast.success(action==='confirm'?'Settlement confirmed.':action==='reject'?'Settlement rejected.':'Settlement cancelled.'); await queryClient.invalidateQueries({ queryKey: ['settlements'] }); await queryClient.invalidateQueries({ queryKey: ['settlement', item.id] }); await queryClient.invalidateQueries({ queryKey: ['settlement-options', groupId] }); await queryClient.invalidateQueries({ queryKey: ['dashboard'] }); await queryClient.invalidateQueries({ queryKey: ['resource', `/groups/${groupId}/balances`] }) }
    catch (cause) { toast.error(messageFor(cause)) }
    finally { setBusy(false) }
  }
  const currentUserId = profile.data?.data.id
  const recipient = currentUserId === item.recipient_user_id
  const creator = currentUserId === item.payer_user_id
  return <article className="resource-row resource-row-wrap"><span className="row-copy"><strong>{item.payer_name || 'Payer'} → {item.recipient_name || 'Recipient'}</strong><small>{status} · {item.currency} {item.amount}</small></span>{status === 'pending' && (recipient || creator) && <span className="row-actions">{recipient && <><button className="button button-small button-primary" disabled={busy} onClick={() => respond('confirm')}>Confirm</button><button className="button button-small button-outline" disabled={busy} onClick={() => respond('reject')}>Reject</button></>}{creator && <button className="button button-small button-outline" disabled={busy} onClick={() => respond('cancel')}>Cancel</button>}</span>}</article>
}

function InviteLinkCreator({ groupId }: { groupId: string }) {
  const toast=useToast()
  const [shareUrl, setShareUrl] = useState('')
  const [busy, setBusy] = useState(false)
  async function createLink() {
    setBusy(true); setShareUrl('')
    try {
      const response = await api.post<{ data?: { url?: string; invite_url?: string } }>(`/groups/${groupId}/invite-links`)
      const url = response.data?.url || response.data?.invite_url
      if (!url) throw new Error('We couldn’t create the invitation link. Please try again.')
      setShareUrl(url)
      toast.success('Invitation link created.')
    } catch (cause) { toast.error(messageFor(cause)) }
    finally { setBusy(false) }
  }
  async function copyLink() {
    try { await navigator.clipboard.writeText(shareUrl); toast.success('Invitation link copied.') }
    catch { toast.error('Could not copy the link. Select and copy it manually.') }
  }
  return <><PageHeader title="Create an invite link" description="Share a link so people can request to join your group." /><section className="form-panel"><button className="button button-primary" onClick={createLink} disabled={busy}>{busy ? 'Creating…' : 'Create link'}</button>{shareUrl && <div className="field-wrap link-result"><label htmlFor="share-url">Shareable invitation link</label><input id="share-url" value={shareUrl} readOnly /><button className="button button-outline" onClick={copyLink}>Copy link</button></div>}</section><Notice tone="warning">A group administrator must approve join requests before membership becomes active.</Notice></>
}

function ExpenseEditor({ groupId }: { groupId: string }) {
  const toast=useToast()
  const members = useQuery({ queryKey: ['members', groupId], queryFn: ({ signal }) => api.get<Collection<MemberSummary>>(`/groups/${groupId}/members`, signal) })
  const [description, setDescription] = useState('')
  const [expenseDate, setExpenseDate] = useState(localDateForInput)
  const [idempotency, setIdempotency] = useState<{ fingerprint: string; key: string }>()
  const [amount, setAmount] = useState('')
  const [payerId, setPayerId] = useState('')
  const [splitMode, setSplitMode] = useState<SplitMode>('equal')
  const [selected, setSelected] = useState<string[]>([])
  const [values, setValues] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const shareInputs = selected.map(user_id => ({ user_id, value: values[user_id] }))
  let shares: ReturnType<typeof allocateShares> = []
  let splitError = ''
  try { if (amount && selected.length) shares = allocateShares(amount, shareInputs, splitMode) }
  catch (cause) { splitError = cause instanceof Error ? cause.message : 'Check the split values.' }

  function toggleParticipant(userId: string) {
    setSelected(current => current.includes(userId) ? current.filter(id => id !== userId) : [...current, userId])
    setValues(current => ({ ...current, [userId]: current[userId] || '' }))
  }

  function toggleAllParticipants() {
    const memberIds = members.data?.data.map(member => member.user_id) ?? []
    const allSelected = memberIds.length > 0 && memberIds.every(id => selected.includes(id))
    setSelected(allSelected ? [] : memberIds)
    setValues(current => Object.fromEntries(memberIds.map(id => [id, current[id] || ''])))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('')
    if (busy) return
    const normalizedDescription = description.trim()
    if (!normalizedDescription) { setError('Enter an expense description.'); return }
    if (!payerId) { setError('Choose who paid for this expense.'); return }
    if (!selected.includes(payerId) && !window.confirm('The payer is not selected as a participant. Save this expense with that split?')) return
    if (!shares.length || splitError) { setError(splitError || 'Select participants and enter a valid split.'); return }
    const payload = {
      description: normalizedDescription,
      expense_date: expenseDate,
      currency: 'INR',
      total_amount: amount,
      paid_by_user_id: payerId,
      split_type: splitMode,
      splits: shares,
      percentages: splitMode === 'percentage' ? selected.map(user_id => ({ user_id, value: values[user_id] })) : undefined,
    }
    const fingerprint = JSON.stringify(payload)
    const key = idempotency?.fingerprint === fingerprint ? idempotency.key : crypto.randomUUID()
    setIdempotency({ fingerprint, key })
    setBusy(true)
    try {
      const response = await api.post<{ data: { id: string } }>(`/groups/${groupId}/expenses`, {
        ...payload,
        idempotency_key: key,
      })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['resource'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['activity'] }),
      ])
      setIdempotency(undefined)
      toast.success('Expense added successfully.')
      navigate(`/app/groups/${groupId}/expenses/${response.data.id}`)
    } catch (cause) { toast.error(messageFor(cause)) }
    finally { setBusy(false) }
  }

  return <><PageHeader title="Add an expense" description="Enter the details and choose how to share the cost." />
    {members.isPending ? <LoadingState label="Loading group members" /> : members.isError ? <ErrorState message={messageFor(members.error)} onRetry={() => void members.refetch()} /> : <div className="expense-form-layout"><form className="form-panel form-stack" onSubmit={submit}>
      <div className="field-wrap"><label htmlFor="expense-description">Description</label><input id="expense-description" value={description} onChange={event => setDescription(event.target.value)} maxLength={255} required /></div>
      <div className="form-grid-two"><div className="field-wrap"><label htmlFor="expense-amount">Amount (INR)</label><input id="expense-amount" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder="0.00" pattern="[0-9]+(\.[0-9]{1,2})?" required /><small className="field-hint">Up to two decimal places.</small></div><div className="field-wrap"><label htmlFor="expense-date">Date</label><input id="expense-date" type="date" value={expenseDate} onChange={event => setExpenseDate(event.target.value)} required /></div></div>
      <div className="field-wrap"><label htmlFor="payer">Paid by</label><select id="payer" value={payerId} onChange={event => setPayerId(event.target.value)} required><option value="">Choose a group member</option>{members.data.data.map(member => <option key={member.user_id} value={member.user_id}>{member.display_name || member.username || member.user_id}</option>)}</select></div>
      <fieldset className="participant-fieldset"><legend>Who shared this expense?</legend><div className="participant-select-all"><p className="field-hint">Select everyone or choose members individually.</p><label><input type="checkbox" checked={members.data.data.length > 0 && members.data.data.every(member => selected.includes(member.user_id))} onChange={toggleAllParticipants} aria-label="Select all group members"/>Select all</label></div>{members.data.data.map(member => <label key={member.user_id} className="check-row"><input type="checkbox" checked={selected.includes(member.user_id)} onChange={() => toggleParticipant(member.user_id)} /><span>{member.display_name || member.username || member.user_id}</span>{member.user_id === payerId && <small>payer</small>}</label>)}</fieldset>
      <div className="field-wrap"><label htmlFor="split-mode">Split method</label><select id="split-mode" value={splitMode} onChange={event => setSplitMode(event.target.value as SplitMode)}><option value="equal">Equal</option><option value="exact">Exact amounts</option><option value="percentage">Percentages</option></select></div>
      {selected.length > 0 && splitMode !== 'equal' && <fieldset className="participant-fieldset"><legend>{splitMode === 'exact' ? 'Share amounts' : 'Percentage shares'}</legend>{selected.map(userId => { const member = members.data.data.find(person => person.user_id === userId); return <div className="share-input-row" key={userId}><label htmlFor={`share-${userId}`}>{member?.display_name || member?.username || userId}</label><input id={`share-${userId}`} inputMode="decimal" value={values[userId] || ''} onChange={event => setValues(current => ({ ...current, [userId]: event.target.value }))} placeholder={splitMode === 'exact' ? '0.00' : '0.00%'} required /></div> })}</fieldset>}
      {error && <ErrorState message={error} />}
      <button className="button button-primary" disabled={busy || members.isError}>{busy ? 'Saving…' : 'Save expense'}</button>
    </form><aside className="split-preview"><p className="eyebrow">Split preview</p><h2>{amount ? `₹${amount}` : 'Enter an amount'}</h2><p className="muted-copy">Review each person’s share before saving.</p>{splitError && <p className="inline-error">{splitError}</p>}{shares.map(share => { const member = members.data.data.find(person => person.user_id === share.user_id); return <div className="preview-row" key={share.user_id}><span>{member?.display_name || member?.username || share.user_id}</span><strong>₹{share.amount}</strong></div> })}</aside></div>}
  </>
}

function MutationPage({ title, description, endpoint, fields, submit, method = 'post', idempotent = false, successMessage = 'Changes saved successfully.', redirectOnSuccess }: { title: string; description: string; endpoint: string; fields: Array<{ name: string; label: string; required: boolean; type?: string; inputMode?: HTMLAttributes<HTMLInputElement>['inputMode']; value?: string; readOnly?: boolean; maxLength?: number }>; submit: string; method?: 'post' | 'patch'; idempotent?: boolean; successMessage?: string; redirectOnSuccess?: 'group' }) {
  const toast=useToast()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [passwordVisible, setPasswordVisible] = useState(false)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError(''); setBusy(true)
    const body = Object.fromEntries(new FormData(event.currentTarget).entries())
    for (const field of fields) {
      const value = body[field.name]
      // Passwords are credentials: preserve every character exactly as entered.
      if (typeof value === 'string' && field.type !== 'password') body[field.name] = value.trim()
      if (field.required && !body[field.name]) {
        setError(`Enter ${field.label.toLowerCase()}.`)
        setBusy(false)
        return
      }
    }
    if (body.new_password && body.confirm_password && body.new_password !== body.confirm_password) {
      setError('New passwords do not match.')
      setBusy(false)
      return
    }
    if (body.current_password && body.new_password && body.current_password === body.new_password) {
      setError('Choose a new password that is different from your current password.')
      setBusy(false)
      return
    }
    delete body.confirm_password
    if (idempotent) body.idempotency_key = crypto.randomUUID()
    try {
      const result = method === 'patch' ? await api.patch<{ data?: { id?: string } }>(endpoint, body) : await api.post<{ data?: { id?: string } }>(endpoint, body)
      toast.success(successMessage)
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['groups'] }), queryClient.invalidateQueries({ queryKey: ['dashboard'] }), queryClient.invalidateQueries({ queryKey: ['activity'] }), queryClient.invalidateQueries({ queryKey: ['resource'] }), queryClient.invalidateQueries({ queryKey: ['group'] }), queryClient.invalidateQueries({ queryKey: ['expense'] }), queryClient.invalidateQueries({ queryKey: ['invitations'] }), queryClient.invalidateQueries({ queryKey: ['notifications'] })])
      if (redirectOnSuccess === 'group' && result.data?.id) navigate(`/app/groups/${result.data.id}`)
    }
    catch (cause) { toast.error(messageFor(cause)) }
    finally { setBusy(false) }
  }
  return <><PageHeader title={title} description={description} /><section className="form-panel"><form className="form-stack" onSubmit={onSubmit}>
    {fields.map(field => <div className="field-wrap" key={field.name}><label htmlFor={field.name}>{field.label}</label>{field.type === 'password' ? <div className="password-control"><input id={field.name} name={field.name} type={passwordVisible ? 'text' : 'password'} autoComplete={field.name === 'current_password' ? 'current-password' : 'new-password'} inputMode={field.inputMode} defaultValue={field.value} readOnly={field.readOnly} required={field.required} maxLength={field.maxLength}/><button type="button" className="password-toggle" onClick={()=>setPasswordVisible(value=>!value)} aria-label={passwordVisible?'Hide password':'Show password'}>{passwordVisible?<EyeOff size={17}/>:<Eye size={17}/>}</button></div> : <input id={field.name} name={field.name} type={field.type || 'text'} inputMode={field.inputMode} defaultValue={field.value} readOnly={field.readOnly} required={field.required} maxLength={field.maxLength} />}</div>)}
    {error && <ErrorState message={error} />}
    <div><button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : submit}</button></div>
  </form></section></>
}

function GroupTabs({ groupId }: { groupId: string }) {
  const root = `/app/groups/${groupId}`
  const location = useLocation()
  const links = [['Overview', root], ['Expenses', `${root}/expenses`], ['Balances', `${root}/balances`], ['Settlements', `${root}/settlements`], ['Members', `${root}/members`]]
  return <nav className="tab-nav" aria-label="Group sections">{links.map(([label, to]) => <Link key={to} to={to} className={location.pathname === to ? 'tab-link tab-link-active' : 'tab-link'}>{label}</Link>)}</nav>
}

function messageFor(error: unknown) {
  if (error instanceof ApiError) {
    if (!error.status) return 'We couldn’t complete that request. Check your connection and try again.'
    if (error.status === 404) return 'We couldn’t find that page or item.'
    if (error.status === 401) return 'Sign in is required to load this information.'
    if (error.status === 403) return 'Your account does not have permission to view this information.'
    if (error.status === 409 || error.status === 422 || error.status === 400) return error.message
    return 'We couldn’t complete that request. Please try again.'
  }
  if (error instanceof Error) return error.message
  return 'The request could not be completed.'
}

function ExpenseDetail({ expenseId }: { expenseId: string }) {
  const toast=useToast()
  const query = useQuery({ queryKey: ['expense', expenseId], queryFn: ({ signal }) => api.get<{ data: { description: string; expense_date: string; total_amount: string; currency: string; payer_name: string | null; paid_by_user_id:string; status: string; splits: Array<{ user_id: string; display_name: string | null; username: string | null; amount: string }> } }>(`/expenses/${expenseId}`, signal) })
  const profile = useQuery({ queryKey:['profile'], queryFn:({signal})=>api.get<{data:{id:string}}>('/users/me',signal) })
  const [voided, setVoided] = useState(false)
  async function voidExpense() {
    if (!window.confirm('Void this expense? It will remain in your history and stop affecting balances.')) return
    try { await api.post(`/expenses/${expenseId}/void`); setVoided(true); toast.success('Expense voided.'); await query.refetch() }
    catch (cause) { toast.error(messageFor(cause)) }
  }
  return <><PageHeader title="Expense details" description="Expense information, split, and history." action={<><Link className="button button-outline" to={`/app/expenses/${expenseId}/edit`}>Edit expense</Link><button className="button button-outline" onClick={voidExpense} disabled={voided}>Void expense</button></>} />
    {query.isPending ? <LoadingState label="Loading expense" /> : query.isError ? <ErrorState message={messageFor(query.error)} onRetry={() => void query.refetch()} /> : <section className="panel"><h2>{query.data.data.description}</h2><p className="muted-copy">{query.data.data.expense_date} · {query.data.data.status}</p>{(() => {const known=Boolean(profile.data);const paidByYou=profile.data?.data.id===query.data.data.paid_by_user_id;return <div className={`expense-payer-detail ${known?(paidByYou?'payer-you':'payer-other'):''}`}><span className="avatar payer-avatar">{(query.data.data.payer_name||'?').slice(0,1).toUpperCase()}</span><span><strong>Paid by {known&&paidByYou?'you':query.data.data.payer_name||'a group member'}</strong><small>{known?(paidByYou?'Your payment':'Another member’s payment'):'Payer'}</small></span></div>})()}<strong className="tabular-amount">{query.data.data.currency} {query.data.data.total_amount}</strong><h3>Split</h3><div className="resource-list">{query.data.data.splits.map(share => <div className="resource-row" key={share.user_id}><span className="row-copy"><strong>{share.display_name || share.username || 'Group member'}</strong></span><strong>{query.data.data.currency} {share.amount}</strong></div>)}</div></section>}
    {query.data && <Link className="inline-link" to={`/app/expenses/${expenseId}/history`}>View expense history <ArrowRight size={15} /></Link>}
  </>
}
