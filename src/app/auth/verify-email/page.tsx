import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * メールのリンクの着地ページ。
 * メールのスキャナはリンクを開くだけで押さないので、確定はボタンの POST に分けている
 */
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token = '' } = await searchParams;

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-950">
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl text-center">メールアドレスの確認</CardTitle>
          <CardDescription className="text-center">
            ご自身で登録した場合だけ、下のボタンを押してください
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form method="post" action="/api/auth/verify-email">
            <input type="hidden" name="token" value={token} />
            <Button type="submit" className="w-full">
              メールアドレスを確認する
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
