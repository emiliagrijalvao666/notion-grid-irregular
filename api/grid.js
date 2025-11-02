// api/grid.js
import { notion } from './_notion.js';

const CONTENT_DB_ID   = process.env.NOTION_DB_ID || process.env.CONTENT_DB_ID || process.env.NOTION_DATABASE_ID;
const PAGE_SIZE_MAX   = 50;

// candidatos de propiedades en el Content DB
const TITLE_CANDS     = ['Post','Name','Título','Title','Post title'];
const DATE_CANDS      = ['Publish Date','Date','Fecha','Pub date'];
const OWNER_CANDS     = ['Owner','Owners','Responsable','Asignado a'];
const STATUS_CANDS    = ['Status','Estado','State'];
const PLATFORM_CANDS  = ['Platform','Platforms'];
const PINNED_CANDS    = ['Pinned','Pin','Destacado'];
const HIDE_CANDS      = ['Hide','Hidden','Oculto','Archive','Archived'];
const COPY_CANDS      = ['Copy','Caption','Description','Descripción'];
const MEDIA_CANDS     = ['Media','Files','File','Attachment','Attachments','Imagen','Imágenes','Video'];
// NUEVO: columnas que son links (Drive, Canva, etc.)
const URL_CANDS       = ['Link','Canva','URL','Video link','Drive','Embed'];
const REL_CLIENTS_CANDS  = ['Client','Clients','Brand','Brands','PostClient'];
const REL_PROJECTS_CANDS = ['Project','Projects','PostProject'];

