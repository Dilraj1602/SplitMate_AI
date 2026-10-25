import { useState, type FormEvent, type HTMLAttributes, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowRight, Plus, Users, WalletCards } from 'lucide-react'
import { useAuth } from '../app/auth'
import { api, ApiError, type Collection, type GroupSummary } from '../services/api'
import { EmptyState, ErrorState, LoadingState, Notice } from '../components/ui/Feedback'
import { PageHeader } from '../components/ui/PageHeader'
import { allocateShares, localDateForInput, type SplitMode } from '../features/expenses/splitMath'

type PageInfo = { title: string; description: string; endpoint?: string; unavailable?: string }
type MemberSummary = { user_id: string; username?: string | null; display_name?: string | null; role?: string }
type InvitationSummary = { id: string; group_name?: string; inviter_name?: string; status: string; expires_at?: string }
type SettlementSummary = { id: string; group_id: string; payer_user_id: string; recipient_user_id: string; payer_name?: string; recipient_name?: string; amount: string; currency: string; status: string }
type NotificationSummary = { id: string; type: string; title: string; body: string; is_read: boolean; created_at: string; group_id?: string | null; related_entity_type?: string | null; related_entity_id?: string | null }
type DashboardData = { data: Array<{ id: string; description: string; total_amount: string; currency: string; expense_date: string }>; summary: { groups_count: number; expense_count: number; total_owed_by_you: string; total_owed_to_you: string; currency: string }; groups: GroupSummary[] }

const pathConfig: Record<string, PageInfo> = {
  '/app': { title: 'Your overview', description: 'A clear view of the groups and activity you can access.', endpoint: '/dashboard' },
  '/app/groups': { title: 'Groups', description: 'Shared spaces for trips, homes, and everyday plans.', endpoint: '/groups' },
  '/app/activity': { title: 'Activity', description: 'A record of changes across the groups you belong to.', endpoint: '/activity' },
  '/app/notifications': { title: 'Notifications', description: 'Updates about invitations, expenses, and settlements.', endpoint: '/notifications' },
  '/app/invitations': { title: 'Invitations', description: 'Review invitations addressed to your account.', endpoint: '/invitations' },
}

