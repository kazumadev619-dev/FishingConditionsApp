import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cacheMock = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
const weatherMock = vi.hoisted(() => vi.fn());
const tideMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/cache/client', () => ({ cache: cacheMock }));
vi.mock('@/lib/openWeatherService', () => ({ getCurrentWeather: weatherMock }));
vi.mock('@/lib/tideService', () => ({ getTideData: tideMock }));

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
});
