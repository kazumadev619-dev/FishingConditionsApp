'use client';

import { Check, X } from 'lucide-react';
import { passwordRequirements } from '@/lib/password-validation';

interface PasswordRequirementsProps {
  password: string;
}

export function PasswordRequirements({ password }: PasswordRequirementsProps) {
  return (
    <div className="space-y-2 text-sm">
      <p className="font-medium text-gray-700 dark:text-gray-300">パスワード要件:</p>
      <ul className="space-y-1">
        {passwordRequirements.map((requirement) => {
          const isSatisfied = requirement.test(password);
          return (
            <li
              key={requirement.id}
              className={`flex items-center space-x-2 ${
                password.length === 0
                  ? 'text-gray-500 dark:text-gray-400'
                  : isSatisfied
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-red-500 dark:text-red-400'
              }`}
            >
              {password.length === 0 ? (
                <span className="h-4 w-4 rounded-full border-2 border-gray-400" />
              ) : isSatisfied ? (
                <Check className="h-4 w-4" />
              ) : (
                <X className="h-4 w-4" />
              )}
              <span>{requirement.label}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
