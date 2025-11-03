// /api/filters.js
import { schema } from './schema';
import { getFilters } from './_notion';

export default async function handler(req, res) {
  try {
    const data = await getFilters(schema); // tu helper existente que agrupa
    res.json({ ok: true, ...data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || 'filters failed' });
  }
}
