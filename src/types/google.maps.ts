/**
 * Google Maps APIのジオコーディングレスポンスの全体構造
 */
export interface GeocodingResponse {
  results: GeocodingResult[];
  status: GeocodingStatus;
  error_message?: string;
}

/**
 * ジオコーディングの結果セット
 * https://developers.google.com/maps/documentation/javascript/reference/geocoder?hl=ja#GeocodingResult
 */
export interface GeocodingResult {
  address_components: AddressComponent[];
  formatted_address: string;
  geometry: Geometry;
  place_id: string;
  name?: string;
  plus_code?: PlusCode;
  types: string[];
}

/**
 * 住所の構成要素
 * https://developers.google.com/maps/documentation/javascript/reference/geocoder?hl=ja#AddressComponent
 */
export interface AddressComponent {
  long_name: string;
  short_name: string;
  types: string[];
}

/**
 * ジオメトリ情報
 * https://developers.google.com/maps/documentation/javascript/reference/geocoder?hl=ja#GeocoderGeometry
 */
export interface Geometry {
  location: LatLngLiteral;
  location_type: LocationType;
  viewport: Bounds;
  bounds?: Bounds;
}

/**
 * 緯度経度のリテラル表現
 * https://developers.google.com/maps/documentation/javascript/reference/coordinates?hl=ja#LatLngLiteral
 */
export interface LatLngLiteral {
  lat: number;
  lng: number;
}

/**
 * 表示領域（ビューポート）
 * https://developers.google.com/maps/documentation/javascript/reference/coordinates?hl=ja#LatLngBoundsLiteral
 */
export interface Bounds {
  northeast: LatLngLiteral;
  southwest: LatLngLiteral;
}

/**
 * Plus Code (Open Location Code)
 * https://developers.google.com/maps/documentation/javascript/reference/geocoder?hl=ja#PlusCode
 */
export interface PlusCode {
  compound_code: string;
  global_code: string;
}

/**
 * ジオコーディングのステータスコード
 * https://developers.google.com/maps/documentation/javascript/reference/geocoder?hl=ja#GeocodingStatus
 */
export type GeocodingStatus =
  | 'OK'
  | 'ZERO_RESULTS'
  | 'OVER_QUERY_LIMIT'
  | 'REQUEST_DENIED'
  | 'INVALID_REQUEST'
  | 'UNKNOWN_ERROR';

/**
 * ジオメトリの場所のタイプ
 * https://developers.google.com/maps/documentation/geocoding/requests-geocoding?hl=ja#results
 */
export type LocationType = 'ROOFTOP' | 'RANGE_INTERPOLATED' | 'GEOMETRIC_CENTER' | 'APPROXIMATE';
