import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FormattedWeatherData } from '../openWeatherService';
import type { FormattedTideData } from '../tideService';
import { getJapanDateTimeParts } from '../utils/dateUtils';
import { getTodayDateString } from '../validators/dateValidator';
import { calculateFishingScore } from './index';

const currentTime = new Date('2026-10-17T00:20:00Z'); // JST 09:20

const weatherData: FormattedWeatherData = {
  coordinates: { lat: 35.6895, lon: 139.6917 },
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
  sunrise: new Date('2026-10-16T21:50:00Z'), // JST 06:50
  sunset: new Date('2026-10-17T07:40:00Z'), // JST 16:40
  dataTime: currentTime,
  timezone: 32400,
};

const tideData: FormattedTideData = {
  port: { prefecture_code: '13', port_code: '1', port_name: '築地' },
  dataTime: currentTime,
  tides: [
    {
      date: '2026-10-17',
      daily: {
        sun: {
          astro_twilight: [],
          regular_twilight: [],
          rise: '06:50',
          midline: '11:45',
          set: '16:40',
        },
        moon: {
          brightness: '0',
          age: '0',
          title: '小潮',
          rise: '',
          midline: '',
          set: '',
          name: null,
        },
        tide: [],
        flood: [{ time: '09:30', unix: 0, cm: 150 }],
        edd: [{ time: '03:30', unix: 0, cm: 20 }],
      },
    },
  ],
};

describe('スコア計算の日本時間', () => {
  const originalTz = process.env.TZ;

  afterEach(() => {
    process.env.TZ = originalTz;
    vi.useRealTimers();
  });

  for (const tz of ['UTC', 'Asia/Tokyo', 'America/Los_Angeles']) {
    it(`TZ=${tz} でもJSTの日付とスコアを使う`, () => {
      process.env.TZ = tz;

      expect(getJapanDateTimeParts(currentTime)).toEqual({
        date: '2026-10-17',
        hours: 9,
        minutes: 20,
      });
      expect(calculateFishingScore(tideData, weatherData, currentTime)).toMatchObject({
        tideName: '小潮',
        components: { tide: 35.95833333333333, time: 5 },
        score: 76,
      });
    });

    // UTC ではまだ前日（10/16 16:00）。toISOString() や UTC の日付を使うと前日の潮汐を引く
    it(`TZ=${tz} でもJSTの0時台はその日の潮汐を使う`, () => {
      process.env.TZ = tz;
      const jstOneAm = new Date('2026-10-16T16:00:00Z'); // JST 10/17 01:00
      vi.useFakeTimers({ now: jstOneAm, toFake: ['Date'] });

      expect(getJapanDateTimeParts(jstOneAm)).toEqual({
        date: '2026-10-17',
        hours: 1,
        minutes: 0,
      });
      expect(getTodayDateString()).toBe('2026-10-17');
      expect(calculateFishingScore(tideData, weatherData, jstOneAm)).toMatchObject({
        tideName: '小潮',
        // 干潮 03:30 まで 2.5 時間で 9.375、潮位差 1.3m で 12。潮汐が引けないと既定の 20 になる
        components: { tide: 21.375, time: 0 },
      });
      expect(calculateFishingScore(tideData, weatherData, jstOneAm).explanation).toContain(
        '本日は小潮です',
      );
    });
  }

  it('JSTの0時を24時にしない', () => {
    expect(getJapanDateTimeParts(new Date('2026-10-16T15:00:00Z'))).toEqual({
      date: '2026-10-17',
      hours: 0,
      minutes: 0,
    });
  });
});
