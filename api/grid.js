// /api/grid.js
import { notion, getDbMeta, resolveProps, hasProp, pickProp } from './_notion.js';
import { SCHEMA } from './schema.js';

export default async function handler(req, res){
  try{
    if(req.method!=='GET') return res.status(405).json({ ok:false, error:'Method not allowed' });

    const dbId = SCHEMA.POSTS_DB_ID;
    if(!process.env.NOTION_TOKEN || !dbId)
      return res.status(400).json({ ok:false, error:'Missing NOTION_TOKEN or NOTION_DATABASE_ID' });

    const meta = await getDbMeta(dbId);
    const P = resolveProps(meta); // ← propiedades efectivas (Client, Project name, etc.)

    const {
      pageSize='12', cursor,
      client:clientIds, project:projectIds, platform:platforms,
      owner:ownerIds, status:statuses
    } = req.query;

    const AND = [];
    if(P.hide)     AND.push({ property:P.hide, checkbox:{ equals:false } });
    if(P.archived) AND.push({ property:P.archived, checkbox:{ equals:false } });

    const arr = v => v ? (Array.isArray(v)?v:[v]) : [];

    if(P.clients && arr(clientIds).length)
      AND.push({ or: arr(clientIds).map(id=>({ property:P.clients, relation:{ contains:id } })) });

    if(P.projects && arr(projectIds).length)
      AND.push({ or: arr(projectIds).map(id=>({ property:P.projects, relation:{ contains:id } })) });

    if(P.platform && arr(platforms).length)
      AND.push({ or: arr(platforms).map(v=>({ property:P.platform, select:{ equals:v } })) });

    if(P.owners && arr(ownerIds).length)
      AND.push({ or: arr(ownerIds).map(id=>({ property:P.owners, people:{ contains:id } })) }); // UUID

    if(P.status && arr(statuses).length)
      AND.push({ or: arr(statuses).map(v=>({ property:P.status, status:{ equals:v } })) });

    const sorts = [];
    if(P.pinned) sorts.push({ property:P.pinned, direction:'descending' });
    if(P.date)   sorts.push({ property:P.date,   direction:'descending' });

    const q = await notion.databases.query({
      database_id: dbId,
      page_size: Number(pageSize),
      start_cursor: cursor || undefined,
      filter: AND.length ? { and: AND } : undefined,
      sorts: sorts.length ? sorts : undefined
    });

    const posts = q.results.map(pg=>{
      const title = P.title ? pickProp.title(pg, P.title) : 'Untitled';
      const date  = P.date  ? pickProp.date(pg, P.date)   : null;
      const pinned = P.pinned ? pickProp.checkbox(pg, P.pinned) : false;
      const media = pickProp.filesAll(pg, P.files||[]);
      return { id:pg.id, title, date, pinned, media };
    });

    res.status(200).json({ ok:true, posts, next_cursor: q.has_more ? q.next_cursor : null });
  }catch(err){
    console.error(err);
    res.status(500).json({ ok:false, error:String(err?.message||err) });
  }
}
