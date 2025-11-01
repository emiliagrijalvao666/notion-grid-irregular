const { Client } = require('@notionhq/client');

function getDbId() {
  return process.env.NOTION_DB_ID
      || process.env.NOTION_DATABASE_ID
      || process.env.NOTION_DB_CONTENT
      || process.env.NOTION_DB;
}

const notion = new Client({ auth: process.env.NOTION_TOKEN });

// --- cache simple en memoria del runtime (TTL 5 min) ---
globalThis.__GRID_CACHE__ = globalThis.__GRID_CACHE__ || {};
const CACHE_TTL_MS = 5 * 60 * 1000;

const DEFAULT_PUBLISHED = (process.env.PUBLISHED_STATUSES || 'Publicado,Aprobado,Scheduled,Entregado,Approved,Published')
  .split(',').map(s => s.trim()).filter(Boolean);

// Utilidades para leer propiedades Notion de forma robusta:
const plain = (arr) => (arr || []).map(t => (t.plain_text || '').trim()).filter(Boolean).join(' ').trim();

function getTitle(p) {
  try { return plain(p?.title) || 'Untitled'; } catch { return 'Untitled'; }
}
function getDate(p) {
  try { return p?.date?.start || null; } catch { return null; }
}
function getStatus(p) {
  try { return p?.status?.name || null; } catch { return null; }
}
function getMulti(p) {
  try { return (p?.multi_select || []).map(x => x.name).filter(Boolean); } catch { return []; }
}
function getPeople(p) {
  try { return (p?.people || []).map(x => x.name || x.email || '').filter(Boolean); } catch { return []; }
}

// Extrae nombres desde un ROLLUP (array) o RICH_TEXT genérico.
// Si vinieran relaciones dentro del rollup, intenta extraer plain_text;
// si no hay nombres, retorna [].
function rollupToNames(prop) {
  const out = new Set();
  if (!prop) return [];
  try {
    if (prop.type === 'rollup') {
      const r = prop.rollup || {};
      if (r.type === 'array') {
        (r.array || []).forEach(item => {
          // Casos comunes: { title: [...] }, { rich_text: [...] }, { people: [...] }
          if (item.title) plain(item.title).split('\n').forEach(s => s && out.add(s));
          else if (item.rich_text) plain(item.rich_text).split('\n').forEach(s => s && out.add(s));
          else if (item.people) (item.people || []).forEach(p => out.add(p.name || p.email || ''));
          else if (item.name) out.add(item.name);
          else if (item.plain_text) out.add(item.plain_text);
          // Si aparece relación embebida sin título, lo ignoramos (no forzamos fetch aquí)
        });
      } else if (r.type === 'incomplete') {
        // Nada que hacer; Notion no expandió el rollup
      } else if (r.type === 'number' && typeof r.number === 'number') {
        out.add(String(r.number));
      } else if (r.type === 'date' && r.date?.start) {
        out.add(r.date.start);
      } else if (r.type === 'rich_text' && r.rich_text) {
        const s = plain(r.rich_text);
        if (s) out.add(s);
      }
    } else if (prop.type === 'rich_text') {
      const s = plain(prop.rich_text);
      if (s) out.add(s);
    }
  } catch {
    // ignorar
  }
  return Array.from(out).filter(Boolean);
}

async function fetchProjectTitles(ids) {
  // NOTA: Notion no tiene batch; hacemos N<=50 en serie corta
  const result = {};
  for (const id of ids) {
    try {
      const pg = await notion.pages.retrieve({ page_id: id });
      const t = getTitle(pg.properties?.Name || pg.properties?.title || {});
      result[id] = t || '—';
    } catch {
      result[id] = '—';
    }
  }
  return result;
}

