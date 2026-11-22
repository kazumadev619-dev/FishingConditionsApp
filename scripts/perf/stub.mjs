// 性能測定用: OpenWeatherMap・tide736・Google Geocoding の代わりに答えるスタブ。
// 応答の形は実物に合わせた最小限（アプリの整形が読む項目だけ）。遅延と呼び出し回数のリセットは /__delay?ms=N。
// 呼び出し回数は /__stats で読める（キャッシュなしの測定で上流が何回呼ばれたかを確かめる）。
import { Buffer } from 'node:buffer';
import { createServer } from 'node:http';
import process from 'node:process';
import { setTimeout } from 'node:timers';
import { URL } from 'node:url';

let delayMs = 0;
const calls = { openweather: 0, tide736: 0, geocode: 0, resend: 0 };
// E2E 用: Resend に送られたメールの本文を記録する（/__mails）。perf では使わない
const mails = [];

const DAY_MS = 24 * 60 * 60 * 1000;
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

// tide736 の実物（rg=week）は 7 日分・1 日 73 点（20 分刻み）で約 52KB。同じ形と大きさで作る
function tideResponse(q) {
  const days = { day: 1, week: 7, month: 30 }[q.get('rg')] ?? 7;
  const start = Date.UTC(Number(q.get('yr')), Number(q.get('mn')) - 1, Number(q.get('dy')));
  const chart = {};
  for (let d = 0; d < days; d++) {
    const dayStart = start + d * DAY_MS;
    const date = new Date(dayStart).toISOString().slice(0, 10);
    const tide = [];
    for (let m = 0; m <= 24 * 60; m += 20) {
      tide.push({
        time: hhmm(m % (24 * 60)),
        unix: dayStart - 9 * 3600 * 1000 + m * 60000,
        cm: Math.round((120 + 80 * Math.sin((m / 60 / 12.4) * 2 * Math.PI + d)) * 10) / 10,
      });
    }
    const ev = (m, cm) => ({ time: hhmm(m), unix: dayStart - 9 * 3600 * 1000 + m * 60000, cm });
    chart[date] = {
      sun: {
        astro_twilight: ['04:54', '17:60'],
        regular_twilight: ['05:56', '16:58'],
        rise: '06:23',
        midline: '11:27',
        set: '16:31',
      },
      moon: {
        brightness: '91.3',
        age: '12.8',
        title: '大潮',
        rise: '14:28',
        midline: '21:25',
        set: '04:33',
        name: null,
      },
      tide,
      flood: [ev(120, 190.1), ev(870, 185.4)],
      edd: [ev(520, 40.2), ev(1180, 35.7)],
    };
  }
  return {
    status: 1,
    message: 'stub',
    tide: {
      port: {
        prefecture_code: Number(q.get('pc')),
        harbor_code: 1,
        harbor_namej: 'スタブ港',
        harbor_name: 'Stub',
        latitude: 35.4,
        longitude: 139.46,
        level: 120,
        tide_type: 1,
        calc_time: 'T12.10-2Y',
        sa_ssa: 'T12.10-2Y',
        calc_way: 'stub',
        observe_public: 'stub',
        calc_public: 'stub',
      },
      chart,
    },
  };
}

function weatherResponse(q) {
  const now = Math.floor(Date.now() / 1000);
  return {
    coord: { lat: Number(q.get('lat')), lon: Number(q.get('lon')) },
    weather: [{ id: 800, main: 'Clear', description: '晴天', icon: '01d' }],
    main: { temp: 18, feels_like: 17, temp_min: 16, temp_max: 20, pressure: 1015, humidity: 60 },
    visibility: 10000,
    wind: { speed: 3.5, deg: 200 },
    clouds: { all: 10 },
    dt: now,
    sys: { country: 'JP', sunrise: now - 6 * 3600, sunset: now + 6 * 3600 },
    timezone: 32400,
    name: 'Stub',
  };
}

function geocodeResponse() {
  const results = Array.from({ length: 10 }, (_, i) => ({
    place_id: `stub-${i}`,
    name: `スタブ地点${i}`,
    formatted_address: `日本、東京都スタブ区${i}`,
    geometry: { location: { lat: 35.6 + i / 100, lng: 139.7 }, location_type: 'APPROXIMATE' },
    address_components: [
      { long_name: '日本', short_name: 'JP', types: ['country'] },
      { long_name: '東京都', short_name: '東京都', types: ['administrative_area_level_1'] },
      { long_name: 'スタブ区', short_name: 'スタブ区', types: ['locality'] },
    ],
    types: ['locality'],
  }));
  return { status: 'OK', results };
}

createServer((req, res) => {
  const url = new URL(req.url, 'http://stub');
  const json = (body) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (url.pathname === '/__delay') {
    // 遅延を変えるときに、呼び出し回数も 0 に戻す（測定の最初に 1 回呼ぶ）
    delayMs = Number(url.searchParams.get('ms') ?? 0);
    for (const k of Object.keys(calls)) calls[k] = 0;
    return json({ delayMs });
  }
  if (url.pathname === '/__stats') {
    return json({ delayMs, calls });
  }
  if (url.pathname === '/__mails') {
    return json(mails);
  }
  if (url.pathname === '/api.resend.com/emails' && req.method === 'POST') {
    calls.resend++;
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    return req.on('end', () => {
      mails.push(JSON.parse(Buffer.concat(chunks).toString() || '{}'));
      json({ id: `stub-mail-${mails.length}` });
    });
  }
  let body;
  if (url.pathname === '/api.openweathermap.org/data/2.5/weather') {
    calls.openweather++;
    body = weatherResponse(url.searchParams);
  } else if (url.pathname === '/tide736.net/api/get_tide.php') {
    calls.tide736++;
    body = tideResponse(url.searchParams);
  } else if (url.pathname === '/maps.googleapis.com/maps/api/geocode/json') {
    calls.geocode++;
    body = geocodeResponse();
  } else {
    res.writeHead(404);
    return res.end();
  }
  setTimeout(() => json(body), delayMs);
  // STUB_HOST は E2E 用（127.0.0.1 に絞る）。perf はコンテナ間で届く必要があるので、未指定なら全インターフェース
}).listen(Number(process.env.STUB_PORT ?? 4000), process.env.STUB_HOST);
