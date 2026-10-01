import type { Metadata } from 'next';
import { connection } from 'next/server';
import { AuthProvider } from '@/components/providers/auth-provider';
import './globals.css';

export const metadata: Metadata = {
  title: '🎣 Fishing Conditions App',
  description:
    '釣り初心者から経験者までが、「いつ・どこで・どんな条件なら釣れるか」をリアルタイムで確認できるWebアプリケーション。',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // CSP の nonce はリクエスト毎に変わるので、全ページを動的レンダリングにする（#147）。
  // 静的に焼いた HTML には nonce が入らず、Next.js のインラインスクリプトが CSP に止められる
  await connection();

  return (
    <html lang="ja">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
