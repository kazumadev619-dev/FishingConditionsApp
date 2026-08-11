'use client';

import { Anchor, Search } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FreeSearchTab } from './FreeSearchTab';
import { PortSelectionTab } from './PortSelectionTab';

export function LocationSearchTabs() {
  return (
    <Tabs defaultValue="free" className="w-full">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="free" className="flex items-center gap-2">
          <Search className="h-4 w-4" />
          <span>検索</span>
        </TabsTrigger>
        <TabsTrigger value="port" className="flex items-center gap-2">
          <Anchor className="h-4 w-4" />
          <span>港</span>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="free" className="mt-4">
        <FreeSearchTab />
      </TabsContent>

      <TabsContent value="port" className="mt-4">
        <PortSelectionTab />
      </TabsContent>
    </Tabs>
  );
}

export { FavoriteTab } from './FavoriteTab';
// Re-export sub-components if needed
export { FreeSearchTab } from './FreeSearchTab';
export { PortSelectionTab } from './PortSelectionTab';
