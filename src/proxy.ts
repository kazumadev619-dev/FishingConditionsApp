import { auth } from '@/auth/edge';

/**
 * Next.js 16 Proxy (旧middleware)
 * Node.js Runtimeで動作（runtime設定は不可）
 * auth/edge.tsからauth()をインポート（シンプルかつ明示的）
 */
export default auth;

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api/auth (Auth.js routes)
     * - healthz (liveness/readiness probe)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, sitemap.xml, robots.txt (metadata files)
     */
    '/((?!api/auth|healthz|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)',
  ],
};
