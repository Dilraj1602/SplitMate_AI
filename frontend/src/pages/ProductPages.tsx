import { useState, type FormEvent, type HTMLAttributes, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useParams } from 'react-router-dom'
import { ArrowRight, Plus, Users, WalletCards } from 'lucide-react'
import { useAuth } from '../app/auth'
import { api, ApiError, type Collection, type GroupSummary } from '../services/api'
import { EmptyState, ErrorState, LoadingState, Notice } from '../components/ui/Feedback'
import { PageHeader } from '../components/ui/PageHeader'
import { allocateShares, type SplitMode } from '../features/expenses/splitMath'

type PageInfo = { title: string; description: string; endpoint?: string; unavailable?: string }
type MemberSummary = { user_id: string; username?: string | null; display_name?: string | null; role?: string }
type InvitationSummary = { id: string; group_name?: string; inviter_name?: string; status: string; expires_at?: string }
type SettlementSummary = { id: string; payer_name?: string; recipient_name?: string; amount: string; currency: string; status: string }

const pathConfig: Record<string, PageInfo> = {
  '/app': { title: 'Your overview', description: 'A clear view of the groups and activity you can access.', endpoint: '/dashboard' },
  '/app/groups': { title: 'Groups', description: 'Shared spaces for trips, homes, and everyday plans.', endpoint: '/groups' },
  '/app/activity': { title: 'Activity', description: 'A record of changes across the groups you belong to.' },
  '/app/notifications': { title: 'Notifications', description: 'Updates about invitations, expenses, and settlements.', endpoint: '/notifications' },
  '/app/invitations': { title: 'Invitations', description: 'Review invitations addressed to your account.', endpoint: '/invitations' },
}

export function OverviewPage() { return <ResourcePage info={pathConfig['/app']} /> }
export function GroupsPage() { return <GroupsListPage /> }
export function ActivityPage() { return <ResourcePage info={pathConfig['/app/activity']} /> }
export function NotificationsPage() { return <ResourcePage info={pathConfig['/app/notifications']} /> }
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
  return <><PageHeader eyebrow="Groups" title={group.name} description={group.description || 'Group overview'} action={<Link className="button button-primary" to={`/app/groups/${groupId}/expenses/new`}><Plus size={16} />Add expense</Link>} /><GroupTabs groupId={groupId} /><Notice>This group view uses live API data. Financial totals will appear when the balances endpoint is connected.</Notice><div className="split-section"><section className="panel"><h2>Recent expenses</h2><ResourceRows endpoint={`/groups/${groupId}/expenses?limit=5`} emptyTitle="No expenses yet" emptyText="Expenses added to this group will appear here." /></section><section className="panel"><h2>Group summary</h2><p className="muted-copy">{group.member_count ?? '—'} active members</p><Link className="inline-link" to={`/app/groups/${groupId}/balances`}>View balances <ArrowRight size={15} /></Link></section></div></>
}

