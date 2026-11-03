import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { FloatingQuickActions, QuickActionPreferencesPanel } from './FloatingQuickActions'
import { QuickActionPreferencesProvider } from './preferences'

beforeEach(() => localStorage.clear())
afterEach(cleanup)

function mountMenu() {
  return render(<MemoryRouter initialEntries={['/app']}><QuickActionPreferencesProvider><Routes>
    <Route path="*" element={<><FloatingQuickActions /><main>Page content</main></>} />
    <Route path="/app/groups/new" element={<><FloatingQuickActions /><main>Create group destination</main></>} />
    <Route path="/app/groups" element={<><FloatingQuickActions /><main>Group selection destination</main></>} />
    <Route path="/app/settlements" element={<><FloatingQuickActions /><main>Settlement destination</main></>} />
    <Route path="/app/expenses" element={<><FloatingQuickActions /><main>All expenses destination</main></>} />
  </Routes></QuickActionPreferencesProvider></MemoryRouter>)
}

describe('floating quick actions', () => {
  it('offers the existing destinations and closes after navigation', async () => {
    const user = userEvent.setup()
    mountMenu()
    await user.click(screen.getByRole('button', { name: 'Open quick actions' }))
    expect(screen.getByRole('menuitem', { name: 'Create Group' })).toHaveAttribute('href', '/app/groups/new')
    expect(screen.getByRole('menuitem', { name: 'Add Expense' })).toHaveAttribute('href', '/app/groups')
    expect(screen.getByRole('menuitem', { name: 'Settle Up' })).toHaveAttribute('href', '/app/settlements')
    expect(screen.getByRole('menuitem', { name: 'All Expenses' })).toHaveAttribute('href', '/app/expenses')
    await user.click(screen.getByRole('menuitem', { name: 'Create Group' }))
    expect(await screen.findByText('Create group destination')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open quick actions' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes from Escape and outside click', async () => {
    const user = userEvent.setup()
    mountMenu()
    const fab = screen.getByRole('button', { name: 'Open quick actions' })
    await user.click(fab)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(fab).toHaveAttribute('aria-expanded', 'false')
    await user.click(fab)
    await user.click(screen.getByText('Page content'))
    expect(fab).toHaveAttribute('aria-expanded', 'false')
  })

  it('applies and persists user preferences immediately', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><QuickActionPreferencesProvider><QuickActionPreferencesPanel /><FloatingQuickActions /></QuickActionPreferencesProvider></MemoryRouter>)
    const root = document.querySelector('.floating-quick-actions')
    expect(root).toHaveClass('quick-actions-right')
    await user.click(screen.getByRole('radio', { name: 'Bottom Left' }))
    expect(root).toHaveClass('quick-actions-left')
    await user.selectOptions(screen.getByLabelText('Button size'), 'large')
    expect(root).toHaveClass('quick-actions-large')
    await user.click(screen.getByRole('checkbox', { name: 'Enable radial animation' }))
    expect(root).toHaveClass('quick-actions-no-animation')
    await user.click(screen.getByRole('checkbox', { name: 'Show floating quick actions' }))
    expect(document.querySelector('.quick-action-fab')).not.toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('splitmate.quick-actions.preferences.v1') || '{}')).toMatchObject({ position: 'left', size: 'large', visible: false, animate: false })
  })
})
