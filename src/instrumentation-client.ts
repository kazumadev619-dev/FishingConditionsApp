import { reportClientError } from '@/lib/clientErrors';

// error.tsx も境界も通らない例外（イベントハンドラ、非同期処理）をサーバーのログへ届ける（#247）
window.addEventListener('error', (event) => {
  reportClientError(event.error ?? event.message, 'window-error');
});
window.addEventListener('unhandledrejection', (event) => {
  reportClientError(event.reason, 'unhandled-rejection');
});
