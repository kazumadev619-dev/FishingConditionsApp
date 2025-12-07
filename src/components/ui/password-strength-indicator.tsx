'use client';

import { calculatePasswordStrength, type PasswordStrength } from '@/lib/password-validation';

interface PasswordStrengthIndicatorProps {
  password: string;
}

const strengthConfig: Record<
  PasswordStrength,
  {
    label: string;
    color: string;
    bgColor: string;
    width: string;
  }
> = {
  weak: {
    label: '弱',
    color: 'text-red-600 dark:text-red-400',
    bgColor: 'bg-red-500',
    width: 'w-1/3',
  },
  medium: {
    label: '中',
    color: 'text-yellow-600 dark:text-yellow-400',
    bgColor: 'bg-yellow-500',
    width: 'w-2/3',
  },
  strong: {
    label: '強',
    color: 'text-green-600 dark:text-green-400',
    bgColor: 'bg-green-500',
    width: 'w-full',
  },
};

export function PasswordStrengthIndicator({ password }: PasswordStrengthIndicatorProps) {
  if (password.length === 0) {
    return null;
  }

  const strength = calculatePasswordStrength(password);
  const config = strengthConfig[strength];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-700 dark:text-gray-300">パスワード強度:</span>
        <span className={`font-medium ${config.color}`}>{config.label}</span>
      </div>
      <div className="h-2 w-full bg-gray-200 rounded-full overflow-hidden dark:bg-gray-700">
        <div className={`h-full ${config.bgColor} ${config.width} transition-all duration-300`} />
      </div>
    </div>
  );
}
