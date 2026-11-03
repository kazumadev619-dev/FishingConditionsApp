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
    color: 'text-destructive',
    bgColor: 'bg-destructive',
    width: 'w-1/3',
  },
  medium: {
    label: '中',
    color: 'text-muted-foreground',
    bgColor: 'bg-muted-foreground',
    width: 'w-2/3',
  },
  strong: {
    label: '強',
    color: 'text-primary',
    bgColor: 'bg-primary',
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
        <span className="text-foreground">パスワード強度:</span>
        <span className={`font-medium ${config.color}`}>{config.label}</span>
      </div>
      <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${config.bgColor} ${config.width} transition-all duration-300`} />
      </div>
    </div>
  );
}
