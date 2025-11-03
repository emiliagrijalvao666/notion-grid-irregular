// api/grid.js
import { notion } from './_notion.js';

const CONTENT_DB_ID =
  process.env.NOTION_DB_ID ||
  process.env.CONTENT_DB_ID ||
  process.env.NOTION_DATABASE_ID;

const PAGE_SIZE_MAX = 50;

// candidatos de propiedades en el Content DB
const TITLE_CANDS       = ['Post','Name','Título','Title','Post title'];
const DATE_CANDS        = ['Publish Date','Fecha','Date','Pub date'];
const OWNER_CANDS       = ['Owner','Owners','Responsable','Asignado a'];
const STATUS_CANDS      = ['Status','Estado','State'];
const PLATFORM_CANDS    = ['Platform','Platforms'];
const PINNED_CANDS      = ['Pinned','Pin','Destacado'];
const HIDE_CANDS        = ['Hide','Hidden','Oculto','Archive','Archived'];
const COPY_CANDS        = ['Copy','Caption','Description','Descripción','Texto'];
const MEDIA_CANDS       = ['Attachment','Attachments','Media','Files','File','Imagen','Imágenes','Video','Canva'];
// 👇 estas son las columnas donde Mich puede poner el link directo de canva/drive
const LINK_CANDS        = ['Link','Canva','URL','Enlace','Embed'];
// relaciones
const REL_CLIENTS_CANDS  = ['Client','Clients','Brand','Brands','PostClient','ClientName'];
const REL_PROJECTS_CANDS = ['Project','Projects','PostProject','ProjectName'];

export default async function handler(req, res) {
  try {
    if (!CONTENT_DB_ID) {
      return res.json({ ok: false, error: 'Missing NOTION_DB_ID / CONTENT_DB_ID' });
    }

    const qs = req.query;
    const pageSize = clampInt(qs.pageSize, 12, 1, PAGE_SIZE_MAX);
    const cursor   = (qs.cursor && String(qs.cursor)) || undefined;

    // filtros que vienen del front
    const sel = {
      clients:   asArray(qs.client),
      projects:  asArray(qs.project),
      platforms: asArray(qs.platform),
      owners:    asArray(qs.owner),   // IDs
      statuses:  asArray(qs.status),  // single
    };

    // leemos el esquema de Notion
    const meta = await notion.databases.retrieve({ database_id: CONTENT_DB_ID });

    const titleKey       = firstExisting(meta, TITLE_CANDS, 'title');
    const dateKey        = firstExisting(meta, DATE_CANDS, 'date');
    const ownerKey       = firstExisting(meta, OWNER_CANDS, 'people');
    const statusKey      = firstExisting(meta, STATUS_CANDS, 'select');
    const platformKey    = firstExisting(meta, PLATFORM_CANDS, 'multi_select');
    const pinnedKey      = firstExisting(meta, PINNED_CANDS, 'checkbox');
    const hideKey        = firstExisting(meta, HIDE_CANDS, 'checkbox');
    const copyKey        = firstExisting(meta, COPY_CANDS); // rich_text o title
    const mediaKey       = firstExisting(meta, MEDIA_CANDS, 'files');
    const linkKey        = firstExisting(meta, LINK_CANDS); // puede ser rich_text o url
    const relClientKey   = firstExisting(meta, REL_CLIENTS_CANDS, 'relation');
    const relProjectKey  = firstExisting(meta, REL_PROJECTS_CANDS, 'relation');

    // ---- Notion filter (lo que sí podemos filtrar desde Notion) ----
    const and = [];

    // ocultos
    if (hideKey) {
      and.push({ property: hideKey, checkbox: { equals: false } });
    }
    // status
    if (statusKey && sel.statuses.length === 1) {
      and.push({ property: statusKey, select: { equals: sel.statuses[0] } });
    }
    // platforms (multi-select)
    if (platformKey && sel.platforms.length > 0) {
      and.push({
        or: sel.platforms.map((p) => ({
          property: platformKey,
          multi_select: { contains: p },
        })),
      });
    }
    // client
    if (relClientKey && sel.clients.length > 0) {
      and.push({
        or: sel.clients.map((id) => ({
          property: relClientKey,
          relation: { contains: id },
        })),
      });
    }
    // project
    if (relProjectKey && sel.projects.length > 0) {
      and.push({
        or: sel.projects.map((id) => ({
          property: relProjectKey,
          relation: { contains: id },
        })),
      });
    }
    // owner
    if (ownerKey && sel.owners.length > 0) {
      and.push({
        or: sel.owners.map((id) => ({
          property: ownerKey,
          people: { contains: id },
        })),
      });
    }

    const filter = and.length ? { and } : undefined;

    // ---- query ----
    const resp = await notion.databases.query({
      database_id: CONTENT_DB_ID,
      start_cursor: cursor,
      page_size: pageSize,
      filter,
      sorts: buildSorts(meta, dateKey),
    });

    // ---- map posts ----
    const posts = resp.results.map((page) =>
      mapPageToPost(page, {
        titleKey,
        dateKey,
        ownerKey,
        statusKey,
        platformKey,
        pinnedKey,
        copyKey,
        mediaKey,
        linkKey,
      })
    );

    return res.json({
      ok: true,
      posts,
      next_cursor: resp.has_more ? resp.next_cursor : null,
    });
  } catch (e) {
    res.json({ ok: false, error: e.message || 'grid failed' });
  }
}

