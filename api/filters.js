// /api/filters.js
import { notion, ensureEnv, CONTENT_DB_ID } from './_notion.js';
import { getContentMeta, readOptions } from './schema.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  try {
    ensureEnv();
    const meta = await getContentMeta();

    const type = (req.query.type || 'all').toLowerCase();

    // --- schema-only (rápido)
    if (type === 'schema') {
      const db = meta.raw;
      return res.status(200).json({
        ok: true,
        platforms: readOptions(db, meta.platforms),
        statuses:  readOptions(db, meta.status),
      });
    }

    // --- colectar owners / relations de forma lazy
    const ownersMap = new Map();
    const clientIds = new Set();
    const projectIds = new Set();

    let cursor = undefined;
    do {
      const q = { database_id: CONTENT_DB_ID, page_size: 100, start_cursor: cursor };
      const resp = await notion.databases.query(q);
      resp.results.forEach(page => {
        if (meta.owners) {
          (page.properties[meta.owners]?.people || []).forEach(p => ownersMap.set(p.id, p.name || 'Unknown'));
        }
        if (meta.clientRel) {
          (page.properties[meta.clientRel]?.relation || []).forEach(r => clientIds.add(r.id));
        }
        if (meta.projectRel) {
          (page.properties[meta.projectRel]?.relation || []).forEach(r => projectIds.add(r.id));
        }
      });
      cursor = resp.has_more ? resp.next_cursor : undefined;
    } while (cursor);

    const owners = Array.from(ownersMap.entries()).map(([id, name]) => ({ id, name }));
    const clients = await titlesFromIds([...clientIds]);
    const projects = await titlesFromIds([...projectIds]);

    // Vincular project -> clientIds (a partir del contenido)
    const projClient = new Map(projects.map(p => [p.id, []]));
    cursor = undefined;
    do {
      const resp = await notion.databases.query({ database_id: CONTENT_DB_ID, page_size: 100, start_cursor: cursor });
      resp.results.forEach(page => {
        const pIds = meta.projectRel ? (page.properties[meta.projectRel]?.relation || []).map(r => r.id) : [];
        const cIds = meta.clientRel ? (page.properties[meta.clientRel]?.relation || []).map(r => r.id) : [];
        pIds.forEach(pid => {
          const arr = projClient.get(pid);
          if (arr) cIds.forEach(cid => { if (!arr.includes(cid)) arr.push(cid); });
        });
      });
      cursor = resp.has_more ? resp.next_cursor : undefined;
    } while (cursor);

    const projectsWithClients = projects.map(p => ({ ...p, clientIds: projClient.get(p.id) || [] }));

    if (type === 'owners')   return res.status(200).json({ ok: true, owners });
    if (type === 'clients')  return res.status(200).json({ ok: true, clients });
    if (type === 'projects') return res.status(200).json({ ok: true, projects: projectsWithClients });

    // all
    return res.status(200).json({
      ok: true,
      platforms: readOptions(meta.raw, meta.platforms),
      statuses:  readOptions(meta.raw, meta.status),
      owners, clients, projects: projectsWithClients,
    });
  } catch (e) {
    res.status(200).json({ ok: false, error: e.message });
  }
}

async function titlesFromIds(ids) {
  const out = [];
  for (const id of ids) {
    try {
      const pg = await notion.pages.retrieve({ page_id: id });
      const titleProp = Object.values(pg.properties).find(p => p.type === 'title');
      const name = titleProp?.title?.map(t => t.plain_text).join('') || 'Sin nombre';
      out.push({ id, name });
    } catch {
      out.push({ id, name: 'Sin nombre' });
    }
  }
  return out;
}
