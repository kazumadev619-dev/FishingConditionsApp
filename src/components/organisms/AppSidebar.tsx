'use client';

import { ChevronDown, Heart, Home, LogOut, MapPin, Search, User, Waves } from 'lucide-react';
import { signOut, useSession } from 'next-auth/react';
import { useState } from 'react';
import { FavoritesModal } from '@/components/organisms/FavoritesModal';
import { LocationSearchTabs } from '@/components/organisms/LocationSearchTabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

const sidebarItems = [
  {
    title: 'ホーム',
    icon: <Home />,
    isActive: true,
  },
  {
    title: '釣り場',
    icon: <MapPin />,
    items: [
      { title: '検索', icon: <Search className="h-4 w-4" />, component: 'search' },
      { title: 'お気に入り', icon: <Heart className="h-4 w-4" />, component: 'favorites' },
    ],
  },
];

interface AppSidebarProps {
  isOpen: boolean;
}

export function AppSidebar({ isOpen }: AppSidebarProps) {
  const { data: session } = useSession();
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});
  const [isFavoritesModalOpen, setIsFavoritesModalOpen] = useState(false);

  const toggleExpanded = (title: string) => {
    setExpandedItems((prev) => ({
      ...prev,
      [title]: !prev[title],
    }));
  };

  const handleLogout = async () => {
    await signOut({ callbackUrl: '/login' });
  };

  return (
    <div
      className={cn(
        'fixed inset-y-0 left-0 z-30 w-64 transform border-r bg-background transition-transform duration-300 ease-in-out',
        isOpen ? 'translate-x-0' : '-translate-x-full',
      )}
    >
      <div className="flex h-full flex-col">
        {/* Logo */}
        <div className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex aspect-square size-10 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-cyan-600 text-white">
              <Waves className="size-5" />
            </div>
            <div>
              <h2 className="font-semibold">釣りコンディション</h2>
              <p className="text-xs text-muted-foreground">Fishing Conditions</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <ScrollArea className="flex-1 px-3 py-2">
          <div className="space-y-1">
            {sidebarItems.map((item) => (
              <div key={item.title} className="mb-1">
                <button
                  type="button"
                  className={cn(
                    'flex w-full items-center justify-between rounded-2xl px-3 py-2 text-sm font-medium',
                    item.isActive ? 'bg-primary/10 text-primary' : 'hover:bg-muted',
                  )}
                  onClick={() => item.items && toggleExpanded(item.title)}
                >
                  <div className="flex items-center gap-3">
                    {item.icon}
                    <span>{item.title}</span>
                  </div>
                  {item.items && (
                    <ChevronDown
                      className={cn(
                        'ml-2 h-4 w-4 transition-transform',
                        expandedItems[item.title] ? 'rotate-180' : '',
                      )}
                    />
                  )}
                </button>

                {item.items && expandedItems[item.title] && (
                  <div className="mt-1 ml-6 space-y-1 border-l pl-3">
                    {item.items.map((subItem) => {
                      if ('component' in subItem && subItem.component === 'search') {
                        return (
                          <div key={subItem.title} className="px-3 py-2">
                            <LocationSearchTabs />
                          </div>
                        );
                      }

                      if ('component' in subItem && subItem.component === 'favorites') {
                        return (
                          <button
                            key={subItem.title}
                            type="button"
                            onClick={() => setIsFavoritesModalOpen(true)}
                            className="flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-sm hover:bg-muted"
                          >
                            {subItem.icon}
                            <span>{subItem.title}</span>
                          </button>
                        );
                      }

                      if ('url' in subItem && typeof subItem.url === 'string') {
                        return (
                          <a
                            key={subItem.title}
                            href={subItem.url}
                            className="flex items-center justify-between rounded-2xl px-3 py-2 text-sm hover:bg-muted"
                          >
                            {subItem.title}
                          </a>
                        );
                      }

                      return null;
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>

        {/* User Profile Dropdown */}
        <div className="border-t p-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-2xl px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <div className="flex items-center gap-3">
                  <User className="h-6 w-6" />
                  <span className="truncate">{session?.user?.email || 'ユーザー'}</span>
                </div>
                <ChevronDown className="h-4 w-4 opacity-50" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={handleLogout} className="text-red-600 focus:text-red-600">
                <LogOut className="mr-2 h-4 w-4" />
                <span>ログアウト</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* お気に入りモーダル */}
      <FavoritesModal open={isFavoritesModalOpen} onOpenChange={setIsFavoritesModalOpen} />
    </div>
  );
}
