// src/hooks/usePortsData.ts
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { logger } from '@/lib/logger';

export interface Port {
  id: string;
  name: string;
  prefecture_code: string;
  prefecture_name: string | null;
  port_code: string;
  latitude: number | null;
  longitude: number | null;
}

export interface Prefecture {
  code: string;
  name: string;
}

export function usePortsData() {
  const [allPorts, setAllPorts] = useState<Port[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAllPorts = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/ports');

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('ログインが必要です');
        }
        throw new Error('港情報の取得に失敗しました');
      }

      const data = await response.json();
      setAllPorts(data.ports || []);
    } catch (err) {
      logger.error({ err }, 'Failed to fetch all ports');
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
      setAllPorts([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAllPorts();
  }, [fetchAllPorts]);

  const prefectures = useMemo<Prefecture[]>(() => {
    const prefMap = new Map<string, string>();

    allPorts.forEach((port) => {
      if (!prefMap.has(port.prefecture_code) && port.prefecture_name) {
        prefMap.set(port.prefecture_code, port.prefecture_name);
      }
    });

    return Array.from(prefMap.entries())
      .map(([code, name]) => ({ code, name }))
      .sort((a, b) => parseInt(a.code, 10) - parseInt(b.code, 10));
  }, [allPorts]);

  return { allPorts, prefectures, isLoading, error };
}
