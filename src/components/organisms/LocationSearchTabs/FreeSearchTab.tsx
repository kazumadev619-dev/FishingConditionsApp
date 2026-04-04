'use client';

import { Loader2, MapPin, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { logger } from '@/lib/logger';
import { cn } from '@/lib/utils';

interface SearchResult {
  place_id: string;
  formatted_address: string;
  name: string;
  latitude: number;
  longitude: number;
}

interface FreeSearchTabProps {
  onLocationSelect?: (location: { lat: number; lng: number; name: string }) => void;
}

export function FreeSearchTab({ onLocationSelect }: FreeSearchTabProps) {
  const router = useRouter();
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
    (result: SearchResult) => {
      const location = {
        lat: result.latitude,
        lng: result.longitude,
        name: result.name || result.formatted_address,
      };

      // URLパラメータで直接 dashboard に遷移
      const params = new URLSearchParams({
        lat: location.lat.toString(),
        lng: location.lng.toString(),
        name: location.name,
      });

      router.push(`/dashboard?${params.toString()}`);

      if (onLocationSelect) {
        onLocationSelect(location);
      }
    },
    [router, onLocationSelect],
  );

  return (
    <div className="space-y-3">
      {/* 検索バー */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          placeholder="場所を検索"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9 text-sm"
        />
        {isLoading && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* エラーメッセージ */}
      {error && (
        <div className="rounded-lg bg-destructive/10 p-2 text-xs text-destructive wrap-break-word">
          {error}
        </div>
      )}

      {/* 検索結果 */}
      {results.length > 0 && (
        <ScrollArea className="h-[200px] rounded-lg border">
          <div className="p-1 space-y-1">
            {results.map((result) => (
              <button
                key={result.place_id}
                type="button"
                onClick={() => handleSelectLocation(result)}
                className={cn(
                  'w-full text-left rounded-lg p-2 transition-colors',
                  'hover:bg-accent hover:text-accent-foreground',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                )}
              >
                <div className="flex items-start gap-2">
                  <MapPin className="h-3 w-3 mt-0.5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0 overflow-hidden">
                    <div className="font-medium text-xs truncate">{result.name}</div>
                    <div className="text-[10px] text-muted-foreground line-clamp-2 break-all">
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
        <div className="text-center py-4 text-xs text-muted-foreground">
          検索結果が見つかりませんでした
        </div>
      )}
    </div>
  );
}