export function GroupCreatePage() { return <MutationPage title="Create a group" description="Groups use INR in the initial release. Currency conversion is not supported." endpoint="/groups" fields={[{ name: 'name', label: 'Group name', required: true }, { name: 'description', label: 'Description', required: false }, { name: 'currency', label: 'Currency', type: 'text', value: 'INR', readOnly: true, required: true }]} submit="Create group" /> }
export function GroupSettingsPage() { const { groupId = '' } = useParams(); return <MutationPage title="Group settings" description="Update the group details you are allowed to manage." endpoint={`/groups/${groupId}`} method="patch" fields={[{ name: 'name', label: 'Group name', required: true }, { name: 'description', label: 'Description', required: false }]} submit="Save changes" /> }
export function MembersPage() {
  const { groupId = '' } = useParams()
  const query = useQuery({ queryKey: ['members', groupId], queryFn: ({ signal }) => api.get<Collection<MemberSummary>>(`/groups/${groupId}/members`, signal) })
  return <><PageHeader title="Members and invitations" description="Active members and pending invitations for this group." action={<><Link className="button button-primary" to={`/app/groups/${groupId}/members/invite`}>Invite by email</Link><Link className="button button-outline" to={`/app/groups/${groupId}/members/invite-link`}>Create invite link</Link></>} /><GroupTabs groupId={groupId} />
    {query.isPending ? <LoadingState label="Loading members" /> : query.isError ? <ErrorState message={messageFor(query.error)} onRetry={() => void query.refetch()} /> : query.data.data.length === 0 ? <EmptyState title="No member records returned">Members will appear here after the group API returns them.</EmptyState> : <div className="resource-list">{query.data.data.map(member => <div className="resource-row" key={member.user_id}><span className="avatar" aria-hidden="true">{(member.display_name || member.username || 'M').slice(0, 1).toUpperCase()}</span><span className="row-copy"><strong>{member.display_name || member.username || 'Group member'}</strong><small>{member.username ? `@${member.username} · ` : ''}{member.role || 'Member'}</small></span></div>)}</div>}
    <section className="panel section-gap"><h2>Membership actions</h2><p className="muted-copy">Removing members and leaving groups are not enabled until outstanding-balance and administrator-transfer rules are resolved.</p></section>
  </>
}
export function InviteMemberPage() { const { groupId = '' } = useParams(); return <MutationPage title="Invite a member" description="The API proposal uses an email address; the product document also mentions username invitations." endpoint={`/groups/${groupId}/invitations`} fields={[{ name: 'email', label: 'Email address', type: 'email', required: true }]} submit="Send invitation" /> }
export function InviteLinkPage() { const { groupId = '' } = useParams(); return <InviteLinkCreator groupId={groupId} /> }
export function BalancesPage() { const { groupId = '' } = useParams(); return <ResourcePage info={{ title: 'Balances', description: 'Amounts are kept separate by currency. Pending settlements do not reduce confirmed balances.', endpoint: `/groups/${groupId}/balances`, unavailable: 'Balances need a live response from the API; the app does not calculate authoritative totals in the browser.' }} tabs={<GroupTabs groupId={groupId} />} /> }
export function SettlementsPage() {
  const { groupId = '' } = useParams()
  const query = useQuery({ queryKey: ['settlements', groupId], queryFn: ({ signal }) => api.get<Collection<SettlementSummary>>(`/groups/${groupId}/settlements`, signal) })
  return <><PageHeader title="Settlements" description="A proposed settlement changes balances only after the recipient confirms it." action={<Link to={`/app/groups/${groupId}/settlements/new`} className="button button-primary"><Plus size={16} />Record settlement</Link>} /><GroupTabs groupId={groupId} />
    <Notice>Pending settlements do not reduce the official outstanding balance.</Notice>
    {query.isPending ? <LoadingState label="Loading settlements" /> : query.isError ? <ErrorState message={messageFor(query.error)} onRetry={() => void query.refetch()} /> : query.data.data.length === 0 ? <EmptyState title="No settlements yet">Recorded payments will appear here with their confirmation status.</EmptyState> : <div className="resource-list">{query.data.data.map(item => <SettlementRow key={item.id} item={item} groupId={groupId} />)}</div>}
  </>
}
export function PersonalSettlementsPage() { return <ResourcePage info={{ title: 'Settlements', description: 'Choose a group to review proposed and confirmed payments.' }} /> }
export function SettlementCreatePage() { const { groupId = '' } = useParams(); return <MutationPage title="Record a settlement" description="This records a proposed payment. It does not move money or reduce balances until the recipient confirms." endpoint={`/groups/${groupId}/settlements`} fields={[{ name: 'recipient_user_id', label: 'Recipient user ID', required: true }, { name: 'amount', label: 'Amount (INR)', inputMode: 'decimal', required: true }, { name: 'currency', label: 'Currency', value: 'INR', readOnly: true, required: true }]} submit="Record proposed settlement" idempotent /> }
export function SettlementDetailPage() { return <ResourcePage info={{ title: 'Settlement details', description: 'The current contract exposes settlements through the group settlement list; a separate detail endpoint is not defined.' }} /> }
export function InvitePreviewPage() { return <InvitePreview /> }
export function ExpensesPage() { const { groupId = '' } = useParams(); return <ResourcePage info={{ title: 'Expenses', description: 'Expenses and their splits, as returned by the group API.', endpoint: `/groups/${groupId}/expenses` }} tabs={<GroupTabs groupId={groupId} />} action={<Link className="button button-primary" to={`/app/groups/${groupId}/expenses/new`}><Plus size={16} />Add expense</Link>} /> }
export function ExpenseCreatePage() { const { groupId = '' } = useParams(); return <ExpenseEditor groupId={groupId} /> }
export function ExpenseEditPage() { const { expenseId = '' } = useParams(); return <MutationPage title="Edit expense" description="Changes will be validated and saved by the backend." endpoint={`/expenses/${expenseId}`} method="patch" fields={[{ name: 'description', label: 'Description', required: true }, { name: 'total_amount', label: 'Total amount', inputMode: 'decimal', required: true }]} submit="Save changes" /> }
export function ExpenseDetailPage() { const { expenseId = '' } = useParams(); return <ExpenseDetail expenseId={expenseId} /> }
export function ExpenseHistoryPage() { const { expenseId = '' } = useParams(); return <ResourcePage info={{ title: 'Expense history', description: 'Audited changes for this expense.', endpoint: `/expenses/${expenseId}/history` }} /> }
export function PersonalBalancesPage() { return <ResourcePage info={{ title: 'Your balances', description: 'Your net position, separated by currency.', endpoint: '/dashboard' }} /> }
export function ProfilePage() { return <MutationPage title="Profile" description="View and update the profile fields allowed by your account." endpoint="/users/me" method="patch" fields={[{ name: 'display_name', label: 'Display name', required: false }]} submit="Save profile" /> }
export function SecurityPage() { return <MutationPage title="Security settings" description="Change your password and review active sessions when the security API is available." endpoint="/auth/change-password" fields={[{ name: 'current_password', label: 'Current password', type: 'password', required: true }, { name: 'new_password', label: 'New password', type: 'password', required: true }, { name: 'confirm_password', label: 'Confirm new password', type: 'password', required: true }]} submit="Update password" /> }
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
      await queryClient.invalidateQueries({ queryKey: ['invitations'] })
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
export function AccessDeniedPage() { return <><PageHeader title="Sign in required" description="This area is available after the authentication service is connected." /><Notice tone="warning">No session was created and no protected data has been loaded.</Notice><Link className="button button-primary" to="/login">Go to sign in</Link></> }

