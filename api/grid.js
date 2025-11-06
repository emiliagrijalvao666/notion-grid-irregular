// api/grid.js
import { notion } from './_notion.js';

const CONTENT_DB_ID =
  process.env.NOTION_DB_ID ||
  process.env.CONTENT_DB_ID ||
  process.env.NOTION_DATABASE_ID;

const PAGE_SIZE_MAX = 50;

const TITLE_CANDS   = ['Post','Name','Título','Title'];
const DATE_CANDS    = ['Publish Date','Date','Fecha'];
const OWNER_CANDS   = ['Owner','Owners','Responsable','Asignado a'];
const STATUS_CANDS  = ['Status','Estado','State'];
const PLATFORM_CANDS= ['Platform','Platforms'];
const PINNED_CANDS  = ['Pinned','Pin','Destacado'];
const HIDE_CANDS    = ['Hide','Hidden','Oculto','Archive','Archived'];
const COPY_CANDS    = ['Copy','Caption','Description','Descripción'];
const MEDIA_CANDS   = ['Attachment','Media','Files','File','Imagen','Imágenes','Video'];

const REL_CLIENTS_CANDS  = ['Client','PostClient','ClientName'];
const REL_PROJECTS_CANDS = ['Project','PostProject','ProjectName'];

// también miramos estas propiedades de texto/url para links externos
const LINK_CANDS = ['Link','Canva','URL','Enlace'];

export default async function handler(req,res){
  try{
    if(!CONTENT_DB_ID) {
      return res.json({ ok:false, error:'Missing NOTION_DB_ID / CONTENT_DB_ID' });
    }

    const qs = req.query;
    const pageSize = clampInt(qs.pageSize, 12, 1, PAGE_SIZE_MAX);
    const cursor   = (qs.cursor && String(qs.cursor)) || undefined;

    const sel = {
      clients:   asArray(qs.client),
      projects:  asArray(qs.project),
      platforms: asArray(qs.platform),
      owners:    asArray(qs.owner),
      statuses:  asArray(qs.status),
    };

    const meta = await notion.databases.retrieve({ database_id: CONTENT_DB_ID });

    const titleKey    = firstExisting(meta, TITLE_CANDS,    'title');
    const dateKey     = firstExisting(meta, DATE_CANDS,     'date');
    const ownerKey    = firstExisting(meta, OWNER_CANDS,    'people');
    const statusKey   = firstExisting(meta, STATUS_CANDS,   'select');
    const platformKey = firstExisting(meta, PLATFORM_CANDS, 'multi_select');
    const pinnedKey   = firstExisting(meta, PINNED_CANDS,   'checkbox');
    const hideKey     = firstExisting(meta, HIDE_CANDS,     'checkbox');
    const copyKey     = firstExisting(meta, COPY_CANDS);
    const mediaKey    = firstExisting(meta, MEDIA_CANDS,    'files');

    const relClientKey  = firstExisting(meta, REL_CLIENTS_CANDS,  'relation');
    const relProjectKey = firstExisting(meta, REL_PROJECTS_CANDS, 'relation');

    const and = [];

    if(hideKey){
      and.push({ property: hideKey, checkbox:{ equals:false }});
    }

    if(statusKey && sel.statuses.length===1){
      and.push({ property: statusKey, select:{ equals: sel.statuses[0] }});
    }

    if(platformKey && sel.platforms.length){
      and.push({
        or: sel.platforms.map(p => ({
          property: platformKey,
          multi_select:{ contains:p }
        }))
      });
    }

    if(relClientKey && sel.clients.length){
      and.push({
        or: sel.clients.map(id => ({
          property: relClientKey,
          relation:{ contains:id }
        }))
      });
    }

    if(relProjectKey && sel.projects.length){
      and.push({
        or: sel.projects.map(id => ({
          property: relProjectKey,
          relation:{ contains:id }
        }))
      });
    }

    if(ownerKey && sel.owners.length){
      and.push({
        or: sel.owners.map(id => ({
          property: ownerKey,
          people:{ contains:id }
        }))
      });
    }

    const filter = and.length ? { and } : undefined;

    const resp = await notion.databases.query({
      database_id: CONTENT_DB_ID,
      start_cursor: cursor,
      page_size: pageSize,
      filter,
      // ⬇️ aquí ahora pasamos también pinnedKey
      sorts: buildSorts(meta, dateKey, pinnedKey),
    });

    const posts = resp.results.map(page =>
      mapPageToPost(page, {
        titleKey,
        dateKey,
        ownerKey,
        platformKey,
        pinnedKey,
        copyKey,
        mediaKey,
        linkKeys: LINK_CANDS,
      })
    );

    res.json({
      ok:true,
      posts,
      next_cursor: resp.has_more ? resp.next_cursor : null,
    });

  } catch(e){
    res.json({ ok:false, error: e.message || 'grid failed' });
  }
}

/* ---------- helpers ---------- */
function clampInt(v, def, min, max){
  const n = parseInt(v,10);
  if(Number.isNaN(n)) return def;
  return Math.max(min, Math.min(max,n));
}
function asArray(v){
  if(v===undefined || v===null) return [];
  return Array.isArray(v) ? v : [v];
}

function firstExisting(meta, candidates, type){
  for(const key of candidates){
    const prop = meta.properties[key];
    if(!prop) continue;
    if(!type) return key;
    if(prop.type === type) return key;
  }
  return undefined;
}

