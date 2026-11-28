import { expect, expectDashboard, test } from './fixtures';

/**
 * #237 の状態を作る、Maps JS の代わりのスクリプト。
 * 本物は「読めたが初期化（認証）に失敗した」とき、gm_authFailure を呼び、そのあとマーカーの
 * position を更新すると `Cannot read properties of undefined (reading 'get')` を投げる（#237 の記録）。
 * 最初の position の設定は通り、2回目（ハートを押したあとの再描画）から投げるところまで真似る。
 * ブートストラップ（@vis.gl/react-google-maps）は callback=google.maps.__ib__ で読み込み完了を待つ。
 */
const FAILING_MAPS_JS = `(() => {
  const maps = window.google.maps;
  const listener = { remove() {} };
  const event = { addListener: () => listener, clearInstanceListeners() {} };
  class MVCObject {
    addListener() { return listener; }
    setOptions() {}
  }
  class Map extends MVCObject {
    constructor(div) { super(); this.div = div; }
    getCenter() { return { lat: () => 0, lng: () => 0, toJSON: () => ({ lat: 0, lng: 0 }) }; }
    getZoom() { return 14; }
    getHeading() { return 0; }
    getTilt() { return 0; }
    moveCamera() {}
    setCenter() {}
    setZoom() {}
  }
  class AdvancedMarkerElement extends EventTarget {
    content = document.createElement('div');
    set position(_value) {
      if (this.positioned) throw new TypeError("Cannot read properties of undefined (reading 'get')");
      this.positioned = true;
      window.__fakeMarkerPlaced = true;
    }
  }
  const libraries = {
    core: { event },
    maps: { Map },
    marker: { AdvancedMarkerElement },
  };
  maps.version = '3.62.0';
  maps.Map = Map;
  maps.Settings = { getInstance: () => ({}) };
  maps.event = event;
  maps.importLibrary = async (name) => libraries[name] ?? {};
  window.gm_authFailure?.();
  maps.__ib__();
})();`;

test.describe('Google Maps の初期化に失敗したとき（#237, #451）', () => {
  test('E2E-MAP-02 初期化に失敗した地図でハートを押しても、地図の場所だけが代替表示になり、ほかのカードは使える（#237）', async ({
    testUserPage: page,
  }) => {
    // Google には出さない。Maps JS への要求だけを、初期化に失敗するスクリプトで返す
    await page.route('https://maps.googleapis.com/maps/api/js?**', (route) =>
      route.fulfill({ contentType: 'text/javascript', body: FAILING_MAPS_JS }),
    );

    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: '東京湾（芝浦） の釣り条件' })).toBeVisible();

    // マーカーが置かれ、次の再描画で例外を投げる状態になってからハートを押す
    await page.waitForFunction(() => '__fakeMarkerPlaced' in window);

    await page.getByRole('button', { name: 'お気に入りに追加' }).click();
    await expect(page).toHaveURL(/\/dashboard\?locationId=[0-9a-f-]+/);

    // #237 の完了条件: ダッシュボード全体がエラー画面に落ちず、地図の場所だけが代替表示になり、
    // ほかの部分（ハートの状態を含む）が使える
    await expect(page.getByRole('heading', { name: '一時的に利用できません' })).toBeHidden();
    await expectDashboard(page, { isFavorite: true, mapFallback: 'マップを表示できませんでした' });
  });
});