/* ---------- helpers ---------- */

function clampInt(v, def, min, max) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return def;
  return Math.max(min, Math.min(max, n));
}
function asArray(v) {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function firstExisting(meta, candidates, type) {
  for (const key of candidates) {
    const prop = meta.properties[key];
    if (!prop) continue;
    if (!type) return key;
    if (prop.type === type) return key;
  }
  return undefined;
}

function buildSorts(meta, dateKey) {
  if (dateKey) {
    return [{ property: dateKey, direction: 'descending' }];
  }
  return [{ timestamp: 'created_time', direction: 'descending' }];
}

function mapPageToPost(page, keys) {
  const {
    titleKey,
    dateKey,
    ownerKey,
    platformKey,
    pinnedKey,
    copyKey,
    mediaKey,
    linkKey,
  } = keys;

  const title       = readTitle(page.properties[titleKey]);
  const date        = readDate(page.properties[dateKey]);
  const ownerNames  = readOwners(page.properties[ownerKey]);
  const platforms   = readMulti(page.properties[platformKey]);
  const pinned      = readCheckbox(page.properties[pinnedKey]);
  const copy        = readText(page.properties[copyKey]);
  const files       = readFiles(page.properties[mediaKey]);  // <-- aquí ya metemos canva/drive si vienen en Attachment
  const linkAssets  = readExternalLinks(page.properties[linkKey]); // <-- columnas tipo Link/Canva/URL

  // fusionamos: attachments + links sueltos
  const assets = [...files, ...linkAssets];

  return {
    id: page.id,
    title,
    date,
    owner: ownerNames[0] || null,
    platforms,
    pinned,
    copy,
    assets,
  };
}

function readTitle(prop) {
  if (!prop || prop.type !== 'title') return '';
  return (prop.title || []).map((t) => t.plain_text).join('').trim();
}
function readDate(prop) {
  if (!prop || prop.type !== 'date' || !prop.date) return null;
  return prop.date.start || null;
}
function readOwners(prop) {
  if (!prop || prop.type !== 'people') return [];
  return (prop.people || []).map((p) => p.name || p.person?.email || 'Unknown');
}
function readMulti(prop) {
  if (!prop) return [];
  if (prop.type === 'multi_select') return (prop.multi_select || []).map((o) => o.name);
  if (prop.type === 'select') return prop.select ? [prop.select.name] : [];
  return [];
}
function readCheckbox(prop) {
  if (!prop || prop.type !== 'checkbox') return false;
  return !!prop.checkbox;
}
function readText(prop) {
  if (!prop) return '';
  if (prop.type === 'rich_text')
    return (prop.rich_text || []).map((t) => t.plain_text).join('').trim();
  if (prop.type === 'title')
    return (prop.title || []).map((t) => t.plain_text).join('').trim();
  return '';
}

/**
 * Lee archivos de una columna tipo "files"
 * y ADEMÁS intenta detectar si el archivo externo es de canva o de drive
 */
function readFiles(prop) {
  if (!prop || prop.type !== 'files') return [];
  const files = prop.files || [];
  return files.map((f) => {
    // si es un archivo externo, viene en f.external.url
    const rawUrl = f?.[f.type]?.url || '';
    return classifyMediaUrl(rawUrl);
  });
}

/**
 * Lee columnas de texto/url donde Mich puede pegar el link de Canva/Drive
 */
function readExternalLinks(prop) {
  if (!prop) return [];
  // puede venir como url
  if (prop.type === 'url' && prop.url) {
    return [classifyMediaUrl(prop.url)];
  }
  // puede venir como rich_text
  if (prop.type === 'rich_text') {
    const txt = (prop.rich_text || []).map((t) => t.plain_text).join('').trim();
    if (!txt) return [];
    return [classifyMediaUrl(txt)];
  }
  return [];
}

/**
 * Dado un URL decide si es imagen, video o embed externo
 */
function classifyMediaUrl(url = '') {
  const u = (url || '').trim();
  if (!u) return { type: 'image', url: '' };

  // 1) Canva
  if (u.includes('canva.com/design/')) {
    return { type: 'external', url: u };
  }

  // 2) Google Drive: archivo
  if (u.includes('drive.google.com/file/')) {
    // forzamos preview
    const preview = u.includes('/preview') ? u : u.replace(/\/view.*$/, '') + '/preview';
    return { type: 'external', url: preview };
  }

  // 3) Google Drive: carpeta → no podemos embebida bien → lo mandamos igual pero será blank
  if (u.includes('drive.google.com/drive/folders/')) {
    return { type: 'external', url: u };
  }

  // 4) extensiones típicas de video
  const lower = u.toLowerCase();
  if (lower.endsWith('.mp4') || lower.endsWith('.mov') || lower.includes('video/mp4')) {
    return { type: 'video', url: u };
  }

  // 5) por defecto es imagen
  return { type: 'image', url: u };
}
