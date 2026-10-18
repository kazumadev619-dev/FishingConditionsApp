import { afterEach, describe, expect, it, vi } from 'vitest';

const date = '2026-10-17';
const tideData = { tides: [{ date, daily: {} }] };

vi.mock('@/components/organisms/DashboardGrid', () => ({ DashboardGrid: () => null }));
vi.mock('@/lib/openWeatherService', () => ({
  getCurrentWeather: vi.fn(async () => ({ data: { sunrise: new Date(), sunset: new Date() } })),
}));
vi.mock('@/lib/tideService', () => ({ getTideData: vi.fn(async () => ({ data: tideData })) }));
vi.mock('@/lib/scoringService', () => ({
  calculateFishingScore: vi.fn(() => ({ components: { time: 0 } })),
}));
vi.mock('./dashboard/resolveLocation', () => ({
  resolveLocation: vi.fn(async () => ({
    latitude: 0,
    longitude: 0,
    prefectureCode: '13',
    portCode: '1',
  })),
}));

import { getTideData } from '@/lib/tideService';
import DashboardPage from './dashboard/page';
import Home from './page';

describe('ページの today（#296）', () => {
  const originalTz = process.env.TZ;

  afterEach(() => {
    process.env.TZ = originalTz;
    vi.useRealTimers();
    vi.mocked(getTideData).mockClear();
  });

  // JST 10/17 01:00。UTC ではまだ 10/16 なので、toISOString() だと前日の潮汐を引く
  for (const tz of ['UTC', 'Asia/Tokyo', 'America/Los_Angeles']) {
    it(`TZ=${tz} でもJSTの日付で潮汐を引く`, async () => {
      process.env.TZ = tz;
      vi.useFakeTimers({ now: new Date('2026-10-16T16:00:00Z'), toFake: ['Date'] });

      await Home();
      await DashboardPage({ searchParams: Promise.resolve({}) });

      expect(vi.mocked(getTideData).mock.calls.map((call) => call[2])).toEqual([date, date]);
    });
  }
});
