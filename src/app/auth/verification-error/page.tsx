'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const ERROR_MESSAGES: Record<string, { title: string; description: string }> = {
  missing_token: {
    title: 'トークンが見つかりません',
    description: 'メールの確認リンクが無効です。もう一度登録を試してください。',
  },
  invalid_token: {
    title: '無効なトークンまたは期限切れ',
    description:
      'このリンクは無効または期限切れです。トークンの有効期限は1時間です。もう一度登録してください。',
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

  return (
    <Card className="mx-auto max-w-md">
      <CardHeader>
        <div className="flex justify-center mb-4">
          <XCircle className="h-16 w-16 text-red-500" />
        </div>
        <CardTitle className="text-2xl text-center">{errorInfo.title}</CardTitle>
        <CardDescription className="text-center">{errorInfo.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button asChild className="w-full">
          <Link href="/register">新規登録ページへ</Link>
        </Button>
        <Button asChild variant="outline" className="w-full">
          <Link href="/login">ログインページへ</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export default function VerificationErrorPage() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-950">
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
