'use client';

import { FavoriteTab } from '@/components/organisms/LocationSearchTabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useFavorites } from '@/hooks/useFavorites';

interface FavoritesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FavoritesModal({ open, onOpenChange }: FavoritesModalProps) {
  const { favorites, isLoading, error, removeFavorite, refetch } = useFavorites();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>お気に入り</DialogTitle>
        </DialogHeader>
        <FavoriteTab
          favorites={favorites}
          isLoading={isLoading}
          error={error}
          onRemove={removeFavorite}
          onRefresh={refetch}
        />
      </DialogContent>
    </Dialog>
  );
}