export function OverviewPage() {
  const query = useQuery({ queryKey: ['dashboard'], queryFn: ({ signal }) => api.get<DashboardData>('/dashboard', signal) })
  return <><PageHeader title="Your overview" description="A clear view of your groups, expenses, and current balances." />
    {query.isPending ? <LoadingState label="Loading your dashboard" /> : query.isError ? <ErrorState message={messageFor(query.error)} onRetry={() => void query.refetch()} /> : <>
      <section className="dashboard-stats" aria-label="Expense summary">
        <article className="panel"><small>Groups</small><strong>{query.data.summary.groups_count}</strong></article>
        <article className="panel"><small>Expenses</small><strong>{query.data.summary.expense_count}</strong></article>
        <article className="panel"><small>You owe</small><strong>{query.data.summary.currency} {query.data.summary.total_owed_by_you}</strong></article>
        <article className="panel"><small>Owed to you</small><strong>{query.data.summary.currency} {query.data.summary.total_owed_to_you}</strong></article>
      </section>
      <div className="split-section section-gap"><section className="panel"><h2>Your groups</h2>{query.data.groups.length ? <div className="resource-list">{query.data.groups.map(group => <Link className="resource-row" key={group.id} to={`/app/groups/${group.id}`}><span className="row-copy"><strong>{group.name}</strong><small>{group.member_count} members · {group.status}</small></span><ArrowRight size={16} /></Link>)}</div> : <EmptyState title="No groups yet">Create a group to start sharing expenses.</EmptyState>}</section>
        <section className="panel"><h2>Recent expenses</h2>{query.data.data.length ? <div className="resource-list">{query.data.data.map(expense => <div className="resource-row" key={expense.id}><span className="row-copy"><strong>{expense.description}</strong><small>{expense.expense_date}</small></span><strong className="tabular-amount">{expense.currency} {expense.total_amount}</strong></div>)}</div> : <EmptyState title="No expenses yet">Expenses from your groups will appear here.</EmptyState>}</section></div>
    </>}
  </>
}
export function GroupsPage() { return <GroupsListPage /> }
export function ActivityPage() { return <ResourcePage info={pathConfig['/app/activity']} /> }
export function NotificationsPage() {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['notifications'], queryFn: ({ signal }) => api.get<Collection<NotificationSummary>>('/notifications', signal) })
  const unread = useQuery({ queryKey: ['notification-count'], queryFn: ({ signal }) => api.get<{ data: { unread_count: number } }>('/notifications/unread-count', signal) })
  const [error, setError] = useState('')
  async function markRead(id?: string) {
    setError('')
    try {
      await api.post(id ? `/notifications/${id}/read` : '/notifications/read-all')
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['notifications'] }), queryClient.invalidateQueries({ queryKey: ['notification-count'] })])
    } catch (cause) { setError(messageFor(cause)) }
  }
  return <><PageHeader title="Notifications" description="Updates about invitations, expenses, and settlements." action={unread.data?.data.unread_count ? <button className="button button-outline" onClick={() => void markRead()}>Mark all read</button> : undefined} />
    {error && <ErrorState message={error} />}
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
  return <><PageHeader eyebrow="Groups" title={group.name} description={group.description || 'Group overview'} action={<Link className="button button-primary" to={`/app/groups/${groupId}/expenses/new`}><Plus size={16} />Add expense</Link>} /><GroupTabs groupId={groupId} /><div className="split-section"><section className="panel"><h2>Recent expenses</h2><ResourceRows endpoint={`/groups/${groupId}/expenses?limit=5`} emptyTitle="No expenses yet" emptyText="Expenses added to this group will appear here." /></section><section className="panel"><h2>Group summary</h2><p className="muted-copy">{group.member_count ?? '—'} active members</p><Link className="inline-link" to={`/app/groups/${groupId}/balances`}>View balances <ArrowRight size={15} /></Link></section></div></>
}

