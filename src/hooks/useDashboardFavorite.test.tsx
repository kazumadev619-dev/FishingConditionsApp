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

async function toggle(location: Parameters<typeof useDashboardFavorite>[0]) {
  let handler: (() => Promise<void>) | undefined;
  const Probe = () => {
    handler = useDashboardFavorite(location).handleToggleFavorite;
    return null;
  };
  renderToStaticMarkup(<Probe />);
  await handler?.();
}

afterEach(() => vi.clearAllMocks());

describe('useDashboardFavorite の登録', () => {
  it('港の画面は、既存の行があっても港の経路で登録する', async () => {
    await toggle({ id: 'existing', source: { type: 'port', portId: 'port-1' } });

    expect(addFavorite).toHaveBeenCalledWith(undefined, 'port-1');
  });

  it('港以外で既存の行があれば locationId で登録する', async () => {
    const coordinates = { lat: 35, lng: 139, name: '地点' };

    await toggle({ id: 'existing', source: { type: 'coordinates', coordinates } });

    expect(addFavorite).toHaveBeenCalledWith('existing');
  });
});
