import { Mail, MailWarning } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * 新規登録の直後に表示する。`?sent=0` は確認メールの送信に失敗したとき。
 * 失敗しても登録は残っていて、ログインすると確認メールを送り直す（credentials.ts）
 */
export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const { sent } = await searchParams;
  const failed = sent === '0';
  const Icon = failed ? MailWarning : Mail;

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <div className="flex justify-center mb-4">
            <Icon className={`h-16 w-16 ${failed ? 'text-destructive' : 'text-primary'}`} />
          </div>
          <CardTitle className="text-title text-center">
            {failed ? '確認メールを送信できませんでした' : '確認メールを送信しました'}
          </CardTitle>
          <CardDescription className="text-center">
            {failed
              ? '登録は完了しています。ログインすると確認メールを送り直します。'
              : 'メールに記載のリンクを開いて、登録を完了してください。リンクの有効期限は1時間です。'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link href="/login">ログインページへ</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
