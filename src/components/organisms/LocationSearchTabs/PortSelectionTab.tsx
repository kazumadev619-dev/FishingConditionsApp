// src/components/organisms/LocationSearchTabs/PortSelectionTab.tsx
'use client';

import { Anchor, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Port } from '@/hooks/usePortsData';
import { usePortsData } from '@/hooks/usePortsData';
import { logger } from '@/lib/logger';

interface PortSelectionTabProps {
  onPortSelect?: (port: Port) => void;
}

export function PortSelectionTab({ onPortSelect }: PortSelectionTabProps) {
  const router = useRouter();
  const { allPorts, prefectures, isLoading, error } = usePortsData();
  const [selectedPrefecture, setSelectedPrefecture] = useState<string>('');
  const [selectedPortId, setSelectedPortId] = useState<string>('');

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

      router.push(`/dashboard?portId=${port.id}`);

      if (onPortSelect) {
        onPortSelect(port);
      }
    },
    [allPorts, router, onPortSelect],
  );

  return (
    <div className="space-y-3">
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

      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
      )}

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

      {!isLoading && selectedPrefecture && filteredPorts.length === 0 && !error && (
        <div className="text-center py-8 text-sm text-muted-foreground">
          この都道府県に登録されている港がありません
        </div>
      )}
    </div>
  );
}