export function GroupCreatePage() { return <MutationPage title="Create a group" description="Bring your shared expenses together in one place." endpoint="/groups" fields={[{ name: 'name', label: 'Group name', required: true, maxLength: 100 }, { name: 'description', label: 'Description', required: false, maxLength: 500 }]} submit="Create group" successMessage="Group created successfully." redirectOnSuccess="group" /> }
export function GroupSettingsPage() { const { groupId = '' } = useParams(); return <MutationPage title="Group settings" description="Update the group details you are allowed to manage." endpoint={`/groups/${groupId}`} method="patch" fields={[{ name: 'name', label: 'Group name', required: true }, { name: 'description', label: 'Description', required: false }]} submit="Save changes" /> }
export function MembersPage() {
  const { groupId = '' } = useParams()
  const query = useQuery({ queryKey: ['members', groupId], queryFn: ({ signal }) => api.get<Collection<MemberSummary>>(`/groups/${groupId}/members`, signal) })
  return <><PageHeader title="Members and invitations" description="Active members and pending invitations for this group." action={<><Link className="button button-primary" to={`/app/groups/${groupId}/members/invite`}>Invite by email</Link><Link className="button button-outline" to={`/app/groups/${groupId}/members/invite-link`}>Create invite link</Link></>} /><GroupTabs groupId={groupId} />
    {query.isPending ? <LoadingState label="Loading members" /> : query.isError ? <ErrorState message={messageFor(query.error)} onRetry={() => void query.refetch()} /> : query.data.data.length === 0 ? <EmptyState title="No members yet">Group members will appear here.</EmptyState> : <div className="resource-list">{query.data.data.map(member => <div className="resource-row" key={member.user_id}><span className="avatar" aria-hidden="true">{(member.display_name || member.username || 'M').slice(0, 1).toUpperCase()}</span><span className="row-copy"><strong>{member.display_name || member.username || 'Group member'}</strong><small>{member.username ? `@${member.username} · ` : ''}{member.role || 'Member'}</small></span></div>)}</div>}
    <section className="panel section-gap"><h2>Membership actions</h2><p className="muted-copy">Removing members and leaving groups are not enabled until outstanding-balance and administrator-transfer rules are resolved.</p></section>
  </>
}
export function InviteMemberPage() { const { groupId = '' } = useParams(); return <MutationPage title="Invite a member" description="They can accept your invitation after signing in or creating an account with this email address." endpoint={`/groups/${groupId}/invitations`} fields={[{ name: 'email', label: 'Email address', type: 'email', required: true }]} submit="Send invitation" successMessage="Invitation created. They can review it in SplitMate." /> }
export function InviteLinkPage() { const { groupId = '' } = useParams(); return <InviteLinkCreator groupId={groupId} /> }
export function BalancesPage() { const { groupId = '' } = useParams(); return <ResourcePage info={{ title: 'Balances', description: 'See what each group member owes and is owed.', endpoint: `/groups/${groupId}/balances`, unavailable: 'Balances are not available right now.' }} tabs={<GroupTabs groupId={groupId} />} /> }
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
export function SettlementCreatePage() { const { groupId = '' } = useParams(); return <MutationPage title="Record a settlement" description="This records a proposed payment. It does not move money or reduce balances until the recipient confirms." endpoint={`/groups/${groupId}/settlements`} fields={[{ name: 'recipient_user_id', label: 'Recipient user ID', required: true }, { name: 'amount', label: 'Amount (INR)', inputMode: 'decimal', required: true }, { name: 'currency', label: 'Currency', value: 'INR', readOnly: true, required: true }]} submit="Record proposed settlement" idempotent /> }
export function SettlementDetailPage() {
  const { settlementId = '' } = useParams()
  const query = useQuery({ queryKey: ['settlement', settlementId], queryFn: ({ signal }) => api.get<{ data: SettlementSummary }>(`/settlements/${settlementId}`, signal), enabled: Boolean(settlementId) })
  return <><PageHeader title="Settlement details" description="Settlement status and participants." />{query.isPending ? <LoadingState /> : query.isError ? <ErrorState message={messageFor(query.error)} onRetry={() => void query.refetch()} /> : <div className="resource-list"><SettlementRow item={query.data.data} groupId={query.data.data.group_id} /></div>}</>
}
export function InvitePreviewPage() { return <InvitePreview /> }
export function ExpensesPage() { const { groupId = '' } = useParams(); return <ResourcePage info={{ title: 'Expenses', description: 'Expenses shared by your group.', endpoint: `/groups/${groupId}/expenses` }} tabs={<GroupTabs groupId={groupId} />} action={<Link className="button button-primary" to={`/app/groups/${groupId}/expenses/new`}><Plus size={16} />Add expense</Link>} /> }
export function ExpenseCreatePage() { const { groupId = '' } = useParams(); return <ExpenseEditor groupId={groupId} /> }
export function ExpenseEditPage() { const { expenseId = '' } = useParams(); return <MutationPage title="Edit expense" description="Update the expense details." endpoint={`/expenses/${expenseId}`} method="patch" fields={[{ name: 'description', label: 'Description', required: true }, { name: 'total_amount', label: 'Total amount', inputMode: 'decimal', required: true }]} submit="Save changes" /> }
export function ExpenseDetailPage() { const { expenseId = '' } = useParams(); return <ExpenseDetail expenseId={expenseId} /> }
export function ExpenseHistoryPage() { const { expenseId = '' } = useParams(); return <ResourcePage info={{ title: 'Expense history', description: 'Audited changes for this expense.', endpoint: `/expenses/${expenseId}/history` }} /> }
export function PersonalBalancesPage() { return <ResourcePage info={{ title: 'Your balances', description: 'Your net position in each group, with currencies kept separate.', endpoint: '/balances' }} /> }
export function ProfilePage() { return <MutationPage title="Profile" description="View and update the profile fields allowed by your account." endpoint="/users/me" method="patch" fields={[{ name: 'display_name', label: 'Display name', required: false }]} submit="Save profile" /> }
export function SecurityPage() { return <MutationPage title="Security settings" description="Choose a strong password to protect your account." endpoint="/auth/change-password" fields={[{ name: 'current_password', label: 'Current password', type: 'password', required: true }, { name: 'new_password', label: 'New password', type: 'password', required: true }, { name: 'confirm_password', label: 'Confirm new password', type: 'password', required: true }]} submit="Update password" successMessage="Password updated. Sign in again with your new password." /> }
function InvitePreview() {
  const { token = '' } = useParams()
  const query = useQuery({ queryKey: ['invite-preview', token], queryFn: ({ signal }) => api.get<{ data: { name?: string; description?: string } }>(`/invite-links/${encodeURIComponent(token)}/preview`, signal), enabled: Boolean(token) })
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const { authenticated } = useAuth()
  const queryClient = useQueryClient()
  async function requestJoin() {
    setBusy(true); setError(''); setStatus('')
    try {
      await api.post(`/invite-links/${encodeURIComponent(token)}/join-requests`)
      setStatus('Your request was sent. Group membership is not active until the group administrator approves it.')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['invitations'] }),
        queryClient.invalidateQueries({ queryKey: ['notifications'] }),
        queryClient.invalidateQueries({ queryKey: ['notification-count'] }),
        queryClient.invalidateQueries({ queryKey: ['groups'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['activity'] }),
      ])
    } catch (cause) { setError(messageFor(cause)) }
    finally { setBusy(false) }
  }
  return <><PageHeader title="Group invitation" description="Review this group before requesting to join." />
    {query.isPending ? <LoadingState label="Loading invitation" /> : query.isError ? <ErrorState message={messageFor(query.error)} onRetry={() => void query.refetch()} /> : <section className="panel"><h2>{query.data.data.name || 'Invitation link'}</h2><p className="muted-copy">{query.data.data.description || 'The invitation preview contains limited group information.'}</p></section>}
    {error && <ErrorState message={error} />}{status && <Notice>{status}</Notice>}
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

