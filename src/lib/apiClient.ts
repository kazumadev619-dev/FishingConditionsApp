interface RequestOptions extends RequestInit {
  params?: Record<string, string>;
}

class ApiClient {
  private baseUrl: string;
  private apiKey: string;
  // APIキーをクエリパラメータとして渡すか、ヘッダーで渡すかを指定
  private keyLocation: 'query' | 'header';
  private keyName: string;

  constructor(
    baseUrl: string,
    apiKey: string,
    keyLocation: 'query' | 'header' = 'header', // デフォルトはヘッダー
    keyName: string = 'X-API-Key', // デフォルトのヘッダー/クエリ名
  ) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.keyLocation = keyLocation;
    this.keyName = keyName;
  }

  private async request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const { params, headers, ...rest } = options;
    const url = new URL(`${this.baseUrl}${endpoint}`);

    // 既存のクエリパラメータを追加
    if (params) {
      Object.keys(params).forEach((key) => url.searchParams.append(key, params[key]));
    }

    // APIキーをクエリパラメータとして追加
    if (this.apiKey && this.keyLocation === 'query') {
      url.searchParams.append(this.keyName, this.apiKey);
    }

    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...headers,
    };

    // APIキーをヘッダーとして追加
    if (this.apiKey && this.keyLocation === 'header') {
      requestHeaders[this.keyName] = this.apiKey;
    }

    const response = await fetch(url.toString(), {
      headers: requestHeaders,
      ...rest,
    });

    if (!response.ok) {
      // TODO: より詳細なエラーハンドリング
      const errorData = await response.json();
      throw new Error(errorData.message || 'API request failed');
    }

    return response.json() as Promise<T>;
  }

  public get<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
  }

  public post<T>(
    endpoint: string,
    data: Record<string, unknown> | unknown[],
    options?: RequestOptions,
  ): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // 必要に応じてput, deleteなども追加
}

// 各API用のクライアントインスタンスをエクスポート
// 環境変数からAPIキーを読み込む
export const openWeatherMapClient = new ApiClient(
  'https://api.openweathermap.org/data/2.5', // OpenWeatherMapのベースURL
  process.env.OPENWEATHERMAP_API_KEY || '',
  'query', // OpenWeatherMapはキーをクエリ(appid)で渡す
  'appid',
);

export const googleMapsClient = new ApiClient(
  'https://maps.googleapis.com/maps/api', // Google MapsのベースURL
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '',
  'query', // Google Maps APIはキーをクエリ(key)で渡す
  'key',
);

// tide736.net のAPIクライアントインスタンスをエクスポート
export const tide736Client = new ApiClient(
  'https://api.tide736.net/api', // tide736.net のベースURL
  '', // APIキーは不要
);
