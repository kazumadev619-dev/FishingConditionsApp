import { auth } from '@/auth/edge';

/**
 * Next.js 16 Proxy (旧middleware)
 * Node.js Runtimeで動作（runtime設定は不可）
 * Prisma/Adapterなし、JWTセッションのみで認証チェック
 */
export default auth;

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api/auth (Auth.js routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, sitemap.xml, robots.txt (metadata files)
     */
    '/((?!api/auth|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)',
  ],
};
