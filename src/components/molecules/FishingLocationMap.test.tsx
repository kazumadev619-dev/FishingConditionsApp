import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('@/lib/clientErrors', () => ({ reportClientError: vi.fn() }));

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

// 要素の木を子へたどり、type が一致する最初の要素を返す（描画はしない）
function findElement(node: ReactNode, type: unknown): ReactElement<Record<string, unknown>> | null {
  if (!isValidElement<{ children?: ReactNode }>(node)) return null;
  if (node.type === type) return node as ReactElement<Record<string, unknown>>;
  const children = ([] as ReactNode[]).concat(node.props.children ?? []);
  for (const child of children) {
    const found = findElement(child, type);
    if (found) return found;
  }
  return null;
}

// Vitest は node 環境で DOM が無く、SSR はエラー境界を使わない。
// そのため React が境界に対して行う呼び出し（getDerivedStateFromError → render）を直接たどる
describe('FishingLocationMap（#237）', () => {
  it('地図は MapErrorBoundary の内側で描画される', async () => {
    const { FishingLocationMap, MapErrorBoundary } = await load();
    const element = FishingLocationMap({ latitude: 35, longitude: 139, locationName: '芝浦' });

    expect(isValidElement(element) && element.type).toBe(MapErrorBoundary);
    // 地点が変わると作り直され、前の地点の失敗を引き継がない。地図も新しい地点で開き直す（#500）
    expect(isValidElement(element) && element.key).toBe('35,139');
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

  // #247: 境界が受け止めた例外は、ブラウザのコンソールだけでなくサーバーのログにも残す
  it('受け止めた例外を map-boundary として、コンポーネントの位置つきで報告する', async () => {
    const { MapErrorBoundary } = await load();
    const { reportClientError } = await import('@/lib/clientErrors');
    const error = new TypeError("Cannot read properties of undefined (reading 'get')");

    new MapErrorBoundary({ children: null }).componentDidCatch(error, {
      componentStack: '\n    at AdvancedMarker',
    });

    expect(reportClientError).toHaveBeenCalledWith(
      error,
      'map-boundary',
      '\n    at AdvancedMarker',
    );
  });
});

// #500: center・zoom を渡すと、@vis.gl/react-google-maps は地図が動くたびに
// カメラをその値へ戻すので、利用者のズームとドラッグが効かない
describe('FishingLocationMap の操作（#500）', () => {
  it('表示範囲を固定しない。選んだ地点は最初の表示位置として渡す', async () => {
    const { FishingLocationMap } = await load();
    const { Map: GoogleMap } = await import('@vis.gl/react-google-maps');
    const element = FishingLocationMap({ latitude: 35, longitude: 139, locationName: '芝浦' });
    const map = findElement(element, GoogleMap);

    expect(map).not.toBeNull();
    expect(map?.props.center).toBeUndefined();
    expect(map?.props.zoom).toBeUndefined();
    expect(map?.props.defaultCenter).toEqual({ lat: 35, lng: 139 });
    expect(map?.props.defaultZoom).toEqual(expect.any(Number));
  });
});
