'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Clock, MapPin, LogIn, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger';

interface SearchHistoryItem {
  id: string;
  searched_at: string;
  location: {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    prefecture: string | null;
    region: string | null;
    port: {
      id: string;
      name: string;
      prefecture_code: string;
    } | null;
  };
}

interface SearchHistoryResponse {
  history: SearchHistoryItem[];
}

export function SearchHistory() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [history, setHistory] = useState<SearchHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'authenticated' && session?.user) {
      fetchSearchHistory();
    }
  }, [status, session]);

  const fetchSearchHistory = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/user/search-history?limit=10');

      if (!response.ok) {
        if (response.status === 401) {
          logger.warn('Unauthorized access to search history');
          return;
        }
        throw new Error('Failed to fetch search history');
      }

      const data: SearchHistoryResponse = await response.json();
      setHistory(data.history);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ err }, 'Error fetching search history');
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleHistoryClick = (item: SearchHistoryItem) => {
    router.push(`/dashboard?locationId=${item.location.id}`);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));

    if (diffInHours < 1) {
      return 'たった今';
    } else if (diffInHours < 24) {
      return `${diffInHours}時間前`;
    } else if (diffInHours < 48) {
      return '昨日';
    } else {
      return date.toLocaleDateString('ja-JP', {
        month: 'short',
        day: 'numeric',
      });
    }
  };

  // 未ログイン時の誘導UI
  if (status === 'unauthenticated') {
    return (
      <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Clock className="h-6 w-6 text-muted-foreground" />
        </div>
        <p className="mb-2 text-sm font-medium text-foreground">履歴を使おう</p>
        <p className="mb-4 text-xs text-muted-foreground">
          ログインすると検索した釣り場の履歴が表示されます
        </p>
        <Button size="sm" variant="outline" onClick={() => router.push('/login')} className="gap-2">
          <LogIn className="h-4 w-4" />
          ログイン
        </Button>
      </div>
    );
  }

  // ローディング状態
  if (status === 'loading' || isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // エラー状態
  if (error) {
    return (
      <div className="py-8 px-4 text-center">
        <p className="text-sm text-destructive">履歴の読み込みに失敗しました</p>
        <Button size="sm" variant="ghost" onClick={fetchSearchHistory} className="mt-2">
          再試行
        </Button>
      </div>
    );
  }

  // 空状態メッセージ
  if (history.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Clock className="h-6 w-6 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground">まだ履歴がありません</p>
        <p className="text-xs text-muted-foreground">釣り場を検索してみましょう</p>
      </div>
    );
  }

  // ログイン済み時の履歴リスト
  return (
    <ScrollArea className="h-[300px]">
      <div className="space-y-1 pr-4">
        {history.map((item) => (
          <button
            key={item.id}
            onClick={() => handleHistoryClick(item)}
            className={cn(
              'flex w-full flex-col items-start gap-1 rounded-2xl px-3 py-2 text-left text-sm transition-colors',
              'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
          >
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span>{formatDate(item.searched_at)}</span>
            </div>
            <div className="flex items-start gap-2">
              <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
              <div className="flex-1 overflow-hidden">
                <p className="truncate font-medium">{item.location.name}</p>
                {(item.location.prefecture || item.location.region) && (
                  <p className="truncate text-xs text-muted-foreground">
                    {item.location.prefecture}
                    {item.location.region && ` / ${item.location.region}`}
                  </p>
                )}
                {item.location.port && (
                  <p className="truncate text-xs text-muted-foreground">
                    最寄り港: {item.location.port.name}
                  </p>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>
    </ScrollArea>
  );
}
