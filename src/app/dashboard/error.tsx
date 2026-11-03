'use client';

export default function DashboardError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <div className="bg-card rounded-lg border p-8 text-center">
        <h2 className="text-title mb-4">一時的に利用できません</h2>
        <p className="text-muted-foreground mb-6">
          データの取得に失敗しました。サーバー側の一時的な問題の可能性があります。
          しばらく待ってから再試行してください。
        </p>
        {error.digest && (
          <p className="text-sm text-muted-foreground mb-6">
            エラーID: <code className="font-mono">{error.digest}</code>
          </p>
        )}
        <button
          type="button"
          onClick={retry}
          className="px-6 py-3 bg-primary text-primary-foreground rounded-md font-bold hover:brightness-94 transition-all"
        >
          再試行
        </button>
      </div>
    </div>
  );
}