function GroupsListPage() {
  const query = useQuery({ queryKey: ['groups'], queryFn: ({ signal }) => api.get<Collection<GroupSummary>>('/groups?limit=20&offset=0', signal) })
  return <><PageHeader title="Groups" description="Shared spaces for trips, homes, and everyday plans." action={<Link to="/app/groups/new" className="button button-primary"><Plus size={16} />Create group</Link>} />
    {query.isPending ? <LoadingState label="Loading groups" /> : query.isError ? <ErrorState message={messageFor(query.error)} onRetry={() => void query.refetch()} /> : query.data.data.length === 0 ? <EmptyState title="No groups yet">Create a group to start organizing shared expenses.</EmptyState> : <div className="resource-list">{query.data.data.map(group => <Link key={group.id} className="resource-row group-row" to={`/app/groups/${group.id}`}><span className="row-icon"><WalletCards size={18} /></span><span className="row-copy"><strong>{group.name}</strong><small>{group.description || `${group.member_count ?? '—'} members`}</small></span><span className="status-label">{group.status === 'archived' ? 'Archived' : 'Active'}</span><ArrowRight size={16} /></Link>)}</div>}
  </>
}

function ResourcePage({ info, action, tabs }: { info: PageInfo; action?: ReactNode; tabs?: ReactNode }) {
  const query = useQuery({ queryKey: ['resource', info.endpoint], queryFn: ({ signal }) => api.get<unknown>(info.endpoint as string, signal), enabled: Boolean(info.endpoint) })
  return <><PageHeader title={info.title} description={info.description} action={action} />{tabs}
    {!info.endpoint ? <EmptyState title="No endpoint in the current API contract">This view will show data when the backend contract defines its resource endpoint.</EmptyState> : query.isPending ? <LoadingState /> : query.isError ? <ErrorState message={messageFor(query.error)} onRetry={() => void query.refetch()} /> : <ApiDataState data={query.data} title={info.title} unavailable={info.unavailable} />}
  </>
}

function ResourceRows({ endpoint, emptyTitle, emptyText }: { endpoint: string; emptyTitle: string; emptyText: string }) {
  const query = useQuery({ queryKey: ['resource', endpoint], queryFn: ({ signal }) => api.get<Collection<unknown>>(endpoint, signal) })
  if (query.isPending) return <LoadingState />
  if (query.isError) return <ErrorState message={messageFor(query.error)} onRetry={() => void query.refetch()} />
  return <ApiCollectionState items={query.data.data} emptyTitle={emptyTitle} emptyText={emptyText} />
}

