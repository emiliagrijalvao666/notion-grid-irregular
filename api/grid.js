import { notion, DB_IDS } from "./_notion.js";
import {
  PROP, getExistingKey, getTitleFromPage,
  toMedia, toOwners, toPlatforms, toCheckbox,
  toRelationIds, toFormulaText, toDate, toStatusName
} from "./schema.js";

export default async function handler(req, res){
  try {
    if (req.method !== "GET") return res.status(405).json({ ok:false, error:"Method not allowed" });
    if (!DB_IDS.posts) return res.status(400).json({ ok:false, error:"Missing NOTION_DATABASE_ID" });

    // Query params
    const qs = new URL(req.url, "https://x").searchParams;
    const pageSize = Math.min(parseInt(qs.get("pageSize") || "12", 10), 50);
    const cursor   = qs.get("cursor") || undefined;
    const clients  = qs.getAll("client");
    const projects = qs.getAll("project");
    const platforms= qs.getAll("platform");
    const owners   = qs.getAll("owner");   // IDs
    const statuses = qs.getAll("status");  // single en UI, array safe aquí

    // Meta para saber qué props existen
    const meta = await notion.databases.retrieve({ database_id: DB_IDS.posts }).catch(()=>null);

    const ownersKey      = meta?.properties?.[PROP.owners] ? PROP.owners : null;
    const platformKey    = getExistingKey(meta, PROP.platformCandidates);
    const clientRelKey   = getExistingKey(meta, PROP.clientRelCandidates);
    const projectRelKey  = getExistingKey(meta, PROP.projectRelCandidates);
    const hasHide        = !!meta?.properties?.[PROP.hide];
    const hasArchived    = !!meta?.properties?.[PROP.archived];
    const hasPinned      = !!meta?.properties?.[PROP.pinned];
    const hasDate        = !!meta?.properties?.[PROP.date];
    const hasStatus      = !!meta?.properties?.[PROP.status];

    // Filtros base
    const and = [];
    if (hasHide){
      and.push({ or:[
        { property: PROP.hide, checkbox:{ equals:false } },
        { property: PROP.hide, checkbox:{ does_not_equal:true } },
      ]});
    }
    if (hasArchived){
      and.push({ or:[
        { property: PROP.archived, checkbox:{ equals:false } },
        { property: PROP.archived, checkbox:{ does_not_equal:true } },
      ]});
    }
    if (clients.length && clientRelKey){
      and.push({ or: clients.map(id => ({ property: clientRelKey, relation:{ contains:id } })) });
    }
    if (projects.length && projectRelKey){
      and.push({ or: projects.map(id => ({ property: projectRelKey, relation:{ contains:id } })) });
    }
    if (platforms.length && platformKey){
      and.push({ or: platforms.map(name => ({ property: platformKey, multi_select:{ contains:name } })) });
    }
    if (owners.length && ownersKey){
      and.push({ or: owners.map(id => ({ property: ownersKey, people:{ contains:id } })) });
    }
    if (statuses.length && hasStatus){
      and.push({ or: statuses.map(name => ({ property: PROP.status, status:{ equals:name } })) });
    }

    const sorts = [];
    if (hasPinned) sorts.push({ property: PROP.pinned, direction:"descending" });
    if (hasDate)   sorts.push({ property: PROP.date,   direction:"descending" });
    sorts.push({ timestamp:"created_time", direction:"descending" });

    const query = {
      database_id: DB_IDS.posts,
      page_size: pageSize,
      start_cursor: cursor,
      filter: and.length ? { and } : undefined,
      sorts
    };

    const resp = await notion.databases.query(query);

    const posts = resp.results.map(p=>{
      const media = toMedia(p);
      const title = getTitleFromPage(p);
      const date  = toDate(p);
      const statusName = toStatusName(p);
      const ownersArr  = toOwners(p, ownersKey);
      const platformsArr = toPlatforms(p, platformKey);
      const pinned = toCheckbox(p, PROP.pinned);

      const clientIds = toRelationIds(p, clientRelKey);
      const projectIds= toRelationIds(p, projectRelKey);
      const clientNameFx  = toFormulaText(p, PROP.clientNameFx);
      const projectNameFx = toFormulaText(p, PROP.projectNameFx);

      const copy = p.properties?.Copy?.rich_text?.map(r=>r.plain_text).join("") || "";

      return {
        id: p.id,
        title,
        date,
        pinned,
        status: statusName,
        owners: ownersArr,
        platforms: platformsArr,
        media,
        clientIds,
        projectIds,
        clientName: clientNameFx || null,
        projectName: projectNameFx || null,
        copy
      };
    });

    return res.json({ ok:true, next_cursor: resp.has_more ? resp.next_cursor : null, posts });

  } catch (e) {
    return res.status(500).json({ ok:false, error:e.message || "grid error" });
  }
}
