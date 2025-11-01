import { Client } from "@notionhq/client";

export default async function handler(req, res){
  try{
    const token = process.env.NOTION_TOKEN;
    const DB = process.env.NOTION_DATABASE_ID;
    if(!token || !DB){ return res.status(500).json({ ok:false, error:"Missing NOTION_TOKEN or NOTION_DATABASE_ID" }); }
    const notion = new Client({ auth: token });

    const url = new URL(req.url, "http://localhost");
    const pageSize = clamp(parseInt(url.searchParams.get("pageSize")||"12",10), 1, 50);
    const startCursor = url.searchParams.get("cursor") || undefined;

    // Filtros seleccionados
    const clientIds = takeArray(url.searchParams.getAll("client"));
    const projectIds = takeArray(url.searchParams.getAll("project"));
    const platforms = takeArray(url.searchParams.getAll("platform"));
    const ownerNames = takeArray(url.searchParams.getAll("owner"));
    const statusNames = takeArray(url.searchParams.getAll("status"));

    const and = [];

    // Reglas permanentes
    and.push({ property:"Hide", checkbox: { does_not_equal: true }});
    and.push({ property:"Archivado", checkbox: { does_not_equal: true }});

    // Client filter (relation includes any of selected)
    if(clientIds.length){
      and.push({
        or: clientIds.map(id => ({ property:"Client", relation:{ contains: id }}))
      });
    }
    // Project filter
    if(projectIds.length){
      and.push({
        or: projectIds.map(id => ({ property:"Project", relation:{ contains: id }}))
      });
    }
    // Platform filter (multi-select includes)
    if(platforms.length){
      and.push({
        or: platforms.map(name => ({ property:"Platform", multi_select:{ contains: name }}))
      });
    }
    // Owners (people name)
    if(ownerNames.length){
      and.push({
        or: ownerNames.map(nm => ({ property:"Owner", people:{ contains: nm }}))
      });
    }
    // Status (by name)
    if(statusNames.length){
      and.push({
        or: statusNames.map(nm => ({ property:"Status", status:{ equals: nm }}))
      });
    }

    const query = {
      database_id: DB,
      page_size: pageSize,
      start_cursor: startCursor,
      filter: and.length ? { and } : undefined,
      sorts: [
        { property:"Publish Date", direction:"descending" },
        { timestamp:"last_edited_time", direction:"descending" }
      ]
    };

    const resp = await notion.databases.query(query);

    // Mapear páginas → posts
    const posts = await Promise.all(resp.results.map(async (pg) => mapPage(pg)));

    return res.json({
      ok:true,
      posts,
      next_cursor: resp.has_more ? resp.next_cursor : null
    });

    /* Map helpers */
    function mapPage(pg){
      const props = pg.properties || {};
      const title = (props["Post"]?.title?.[0]?.plain_text || "Untitled").trim();
      const date = props["Publish Date"]?.date?.start || null;
      const pinned = !!props["Pinned"]?.checkbox;
      const copy = richToPlain(props["Copy"]?.rich_text || []);
      const media = collectMedia(props);

      // IDs para relacionar filtros (no mostramos en UI)
      const clientIds = (props["Client"]?.relation || []).map(r=>r.id);
      const projectIds = (props["Project"]?.relation || []).map(r=>r.id);
      const owners = (props["Owner"]?.people || []).map(p => p.name).filter(Boolean);
      const platforms = (props["Platform"]?.multi_select || []).map(o=>o.name);

      return { id: pg.id, title, date, pinned, copy, media, clientIds, projectIds, owners, platforms };
    }

    function richToPlain(arr){ return arr.map(x=>x.plain_text||"").join(""); }

    function collectMedia(props){
      const out = [];
      const add = (file) => {
        if(!file) return;
        const url = file?.file?.url || file?.external?.url;
        if(!url) return;
        const name = (file.name || "").toLowerCase();
        const isVideo = /\.(mp4|webm|mov|m4v)$/.test(name);
        out.push({ url, type: isVideo ? "video" : "image" });
      };
      for(const src of ["Attachment","Link","Canva"]){
        const files = props[src]?.files || [];
        files.forEach(add);
      }
      return out;
    }

  }catch(err){
    // Evita devolver HTML en caso de error
    return res.status(500).json({ ok:false, error: String(err?.message||err) });
  }
}

/* utils */
function clamp(n,min,max){ return Math.max(min, Math.min(max, n)); }
function takeArray(v){ return Array.isArray(v) ? v.filter(Boolean) : []; }
