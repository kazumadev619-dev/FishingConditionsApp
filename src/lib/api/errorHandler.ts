import { ApiError, ApiErrorType, RETRYABLE_STATUS_CODES } from './types';

export async function parseErrorResponse(response: Response): Promise<string> {
  try {
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      const data = await response.json();
      return data.message || data.error || `HTTP ${response.status}`;
    }
    return await response.text();
  } catch {
    return `HTTP ${response.status} ${response.statusText}`;
  }
}

// 種別は 4xx が CLIENT_ERROR・5xx が SERVER_ERROR（429 だけ RATE_LIMITED）。
// リトライ可否は種別と独立で、RETRYABLE_STATUS_CODES（408 を含む）だけが対象。
export function createApiError(statusCode: number, message: string): ApiError {
  if (statusCode === 429) {
    return new ApiError(message, ApiErrorType.RATE_LIMITED, statusCode, false);
  }
  const type = statusCode < 500 ? ApiErrorType.CLIENT_ERROR : ApiErrorType.SERVER_ERROR;
  return new ApiError(message, type, statusCode, RETRYABLE_STATUS_CODES.includes(statusCode));
}