function ApiDataState({ data, title, unavailable }: { data: unknown; title: string; unavailable?: string }) {
  if (isRecord(data) && Array.isArray(data.data)) return <ApiCollectionState items={data.data} emptyTitle={`No ${title.toLowerCase()} yet`} emptyText={unavailable || 'Records returned by the API will appear here.'} />
  return <EmptyState title="Data received">{unavailable || 'The API responded. This resource needs a specific display contract before its fields can be shown.'}</EmptyState>
}

function ApiCollectionState({ items, emptyTitle, emptyText }: { items: unknown[]; emptyTitle: string; emptyText: string }) {
  if (items.length === 0) return <EmptyState title={emptyTitle}>{emptyText}</EmptyState>
  return <div className="resource-list">{items.map((item, index) => {
    if (!isRecord(item)) return <div className="resource-row" key={index}><span className="row-copy"><strong>Record</strong><small>Response fields are not available in the expected shape.</small></span></div>
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
      await queryClient.invalidateQueries({ queryKey: ['invitations'] })
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
  async function respond(action: 'confirm' | 'reject' | 'cancel') {
    if (action === 'confirm' && !window.confirm(`Confirm ${item.currency} ${item.amount} from ${item.payer_name || 'the payer'} to ${item.recipient_name || 'the recipient'}?`)) return
    setBusy(true); setError('')
    try { await api.post(`/settlements/${item.id}/${action}`); setStatus(action === 'confirm' ? 'confirmed' : action === 'reject' ? 'rejected' : 'cancelled'); await queryClient.invalidateQueries({ queryKey: ['settlements', groupId] }); await queryClient.invalidateQueries({ queryKey: ['resource', `/groups/${groupId}/balances`] }) }
    catch (cause) { setError(messageFor(cause)) }
    finally { setBusy(false) }
  }
  return <article className="resource-row resource-row-wrap"><span className="row-copy"><strong>{item.payer_name || 'Payer'} → {item.recipient_name || 'Recipient'}</strong><small>{item.status} · {item.currency} {item.amount}</small>{error && <small className="inline-error">{error}</small>}</span>{status === 'pending' && <span className="row-actions"><button className="button button-small button-primary" disabled={busy} onClick={() => respond('confirm')}>Confirm</button><button className="button button-small button-outline" disabled={busy} onClick={() => respond('reject')}>Reject</button></span>}</article>
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
      if (!url) throw new Error('The API did not return a shareable link.')
      setShareUrl(url)
    } catch (cause) { setError(messageFor(cause)) }
    finally { setBusy(false) }
  }
  async function copyLink() {
    try { await navigator.clipboard.writeText(shareUrl); setMessage('Invitation link copied.') }
    catch { setError('Could not copy the link. Select and copy it manually.') }
  }
  return <><PageHeader title="Create an invite link" description="The link opens a limited preview and creates a join request; it never activates membership by itself." /><section className="form-panel"><button className="button button-primary" onClick={createLink} disabled={busy}>{busy ? 'Creating…' : 'Create link'}</button>{shareUrl && <div className="field-wrap link-result"><label htmlFor="share-url">Shareable invitation link</label><input id="share-url" value={shareUrl} readOnly /><button className="button button-outline" onClick={copyLink}>Copy link</button></div>}{error && <ErrorState message={error} />}{message && <Notice>{message}</Notice>}</section><Notice tone="warning">A join request still needs administrator approval. Expiry follows the API policy.</Notice></>
}

function ExpenseEditor({ groupId }: { groupId: string }) {
  const members = useQuery({ queryKey: ['members', groupId], queryFn: ({ signal }) => api.get<Collection<MemberSummary>>(`/groups/${groupId}/members`, signal) })
  const [description, setDescription] = useState('')
  const [expenseDate, setExpenseDate] = useState('')
  const [amount, setAmount] = useState('')
  const [payerId, setPayerId] = useState('')
  const [splitMode, setSplitMode] = useState<SplitMode>('equal')
  const [selected, setSelected] = useState<string[]>([])
  const [values, setValues] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const queryClient = useQueryClient()
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
    event.preventDefault(); setError(''); setSaved(false)
    if (!payerId) { setError('Choose who paid for this expense.'); return }
    if (!selected.includes(payerId) && !window.confirm('The payer is not selected as a participant. Save this expense with that split?')) return
    if (!shares.length || splitError) { setError(splitError || 'Select participants and enter a valid split.'); return }
    setBusy(true)
    try {
      await api.post(`/groups/${groupId}/expenses`, {
        description,
        expense_date: expenseDate,
        currency: 'INR',
        total_amount: amount,
        paid_by_user_id: payerId,
        split_type: splitMode,
        splits: shares,
        idempotency_key: crypto.randomUUID(),
      })
      setSaved(true)
      await queryClient.invalidateQueries({ queryKey: ['resource', `/groups/${groupId}/expenses`] })
    } catch (cause) { setError(messageFor(cause)) }
    finally { setBusy(false) }
  }

  return <><PageHeader title="Add an expense" description="Enter shares in rupees. The backend validates and stores the authoritative split." />
    {members.isPending ? <LoadingState label="Loading group members" /> : members.isError ? <ErrorState message={messageFor(members.error)} onRetry={() => void members.refetch()} /> : <div className="expense-form-layout"><form className="form-panel form-stack" onSubmit={submit}>
      <div className="field-wrap"><label htmlFor="expense-description">Description</label><input id="expense-description" value={description} onChange={event => setDescription(event.target.value)} maxLength={255} required /></div>
      <div className="form-grid-two"><div className="field-wrap"><label htmlFor="expense-amount">Amount (INR)</label><input id="expense-amount" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder="0.00" pattern="[0-9]+(\.[0-9]{1,2})?" required /><small className="field-hint">Up to two decimal places.</small></div><div className="field-wrap"><label htmlFor="expense-date">Date</label><input id="expense-date" type="date" value={expenseDate} onChange={event => setExpenseDate(event.target.value)} required /></div></div>
      <div className="field-wrap"><label htmlFor="payer">Paid by</label><select id="payer" value={payerId} onChange={event => setPayerId(event.target.value)} required><option value="">Choose a group member</option>{members.data.data.map(member => <option key={member.user_id} value={member.user_id}>{member.display_name || member.username || member.user_id}</option>)}</select></div>
      <fieldset className="participant-fieldset"><legend>Who shared this expense?</legend><p className="field-hint">No one is included automatically. Select each participant explicitly.</p>{members.data.data.map(member => <label key={member.user_id} className="check-row"><input type="checkbox" checked={selected.includes(member.user_id)} onChange={() => toggleParticipant(member.user_id)} /><span>{member.display_name || member.username || member.user_id}</span>{member.user_id === payerId && <small>payer</small>}</label>)}</fieldset>
      <div className="field-wrap"><label htmlFor="split-mode">Split method</label><select id="split-mode" value={splitMode} onChange={event => setSplitMode(event.target.value as SplitMode)}><option value="equal">Equal</option><option value="exact">Exact amounts</option><option value="percentage">Percentages</option></select></div>
      {selected.length > 0 && splitMode !== 'equal' && <fieldset className="participant-fieldset"><legend>{splitMode === 'exact' ? 'Share amounts' : 'Percentage shares'}</legend>{selected.map(userId => { const member = members.data.data.find(person => person.user_id === userId); return <div className="share-input-row" key={userId}><label htmlFor={`share-${userId}`}>{member?.display_name || member?.username || userId}</label><input id={`share-${userId}`} inputMode="decimal" value={values[userId] || ''} onChange={event => setValues(current => ({ ...current, [userId]: event.target.value }))} placeholder={splitMode === 'exact' ? '0.00' : '0.00%'} required /></div> })}</fieldset>}
      {error && <ErrorState message={error} />}{saved && <Notice>Expense saved by the API. The server remains authoritative for balances.</Notice>}
      <button className="button button-primary" disabled={busy || members.isError}>{busy ? 'Saving…' : 'Save expense'}</button>
    </form><aside className="split-preview"><p className="eyebrow">Split preview</p><h2>{amount ? `₹${amount}` : 'Enter an amount'}</h2><p className="muted-copy">Preview only. The server recalculates and validates every share.</p>{splitError && <p className="inline-error">{splitError}</p>}{shares.map(share => { const member = members.data.data.find(person => person.user_id === share.user_id); return <div className="preview-row" key={share.user_id}><span>{member?.display_name || member?.username || share.user_id}</span><strong>₹{share.amount}</strong></div> })}</aside></div>}
    <Notice tone="warning">The initial release accepts INR only. No other currency is submitted or converted.</Notice>
  </>
}

