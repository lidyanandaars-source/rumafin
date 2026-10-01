import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from '@/features/auth/AuthProvider'
import { HouseholdProvider } from '@/hooks/useHousehold'
import { LoginPage } from '@/features/auth/LoginPage'
import { OnboardingGate } from '@/features/auth/OnboardingGate'
import { AppShell } from '@/components/layout/AppShell'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { TransactionsPage } from '@/features/transactions/TransactionsPage'
import { TransactionFormPage } from '@/features/transactions/TransactionFormPage'
import { AccountsPage } from '@/features/accounts/AccountsPage'
import { CategoriesPage } from '@/features/categories/CategoriesPage'
import { BudgetsPage } from '@/features/budgets/BudgetsPage'
import { ReportsPage } from '@/features/reports/ReportsPage'
import { MembersPage } from '@/features/members/MembersPage'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { LoadingState } from '@/components/ui/status'
import { ResetPasswordPage } from '@/features/auth/ResetPasswordPage'

function SetupMissing() {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-100 p-6">
      <div className="w-full max-w-xl rounded-3xl bg-white p-7 shadow-soft">
        <div className="mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-slate-950 text-xl font-bold text-white">RF</div>
        <h1 className="text-2xl font-bold">Konfigurasi Supabase diperlukan</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">Salin <code>.env.example</code> menjadi <code>.env.local</code>, lalu isi <code>VITE_SUPABASE_URL</code> dan <code>VITE_SUPABASE_ANON_KEY</code>. Setelah database migration dijalankan, aplikasi siap dipakai.</p>
      </div>
    </main>
  )
}

export function App() {
  const { user, loading, configured } = useAuth()
  if (!configured) return <SetupMissing />
  if (window.location.pathname === '/reset-password') return <ResetPasswordPage />
  if (loading) return <div className="grid min-h-screen place-items-center"><LoadingState label="Memeriksa sesi…" /></div>
  if (!user) return <Routes><Route path="*" element={<LoginPage />} /></Routes>

  return (
    <HouseholdProvider>
      <OnboardingGate>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/transactions/new" element={<TransactionFormPage />} />
            <Route path="/transactions/:id/edit" element={<TransactionFormPage />} />
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/categories" element={<CategoriesPage />} />
            <Route path="/budgets" element={<BudgetsPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/members" element={<MembersPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </OnboardingGate>
    </HouseholdProvider>
  )
}
