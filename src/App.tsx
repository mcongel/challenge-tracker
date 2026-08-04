import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { Dashboard } from './pages/Dashboard';
import { CashLedger } from './pages/CashLedger';
import { Positions } from './pages/Positions';
import { TradeLog } from './pages/TradeLog';
import { Milestones } from './pages/Milestones';
import { TaxReserve } from './pages/TaxReserve';
import { Benchmark } from './pages/Benchmark';
import { ParkedPile } from './pages/ParkedPile';
import { Rules } from './pages/Rules';

export default function App() {
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
