'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { MapPin, Loader2, Anchor } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useSession } from 'next-auth/react';
import { logger } from '@/lib/logger';

interface Port {
  id: string;
  name: string;
  prefecture_code: string;
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
  const { data: session } = useSession();
  const [selectedPrefecture, setSelectedPrefecture] = useState<string>('');
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
      if (!prefMap.has(port.prefecture_code)) {
        // CSVのデータ構造上、都道府県名は取得できないのでコードのみ
        // 将来的にはDBに都道府県名カラムを追加するか、別マスタを用意する
        prefMap.set(port.prefecture_code, `都道府県コード: ${port.prefecture_code}`);
      }
    });

    return Array.from(prefMap.entries())
      .map(([code, name]) => ({ code, name }))
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [allPorts]);

  // 選択された都道府県の港一覧をフィルタリング
  const filteredPorts = useMemo(() => {
    if (!selectedPrefecture) {
      return [];
    }
    return allPorts.filter((port) => port.prefecture_code === selectedPrefecture);
  }, [allPorts, selectedPrefecture]);

  const handleSelectPort = useCallback(
    async (port: Port) => {
      if (!port.latitude || !port.longitude) {
        logger.error({ portId: port.id }, 'Port has no coordinates');
        return;
      }

      // ログイン済みの場合はlocationsに保存
      if (session?.user) {
        try {
          const response = await fetch('/api/locations', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              name: port.name,
              latitude: port.latitude,
              longitude: port.longitude,
              port_id: port.id,
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
          // 保存失敗時もportIdで遷移
          router.push(`/dashboard?portId=${port.id}`);
        }
      } else {
        // 未ログイン時はportIdでダッシュボードに遷移
        router.push(`/dashboard?portId=${port.id}`);
      }

      if (onPortSelect) {
        onPortSelect(port);
      }
    },
    [router, session, onPortSelect],
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

      {/* 港リスト */}
      {!isLoading && filteredPorts.length > 0 && (
        <ScrollArea className="h-[300px] rounded-lg border">
          <div className="p-2 space-y-1">
            {filteredPorts.map((port) => (
              <button
                key={port.id}
                onClick={() => handleSelectPort(port)}
                disabled={!port.latitude || !port.longitude}
                className={cn(
                  'w-full text-left rounded-lg p-3 transition-colors',
                  'hover:bg-accent hover:text-accent-foreground',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                )}
              >
                <div className="flex items-start gap-2">
                  <Anchor className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{port.name}</div>
                    {(!port.latitude || !port.longitude) && (
                      <div className="text-xs text-muted-foreground">座標情報なし</div>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
      )}

      {/* 空状態 */}
      {!isLoading && selectedPrefecture && filteredPorts.length === 0 && !error && (
        <div className="text-center py-8 text-sm text-muted-foreground">
          この都道府県に登録されている港がありません
        </div>
      )}

      {/* ヘルプテキスト */}
      {!selectedPrefecture && !isLoading && !error && (
        <div className="flex items-start gap-2 text-xs text-muted-foreground p-3 bg-muted/50 rounded-lg">
          <MapPin className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            港マスタから選択すると、確実に潮汐データを取得できます。都道府県を選択してください。
          </div>
        </div>
      )}
    </div>
  );
}
