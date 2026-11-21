import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDashboardFavorite } from './useDashboardFavorite';

const addFavorite = vi.hoisted(() => vi.fn(async () => 'new-id'));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('@/components/providers/favorites-provider', () => ({
  useFavorites: () => ({
    isFavorite: () => false,
    addFavorite,
    removeFavorite: vi.fn(),
    isLoading: false,
  }),
}));

type Location = Parameters<typeof useDashboardFavorite>[0];

function Probe({
  location,
  onHandler,
}: {
  location: Location;
  onHandler: (h: () => Promise<void>) => void;
}) {
  onHandler(useDashboardFavorite(location).handleToggleFavorite);
  return null;
}

async function toggle(location: Location) {
  let handler: (() => Promise<void>) | undefined;
  renderToStaticMarkup(<Probe location={location} onHandler={(h) => (handler = h)} />);
  await handler?.();
}

afterEach(() => vi.clearAllMocks());

describe('useDashboardFavorite の登録', () => {
  it('港の画面は、既存の行があっても港の経路で登録する', async () => {
    await toggle({ id: 'existing', source: { type: 'port', portId: 'port-1' } });

    expect(addFavorite).toHaveBeenCalledWith({ portId: 'port-1' });
  });

  it('港以外で既存の行があれば locationId で登録する', async () => {
    const coordinates = { lat: 35, lng: 139, name: '地点' };

    await toggle({ id: 'existing', source: { type: 'coordinates', coordinates } });

    expect(addFavorite).toHaveBeenCalledWith({ locationId: 'existing' });
  });

  it('既存の行が無い座標の画面は、座標で登録する', async () => {
    const coordinates = { lat: 35, lng: 139, name: '地点' };

    await toggle({ source: { type: 'coordinates', coordinates } });

    expect(addFavorite).toHaveBeenCalledWith({ coordinates });
  });
});
