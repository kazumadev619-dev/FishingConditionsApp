'use client';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <div className="bg-card rounded-xl border p-8 text-center">
        <h2 className="text-2xl font-bold mb-4">⚠️ エラーが発生しました</h2>
        <p className="text-muted-foreground mb-6">
          データの取得に失敗しました。ネットワーク接続を確認してください。
        </p>
        <p className="text-sm text-red-500 mb-6">{error.message}</p>
        <button
          onClick={reset}
          className="px-6 py-3 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
        >
          再試行
        </button>
      </div>
    </div>
  );
}
