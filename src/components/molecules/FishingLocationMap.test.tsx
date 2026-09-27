import { isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));

// API キーと Map ID はモジュールの読み込み時に読まれるので、設定してから import する
async function load() {
  vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', 'test-key');
  vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID', 'test-map-id');
  vi.resetModules();
  return import('./FishingLocationMap');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

// Vitest は node 環境で DOM が無く、SSR はエラー境界を使わない。
// そのため React が境界に対して行う呼び出し（getDerivedStateFromError → render）を直接たどる
describe('FishingLocationMap（#237）', () => {
  it('地図は MapErrorBoundary の内側で描画される', async () => {
    const { FishingLocationMap, MapErrorBoundary } = await load();
    const element = FishingLocationMap({ latitude: 35, longitude: 139, locationName: '芝浦' });

    expect(isValidElement(element) && element.type).toBe(MapErrorBoundary);
  });

  it('地図の中で例外が出たら、地図の代わりに代替表示を出す', async () => {
    const { MapErrorBoundary } = await load();
    const boundary = new MapErrorBoundary({ children: <p>MAP</p> });
    expect(renderToStaticMarkup(boundary.render())).toBe('<p>MAP</p>');

    boundary.state = MapErrorBoundary.getDerivedStateFromError();
    const html = renderToStaticMarkup(boundary.render());

    expect(html).not.toContain('MAP');
    expect(html).toContain('マップを表示できませんでした');
  });
});
