import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { AccountSettingsPage, AllExpensesPage, ExpenseRows, GroupBalancesPage, SecurityPage, SettlementCreatePage, InviteMemberPage } from './ProductPages'
import { ToastProvider } from '../components/ui/ToastProvider'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
function renderWithQueries(ui: ReactNode, initialEntries = ['/']) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<ToastProvider><QueryClientProvider client={client}><MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter></QueryClientProvider></ToastProvider>)
}

describe('account settings and expense details', () => {
  it('separates account settings from the password page', () => {
    render(<MemoryRouter><AccountSettingsPage /></MemoryRouter>)
    expect(screen.getByRole('link', { name: /Profile information/ })).toHaveAttribute('href', '/app/settings/profile')
    expect(screen.getByRole('link', { name: /Password and security/ })).toHaveAttribute('href', '/app/settings/security')
  })

  it('supports showing and hiding the current and new password fields', async () => {
    renderWithQueries(<SecurityPage />)
    expect(screen.getByLabelText('Current password')).toHaveAttribute('type', 'password')
    expect(screen.getByLabelText('New password')).toHaveAttribute('type', 'password')
    await userEvent.setup().click(screen.getAllByRole('button', { name: 'Show password' })[0])
    expect(screen.getByLabelText('Current password')).toHaveAttribute('type', 'text')
    expect(screen.getByLabelText('New password')).toHaveAttribute('type', 'text')
  })

  it('explains that a password change requires a different new password', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const user = userEvent.setup()
    renderWithQueries(<SecurityPage />)
    await user.type(screen.getByLabelText('Current password'), 'samePass1')
    await user.type(screen.getByLabelText('New password'), 'samePass1')
    await user.type(screen.getByLabelText('Confirm new password'), 'samePass1')
    await user.click(screen.getByRole('button', { name: 'Update password' }))
    expect(await screen.findByText('Choose a new password that is different from your current password.')).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('sends password values without trimming leading or trailing spaces', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Password updated.' }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetch)
    const user = userEvent.setup()
    renderWithQueries(<SecurityPage />)
    await user.type(screen.getByLabelText('Current password'), ' oldpass ')
    await user.type(screen.getByLabelText('New password'), ' newpass ')
    await user.type(screen.getByLabelText('Confirm new password'), ' newpass ')
    await user.click(screen.getByRole('button', { name: 'Update password' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Password updated. Sign in again with your new password.')
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ current_password: ' oldpass ', new_password: ' newpass ' })
  })

  it('renders every group member with their own calculated balance', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      const body = url.endsWith('/users/me') ? { data: { id: 'alice-id' } } : { data: [
        { user_id: 'alice-id', username: 'alice', display_name: 'Alice', net_amount: '50.00', currency: 'INR', position: 'owed_to' },
        { user_id: 'bob-id', username: 'bob', display_name: 'Bob', net_amount: '-50.00', currency: 'INR', position: 'owes' },
        { user_id: 'carol-id', username: 'carol', display_name: 'Carol', net_amount: '0.00', currency: 'INR', position: 'settled' },
      ] }
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))
    renderWithQueries(<GroupBalancesPage groupId="group-id" />)
    expect(await screen.findByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('Carol')).toBeInTheDocument()
    expect(screen.getByText('₹ 50.00')).toBeInTheDocument()
    expect(screen.getByText('−₹ 50.00')).toBeInTheDocument()
    expect(screen.getByText('You')).toBeInTheDocument()
  })

  it('labels each expense payer using the authenticated user ID', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const body = String(input).endsWith('/users/me') ? { data: { id: 'alice-id' } } : { data: [
        { id: 'one', group_id: 'group-id', description: 'Groceries', total_amount: '120.00', currency: 'INR', expense_date: '2026-10-26', paid_by_user_id: 'alice-id', payer_name: 'Alice' },
        { id: 'two', group_id: 'group-id', description: 'Taxi', total_amount: '80.00', currency: 'INR', expense_date: '2026-10-25', paid_by_user_id: 'bob-id', payer_name: 'Bob' },
      ] }
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))
    renderWithQueries(<ExpenseRows endpoint="/groups/group-id/expenses" />)
    expect(await screen.findByText('Paid by you')).toBeInTheDocument()
    expect(screen.getByText('Paid by Bob')).toBeInTheDocument()
  })

  it('prefills a partial settlement from server-calculated available debt', async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify({ data: { id: 'settlement-id' } }), { status: 201, headers: { 'Content-Type': 'application/json' } })
      return new Response(JSON.stringify({ data: [{ user_id: 'alice-id', username: 'alice', display_name: 'Alice', currency: 'INR', outstanding_amount: '50.00', pending_amount: '0.00', available_amount: '50.00' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetch)
    const user = userEvent.setup()
    const entry = '/app/groups/group-id/settlements/new'
    renderWithQueries(<Routes><Route path="/app/groups/:groupId/settlements/new" element={<SettlementCreatePage/>}/></Routes>, [entry])
    await user.selectOptions(await screen.findByLabelText('Pay to / Settle with'), 'alice-id')
    expect(screen.getByLabelText('Amount')).toHaveValue(50)
    await user.clear(screen.getByLabelText('Amount'))
    await user.type(screen.getByLabelText('Amount'), '20')
    expect(screen.getByText(/You are paying/)).toHaveTextContent('You are paying Alice ₹20.00.')
    await user.click(screen.getByRole('button', { name: 'Record proposed settlement' }))
    expect(await screen.findByRole('status')).toHaveTextContent(/Settlement proposal sent to Alice/)
    const postCall = fetch.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(JSON.parse(postCall?.[1]?.body as string)).toMatchObject({ recipient_user_id: 'alice-id', amount: '20', currency: 'INR' })
  })

  it('sends a username invitation through the existing invitation API', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { id: 'invitation-id' } }), { status: 201, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetch)
    const user = userEvent.setup()
    const entry = '/app/groups/group-id/members/invite'
    renderWithQueries(<Routes><Route path="/app/groups/:groupId/members/invite" element={<InviteMemberPage/>}/></Routes>, [entry])
    await user.selectOptions(screen.getByLabelText('Invite using'), 'username')
    await user.type(screen.getByLabelText('Username'), 'rahul_23')
    await user.click(screen.getByRole('button', { name: 'Send invitation' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Invitation sent successfully.')
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/groups/group-id/invitations'), expect.objectContaining({ body: JSON.stringify({ username: 'rahul_23' }) }))
  })

  it('shows invitation API failures as dismissible error toasts', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'No account matches that username.' }), { status: 404, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetch)
    const user = userEvent.setup()
    const entry = '/app/groups/group-id/members/invite'
    renderWithQueries(<Routes><Route path="/app/groups/:groupId/members/invite" element={<InviteMemberPage/>}/></Routes>, [entry])
    await user.selectOptions(screen.getByLabelText('Invite using'), 'username')
    await user.type(screen.getByLabelText('Username'), 'unknowner')
    await user.click(screen.getByRole('button', { name: 'Send invitation' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No account matches that username.')
    expect(screen.getByRole('button', { name: 'Dismiss notification' })).toBeInTheDocument()
  })

  it('shows all accessible expenses with their group and links to expense details', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      const body = url.endsWith('/users/me')
        ? { data: { id: 'alice-id' } }
        : { data: [{ id: 'expense-id', group_id: 'group-id', group_name: 'Weekend', description: 'Dinner', total_amount: '100.00', currency: 'INR', expense_date: '2026-10-26', paid_by_user_id: 'alice-id', payer_name: 'Alice' }], pagination: { limit: 20, offset: 0, total: 1 } }
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))
    renderWithQueries(<Routes><Route path="/app/expenses" element={<AllExpensesPage/>}/></Routes>, ['/app/expenses'])
    expect(await screen.findByText('Dinner')).toBeInTheDocument()
    expect(screen.getByText(/Weekend/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Dinner/ })).toHaveAttribute('href', '/app/expenses/expense-id')
  })
})
