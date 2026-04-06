// src/hooks/useLocationSearch.ts
'use client';

import { useEffect, useState } from 'react';
import { logger } from '@/lib/logger';

export interface SearchResult {
  place_id: string;
  formatted_address: string;
  name: string;
  latitude: number;
  longitude: number;
}

export function useLocationSearch(query: string) {
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

  return { results, isLoading, error };
}
