import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cacheMock = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
const weatherMock = vi.hoisted(() => vi.fn());
const tideMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/rateLimit', () => ({
  withUserRateLimit: (_routeName: string, handler: () => Promise<Response>) => handler(),
}));
vi.mock('@/lib/cache/client', () => ({ cache: cacheMock }));
vi.mock('@/lib/openWeatherService', () => ({ getCurrentWeather: weatherMock }));
vi.mock('@/lib/tideService', () => ({ getTideData: tideMock }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { CACHE_TTL } from '@/lib/cache';
import type { FormattedWeatherData } from '@/lib/openWeatherService';
import type { FormattedTideData } from '@/lib/tideService';
import { GET } from './route';

// スコアの中身は見ない（基準時刻とキーだけを見る）ので、計算が通る最小の形にする
const weather: FormattedWeatherData = {
  coordinates: { lat: 35.6789, lon: 139.7654 },
  cityName: 'Tokyo',
  country: 'JP',
  temperature: 20,
  feelsLike: 20,
  tempMin: 18,
  tempMax: 22,
  humidity: 50,
  pressure: 1013,
  windSpeed: 2,
  windDeg: 0,
  cloudiness: 0,
  visibility: 10000,
  weather: { id: 800, main: 'Clear', description: 'clear sky', icon: '01d' },
  sunrise: new Date('2026-10-12T05:40:00+09:00'),
  sunset: new Date('2026-10-12T17:10:00+09:00'),
  dataTime: new Date('2026-10-12T06:00:00+09:00'),
  timezone: 32400,
};
const tide: FormattedTideData = {
  port: { prefecture_code: '13', port_code: '1', port_name: '築地' },
  dataTime: new Date('2026-10-12T06:00:00+09:00'),
  tides: [],
};

const request = (date?: string) =>
  new NextRequest(
    `http://localhost/api/scores?lat=35.6789&lon=139.7654&prefectureCode=13&portCode=1${date ? `&date=${date}` : ''}`,
  );

async function scoreAt(nowIso: string, date?: string) {
  vi.setSystemTime(new Date(nowIso));
  const res = await GET(request(date));
  expect(res.status).toBe(200);
  const body = await res.json();
  return { calculatedAt: body.score.calculatedAt, key: cacheMock.set.mock.lastCall?.[0] };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  cacheMock.get.mockResolvedValue({ hit: false });
  cacheMock.set.mockResolvedValue(true);
  weatherMock.mockResolvedValue({ data: weather, fromCache: false });
  tideMock.mockResolvedValue({ data: tide, fromCache: false });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GET /api/scores の基準時刻（#301）', () => {
  it('今日は現在時刻で計算し、30分の枠ごとに別のキャッシュキーを使う', async () => {
    const morning = await scoreAt('2026-10-12T06:10:00+09:00');
    const sameSlot = await scoreAt('2026-10-12T06:29:00+09:00');
    const evening = await scoreAt('2026-10-12T17:45:00+09:00');

    expect(morning.calculatedAt).toBe('2026-10-11T21:10:00.000Z');
    expect(evening.calculatedAt).toBe('2026-10-12T08:45:00.000Z');
    expect(morning.key).toBe(
      'score:date:2026-10-12:lat:35.68:lon:139.77:port:1:prefecture:13:slot:06:00',
    );
    expect(sameSlot.key).toBe(morning.key);
    expect(evening.key).toBe(
      'score:date:2026-10-12:lat:35.68:lon:139.77:port:1:prefecture:13:slot:17:30',
    );
  });

  it('date に今日を明示しても、省略したときと同じく現在時刻で計算する', async () => {
    const result = await scoreAt('2026-10-12T00:15:00+09:00', '2026-10-12');

    expect(result.calculatedAt).toBe('2026-10-11T15:15:00.000Z');
    expect(result.key).toMatch(/:slot:00:00$/);
  });

  it('今日以外の日付は、時刻に関係なくその日の JST 9:00 で計算し、キーは日付だけ', async () => {
    const first = await scoreAt('2026-10-12T06:10:00+09:00', '2026-10-13');
    const later = await scoreAt('2026-10-12T17:45:00+09:00', '2026-10-13');

    expect(first.calculatedAt).toBe('2026-10-13T00:00:00.000Z');
    expect(later.calculatedAt).toBe(first.calculatedAt);
    expect(first.key).toBe('score:date:2026-10-13:lat:35.68:lon:139.77:port:1:prefecture:13');
  });

  it('skipCache=true でも今日は現在時刻で計算する', async () => {
    vi.setSystemTime(new Date('2026-10-12T17:45:00+09:00'));
    const url = request().nextUrl;
    url.searchParams.set('skipCache', 'true');
    const res = await GET(new NextRequest(url));
    const body = await res.json();

    expect(res.headers.get('X-From-Cache')).toBe('false');
    expect(body.score.calculatedAt).toBe('2026-10-12T08:45:00.000Z');
    expect(cacheMock.set).not.toHaveBeenCalled();
  });
});

// 以下は #364。スコア API のキャッシュと入力検証。期待値の出どころは各 describe に書く。
const BASE = 'lat=35.6789&lon=139.7654&prefectureCode=13&portCode=1';
const get = (query: string) => GET(new NextRequest(`http://localhost/api/scores?${query}`));

// 守る状態: 応答は共有キャッシュ（CDN・中間プロキシ）に保存されない。
// 期待値: docs/reference/architecture.md「キャッシュの層」（`/api/scores` は `private, max-age=1800`（30分）。
// 認証必須の API なので `public` にして共有キャッシュに載せない）。
describe('GET /api/scores の Cache-Control', () => {
  it('キャッシュ経由の応答は private で、max-age はスコアの TTL（30分）', async () => {
    const res = await get(BASE);

    const control = res.headers.get('Cache-Control') ?? '';
    expect(control.split(/,\s*/)).toContain('private');
    expect(control).not.toMatch(/public|s-maxage/);
    expect(control).toContain(`max-age=${CACHE_TTL.SCORE}`);
  });

  it('キャッシュヒットの応答も private', async () => {
    cacheMock.get.mockResolvedValue({ hit: true, value: cachedBody() });
    const res = await get(BASE);

    expect(res.headers.get('Cache-Control')?.split(/,\s*/)).toContain('private');
  });
});

// キャッシュは JSON で往復するので、Date は ISO 文字列で戻る。Invalid Date は null に落ちる。
const cachedBody = () => ({
  score: {
    score: 70,
    rank: 'good',
    components: { tide: 30, weather: 20, time: 20 },
    explanation: '',
    bestComponent: 'tide',
    worstComponent: 'weather',
    calculatedAt: '2026-10-12T05:10:00.000Z',
  },
  fromCache: false,
});

// キャッシュヒットの応答は、外部 API を呼ばず、X-From-Cache: true で返す。
// 日付の復元・壊れた日付の扱いは仕様未定のため、ここでは固定しない（#420）。
describe('GET /api/scores のキャッシュヒット', () => {
  it('外部 API を呼ばず、X-From-Cache: true で返す', async () => {
    cacheMock.get.mockResolvedValue({ hit: true, value: cachedBody() });

    const res = await get(BASE);

    expect(res.status).toBe(200);
    expect(res.headers.get('X-From-Cache')).toBe('true');
    expect(weatherMock).not.toHaveBeenCalled();
    expect(tideMock).not.toHaveBeenCalled();
  });

  it('ミスのときは X-From-Cache: false で、外部 API を呼び、結果をキャッシュに保存する', async () => {
    const res = await get(BASE);

    expect(res.headers.get('X-From-Cache')).toBe('false');
    expect(weatherMock).toHaveBeenCalledOnce();
    expect(tideMock).toHaveBeenCalledOnce();
    expect(cacheMock.set).toHaveBeenCalledOnce();
  });
});

describe('GET /api/scores の取得失敗', () => {
  it('外部取得が失敗したら 500 と固定のメッセージを返す（内部のエラー文を出さない）', async () => {
    weatherMock.mockRejectedValue(new Error('secret upstream detail'));

    const res = await get(BASE);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to calculate fishing score' });
  });
});
