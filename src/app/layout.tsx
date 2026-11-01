import type { Metadata } from 'next';
import { BIZ_UDPGothic, IBM_Plex_Mono, Shippori_Mincho_B1 } from 'next/font/google';
import { connection } from 'next/server';
import { AuthProvider } from '@/components/providers/auth-provider';
import './globals.css';

// 日本語の字形はサブセットが細かく、preload すると latin だけが先に読まれて意味が薄い
const bizUdp = BIZ_UDPGothic({
  weight: ['400', '700'],
  variable: '--font-biz-udp',
  preload: false,
});
const shippori = Shippori_Mincho_B1({
  weight: ['600', '700'],
  variable: '--font-shippori',
  preload: false,
});
const plexMono = IBM_Plex_Mono({
  weight: ['500', '600'],
  subsets: ['latin'],
  variable: '--font-plex-mono',
});

export const metadata: Metadata = {
  title: 'Fishing Conditions App',
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
    <html lang="ja" className={`${bizUdp.variable} ${shippori.variable} ${plexMono.variable}`}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
