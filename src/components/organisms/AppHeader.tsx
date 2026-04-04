'use client';

import { Menu, PanelLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface AppHeaderProps {
  onToggleSidebar: () => void;
  onToggleMobileSidebar?: () => void;
}

export function AppHeader({ onToggleSidebar, onToggleMobileSidebar }: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-10 flex h-16 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur">
      {/* Mobile Menu Button */}
      <Button variant="ghost" size="icon" className="md:hidden" onClick={onToggleMobileSidebar}>
        <Menu className="h-5 w-5" />
      </Button>

      {/* Desktop Sidebar Toggle */}
      <Button variant="ghost" size="icon" className="hidden md:flex" onClick={onToggleSidebar}>
        <PanelLeft className="h-5 w-5" />
      </Button>

      {/* Title */}
      <div className="flex flex-1 items-center justify-between">
        <h1 className="text-xl font-semibold">ダッシュボード</h1>
      </div>
    </header>
  );
}