function ResourceRows({ endpoint, emptyTitle, emptyText }: { endpoint: string; emptyTitle: string; emptyText: string }) {
  const query = useQuery({ queryKey: ['resource', endpoint], queryFn: ({ signal }) => api.get<Collection<unknown>>(endpoint, signal) })
  if (query.isPending) return <LoadingState />
  if (query.isError) return <ErrorState message={messageFor(query.error)} onRetry={() => void query.refetch()} />
  return <ApiCollectionState items={query.data.data} emptyTitle={emptyTitle} emptyText={emptyText} />
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
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const queryClient = useQueryClient()
  async function respond(decision: 'accept' | 'decline') {
    setBusy(true); setError(''); setMessage('')
    try {
      await api.post(`/invitations/${item.id}/${decision}`)
      setMessage(decision === 'accept' ? 'Invitation accepted.' : 'Invitation declined.')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['invitations'] }),
        queryClient.invalidateQueries({ queryKey: ['notifications'] }),
        queryClient.invalidateQueries({ queryKey: ['notification-count'] }),
        queryClient.invalidateQueries({ queryKey: ['groups'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['activity'] }),
      ])
    } catch (cause) { setError(messageFor(cause)) }
    finally { setBusy(false) }
  }
  return <article className="resource-row resource-row-wrap"><span className="row-icon"><Users size={18} /></span><span className="row-copy"><strong>{item.group_name || 'Group invitation'}</strong><small>{item.inviter_name ? `Invited by ${item.inviter_name} · ` : ''}{item.status}{item.expires_at ? ` · Expires ${new Date(item.expires_at).toLocaleDateString()}` : ''}</small>{message && <small className="inline-success">{message}</small>}{error && <small className="inline-error">{error}</small>}</span>{item.status === 'pending' && <span className="row-actions"><button className="button button-small button-primary" disabled={busy} onClick={() => respond('accept')}>Accept</button><button className="button button-small button-outline" disabled={busy} onClick={() => respond('decline')}>Decline</button></span>}</article>
}

