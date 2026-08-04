import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { MobileBottomNav } from './MobileBottomNav';
import { useLayout } from '../../contexts/LayoutContext';
import { recordNavigationActivity } from '../../lib/activityTracking';
import { useHeartbeat } from '../../hooks/useHeartbeat';
import { useAutoBankSync } from '../../hooks/useAutoBankSync';
import { useAppUpdateGuard } from '../../hooks/useAppUpdateGuard';

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const { sidebarOpen, setSidebarOpen } = useLayout();
  const location = useLocation();

  useHeartbeat(true);
  useAutoBankSync();
  useAppUpdateGuard();

  useEffect(() => {
    recordNavigationActivity(location.pathname);
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 text-gray-900 dark:text-slate-100 flex">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 flex flex-col">
        <Header onMenuClick={() => setSidebarOpen(true)} />

        {/* pb-20: clearance for the fixed MobileBottomNav (pb-18 isn't a real
            Tailwind class — it silently generated nothing and the nav covered
            the last strip of every mobile page). */}
        <main className="flex-1 p-3 sm:p-6 pb-20 lg:pb-6 density-aware-page">
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
        </main>

        <MobileBottomNav />
      </div>
    </div>
  );
}
