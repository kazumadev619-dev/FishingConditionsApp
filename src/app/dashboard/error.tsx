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
      <div className="bg-card rounded-xl border p-8 text-center">
        <h2 className="text-2xl font-bold mb-4">⚠️ 一時的に利用できません</h2>
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
          className="px-6 py-3 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
        >
          再試行
        </button>
      </div>
    </div>
  );
}
