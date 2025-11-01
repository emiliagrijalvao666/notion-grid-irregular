// api/filters.js
import { notion } from './_notion.js';

const CONTENT_DB_ID = process.env.NOTION_DB_ID || process.env.CONTENT_DB_ID;
const PROJECTS_DB_ID = process.env.NOTION_DB_PROJECTS || process.env.PROJECTS_DB_ID;

const TITLE_CANDS_PROJECTS = ['Name','Project name','Aq Project name','Project','Título','Title'];
const REL_CLIENTS_CANDS   = ['Client','Clients','Brand','Brands','PostClient'];

const REL_PROJECT_CANDS_CONTENT = ['Project','PostProject'];
const REL_CLIENT_CANDS_CONTENT  = ['Client','PostClient'];
const PLATFORM_CANDS            = ['Platform','Platforms'];
const STATUS_CANDS              = ['Status','Estado','State'];
const OWNER_PEOPLE_CANDS        = ['Owner','Owners','Responsable','Asignado a'];

export default async function handler(req, res) {
  try {
    if (!CONTENT_DB_ID) return res.json({ ok:false, error:'Missing NOTION_DB_ID/CONTENT_DB_ID' });

    // 1) Platforms + Statuses del Content DB (baratos y estables)
    const meta = await notion.databases.retrieve({ database_id: CONTENT_DB_ID });
    const platforms = enumFrom(meta, PLATFORM_CANDS);
    const statuses  = enumFrom(meta, STATUS_CANDS);

    // 2) Owners (people únicos presentes en el Content DB)
    const owners = await collectPeople(CONTENT_DB_ID, OWNER_PEOPLE_CANDS);

    // 3) Clients (del Content DB por relación o del propio DB si existe column)
    const clients = await collectRelatedFromContent(CONTENT_DB_ID, REL_CLIENT_CANDS_CONTENT);

    // 4) Projects (UNIÓN de Projects DB + relaciones vistas en Content)
    const fromProjectsDB = PROJECTS_DB_ID
      ? await collectProjectsDB(PROJECTS_DB_ID)
      : [];
    const fromContent    = await collectProjectsFromContent(CONTENT_DB_ID, REL_PROJECT_CANDS_CONTENT, REL_CLIENT_CANDS_CONTENT);

    // unir por id y name
    const map = new Map();
    [...fromProjectsDB, ...fromContent].forEach(p => {
      const k = p.id || `name:${p.name}`;
      if (!map.has(k)) map.set(k, { id:p.id, name:p.name, clientIds: new Set(p.clientIds||[]) });
      else {
        const cur = map.get(k);
        p.clientIds?.forEach(id => cur.clientIds.add(id));
      }
    });
    const projects = [...map.values()].map(p => ({ ...p, clientIds: [...p.clientIds] }));

    res.json({ ok:true, platforms, statuses, owners, clients, projects });
  } catch (e) {
    res.json({ ok:false, error: e.message || 'filters failed' });
  }
}

// ---------- helpers ----------
function enumFrom(meta, candidates) {
  for (const key of candidates) {
    const prop = meta.properties[key];
    if (prop?.type === 'select' && prop.select?.options)  return prop.select.options.map(o=>o.name);
    if (prop?.type === 'multi_select' && prop.multi_select?.options) return prop.multi_select.options.map(o=>o.name);
  }
  return [];
}

async function collectPeople(dbId, cands) {
  const meta = await notion.databases.retrieve({ database_id: dbId });
  const key  = cands.find(k => meta.properties[k]?.type === 'people');
  if (!key) return [];
  const out = new Map();
  for await (const page of paginate(dbId, {})) {
    const people = page.properties[key]?.people || [];
    people.forEach(p => out.set(p.id, { id:p.id, name: p.name || p.person?.email || 'Unknown' }));
  }
  return [...out.values()];
}

async function collectRelatedFromContent(dbId, relCands) {
  const meta = await notion.databases.retrieve({ database_id: dbId });
  const key = relCands.find(k => meta.properties[k]?.type === 'relation');
  if (!key) return [];
  const out = new Map();
  for await (const page of paginate(dbId, {})) {
    const rels = page.properties[key]?.relation || [];
    rels.forEach(r => out.set(r.id, { id:r.id, name: r.id })); // si luego quieres nombres, puedes mapearlos
  }
  return [...out.values()];
}

async function collectProjectsDB(projectsDbId) {
  const meta = await notion.databases.retrieve({ database_id: projectsDbId });
  const titleKey = TITLE_CANDS_PROJECTS.find(k => meta.properties[k]?.type === 'title');
  const relClientKey = REL_CLIENTS_CANDS.find(k => meta.properties[k]?.type === 'relation');

  const out = [];
  for await (const page of paginate(projectsDbId, {})) {
    const name = getTitle(page.properties[titleKey]) || 'Untitled';
    const clientIds = (page.properties[relClientKey]?.relation || []).map(r => r.id);
    out.push({ id: page.id, name, clientIds });
  }
  return out;
}

async function collectProjectsFromContent(contentDbId, projRelCands, cliRelCands) {
  const meta = await notion.databases.retrieve({ database_id: contentDbId });
  const projKey = projRelCands.find(k => meta.properties[k]?.type === 'relation');
  const cliKey  = cliRelCands.find(k  => meta.properties[k]?.type === 'relation');
  if (!projKey) return [];

  const map = new Map();
  for await (const page of paginate(contentDbId, {})) {
    const proj = page.properties[projKey]?.relation || [];
    const clis = page.properties[cliKey]?.relation || [];
    const clientIds = clis.map(r => r.id);
    proj.forEach(r => {
      if (!map.has(r.id)) map.set(r.id, { id:r.id, name:r.id, clientIds: new Set() });
      const it = map.get(r.id);
      clientIds.forEach(id => it.clientIds.add(id));
    });
  }
  return [...map.values()].map(p => ({ ...p, clientIds: [...p.clientIds] }));
}

function getTitle(prop) {
  if (!prop || prop.type !== 'title') return '';
  return (prop.title || []).map(t => t.plain_text).join('').trim();
}

async function* paginate(database_id, body) {
  let cursor = undefined;
  do {
    const resp = await notion.databases.query({ database_id, start_cursor: cursor, page_size: 50, ...body });
    for (const r of resp.results) yield r;
    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);
}
