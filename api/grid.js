import { Client } from "@notionhq/client";

const {
  NOTION_TOKEN,
  NOTION_DATABASE_ID
} = process.env;

const notion = new Client({ auth: NOTION_TOKEN });

function firstText(p){ return p?.title?.[0]?.plain_text || ''; }

function collectMedia(page){
  const props = page.properties || {};
  const buckets = ["Attachment","Canva","Link"].map(k => props[k]?.files || []).flat();
  const urls = buckets.map(f=>({
    type: /\.mp4$|\.mov$|\.webm$/i.test((f.name||'') + (f?.file?.url||f?.external?.url||'')) ? 'video' : 'image',
    url: f?.file?.url || f?.external?.url
  })).filter(m=>!!m.url);
  return urls;
}

export default async function handler(req,res){
  try{
    if(req.method!=='POST') return res.status(405).json({ok:false,error:'Method not allowed'});
    if(!NOTION_TOKEN || !NOTION_DATABASE_ID) return res.status(400).json({ok:false, error:'Missing NOTION_TOKEN or NOTION_DATABASE_ID'});

    const { pageSize=12, cursor=null, filter={} } = req.body || {};

    const and = [
      { property:"Hide", checkbox:{ equals:false } },
      { property:"Archivado", checkbox:{ equals:false } },
    ];

    if(filter.clientId){
      and.push({ property:"Client", relation:{ contains: filter.clientId } });
    }
    if(filter.projectId){
      and.push({ property:"Project", relation:{ contains: filter.projectId } });
    }
    if(filter.ownerId){
      and.push({ property:"Owner", people:{ contains: filter.ownerId } });
    }
    if(filter.status){
      and.push({ property:"Status", status:{ equals: filter.status } });
    }
    if(Array.isArray(filter.platforms) && filter.platforms.length){
      and.push({
        or: filter.platforms.map(p => ({ property:"Platform", multi_select:{ contains:p } }))
      });
    }

    const query = {
      database_id: NOTION_DATABASE_ID,
      page_size: pageSize,
      sorts: [{property:"Publish Date", direction:"descending"}],
      filter: { and }
    };
    if(cursor) query.start_cursor = cursor;

    const result = await notion.databases.query(query);

    const items = await Promise.all(result.results.map(async (pg)=>{
      const props = pg.properties || {};
      const title = firstText(props["Post"]) || firstText(props["Name"]) || '';
      const pinned = props["Pinned"]?.checkbox === true;
      const date = props["Publish Date"]?.date?.start || null;
      const copy = props["Copy"]?.rich_text?.map(t=>t.plain_text).join(' ') || '';
      const media = collectMedia(pg);

      return {
        id: pg.id,
        title, date, pinned, copy,
        media
      };
    }));

    res.json({ ok:true, items, nextCursor: result.has_more ? result.next_cursor : null });
  }catch(err){
    console.error(err);
    res.status(500).json({ok:false, error:'Query failed'});
  }
}
