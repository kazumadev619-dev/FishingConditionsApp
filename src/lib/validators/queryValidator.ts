export const LIMIT_REGEX = /^\d+$/;

export function isValidQuery(query: string): boolean {
  for (const char of query) {
    const code = char.charCodeAt(0);
    if ((code >= 0 && code <= 31) || code === 127) {
      return false;
    }
  }
  return true;
}