function SettlementRow({ item, groupId }: { item: SettlementSummary; groupId: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState(item.status)
  const queryClient = useQueryClient()
  const profile = useQuery({ queryKey: ['profile'], queryFn: ({ signal }) => api.get<{ data: { id: string } }>('/users/me', signal) })
  async function respond(action: 'confirm' | 'reject' | 'cancel') {
    if (action === 'confirm' && !window.confirm(`Confirm ${item.currency} ${item.amount} from ${item.payer_name || 'the payer'} to ${item.recipient_name || 'the recipient'}?`)) return
    setBusy(true); setError('')
    try { await api.post(`/settlements/${item.id}/${action}`); setStatus(action === 'confirm' ? 'confirmed' : action === 'reject' ? 'rejected' : 'cancelled'); await queryClient.invalidateQueries({ queryKey: ['settlements'] }); await queryClient.invalidateQueries({ queryKey: ['settlement', item.id] }); await queryClient.invalidateQueries({ queryKey: ['dashboard'] }); await queryClient.invalidateQueries({ queryKey: ['resource', `/groups/${groupId}/balances`] }) }
    catch (cause) { setError(messageFor(cause)) }
    finally { setBusy(false) }
  }
  const currentUserId = profile.data?.data.id
  const recipient = currentUserId === item.recipient_user_id
  const creator = currentUserId === item.payer_user_id
  return <article className="resource-row resource-row-wrap"><span className="row-copy"><strong>{item.payer_name || 'Payer'} → {item.recipient_name || 'Recipient'}</strong><small>{item.status} · {item.currency} {item.amount}</small>{error && <small className="inline-error">{error}</small>}</span>{status === 'pending' && (recipient || creator) && <span className="row-actions">{recipient && <><button className="button button-small button-primary" disabled={busy} onClick={() => respond('confirm')}>Confirm</button><button className="button button-small button-outline" disabled={busy} onClick={() => respond('reject')}>Reject</button></>}{creator && <button className="button button-small button-outline" disabled={busy} onClick={() => respond('cancel')}>Cancel</button>}</span>}</article>
}

function InviteLinkCreator({ groupId }: { groupId: string }) {
  const [shareUrl, setShareUrl] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  async function createLink() {
    setBusy(true); setError(''); setMessage(''); setShareUrl('')
    try {
      const response = await api.post<{ data?: { url?: string; invite_url?: string } }>(`/groups/${groupId}/invite-links`)
      const url = response.data?.url || response.data?.invite_url
      if (!url) throw new Error('We couldn’t create the invitation link. Please try again.')
      setShareUrl(url)
    } catch (cause) { setError(messageFor(cause)) }
    finally { setBusy(false) }
  }
  async function copyLink() {
    try { await navigator.clipboard.writeText(shareUrl); setMessage('Invitation link copied.') }
    catch { setError('Could not copy the link. Select and copy it manually.') }
  }
  return <><PageHeader title="Create an invite link" description="Share a link so people can request to join your group." /><section className="form-panel"><button className="button button-primary" onClick={createLink} disabled={busy}>{busy ? 'Creating…' : 'Create link'}</button>{shareUrl && <div className="field-wrap link-result"><label htmlFor="share-url">Shareable invitation link</label><input id="share-url" value={shareUrl} readOnly /><button className="button button-outline" onClick={copyLink}>Copy link</button></div>}{error && <ErrorState message={error} />}{message && <Notice>{message}</Notice>}</section><Notice tone="warning">A group administrator must approve join requests before membership becomes active.</Notice></>
}

function ExpenseEditor({ groupId }: { groupId: string }) {
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
      navigate(`/app/groups/${groupId}/expenses/${response.data.id}`)
    } catch (cause) { setError(messageFor(cause)) }
    finally { setBusy(false) }
  }

  return <><PageHeader title="Add an expense" description="Enter the details and choose how to share the cost." />
    {members.isPending ? <LoadingState label="Loading group members" /> : members.isError ? <ErrorState message={messageFor(members.error)} onRetry={() => void members.refetch()} /> : <div className="expense-form-layout"><form className="form-panel form-stack" onSubmit={submit}>
      <div className="field-wrap"><label htmlFor="expense-description">Description</label><input id="expense-description" value={description} onChange={event => setDescription(event.target.value)} maxLength={255} required /></div>
      <div className="form-grid-two"><div className="field-wrap"><label htmlFor="expense-amount">Amount (INR)</label><input id="expense-amount" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder="0.00" pattern="[0-9]+(\.[0-9]{1,2})?" required /><small className="field-hint">Up to two decimal places.</small></div><div className="field-wrap"><label htmlFor="expense-date">Date</label><input id="expense-date" type="date" value={expenseDate} onChange={event => setExpenseDate(event.target.value)} required /></div></div>
      <div className="field-wrap"><label htmlFor="payer">Paid by</label><select id="payer" value={payerId} onChange={event => setPayerId(event.target.value)} required><option value="">Choose a group member</option>{members.data.data.map(member => <option key={member.user_id} value={member.user_id}>{member.display_name || member.username || member.user_id}</option>)}</select></div>
      <fieldset className="participant-fieldset"><legend>Who shared this expense?</legend><p className="field-hint">No one is included automatically. Select each participant explicitly.</p>{members.data.data.map(member => <label key={member.user_id} className="check-row"><input type="checkbox" checked={selected.includes(member.user_id)} onChange={() => toggleParticipant(member.user_id)} /><span>{member.display_name || member.username || member.user_id}</span>{member.user_id === payerId && <small>payer</small>}</label>)}</fieldset>
      <div className="field-wrap"><label htmlFor="split-mode">Split method</label><select id="split-mode" value={splitMode} onChange={event => setSplitMode(event.target.value as SplitMode)}><option value="equal">Equal</option><option value="exact">Exact amounts</option><option value="percentage">Percentages</option></select></div>
      {selected.length > 0 && splitMode !== 'equal' && <fieldset className="participant-fieldset"><legend>{splitMode === 'exact' ? 'Share amounts' : 'Percentage shares'}</legend>{selected.map(userId => { const member = members.data.data.find(person => person.user_id === userId); return <div className="share-input-row" key={userId}><label htmlFor={`share-${userId}`}>{member?.display_name || member?.username || userId}</label><input id={`share-${userId}`} inputMode="decimal" value={values[userId] || ''} onChange={event => setValues(current => ({ ...current, [userId]: event.target.value }))} placeholder={splitMode === 'exact' ? '0.00' : '0.00%'} required /></div> })}</fieldset>}
      {error && <ErrorState message={error} />}
      <button className="button button-primary" disabled={busy || members.isError}>{busy ? 'Saving…' : 'Save expense'}</button>
    </form><aside className="split-preview"><p className="eyebrow">Split preview</p><h2>{amount ? `₹${amount}` : 'Enter an amount'}</h2><p className="muted-copy">Review each person’s share before saving.</p>{splitError && <p className="inline-error">{splitError}</p>}{shares.map(share => { const member = members.data.data.find(person => person.user_id === share.user_id); return <div className="preview-row" key={share.user_id}><span>{member?.display_name || member?.username || share.user_id}</span><strong>₹{share.amount}</strong></div> })}</aside></div>}
  </>
}

