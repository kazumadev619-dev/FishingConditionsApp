'use client';

import { signup } from '@/lib/actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordRequirements } from '@/components/ui/password-requirements';
import { PasswordStrengthIndicator } from '@/components/ui/password-strength-indicator';
import Link from 'next/link';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle } from 'lucide-react';

export default function RegisterPage() {
  const [errorMessage, dispatch] = useActionState(signup, undefined);
  const [password, setPassword] = useState('');

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-950">
      <form action={dispatch}>
        <Card className="mx-auto max-w-sm">
          <CardHeader>
            <CardTitle className="text-2xl">新規登録</CardTitle>
            <CardDescription>
              アカウントを作成するために以下の情報を入力してください
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="name">名前</Label>
                <Input id="name" name="name" placeholder="山田 太郎" required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="email">メールアドレス</Label>
                <Input id="email" type="email" name="email" placeholder="m@example.com" required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="password">パスワード</Label>
                <Input
                  id="password"
                  type="password"
                  name="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              {password && (
                <>
                  <PasswordStrengthIndicator password={password} />
                  <PasswordRequirements password={password} />
                </>
              )}

              {errorMessage && (
                <div
                  className="flex items-center space-x-2 text-sm text-red-500"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  <AlertCircle className="h-4 w-4" />
                  <p>{errorMessage}</p>
                </div>
              )}
              <SignupButton />
            </div>
            <div className="mt-4 text-center text-sm">
              既にアカウントをお持ちですか？{' '}
              <Link href="/login" className="underline">
                ログイン
              </Link>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}

function SignupButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" className="w-full" aria-disabled={pending}>
      {pending ? '登録処理中...' : 'アカウント作成'}
    </Button>
  );
}
