import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { DataProvider } from './contexts/DataContext';
import { Layout } from './components/layout/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { CashLedger } from './pages/CashLedger';
import { Positions } from './pages/Positions';
import { TradeLog } from './pages/TradeLog';
import { Milestones } from './pages/Milestones';
import { TaxReserve } from './pages/TaxReserve';
import { Benchmark } from './pages/Benchmark';
import { ParkedPile } from './pages/ParkedPile';
import { Activity } from './pages/Activity';
import { Income } from './pages/Income';
import { Transition } from './pages/Transition';
import { Rules } from './pages/Rules';
import { Help } from './pages/Help';
import { isSupabaseConfigured } from './lib/supabase';

function Gate() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-slate-950 flex items-center justify-center">
        <div className="h-8 w-8 rounded-full border-2 border-indigo-600 border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!session || !isSupabaseConfigured) return <Login />;

  return (
    <DataProvider>
      <AppRoutes />
    </DataProvider>
  );
}

function AppRoutes() {
  // Keyed by route: a crash on one screen must not follow the user to every
  // other screen — navigation remounts the boundary and clears it.
  const { pathname } = useLocation();
  return (
    <Layout>
      <ErrorBoundary key={pathname}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/ledger" element={<CashLedger />} />
        <Route path="/positions" element={<Positions />} />
        <Route path="/trades" element={<TradeLog />} />
        <Route path="/milestones" element={<Milestones />} />
        <Route path="/tax" element={<TaxReserve />} />
        <Route path="/benchmark" element={<Benchmark />} />
        <Route path="/parked" element={<ParkedPile />} />
        <Route path="/activity" element={<Activity />} />
        <Route path="/income" element={<Income />} />
        <Route path="/transition" element={<Transition />} />
        <Route path="/rules" element={<Rules />} />
        <Route path="/help" element={<Help />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </ErrorBoundary>
    </Layout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
