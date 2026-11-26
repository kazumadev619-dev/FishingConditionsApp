import type { GeocodingResponse, GeocodingStatus } from '@/types/google.maps';
import { googleMapsClient } from './api/client';
import { createApiError } from './api/errorHandler';
import { ApiError, ApiErrorType } from './api/types';

function createGeocodingApiError(
  status: GeocodingStatus | string,
  errorMessage?: string,
): ApiError {
  const message = `Geocoding API error: ${status}${errorMessage ? ` - ${errorMessage}` : ''}`;

  switch (status) {
    case 'OVER_QUERY_LIMIT':
      return new ApiError(message, ApiErrorType.RATE_LIMITED, undefined, true);
    case 'REQUEST_DENIED':
    case 'INVALID_REQUEST':
      return new ApiError(message, ApiErrorType.CLIENT_ERROR, undefined, false);
    default:
      return createApiError(502, message);
  }
}

/**
 * 住所文字列を使用してジオコーディングを実行し、緯度経度などの情報を取得します。
 * この関数は、汎用のAPIクライアントインスタンスを利用してリクエストを送信します。
 * @param address 検索する住所または地名
 * @returns ジオコーディング結果を含むPromise（ZERO_RESULTS も 0 件の正常応答として返す）
 * @throws APIがエラーを返した場合に ApiError をスローします
 */
export const geocode = async (address: string): Promise<GeocodingResponse> => {
  // Google Maps APIが正しく設定されているかチェック
  if (!googleMapsClient.isAvailable()) {
    throw new ApiError(
      'Google Maps API is not configured. Please set GOOGLE_MAPS_API_KEY in your environment variables.',
      ApiErrorType.CLIENT_ERROR,
      undefined,
      false,
    );
  }

  const data = await googleMapsClient.get<GeocodingResponse>('/geocode/json', {
    params: {
      address,
      language: 'ja',
    },
  });

  if (data.status === 'OK' || data.status === 'ZERO_RESULTS') {
    return data;
  }

  throw createGeocodingApiError(data.status, data.error_message);
};
