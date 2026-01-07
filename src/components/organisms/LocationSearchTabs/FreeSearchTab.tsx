'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Search, MapPin, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useSession } from 'next-auth/react';
import { logger } from '@/lib/logger';

interface SearchResult {
  place_id: string;
  formatted_address: string;
  name: string;
  geometry: {
    location: {
      lat: number;
      lng: number;
    };
  };
}

interface FreeSearchTabProps {
  onLocationSelect?: (location: { lat: number; lng: number; name: string }) => void;
}

export function FreeSearchTab({ onLocationSelect }: FreeSearchTabProps) {
  const router = useRouter();
  const { data: session } = useSession();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debouncedQuery, setDebouncedQuery] = useState('');

  // debounce処理（300ms）
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  // 検索実行
  useEffect(() => {
    const searchLocations = async () => {
      if (debouncedQuery.length < 2) {
        setResults([]);
        setError(null);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/locations/search?q=${encodeURIComponent(debouncedQuery)}`,
        );

        if (!response.ok) {
          throw new Error('検索に失敗しました');
        }

        const data = await response.json();
        setResults(data.data || []);
      } catch (err) {
        logger.error({ err }, 'Location search error');
        setError(err instanceof Error ? err.message : '検索中にエラーが発生しました');
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    };

    searchLocations();
  }, [debouncedQuery]);

  const handleSelectLocation = useCallback(
    async (result: SearchResult) => {
      const location = {
        lat: result.geometry.location.lat,
        lng: result.geometry.location.lng,
        name: result.name || result.formatted_address,
      };

      // ログイン済みの場合はlocationsに保存
      if (session?.user) {
        try {
          const response = await fetch('/api/locations', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              name: location.name,
              latitude: location.lat,
              longitude: location.lng,
              address: result.formatted_address,
            }),
          });

          if (!response.ok) {
            throw new Error('釣り場の保存に失敗しました');
          }

          const savedLocation = await response.json();

          // 保存したlocationIdでダッシュボードに遷移
          router.push(`/dashboard?locationId=${savedLocation.id}`);
        } catch (err) {
          logger.error({ err }, 'Failed to save location');
          // 保存失敗時も座標で遷移
          router.push(`/dashboard?lat=${location.lat}&lng=${location.lng}`);
        }
      } else {
        // 未ログイン時は座標のみでダッシュボードに遷移
        router.push(`/dashboard?lat=${location.lat}&lng=${location.lng}`);
      }

      if (onLocationSelect) {
        onLocationSelect(location);
      }
    },
    [router, session, onLocationSelect],
  );

  return (
    <div className="space-y-3">
      {/* 検索バー */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          placeholder="場所を検索（例: 東京湾、横浜港）"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9"
        />
        {isLoading && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* エラーメッセージ */}
      {error && (
        <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
      )}

      {/* 検索結果 */}
      {results.length > 0 && (
        <ScrollArea className="h-[300px] rounded-lg border">
          <div className="p-2 space-y-1">
            {results.map((result) => (
              <button
                key={result.place_id}
                onClick={() => handleSelectLocation(result)}
                className={cn(
                  'w-full text-left rounded-lg p-3 transition-colors',
                  'hover:bg-accent hover:text-accent-foreground',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                )}
              >
                <div className="flex items-start gap-2">
                  <MapPin className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{result.name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {result.formatted_address}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
      )}

      {/* 空状態 */}
      {!isLoading && query.length >= 2 && results.length === 0 && !error && (
        <div className="text-center py-8 text-sm text-muted-foreground">
          検索結果が見つかりませんでした
        </div>
      )}

      {/* ヘルプテキスト */}
      {query.length === 0 && (
        <div className="text-xs text-muted-foreground p-3">
          任意の場所を検索できます。最寄りの潮汐観測港が自動的にマッピングされます。
        </div>
      )}
    </div>
  );
}
