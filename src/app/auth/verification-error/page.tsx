'use client';

import { XCircle } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const ERROR_MESSAGES: Record<string, { title: string; description: string }> = {
  missing_token: {
    title: 'トークンが見つかりません',
    description: 'メールの確認リンクが無効です。ログインすると確認メールを送り直します。',
  },
  invalid_token: {
    title: '無効なトークンまたは期限切れ',
    description:
      'このリンクは無効または期限切れです。トークンの有効期限は1時間です。ログインすると確認メールを送り直します。',
  },
  user_not_found: {
    title: 'ユーザーが見つかりません',
    description: 'このメールアドレスに関連付けられたユーザーが見つかりませんでした。',
  },
  server_error: {
    title: 'サーバーエラー',
    description: 'サーバーでエラーが発生しました。時間をおいて再度お試しください。',
  },
};

function VerificationErrorContent() {
  const searchParams = useSearchParams();
  const errorType = searchParams.get('error') || 'server_error';
  const errorInfo = ERROR_MESSAGES[errorType] || ERROR_MESSAGES.server_error;
  // リンクが無効・期限切れになるのは登録済みの人。新規登録を押すと「既に使用されています」になる
  const loginFirst = errorType === 'invalid_token' || errorType === 'missing_token';
  const login = { href: '/login', label: 'ログインページへ' };
  const register = { href: '/register', label: '新規登録ページへ' };
  const [primary, secondary] = loginFirst ? [login, register] : [register, login];

  return (
    <Card className="mx-auto max-w-md">
      <CardHeader>
        <div className="flex justify-center mb-4">
          <XCircle className="h-16 w-16 text-destructive" />
        </div>
        <CardTitle className="text-title text-center">{errorInfo.title}</CardTitle>
        <CardDescription className="text-center">{errorInfo.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button asChild className="w-full">
          <Link href={primary.href}>{primary.label}</Link>
        </Button>
        <Button asChild variant="outline" className="w-full">
          <Link href={secondary.href}>{secondary.label}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export default function VerificationErrorPage() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <Suspense
        fallback={
          <Card className="mx-auto max-w-md">
            <CardContent className="py-8">
              <p className="text-center">読み込み中...</p>
            </CardContent>
          </Card>
        }
      >
        <VerificationErrorContent />
      </Suspense>
    </div>
  );
}
