// /api/grid.js
import { notion, ensureEnv, CONTENT_DB_ID } from './_notion.js';
import { getContentMeta } from './schema.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  try {
    ensureEnv();
    const meta = await getContentMeta();

    const pageSize = Math.min(parseInt(req.query.pageSize || '12', 10), 50);
    const cursor   = req.query.cursor || undefined;

    const owners   = toArray(req.query.owner);    // IDs (uuid)
    const clients  = toArray(req.query.client);   // relation ids
    const projects = toArray(req.query.project);  // relation ids
    const plats    = toArray(req.query.platform); // option names
    const status   = toArray(req.query.status);   // 0/1 items

    // Build Notion filter
    const and = [];

    if (owners.length && meta.owners) {
      and.push({ or: owners.map(id => ({ property: meta.owners, people: { contains: id } })) });
    }
    if (clients.length && meta.clientRel) {
      and.push({ or: clients.map(id => ({ property: meta.clientRel, relation: { contains: id } })) });
    }
    if (projects.length && meta.projectRel) {
      and.push({ or: projects.map(id => ({ property: meta.projectRel, relation: { contains: id } })) });
    }
    if (plats.length && meta.platforms) {
      const t = meta.raw.properties[meta.platforms].type; // 'multi_select' o 'select'
      const key = t === 'multi_select' ? 'multi_select' : 'select';
      and.push({ or: plats.map(name => ({ property: meta.platforms, [key]: { contains: name } })) });
    }
    if (status.length && meta.status) {
      const name = status[0];
      const t = meta.raw.properties[meta.status].type; // 'status' o 'select'
      const key = t === 'status' ? 'status' : 'select';
      and.push({ property: meta.status, [key]: { equals: name } });
    }

    const query = {
      database_id: CONTENT_DB_ID,
      page_size: pageSize,
      start_cursor: cursor,
      filter: and.length ? { and } : undefined,
      sorts: meta.date ? [{ property: meta.date, direction: 'descending' }] : undefined,
    };

    const resp = await notion.databases.query(query);

    const posts = resp.results.map(page => mapPost(page, meta));
    res.status(200).json({ ok: true, posts, next_cursor: resp.has_more ? resp.next_cursor : null });
  } catch (e) {
    res.status(200).json({ ok: false, error: e.message });
  }
}

function toArray(v) {
  if (Array.isArray(v)) return v;
  if (v == null) return [];
  return [v];
}

function richTextToPlain(rt) {
  return (rt || []).map(t => t.plain_text).join('');
}

function mapPost(page, meta) {
  const p = page.properties;

  const title = meta.title ? richTextToPlain(p[meta.title]?.title) : '';
  const date  = meta.date  ? (p[meta.date]?.date?.start || null) : null;

  const ownerName = meta.owners ? ((p[meta.owners]?.people || [])[0]?.name || null) : null;
  const pinned = meta.pinned ? !!p[meta.pinned]?.checkbox : false;

  const copy = meta.copy ? richTextToPlain(p[meta.copy]?.rich_text || []) : '';

  // assets: concat de todas las props Files
  const media = [];
  (meta.files || []).forEach(fn => {
    const files = p[fn]?.files || [];
    files.forEach(f => {
      const url = f.type === 'file' ? f.file.url : f.external.url;
      const type = guessTypeFromUrl(url);
      media.push({ type, url });
    });
  });

  const platforms = meta.platforms
    ? (p[meta.platforms]?.multi_select || p[meta.platforms]?.select ? []
      : [])
    : [];

  return {
    id: page.id,
    title,
    date,
    owner: ownerName,
    platforms,
    pinned,
    copy,
    media,
  };
}

function guessTypeFromUrl(url) {
  const u = (url || '').toLowerCase();
  if (u.includes('.mp4') || u.includes('.mov') || u.includes('video')) return 'video';
  return 'image';
}
