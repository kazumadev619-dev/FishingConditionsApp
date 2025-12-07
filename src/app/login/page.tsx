'use client';

import { authenticate } from '@/lib/actions';
import { signIn } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Link from 'next/link';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle } from 'lucide-react';

export default function LoginPage() {
  const [errorMessage, dispatch] = useActionState(authenticate, undefined);
  const [googleError, setGoogleError] = useState<string | undefined>(undefined);

  const handleGoogleSignIn = async () => {
    try {
      setGoogleError(undefined);
      await signIn('google', { callbackUrl: '/dashboard' });
    } catch (error) {
      console.error('Google sign-in error:', error);
      setGoogleError('Googleログインに失敗しました。時間をおいて再度お試しください。');
    }
  };

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

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">または</span>
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={handleGoogleSignIn}
              >
                <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                  <path
                    fill="currentColor"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="currentColor"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="currentColor"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="currentColor"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                Googleでログイン
              </Button>

              {googleError && (
                <div
                  className="flex items-center space-x-2 text-sm text-red-500"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  <AlertCircle className="h-4 w-4" />
                  <p>{googleError}</p>
                </div>
              )}
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