function buildBaseFilter(schema, publishedOnly) {
  const and = [];

  // Exclusiones (solo si existen)
  if (schema.Hide) and.push({ property: 'Hide', checkbox: { equals: false } });
  if (schema.Archivado) and.push({ property: 'Archivado', checkbox: { equals: false } });

  // Published Only
  if (publishedOnly && schema.Status) {
    const ors = (DEFAULT_PUBLISHED || []).map(name => ({
      property: 'Status',
      status: { equals: name }
    }));
    // Solo si hay al menos 1 status definido
    if (ors.length > 0) and.push({ or: ors });
  }

  // Si and está vacío, no mandamos filter (evita body validation)
  return and.length ? { and } : undefined;
}

async function pullDataset(publishedOnly) {
  const db = getDbId();

  // Revisa cache
  const key = `${db}::${publishedOnly ? 'pub' : 'all'}`;
  const hit = globalThis.__GRID_CACHE__[key];
  const now = Date.now();
  if (hit && hit.expires > now) return hit.data;

  // Descubre schema
  const info = await notion.databases.retrieve({ database_id: db });
  const props = info.properties || {};
  const schema = Object.assign({}, ...Object.keys(props).map(k => ({ [k]: true })));

  // Query paginado
  const baseFilter = buildBaseFilter(schema, publishedOnly);
  const sorts = [];
  if (schema['Publish Date']) sorts.push({ property: 'Publish Date', direction: 'descending' });

  let start_cursor = undefined;
  const pages = [];
  do {
    const q = {
      database_id: db,
      page_size: 100
    };
    if (baseFilter) q.filter = baseFilter;
    if (sorts.length) q.sorts = sorts;
    if (start_cursor) q.start_cursor = start_cursor;

    const resp = await notion.databases.query(q);
    pages.push(...(resp.results || []));
    start_cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (start_cursor);

  // Resolver proyectos (relation) si hace falta
  const pendingProjectIds = new Set();
  const normalized = [];

  for (const pg of pages) {
    const p = pg.properties || {};

    const title = getTitle(p.Name || p.title || {});
    const date = getDate(p['Publish Date'] || {});
    const status = getStatus(p.Status || {});
    const platforms = getMulti(p.Platform || {});
    const owners = getPeople(p.Owner || {});

    const clients = rollupToNames(p.PostClient || {}); // rollup
    const brands  = rollupToNames(p.PostBrands || {}); // rollup

    // PostProject (relation) → nombres luego
    let projectNames = [];
    if (p.PostProject && p.PostProject.type === 'relation') {
      const ids = (p.PostProject.relation || []).map(r => r.id).filter(Boolean);
      ids.forEach(id => pendingProjectIds.add(id));
      projectNames = ids.map(id => ({ __projectId: id }));
    }

    // Assets (intentamos Link / Assets)
    let assets = [];
    if (p.Assets && p.Assets.type === 'files') {
      assets = (p.Assets.files || []).map(f => ({
        url: (f.external?.url || f.file?.url),
        type: 'image',
        source: 'attachment'
      })).filter(a => a.url);
    } else if (p.Link && p.Link.type === 'url' && p.Link.url) {
      assets = [{ url: p.Link.url, type: 'image', source: 'link' }];
    }

    // Copy
    let copy = '';
    if (p.Copy && p.Copy.type === 'rich_text') {
      copy = plain(p.Copy.rich_text);
    }

    const hidden = !!(p.Hide && p.Hide.type === 'checkbox' && p.Hide.checkbox);
    const archived = !!(p.Archivado && p.Archivado.type === 'checkbox' && p.Archivado.checkbox);

    normalized.push({
      id: pg.id,
      title,
      date,
      status,
      platforms,
      owners,
      clients,
      brands,
      projectNames, // provisionales
      hidden,
      archived,
      copy,
      assets
    });
  }

  // Completar nombres de proyectos si hay IDs
  if (pendingProjectIds.size) {
    const titles = await fetchProjectTitles(Array.from(pendingProjectIds));
    normalized.forEach(n => {
      if (Array.isArray(n.projectNames)) {
        const names = [];
        n.projectNames.forEach(x => {
          if (x && x.__projectId && titles[x.__projectId]) names.push(titles[x.__projectId]);
        });
        n.projectNames = names;
      }
    });
  }

  // Contadores globales (sobre dataset base)
  const counters = {
    clients: new Map(),
    projects: new Map(),
    brands: new Map(),
    platforms: new Map(),
    owners: new Map()
  };
  function bump(map, name) {
    if (!name) return;
    map.set(name, (map.get(name) || 0) + 1);
  }
  normalized.forEach(n => {
    (n.clients || []).forEach(c => bump(counters.clients, c));
    (n.projectNames || []).forEach(pr => bump(counters.projects, pr));
    (n.brands || []).forEach(b => bump(counters.brands, b));
    (n.platforms || []).forEach(pl => bump(counters.platforms, pl));
    (n.owners || []).forEach(o => bump(counters.owners, o));
  });

  function toSortedArray(map) {
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }

  const dataset = {
    schema: Object.keys(schema),
    posts: normalized,
    counts: {
      clients: toSortedArray(counters.clients),
      projects: toSortedArray(counters.projects),
      brands: toSortedArray(counters.brands),
      platforms: toSortedArray(counters.platforms),
      owners: toSortedArray(counters.owners)
    }
  };

  globalThis.__GRID_CACHE__[key] = { data: dataset, expires: now + CACHE_TTL_MS };
  return dataset;
}

// Filtro server-side (porque PostClient/PostBrands son rollups)
function applyRuntimeFilters(list, q) {
  const { client, project, brand, platform, owner, search } = q;

  let out = list;

  if (client) {
    out = out.filter(x => (x.clients || []).some(n => n === client));
  }
  if (project) {
    out = out.filter(x => (x.projectNames || []).some(n => n === project));
  }
  if (brand) {
    out = out.filter(x => (x.brands || []).some(n => n === brand));
  }
  if (platform) {
    out = out.filter(x => (x.platforms || []).includes(platform));
  }
  if (owner) {
    out = out.filter(x => (x.owners || []).includes(owner));
  }
  if (search) {
    const s = search.toLowerCase();
    out = out.filter(x =>
      (x.title || '').toLowerCase().includes(s) ||
      (x.copy || '').toLowerCase().includes(s)
    );
  }

  return out;
}

module.exports = async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const params = Object.fromEntries(url.searchParams.entries());

    const publishedOnly = (params.status || 'published') !== 'all';
    const limit = Math.max(1, Math.min(100, parseInt(params.limit || '24', 10)));
    const offset = Math.max(0, parseInt(params.offset || '0', 10));

    // dataset base (con cache)
    const ds = await pullDataset(publishedOnly);

    // aplica filtros dinámicos en servidor (clientes/proyectos/brands/platforms/owner + search)
    const filtered = applyRuntimeFilters(ds.posts, {
      client: params.client || '',
      project: params.project || '',
      brand: params.brand || '',
      platform: params.platform || '',
      owner: params.owner || '',
      search: params.q || ''
    });

    // Orden final por fecha desc (si existe), si no por título
    filtered.sort((a, b) => {
      if (a.date && b.date) return (a.date < b.date) ? 1 : (a.date > b.date ? -1 : 0);
      return (a.title || '').localeCompare(b.title || '');
    });

    const page = filtered.slice(offset, offset + limit);
    const has_more = offset + limit < filtered.length;

    // Armar filtros con contadores (globales del dataset ya ordenados DESC)
    const pickTop = (arr) => arr.slice(0, 6);

    const filters = {
      clients: pickTop(ds.counts.clients),
      projects: pickTop(ds.counts.projects),
      brands: pickTop(ds.counts.brands),
      platforms: pickTop(ds.counts.platforms),
      owners: pickTop(ds.counts.owners)
    };

    res.setHeader('Content-Type', 'application/json');
    res.status(200).send(JSON.stringify({
      ok: true,
      total: filtered.length,
      offset,
      limit,
      has_more,
      next_offset: has_more ? offset + limit : null,
      posts: page,
      filters
    }));
  } catch (e) {
    res.status(200).send(JSON.stringify({ ok: false, error: e.message, posts: [], filters: {} }));
  }
};
