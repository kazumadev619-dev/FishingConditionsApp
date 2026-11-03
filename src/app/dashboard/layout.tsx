'use client';

import { useState } from 'react';
import { AppHeader } from '@/components/organisms/AppHeader';
import { AppSidebar } from '@/components/organisms/AppSidebar';
import { FavoritesProvider } from '@/components/providers/favorites-provider';
import { cn } from '@/lib/utils';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <FavoritesProvider>
      <div className="relative min-h-screen overflow-hidden bg-background">
        {/* Mobile menu overlay */}
        {mobileMenuOpen && (
          <button
            type="button"
            aria-label="メニューを閉じる"
            className="fixed inset-0 z-40 bg-black/50 md:hidden cursor-default"
            onClick={() => setMobileMenuOpen(false)}
          />
        )}

        {/* Sidebar - Mobile */}
        <div
          className={cn('fixed inset-y-0 left-0 z-50 md:hidden', mobileMenuOpen ? '' : 'hidden')}
        >
          <AppSidebar isOpen={mobileMenuOpen} />
        </div>

        {/* Sidebar - Desktop */}
        <div className="hidden md:block">
          <AppSidebar isOpen={sidebarOpen} />
        </div>

        {/* Main Content */}
        <div
          className={cn(
            'min-h-screen transition-all duration-300 ease-in-out',
            sidebarOpen ? 'md:pl-64' : 'md:pl-0',
          )}
        >
          <AppHeader
            onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
            onToggleMobileSidebar={() => setMobileMenuOpen(true)}
          />

          <main className="flex-1">{children}</main>
        </div>
      </div>
    </FavoritesProvider>
  );
}
