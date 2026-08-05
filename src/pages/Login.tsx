import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { isSupabaseConfigured } from '../lib/supabase';

/** Sign-in against the existing Sackets project auth — no signups here. */
export function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await signIn(email, password);
    if (result.error) setError(result.error);
    setBusy(false);
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <span className="font-display font-semibold text-2xl tracking-tight text-gray-900 dark:text-slate-100">
            Challenge<span className="text-indigo-600">Tracker</span>
          </span>
          <p className="mt-1 text-sm text-gray-500">The scoreboard. Sign in to see the score.</p>
        </div>

        {!isSupabaseConfigured ? (
          <div className="bg-white rounded-lg shadow-lg p-6 text-sm text-gray-600">
            <p className="font-medium text-gray-900 mb-1">Not connected yet</p>
            <p>
              Set <code className="text-xs">VITE_SUPABASE_URL</code> and{' '}
              <code className="text-xs">VITE_SUPABASE_ANON_KEY</code> (see{' '}
              <code className="text-xs">supabase/SETUP.md</code>), then rebuild.
            </p>
          </div>
        ) : (
          <form onSubmit={submit} className="bg-white rounded-lg shadow-lg p-6 space-y-4">
            <div>
              <label htmlFor="email" className="block text-xs font-medium text-gray-500 mb-1">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-xs font-medium text-gray-500 mb-1">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            {error && (
              <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{error}</p>
            )}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
