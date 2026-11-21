export function getBackoffDelay(attempt: number): number {
  return Math.min(100 * 2 ** attempt, 5000);
}
