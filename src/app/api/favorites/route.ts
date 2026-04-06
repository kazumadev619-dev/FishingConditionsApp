/**
 * お気に入り管理API
 * GET  /api/favorites         - お気に入り一覧取得
 * POST /api/favorites         - お気に入り追加
 * DELETE /api/favorites?locationId=xxx - お気に入り削除
 */
export { GET } from './handlers/getFavorites';
export { POST } from './handlers/addFavorite';
export { DELETE } from './handlers/deleteFavorite';
