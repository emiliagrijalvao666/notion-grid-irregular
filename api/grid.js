import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN });

// Helper to detect file type from url/name
const isVideoUrl = (u='') => /\.mp4($|\?)/i.test(u) || /\.mov($|\?)/i.test(u) || /\.webm($|\?)/i.test(u);

export default async function handler(req, res){
  try{
    const { NOTION_TOKEN, NOTION_DATABASE_ID } = process.env;
    if(!NOTION_TOKEN || !NOTION_DATABASE_ID) return res.status(200).json({ ok:false, error:"Missing NOTION_TOKEN or NOTION_DATABASE_ID" });

    const {
      pageSize = 12, cursor,
      client: clients = [], project: projects = [],
      platform: platforms = [], owner: owners = [],
      status
    } = req.query;

    const and = [];

    // Exclusions
    if (hasProp(NOTION_DATABASE_ID, 'Hide')) and.push({ property:'Hide', checkbox:{ equals:false }});

    // If there's a Draft checkbox, exclude; otherwise if Status has "Draft", exclude
    // We'll try both defensively:
    and.push({ or: [
      { property:'Draft', checkbox:{ equals:false }},
      { property:'Draft', checkbox:{ is_empty:true }},
      { and:[ { property:'Status', status:{ does_not_equal:'Draft' }} ] }
    ]});

    // Multi filters
    if (arr(clients).length)  and.push({ or: arr(clients).map(id => ({ property:'PostClient',  relation:{ contains:id }})) });
    if (arr(projects).length) and.push({ or: arr(projects).map(id => ({ property:'PostProject', relation:{ contains:id }})) });
    if (arr(platforms).length)and.push({ or: arr(platforms).map(n  => ({ property:'Platform',   multi_select:{ contains:n }})) });
    if (arr(owners).length)   and.push({ or: arr(owners).map(id   => ({ property:'Owner',      people:{ contains:id }})) });

    // Single
    if (status) and.push({ property:'Status', status:{ equals: Array.isArray(status)?status[0]:status }});

    const filter = and.length ? { and } : undefined;

    const query = {
      database_id: NOTION_DATABASE_ID,
      filter,
      sorts: [
        { property:'Publish Date', direction:'descending' },
        { timestamp:'created_time', direction:'descending' }
      ],
      page_size: Number(pageSize),
      start_cursor: cursor || undefined
    };

    const resp = await notion.databases.query(query);

    const posts = resp.results.map(page => {
      const p = page.properties || {};

      // Collect media from the three properties (files & media)
      const media = []
        .concat(readFiles(p['Attachment']))
        .concat(readFiles(p['Link']))
        .concat(readFiles(p['Canva Design']));

      const out = {
        id: page.id,
        title: readTitle(p['Name']) || 'No title',
        date: p['Publish Date']?.date?.start || null,
        pinned: !!p['Pinned']?.checkbox,
        media: media,
        copy: readPlain(p['Copy'])
      };
      return out;
    });

    res.status(200).json({
      ok:true,
      next_cursor: resp.has_more ? resp.next_cursor : null,
      posts
    });
  }catch(err){
    res.status(200).json({ ok:false, error: err.body?.message || err.message || String(err) });
  }
}

// ---------- helpers ----------
function arr(v){ return Array.isArray(v) ? v : (v ? [v] : []); }

function readFiles(prop){
  const out = [];
  const items = prop?.files || [];
  items.forEach(f=>{
    const url = f.type==='external' ? f.external?.url : f.file?.url;
    if(!url) return;
    out.push({ type: isVideoUrl(url) ? 'video' : 'image', url });
  });
  return out;
}
function readTitle(prop){ return (prop?.title||[]).map(t=>t.plain_text).join('').trim(); }
function readPlain(prop){ return (prop?.rich_text||[]).map(t=>t.plain_text).join('').trim(); }

// Optional: shallow check for property existence by name (best effort)
async function hasProp(){ return true; } // keep true; we handle Draft/Hide defensively
