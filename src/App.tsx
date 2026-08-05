import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Layout } from './components/layout/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { CashLedger } from './pages/CashLedger';
import { Positions } from './pages/Positions';
import { TradeLog } from './pages/TradeLog';
import { Milestones } from './pages/Milestones';
import { TaxReserve } from './pages/TaxReserve';
import { Benchmark } from './pages/Benchmark';
import { ParkedPile } from './pages/ParkedPile';
import { Rules } from './pages/Rules';
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
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/ledger" element={<CashLedger />} />
        <Route path="/positions" element={<Positions />} />
        <Route path="/trades" element={<TradeLog />} />
        <Route path="/milestones" element={<Milestones />} />
        <Route path="/tax" element={<TaxReserve />} />
        <Route path="/benchmark" element={<Benchmark />} />
        <Route path="/parked" element={<ParkedPile />} />
        <Route path="/rules" element={<Rules />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
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
