'use client';

import { Anchor, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { logger } from '@/lib/logger';

interface Port {
  id: string;
  name: string;
  prefecture_code: string;
  prefecture_name: string | null;
  port_code: string;
  latitude: number | null;
  longitude: number | null;
}

interface Prefecture {
  code: string;
  name: string;
}

interface PortSelectionTabProps {
  onPortSelect?: (port: Port) => void;
}

export function PortSelectionTab({ onPortSelect }: PortSelectionTabProps) {
  const router = useRouter();
  const [selectedPrefecture, setSelectedPrefecture] = useState<string>('');
  const [selectedPortId, setSelectedPortId] = useState<string>('');
  const [allPorts, setAllPorts] = useState<Port[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 初回マウント時に全港を取得
  useEffect(() => {
    const fetchAllPorts = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch('/api/ports');

        if (!response.ok) {
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
    };

    fetchAllPorts();
  }, []);

  // 都道府県一覧を生成（港データから重複なしで抽出）
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

  // 選択された都道府県の港一覧をフィルタリング
  const filteredPorts = useMemo(() => {
    if (!selectedPrefecture) {
      return [];
    }
    return allPorts.filter((port) => port.prefecture_code === selectedPrefecture);
  }, [allPorts, selectedPrefecture]);

  const handlePortChange = useCallback(
    (portId: string) => {
      setSelectedPortId(portId);

      const port = allPorts.find((p) => p.id === portId);
      if (!port) {
        return;
      }

      if (!port.latitude || !port.longitude) {
        logger.error({ portId: port.id }, 'Port has no coordinates');
        return;
      }

      // portId で直接 dashboard に遷移
      router.push(`/dashboard?portId=${port.id}`);

      if (onPortSelect) {
        onPortSelect(port);
      }
    },
    [allPorts, router, onPortSelect],
  );

  return (
    <div className="space-y-3">
      {/* 都道府県選択 */}
      <Select value={selectedPrefecture} onValueChange={setSelectedPrefecture}>
        <SelectTrigger disabled={isLoading || allPorts.length === 0}>
          <SelectValue placeholder="都道府県を選択" />
        </SelectTrigger>
        <SelectContent>
          <ScrollArea className="h-[200px]">
            {prefectures.map((pref) => (
              <SelectItem key={pref.code} value={pref.code}>
                {pref.name}
              </SelectItem>
            ))}
          </ScrollArea>
        </SelectContent>
      </Select>

      {/* ローディング */}
      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* エラーメッセージ */}
      {error && (
        <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
      )}

      {/* 港選択 */}
      {!isLoading && filteredPorts.length > 0 && (
        <Select value={selectedPortId} onValueChange={handlePortChange}>
          <SelectTrigger>
            <SelectValue placeholder="港を選択" />
          </SelectTrigger>
          <SelectContent>
            <ScrollArea className="h-[300px]">
              {filteredPorts.map((port) => (
                <SelectItem
                  key={port.id}
                  value={port.id}
                  disabled={!port.latitude || !port.longitude}
                  className="flex items-start gap-2"
                >
                  <div className="flex items-start gap-2 w-full">
                    <Anchor className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{port.name}</div>
                      {(!port.latitude || !port.longitude) && (
                        <div className="text-xs text-muted-foreground">座標情報なし</div>
                      )}
                    </div>
                  </div>
                </SelectItem>
              ))}
            </ScrollArea>
          </SelectContent>
        </Select>
      )}

      {/* 空状態 */}
      {!isLoading && selectedPrefecture && filteredPorts.length === 0 && !error && (
        <div className="text-center py-8 text-sm text-muted-foreground">
          この都道府県に登録されている港がありません
        </div>
      )}
    </div>
  );
}
