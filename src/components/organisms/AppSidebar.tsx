'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Home, MapPin, ChevronDown, Waves, User } from 'lucide-react';
import { useSession } from 'next-auth/react';

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
      { title: 'お気に入り', url: '#' },
      { title: '履歴', url: '#' },
      { title: '新しい釣り場', url: '#' },
    ],
  },
];

interface AppSidebarProps {
  isOpen: boolean;
}

export function AppSidebar({ isOpen }: AppSidebarProps) {
  const { data: session } = useSession();
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});

  const toggleExpanded = (title: string) => {
    setExpandedItems((prev) => ({
      ...prev,
      [title]: !prev[title],
    }));
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
                    {item.items.map((subItem) => (
                      <a
                        key={subItem.title}
                        href={subItem.url}
                        className="flex items-center justify-between rounded-2xl px-3 py-2 text-sm hover:bg-muted"
                      >
                        {subItem.title}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>

        {/* User Profile */}
        <div className="border-t p-3">
          <div className="space-y-1">
            <button className="flex w-full items-center justify-between rounded-2xl px-3 py-2 text-sm font-medium hover:bg-muted">
              <div className="flex items-center gap-3">
                <User className="h-6 w-6" />
                <span className="truncate">{session?.user?.email || 'ユーザー'}</span>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
