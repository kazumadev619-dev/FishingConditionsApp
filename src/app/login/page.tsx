'use client';

import { authenticate } from '@/lib/actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle } from 'lucide-react';

export default function LoginPage() {
  const [errorMessage, dispatch] = useActionState(authenticate, undefined);

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-950">
      <form action={dispatch}>
        <Card className="mx-auto max-w-sm">
          <CardHeader>
            <CardTitle className="text-2xl">ログイン</CardTitle>
            <CardDescription>
              メールアドレスとパスワードを入力してログインしてください
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="email">メールアドレス</Label>
                <Input id="email" type="email" name="email" placeholder="m@example.com" required />
              </div>
              <div className="grid gap-2">
                <div className="flex items-center">
                  <Label htmlFor="password">パスワード</Label>
                  <Link href="#" className="ml-auto inline-block text-sm underline">
                    パスワードを忘れましたか？
                  </Link>
                </div>
                <Input id="password" type="password" name="password" required />
              </div>
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
              <LoginButton />
              <Button variant="outline" className="w-full" disabled>
                Googleでログイン
              </Button>
            </div>
            <div className="mt-4 text-center text-sm">
              アカウントをお持ちでないですか？{' '}
              <Link href="/register" className="underline">
                新規登録
              </Link>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}

function LoginButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" className="w-full" aria-disabled={pending}>
      {pending ? 'ログイン処理中...' : 'ログイン'}
    </Button>
  );
}
