/**
 * アニメーション関連の定数
 */

import type { Transition, Variants } from 'framer-motion';

/**
 * カード表示時のバリアント（順次表示）
 */
export const cardVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: i * 0.1,
      duration: 0.5,
      ease: [0.4, 0, 0.2, 1] as const,
    },
  }),
};

/**
 * ホバー時のスケールトランジション
 */
export const hoverScaleTransition: Transition = {
  type: 'spring',
  stiffness: 300,
};

/**
 * ヘッダーのフェードイン設定
 */
export const headerAnimation = {
  initial: { opacity: 0, y: -20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.5 },
};

/**
 * 説明セクションのフェードイン設定
 */
export const explanationAnimation = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  transition: { delay: 0.5, duration: 0.5 },
};

/**
 * 地図セクションのフェードイン設定
 */
export const mapAnimation = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { delay: 0.6, duration: 0.5 },
};

/**
 * カードホバー時のスケール設定
 */
export const cardHoverScale = { scale: 1.02, y: -5 };
