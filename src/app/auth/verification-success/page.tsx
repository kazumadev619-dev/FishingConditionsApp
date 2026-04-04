import { CheckCircle } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function VerificationSuccessPage() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-950">
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <div className="flex justify-center mb-4">
            <CheckCircle className="h-16 w-16 text-green-500" />
          </div>
          <CardTitle className="text-2xl text-center">メール検証完了</CardTitle>
          <CardDescription className="text-center">
            メールアドレスの確認が完了しました
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-center text-gray-600 dark:text-gray-400">
            アカウントの準備が整いました。ログインして釣りスコアアプリをお楽しみください。
          </p>
          <Button asChild className="w-full">
            <Link href="/login">ログインページへ</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
