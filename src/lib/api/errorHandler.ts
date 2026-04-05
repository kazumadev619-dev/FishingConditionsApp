import {
  ApiError,
  ApiErrorType,
  NON_RETRYABLE_STATUS_CODES,
  RETRYABLE_STATUS_CODES,
} from './types';

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

export function createApiError(statusCode: number, message: string): ApiError {
  let type: ApiErrorType;
  let retryable = false;

  if (statusCode === 429) {
    type = ApiErrorType.RATE_LIMITED;
    retryable = true;
  } else if (RETRYABLE_STATUS_CODES.includes(statusCode)) {
    type = ApiErrorType.SERVER_ERROR;
    retryable = true;
  } else if (NON_RETRYABLE_STATUS_CODES.includes(statusCode)) {
    type = ApiErrorType.CLIENT_ERROR;
    retryable = false;
  } else {
    type = ApiErrorType.SERVER_ERROR;
    retryable = statusCode >= 500;
  }

  return new ApiError(message, type, statusCode, retryable);
}
