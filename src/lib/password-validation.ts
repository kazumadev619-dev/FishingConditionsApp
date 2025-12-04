export interface PasswordRequirement {
  id: string;
  label: string;
  test: (password: string) => boolean;
}

export const passwordRequirements: PasswordRequirement[] = [
  {
    id: 'length',
    label: '8文字以上',
    test: (password) => password.length >= 8 && password.length <= 128,
  },
  {
    id: 'uppercase',
    label: '大文字を1文字以上含む',
    test: (password) => /[A-Z]/.test(password),
  },
  {
    id: 'lowercase',
    label: '小文字を1文字以上含む',
    test: (password) => /[a-z]/.test(password),
  },
  {
    id: 'number',
    label: '数字を1文字以上含む',
    test: (password) => /[0-9]/.test(password),
  },
  {
    id: 'special',
    label: '特殊文字(!@#$%^&*._-)を1文字以上含む',
    test: (password) => /[!@#$%^&*._-]/.test(password),
  },
];

export type PasswordStrength = 'weak' | 'medium' | 'strong';

export function calculatePasswordStrength(password: string): PasswordStrength {
  if (password.length === 0) return 'weak';

  const satisfiedRequirements = passwordRequirements.filter((req) => req.test(password)).length;

  if (satisfiedRequirements <= 2) return 'weak';
  if (satisfiedRequirements <= 4) return 'medium';
  return 'strong';
}