function MutationPage({ title, description, endpoint, fields, submit, method = 'post', idempotent = false }: { title: string; description: string; endpoint: string; fields: Array<{ name: string; label: string; required: boolean; type?: string; inputMode?: HTMLAttributes<HTMLInputElement>['inputMode']; value?: string; readOnly?: boolean }>; submit: string; method?: 'post' | 'patch'; idempotent?: boolean }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [complete, setComplete] = useState(false)
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setComplete(false); setBusy(true)
    const body = Object.fromEntries(new FormData(event.currentTarget).entries())
    if (body.new_password && body.confirm_password && body.new_password !== body.confirm_password) {
      setError('New passwords do not match.')
      setBusy(false)
      return
    }
    delete body.confirm_password
    if (idempotent) body.idempotency_key = crypto.randomUUID()
    try { await (method === 'patch' ? api.patch(endpoint, body) : api.post(endpoint, body)); setComplete(true) }
    catch (cause) { setError(messageFor(cause)) }
    finally { setBusy(false) }
  }
  return <><PageHeader title={title} description={description} /><section className="form-panel"><form className="form-stack" onSubmit={onSubmit}>
    {fields.map(field => <div className="field-wrap" key={field.name}><label htmlFor={field.name}>{field.label}</label><input id={field.name} name={field.name} type={field.type || 'text'} inputMode={field.inputMode} defaultValue={field.value} readOnly={field.readOnly} required={field.required} /></div>)}
    {error && <ErrorState message={error} />}{complete && <Notice>The API accepted the request.</Notice>}
    <div><button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : submit}</button></div>
  </form></section><Notice tone="warning">This form sends a real API request. It will show an error if the backend endpoint is not available; it never reports success without a successful response.</Notice></>
}