export default async function handler(req, res){
  try{
    if (!CONTENT_DB_ID) return res.json({ ok:false, error:'Missing NOTION_DB_ID / CONTENT_DB_ID' });

    const qs = req.query;
    const pageSize = clampInt(qs.pageSize, 12, 1, PAGE_SIZE_MAX);
    const cursor   = (qs.cursor && String(qs.cursor)) || undefined;

    const sel = {
      clients:   asArray(qs.client),
      projects:  asArray(qs.project),
      platforms: asArray(qs.platform),
      owners:    asArray(qs.owner),   // IDs
      statuses:  asArray(qs.status),  // single
    };

    // leemos el schema real
    const meta = await notion.databases.retrieve({ database_id: CONTENT_DB_ID });

    const titleKey      = firstExisting(meta, TITLE_CANDS, 'title');
    const dateKey       = firstExisting(meta, DATE_CANDS, 'date');
    const ownerKey      = firstExisting(meta, OWNER_CANDS, 'people');
    const statusKey     = firstExisting(meta, STATUS_CANDS, 'select');
    const platformKey   = firstExisting(meta, PLATFORM_CANDS, 'multi_select');
    const pinnedKey     = firstExisting(meta, PINNED_CANDS, 'checkbox');
    const hideKey       = firstExisting(meta, HIDE_CANDS, 'checkbox');
    const copyKey       = firstExisting(meta, COPY_CANDS);
    const mediaKey      = firstExisting(meta, MEDIA_CANDS, 'files');
    const urlKey        = firstExisting(meta, URL_CANDS);
    const relClientKey  = firstExisting(meta, REL_CLIENTS_CANDS, 'relation');
    const relProjectKey = firstExisting(meta, REL_PROJECTS_CANDS, 'relation');

    // ---- Notion filter (solo lo que Notion soporta bien) ----
    const and = [];

    if (hideKey){
      and.push({ property: hideKey, checkbox: { equals: false }});
    }
    if (statusKey && sel.statuses.length===1){
      and.push({ property: statusKey, select: { equals: sel.statuses[0] }});
    }
    if (platformKey && sel.platforms.length>0){
      and.push({
        or: sel.platforms.map(p => ({ property: platformKey, multi_select: { contains: p }}))
      });
    }
    if (relClientKey && sel.clients.length>0){
      and.push({
        or: sel.clients.map(id => ({ property: relClientKey, relation: { contains: id }}))
      });
    }
    if (relProjectKey && sel.projects.length>0){
      and.push({
        or: sel.projects.map(id => ({ property: relProjectKey, relation: { contains: id }}))
      });
    }
    if (ownerKey && sel.owners.length>0){
      and.push({
        or: sel.owners.map(id => ({ property: ownerKey, people: { contains: id }}))
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
    const posts = resp.results.map(page => mapPageToPost(page, {
      titleKey,
      dateKey,
      ownerKey,
      statusKey,
      platformKey,
      pinnedKey,
      copyKey,
      mediaKey,
      urlKey
    }));

    return res.json({ ok:true, posts, next_cursor: resp.has_more ? resp.next_cursor : null });

  }catch(e){
    res.json({ ok:false, error: e.message || 'grid failed' });
  }
}

/* ---------- helpers ---------- */

function clampInt(v, def, min, max){
  const n = parseInt(v,10); if (Number.isNaN(n)) return def;
  return Math.max(min, Math.min(max, n));
}
function asArray(v){ if (v===undefined || v===null) return []; return Array.isArray(v) ? v : [v]; }

function firstExisting(meta, candidates, type){
  for (const key of candidates){
    const prop = meta.properties[key];
    if (!prop) continue;
    if (!type) return key;
    if (prop.type === type) return key;
  }
  return undefined;
}

function buildSorts(meta, dateKey){
  if (dateKey){
    return [{ property: dateKey, direction: 'descending' }];
  }
  return [{ timestamp: 'created_time', direction: 'descending' }];
}

function mapPageToPost(page, keys){
  const {
    titleKey,
    dateKey,
    ownerKey,
    platformKey,
    pinnedKey,
    copyKey,
    mediaKey,
    urlKey
  } = keys;

  const title       = readTitle(page.properties[titleKey]);
  const date        = readDate(page.properties[dateKey]);
  const ownerNames  = readOwners(page.properties[ownerKey]);
  const platforms   = readMulti(page.properties[platformKey]);
  const pinned      = readCheckbox(page.properties[pinnedKey]);
  const copy        = readText(page.properties[copyKey]);
  const fileAssets  = readFiles(page.properties[mediaKey]);
  const urlAssets   = readUrls(page.properties[urlKey]);
  const assets      = [...fileAssets, ...urlAssets];

  return {
    id: page.id,
    title,
    date,
    owner: ownerNames[0] || null,
    platforms,
    pinned,
    copy,
    assets
  };
}

function readTitle(prop){
  if (!prop || prop.type!=='title') return '';
  return (prop.title||[]).map(t=>t.plain_text).join('').trim();
}
function readDate(prop){
  if (!prop || prop.type!=='date' || !prop.date) return null;
  return prop.date.start || null;
}
function readOwners(prop){
  if (!prop || prop.type!=='people') return [];
  return (prop.people||[]).map(p=> p.name || p.person?.email || 'Unknown');
}
function readMulti(prop){
  if (!prop) return [];
  if (prop.type==='multi_select') return (prop.multi_select?.map(o=>o.name)||[]);
  if (prop.type==='select')       return prop.select ? [prop.select.name] : [];
  return [];
}
function readCheckbox(prop){
  if (!prop || prop.type!=='checkbox') return false;
  return !!prop.checkbox;
}
function readText(prop){
  if (!prop) return '';
  if (prop.type==='rich_text') return (prop.rich_text||[]).map(t=>t.plain_text).join('').trim();
  if (prop.type==='title')     return (prop.title||[]).map(t=>t.plain_text).join('').trim();
  return '';
}
function readFiles(prop){
  if (!prop || prop.type!=='files') return [];
  const files = prop.files || [];
  return files.map(f=>{
    const url = f?.[f.type]?.url || '';
    return { type: guessType(url), url };
  });
}

// lee columnas tipo url / rich_text que tengan un link
function readUrls(prop){
  if (!prop) return [];
  let urls = [];

  if (prop.type === 'url' && prop.url){
    urls.push(prop.url);
  } else if (prop.type === 'rich_text'){
    const txt = (prop.rich_text||[]).map(t=>t.plain_text).join(' ');
    const m = txt.match(/https?:\/\/\S+/g);
    if (m) urls = urls.concat(m);
  }

  return urls.map(u => ({ type: guessType(u), url: u }));
}

function guessType(url=''){
  const u = url.toLowerCase();

  // drive
  if (u.includes('drive.google.com')) return 'video';
  // canva
  if (u.includes('canva.com')) return 'image';
  // video comunes
  if (u.endsWith('.mp4') || u.includes('video/mp4')) return 'video';
  if (u.endsWith('.mov') || u.includes('video/quicktime')) return 'video';

  return 'image';
}
