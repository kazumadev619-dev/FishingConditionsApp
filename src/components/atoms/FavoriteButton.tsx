'use client';

import { Heart } from 'lucide-react';
import { motion } from 'framer-motion';

interface FavoriteButtonProps {
  isFavorite: boolean;
  isLoading?: boolean;
  onToggle: () => void;
  size?: 'sm' | 'md' | 'lg';
}

export function FavoriteButton({
  isFavorite,
  isLoading = false,
  onToggle,
  size = 'md',
}: FavoriteButtonProps) {
  const sizeClasses = {
    sm: 'w-6 h-6',
    md: 'w-8 h-8',
    lg: 'w-10 h-10',
  };

  const iconSizes = {
    sm: 16,
    md: 20,
    lg: 24,
  };

  return (
    <motion.button
      onClick={onToggle}
      disabled={isLoading}
      className={`${sizeClasses[size]} flex items-center justify-center rounded-full transition-colors hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed`}
      whileTap={{ scale: 0.9 }}
      aria-label={isFavorite ? 'お気に入りから削除' : 'お気に入りに追加'}
    >
      <motion.div
        initial={false}
        animate={{
          scale: isFavorite ? 1.2 : 1,
        }}
        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      >
        <Heart
          size={iconSizes[size]}
          className={`transition-colors ${
            isFavorite ? 'fill-red-500 text-red-500' : 'text-gray-400 hover:text-red-400'
          }`}
        />
      </motion.div>
    </motion.button>
  );
}
