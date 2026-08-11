import type { Metadata } from 'next';
import { AuthProvider } from '@/components/providers/auth-provider';
import './globals.css';

export const metadata: Metadata = {
  title: '🎣 Fishing Conditions App',
  description:
    '釣り初心者から経験者までが、「いつ・どこで・どんな条件なら釣れるか」をリアルタイムで確認できるWebアプリケーション。',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