function GroupTabs({ groupId }: { groupId: string }) {
  const root = `/app/groups/${groupId}`
  const location = useLocation()
  const links = [['Overview', root], ['Expenses', `${root}/expenses`], ['Balances', `${root}/balances`], ['Settlements', `${root}/settlements`], ['Members', `${root}/members`]]
  return <nav className="tab-nav" aria-label="Group sections">{links.map(([label, to]) => <Link key={to} to={to} className={location.pathname === to ? 'tab-link tab-link-active' : 'tab-link'}>{label}</Link>)}</nav>
}

function messageFor(error: unknown) {
  if (error instanceof ApiError) {
    if (!error.status) return error.message
    if (error.status === 404) return 'This feature is not available from the backend yet.'
    if (error.status === 401) return 'Sign in is required to load this information.'
    if (error.status === 403) return 'Your account does not have permission to view this information.'
    return error.message
  }
  if (error instanceof Error) return error.message
  return 'The request could not be completed.'
}

function ExpenseDetail({ expenseId }: { expenseId: string }) {
  const query = useQuery({ queryKey: ['expense', expenseId], queryFn: ({ signal }) => api.get<unknown>(`/expenses/${expenseId}`, signal) })
  const [voidError, setVoidError] = useState('')
  const [voided, setVoided] = useState(false)
  async function voidExpense() {
    if (!window.confirm('Void this expense? It will remain in history and stop affecting balances if the backend accepts the request.')) return
    setVoidError('')
    try { await api.post(`/expenses/${expenseId}/void`); setVoided(true); await query.refetch() }
    catch (cause) { setVoidError(messageFor(cause)) }
  }
  return <><PageHeader title="Expense details" description="Expense information, split, and history." action={<><Link className="button button-outline" to={`/app/expenses/${expenseId}/edit`}>Edit expense</Link><button className="button button-outline" onClick={voidExpense} disabled={voided}>Void expense</button></>} />
    {query.isPending ? <LoadingState label="Loading expense" /> : query.isError ? <ErrorState message={messageFor(query.error)} onRetry={() => void query.refetch()} /> : <EmptyState title={voided ? 'Expense voided' : 'Expense data received'}>The backend response will provide payer, participant shares, amount, currency, and status.</EmptyState>}
    {voidError && <ErrorState message={voidError} />}
    {query.data && <Link className="inline-link" to={`/app/expenses/${expenseId}/history`}>View expense history <ArrowRight size={15} /></Link>}
  </>
}