function MutationPage({ title, description, endpoint, fields, submit, method = 'post', idempotent = false, successMessage = 'Changes saved successfully.', redirectOnSuccess }: { title: string; description: string; endpoint: string; fields: Array<{ name: string; label: string; required: boolean; type?: string; inputMode?: HTMLAttributes<HTMLInputElement>['inputMode']; value?: string; readOnly?: boolean; maxLength?: number }>; submit: string; method?: 'post' | 'patch'; idempotent?: boolean; successMessage?: string; redirectOnSuccess?: 'group' }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [complete, setComplete] = useState(false)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError(''); setComplete(false); setBusy(true)
    const body = Object.fromEntries(new FormData(event.currentTarget).entries())
    for (const field of fields) {
      const value = body[field.name]
      if (typeof value === 'string') body[field.name] = value.trim()
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
    delete body.confirm_password
    if (idempotent) body.idempotency_key = crypto.randomUUID()
    try {
      const result = method === 'patch' ? await api.patch<{ data?: { id?: string } }>(endpoint, body) : await api.post<{ data?: { id?: string } }>(endpoint, body)
      setComplete(true)
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['groups'] }), queryClient.invalidateQueries({ queryKey: ['dashboard'] }), queryClient.invalidateQueries({ queryKey: ['activity'] }), queryClient.invalidateQueries({ queryKey: ['resource'] }), queryClient.invalidateQueries({ queryKey: ['group'] }), queryClient.invalidateQueries({ queryKey: ['expense'] }), queryClient.invalidateQueries({ queryKey: ['invitations'] }), queryClient.invalidateQueries({ queryKey: ['notifications'] })])
      if (redirectOnSuccess === 'group' && result.data?.id) navigate(`/app/groups/${result.data.id}`)
    }
    catch (cause) { setError(messageFor(cause)) }
    finally { setBusy(false) }
  }
  return <><PageHeader title={title} description={description} /><section className="form-panel"><form className="form-stack" onSubmit={onSubmit}>
    {fields.map(field => <div className="field-wrap" key={field.name}><label htmlFor={field.name}>{field.label}</label><input id={field.name} name={field.name} type={field.type || 'text'} inputMode={field.inputMode} defaultValue={field.value} readOnly={field.readOnly} required={field.required} maxLength={field.maxLength} /></div>)}
    {error && <ErrorState message={error} />}{complete && <Notice>{successMessage}</Notice>}
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
  const query = useQuery({ queryKey: ['expense', expenseId], queryFn: ({ signal }) => api.get<{ data: { description: string; expense_date: string; total_amount: string; currency: string; payer_name: string | null; status: string; splits: Array<{ user_id: string; display_name: string | null; username: string | null; amount: string }> } }>(`/expenses/${expenseId}`, signal) })
  const [voidError, setVoidError] = useState('')
  const [voided, setVoided] = useState(false)
  async function voidExpense() {
    if (!window.confirm('Void this expense? It will remain in your history and stop affecting balances.')) return
    setVoidError('')
    try { await api.post(`/expenses/${expenseId}/void`); setVoided(true); await query.refetch() }
    catch (cause) { setVoidError(messageFor(cause)) }
  }
  return <><PageHeader title="Expense details" description="Expense information, split, and history." action={<><Link className="button button-outline" to={`/app/expenses/${expenseId}/edit`}>Edit expense</Link><button className="button button-outline" onClick={voidExpense} disabled={voided}>Void expense</button></>} />
    {query.isPending ? <LoadingState label="Loading expense" /> : query.isError ? <ErrorState message={messageFor(query.error)} onRetry={() => void query.refetch()} /> : <section className="panel"><h2>{query.data.data.description}</h2><p className="muted-copy">{query.data.data.expense_date} · Paid by {query.data.data.payer_name || 'a group member'} · {query.data.data.status}</p><strong className="tabular-amount">{query.data.data.currency} {query.data.data.total_amount}</strong><h3>Split</h3><div className="resource-list">{query.data.data.splits.map(share => <div className="resource-row" key={share.user_id}><span className="row-copy"><strong>{share.display_name || share.username || 'Group member'}</strong></span><strong>{query.data.data.currency} {share.amount}</strong></div>)}</div>{voided && <Notice>Expense voided.</Notice>}</section>}
    {voidError && <ErrorState message={voidError} />}
    {query.data && <Link className="inline-link" to={`/app/expenses/${expenseId}/history`}>View expense history <ArrowRight size={15} /></Link>}
  </>
}
