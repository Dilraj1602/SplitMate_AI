import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppShell } from '../layouts/AppShell'
import { useAuth } from './auth'
import { AuthPage, LandingPage, NotFoundPage } from '../pages/AuthPages'
import {
  AccessDeniedPage, ActivityPage, BalancesPage, ExpenseCreatePage, ExpenseDetailPage,
  ExpenseEditPage, ExpenseHistoryPage, ExpensesPage, GroupCreatePage, GroupPage,
  GroupSettingsPage, GroupsPage, InviteLinkPage, InviteMemberPage, InvitationsPage, InvitePreviewPage, MembersPage, NotificationsPage,
  OverviewPage, PersonalBalancesPage, PersonalSettlementsPage, ProfilePage, SecurityPage, SettlementCreatePage, SettlementDetailPage, SettlementsPage,
} from '../pages/ProductPages'

function RequireSession() {
  const { authenticated } = useAuth()
  return authenticated ? <AppShell /> : <Navigate to="/login" replace state={{ returnTo: window.location.pathname }} />
}

export const router = createBrowserRouter([
  { path: '/', element: <LandingPage /> },
  { path: '/login', element: <AuthPage mode="login" /> },
  { path: '/signup', element: <AuthPage mode="register" /> },
  { path: '/register', element: <Navigate to="/signup" replace /> },
  { path: '/verify-email', element: <AuthPage mode="verify" /> },
  { path: '/forgot-password', element: <AuthPage mode="forgot" /> },
  { path: '/reset-password', element: <AuthPage mode="reset" /> },
  { path: '/invite/:token', element: <InvitePreviewPage /> },
  { path: '/access-denied', element: <AccessDeniedPage /> },
  { path: '/app', element: <RequireSession />, children: [
    { index: true, element: <OverviewPage /> },
    { path: 'groups', element: <GroupsPage /> },
    { path: 'groups/new', element: <GroupCreatePage /> },
    { path: 'groups/:groupId', element: <GroupPage /> },
    { path: 'groups/:groupId/settings', element: <GroupSettingsPage /> },
    { path: 'groups/:groupId/members', element: <MembersPage /> },
    { path: 'groups/:groupId/members/invite', element: <InviteMemberPage /> },
    { path: 'groups/:groupId/members/invite-link', element: <InviteLinkPage /> },
    { path: 'groups/:groupId/expenses', element: <ExpensesPage /> },
    { path: 'groups/:groupId/expenses/new', element: <ExpenseCreatePage /> },
    { path: 'groups/:groupId/expenses/:expenseId', element: <ExpenseDetailPage /> },
    { path: 'groups/:groupId/expenses/:expenseId/edit', element: <ExpenseEditPage /> },
    { path: 'groups/:groupId/expenses/:expenseId/history', element: <ExpenseHistoryPage /> },
    { path: 'groups/:groupId/balances', element: <BalancesPage /> },
    { path: 'groups/:groupId/settlements', element: <SettlementsPage /> },
    { path: 'groups/:groupId/settlements/new', element: <SettlementCreatePage /> },
    { path: 'groups/:groupId/settlements/:settlementId', element: <SettlementDetailPage /> },
    { path: 'expenses/:expenseId', element: <ExpenseDetailPage /> },
    { path: 'expenses/:expenseId/edit', element: <ExpenseEditPage /> },
    { path: 'expenses/:expenseId/history', element: <ExpenseHistoryPage /> },
    { path: 'balances', element: <PersonalBalancesPage /> },
    { path: 'settlements', element: <PersonalSettlementsPage /> },
    { path: 'invitations', element: <InvitationsPage /> },
    { path: 'activity', element: <ActivityPage /> },
    { path: 'notifications', element: <NotificationsPage /> },
    { path: 'settings/profile', element: <ProfilePage /> },
    { path: 'settings/security', element: <SecurityPage /> },
  ] },
  { path: '*', element: <NotFoundPage /> },
])