// 🔁 Orden backend: Pinned primero, luego fecha desc, si no hay nada → created_time
function buildSorts(meta, dateKey, pinnedKey){
  const sorts = [];

  if (pinnedKey){
    // checkbox: true > false si ordenamos 'descending'
    sorts.push({ property: pinnedKey, direction:'descending' });
  }

  if (dateKey){
    sorts.push({ property: dateKey, direction:'descending' });
  }

  if (sorts.length){
    return sorts;
  }

  return [{ timestamp:'created_time', direction:'descending' }];
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
    linkKeys
  } = keys;

  const title     = readTitle(page.properties[titleKey]);
  const date      = readDate(page.properties[dateKey]);
  const owner     = readOwners(page.properties[ownerKey])[0] || null;
  const platforms = readMulti(page.properties[platformKey]);
  const pinned    = readCheckbox(page.properties[pinnedKey]);
  const copy      = readText(page.properties[copyKey]);
  const files     = readFiles(page.properties[mediaKey]);

  // extra media a partir de propiedades de texto/url
  const extra = [];
  for(const lk of linkKeys || []){
    const prop = page.properties[lk];
    if(!prop) continue;
    const urls = readAllUrlsFromProp(prop);
    for(const u of urls){
      const m = classifyExternal(u);
      if(m) extra.push(m);
    }
  }

  const assets = [...files, ...extra];

  return {
    id: page.id,
    title,
    date,
    owner,
    platforms,
    pinned,
    copy,
    assets,
  };
}

/* --- readers --- */
function readTitle(prop){
  if(!prop || prop.type!=='title') return '';
  return (prop.title || []).map(t => t.plain_text).join('').trim();
}
function readDate(prop){
  if(!prop || prop.type!=='date' || !prop.date) return null;
  return prop.date.start || null;
}
function readOwners(prop){
  if(!prop || prop.type!=='people') return [];
  return (prop.people || []).map(p => p.name || p.person?.email || 'Unknown');
}
function readMulti(prop){
  if(!prop) return [];
  if(prop.type==='multi_select'){
    return (prop.multi_select || []).map(o => o.name);
  }
  if(prop.type==='select'){
    return prop.select ? [prop.select.name] : [];
  }
  return [];
}
function readCheckbox(prop){
  if(!prop || prop.type!=='checkbox') return false;
  return !!prop.checkbox;
}
function readText(prop){
  if(!prop) return '';
  if(prop.type==='rich_text'){
    return (prop.rich_text || []).map(t => t.plain_text).join(' ').trim();
  }
  if(prop.type==='title'){
    return (prop.title || []).map(t => t.plain_text).join(' ').trim();
  }
  if(prop.type==='url'){
    return prop.url || '';
  }
  return '';
}
function readFiles(prop){
  if(!prop || prop.type!=='files') return [];
  return (prop.files || []).map(f => {
    const url = f?.[f.type]?.url || '';
    return { type: guessType(url), url };
  });
}

/* URLs en rich_text o url (todas) */
function readAllUrlsFromProp(prop){
  let raw = '';
  if(prop.type==='url') {
    raw = prop.url || '';
  } else if(prop.type==='rich_text') {
    raw = (prop.rich_text || []).map(t => t.plain_text).join(' ');
  } else {
    return [];
  }
  if(!raw) return [];
  return extractUrls(raw);
}

function extractUrls(text=''){
  const re = /\bhttps?:\/\/[^\s<>"')]+/gi;
  const out = [];
  let m;
  while((m = re.exec(text))){
    out.push(m[0]);
  }
  return out;
}

/* Clasificación + Drive thumbnail & preview */
function classifyExternal(u){
  const lower = u.toLowerCase();

  // Canva
  if(lower.includes('canva.com/design/')){
    return { type:'external', provider:'canva', url:u };
  }

  // Google Drive file: /file/d/<id>/...
  if(lower.includes('drive.google.com/file/')){
    let id = null;

    // patrón típico /file/d/<id>/
    const m = u.match(/\/file\/d\/([^/]+)/);
    if(m) id = m[1];

    // fallback /d/<id>/ o ?id=<id>
    if(!id){
      const m2 = u.match(/\/d\/([^/]+)/) || u.match(/[?&]id=([^&]+)/);
      if(m2) id = m2[1];
    }

    const preview = id ? `https://drive.google.com/file/d/${id}/preview` : u;
    const thumb   = id ? `https://drive.google.com/thumbnail?id=${id}&sz=w1000` : '';

    return { type:'external', provider:'drive', url:preview, thumb };
  }

  // Google Drive "open?id=" o docs.google.com
  if(lower.includes('drive.google.com/open?') || lower.includes('docs.google.com/')){
    const m = u.match(/[?&]id=([^&]+)/);
    if(m){
      const id = m[1];
      const preview = `https://drive.google.com/file/d/${id}/preview`;
      const thumb   = `https://drive.google.com/thumbnail?id=${id}&sz=w1000`;
      return { type:'external', provider:'drive', url:preview, thumb };
    }
  }

  // Google Drive folder
  if(lower.includes('drive.google.com/drive/folders/')){
    return { type:'external', provider:'drive', url:u };
  }

  // genérico
  return { type:'external', provider:'link', url:u };
}

function guessType(url=''){
  const u = url.toLowerCase();
  if(u.includes('.mp4') || u.includes('video/mp4')) return 'video';
  if(u.includes('.mov') || u.includes('video/quicktime')) return 'video';
  return 'image';
}
