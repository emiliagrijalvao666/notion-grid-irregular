// api/grid.js
import { notion } from './_notion.js';

const CONTENT_DB_ID =
  process.env.NOTION_DB_ID ||
  process.env.CONTENT_DB_ID ||
  process.env.NOTION_DATABASE_ID;

const PAGE_SIZE_MAX = 50;

// candidatos de propiedades en el Content DB
const TITLE_CANDS = ['Post', 'Name', 'Título', 'Title'];
const DATE_CANDS = ['Publish Date', 'Date', 'Fecha'];
const OWNER_CANDS = ['Owner', 'Owners', 'Responsable', 'Asignado a'];
const STATUS_CANDS = ['Status', 'Estado', 'State'];
const PLATFORM_CANDS = ['Platform', 'Platforms'];
const PINNED_CANDS = ['Pinned', 'Pin', 'Destacado'];
const HIDE_CANDS = ['Hide', 'Hidden', 'Oculto', 'Archive', 'Archived'];
const COPY_CANDS = ['Copy', 'Caption', 'Description', 'Descripción'];
const MEDIA_CANDS = ['Attachment', 'Media', 'Files', 'File', 'Imagen', 'Imágenes', 'Video'];

// estas son las que te salen en /api/diag
const REL_CLIENTS_CANDS = ['Client', 'PostClient', 'ClientName'];
const REL_PROJECTS_CANDS = ['Project', 'PostProject', 'ProjectName'];

// campos tipo URL / texto donde a veces ponen CANVA o DRIVE
const LINK_CANDS = ['Link', 'Canva', 'URL', 'Enlace'];

export default async function handler(req, res) {
  try {
    if (!CONTENT_DB_ID) {
      return res.json({ ok: false, error: 'Missing NOTION_DB_ID / CONTENT_DB_ID' });
    }

    const qs = req.query;
    const pageSize = clampInt(qs.pageSize, 12, 1, PAGE_SIZE_MAX);
    const cursor = (qs.cursor && String(qs.cursor)) || undefined;

    const sel = {
      clients: asArray(qs.client),
      projects: asArray(qs.project),
      platforms: asArray(qs.platform),
      owners: asArray(qs.owner),
      statuses: asArray(qs.status),
    };

    // 1) leemos el schema
    const meta = await notion.databases.retrieve({ database_id: CONTENT_DB_ID });

    const titleKey = firstExisting(meta, TITLE_CANDS, 'title');
    const dateKey = firstExisting(meta, DATE_CANDS, 'date');
    const ownerKey = firstExisting(meta, OWNER_CANDS, 'people');
    const statusKey = firstExisting(meta, STATUS_CANDS, 'select');
    const platformKey = firstExisting(meta, PLATFORM_CANDS, 'multi_select');
    const pinnedKey = firstExisting(meta, PINNED_CANDS, 'checkbox');
    const hideKey = firstExisting(meta, HIDE_CANDS, 'checkbox');
    const copyKey = firstExisting(meta, COPY_CANDS);
    const mediaKey = firstExisting(meta, MEDIA_CANDS, 'files');

    const relClientKey = firstExisting(meta, REL_CLIENTS_CANDS, 'relation');
    const relProjectKey = firstExisting(meta, REL_PROJECTS_CANDS, 'relation');

    // 2) armamos el filtro que Notion sí entiende
    const and = [];

    if (hideKey) {
      and.push({ property: hideKey, checkbox: { equals: false } });
    }

    if (statusKey && sel.statuses.length === 1) {
      and.push({ property: statusKey, select: { equals: sel.statuses[0] } });
    }

    if (platformKey && sel.platforms.length > 0) {
      and.push({
        or: sel.platforms.map((p) => ({
          property: platformKey,
          multi_select: { contains: p },
        })),
      });
    }

    if (relClientKey && sel.clients.length > 0) {
      and.push({
        or: sel.clients.map((id) => ({
          property: relClientKey,
          relation: { contains: id },
        })),
      });
    }

    if (relProjectKey && sel.projects.length > 0) {
      and.push({
        or: sel.projects.map((id) => ({
          property: relProjectKey,
          relation: { contains: id },
        })),
      });
    }

    if (ownerKey && sel.owners.length > 0) {
      and.push({
        or: sel.owners.map((id) => ({
          property: ownerKey,
          people: { contains: id },
        })),
      });
    }

    const filter = and.length ? { and } : undefined;

    // 3) query
    const resp = await notion.databases.query({
      database_id: CONTENT_DB_ID,
      start_cursor: cursor,
      page_size: pageSize,
      filter,
      sorts: buildSorts(meta, dateKey),
    });

    // 4) mapeamos
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
        linkKeys: LINK_CANDS,
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
    linkKeys,
  } = keys;

  const title = readTitle(page.properties[titleKey]);
  const date = readDate(page.properties[dateKey]);
  const ownerNames = readOwners(page.properties[ownerKey]);
  const platforms = readMulti(page.properties[platformKey]);
  const pinned = readCheckbox(page.properties[pinnedKey]);
  const copy = readText(page.properties[copyKey]);
  const files = readFiles(page.properties[mediaKey]);

  // aquí leemos también Link / Canva / URL
  const extraFromLinks = [];
  for (const lk of linkKeys || []) {
    const p = page.properties[lk];
    if (!p) continue;
    const extra = readExternalLinkAsMedia(p);
    if (extra) extraFromLinks.push(extra);
  }

  const assets = [...files, ...extraFromLinks];

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
  if (prop.type === 'url') return prop.url || '';
  return '';
}

function readFiles(prop) {
  if (!prop || prop.type !== 'files') return [];
  const files = prop.files || [];
  return files.map((f) => {
    const url = f?.[f.type]?.url || '';
    return { type: guessType(url), url };
  });
}

// convierte los links de Canva / Drive en media que el frontend pueda mostrar
function readExternalLinkAsMedia(prop) {
  // puede venir como url directa o rich_text
  let raw = '';
  if (prop.type === 'url') {
    raw = prop.url || '';
  } else if (prop.type === 'rich_text') {
    raw = (prop.rich_text || []).map((t) => t.plain_text).join('').trim();
  } else {
    return null;
  }

  if (!raw) return null;

  const lower = raw.toLowerCase();

  // Canva: https://www.canva.com/design/...
  if (lower.includes('canva.com/design')) {
    // este mismo link sirve para <iframe> en la vista grande
    return {
      type: 'external',
      provider: 'canva',
      url: raw,
    };
  }

  // Google Drive file
  // https://drive.google.com/file/d/FILEID/view?usp=...
  if (lower.includes('drive.google.com/file/')) {
    const id = raw.split('/file/')[1]?.split('/')[0];
    const embed = id
      ? `https://drive.google.com/file/d/${id}/preview`
      : raw;
    return {
      type: 'external',
      provider: 'drive',
      url: embed,
    };
  }

  // Google Drive folder (no podemos listar el folder, pero lo mandamos igual)
  if (lower.includes('drive.google.com/drive/folders/')) {
    return {
      type: 'external',
      provider: 'drive',
      url: raw,
    };
  }

  // cualquier otro link lo mandamos igual
  return {
    type: 'external',
    provider: 'link',
    url: raw,
  };
}

function guessType(url = '') {
  const u = url.toLowerCase();
  if (u.includes('.mp4') || u.includes('video/mp4')) return 'video';
  if (u.includes('.mov') || u.includes('video/quicktime')) return 'video';
  return 'image';
}
