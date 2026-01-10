'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Search, Anchor, Heart } from 'lucide-react';
import { FreeSearchTab } from './FreeSearchTab';
import { PortSelectionTab } from './PortSelectionTab';
import { FavoriteTab } from './FavoriteTab';
import { useFavorites } from '@/hooks/useFavorites';

export function LocationSearchTabs() {
  const { favorites, isLoading, error, removeFavorite, refetch } = useFavorites();

  return (
    <Tabs defaultValue="free" className="w-full">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="free" className="flex items-center gap-2">
          <Search className="h-4 w-4" />
          <span>自由検索</span>
        </TabsTrigger>
        <TabsTrigger value="port" className="flex items-center gap-2">
          <Anchor className="h-4 w-4" />
          <span>港</span>
        </TabsTrigger>
        <TabsTrigger value="favorites" className="flex items-center gap-2">
          <Heart className="h-4 w-4" />
          <span>お気に入り</span>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="free" className="mt-4">
        <FreeSearchTab />
      </TabsContent>

      <TabsContent value="port" className="mt-4">
        <PortSelectionTab />
      </TabsContent>

      <TabsContent value="favorites" className="mt-4">
        <FavoriteTab
          favorites={favorites}
          isLoading={isLoading}
          error={error}
          onRemove={removeFavorite}
          onRefresh={refetch}
        />
      </TabsContent>
    </Tabs>
  );
}

// Re-export sub-components if needed
export { FreeSearchTab } from './FreeSearchTab';
export { PortSelectionTab } from './PortSelectionTab';
export { FavoriteTab } from './FavoriteTab';
