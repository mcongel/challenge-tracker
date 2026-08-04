import { useState } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { MobileBottomNav } from './MobileBottomNav';

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 text-gray-900 dark:text-slate-100 flex">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 flex flex-col min-w-0">
        <Header onMenuClick={() => setSidebarOpen(true)} />

        {/* pb-20: clearance for the fixed MobileBottomNav on small screens. */}
        <main className="flex-1 p-3 sm:p-6 pb-20 lg:pb-6 density-aware-page">
          <div className="max-w-7xl mx-auto">{children}</div>
        </main>

        <MobileBottomNav />
      </div>
    </div>
  );
}
