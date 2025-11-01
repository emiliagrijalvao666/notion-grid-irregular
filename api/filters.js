// /api/filters.js
import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DB_ID = process.env.NOTION_DATABASE_ID || process.env.NOTION_DB_ID;

function safePlainTextFromTitleArray(arr = []) {
  return (arr || []).map(t => t.plain_text || "").join("").trim();
}

function extractStringsFromProperty(prop) {
  if (!prop) return [];

  const type = prop.type;

  // title
  if (type === "title") {
    const txt = safePlainTextFromTitleArray(prop.title || []);
    return txt ? [txt] : [];
  }

  // rich_text
  if (type === "rich_text") {
    const txt = (prop.rich_text || []).map(t => t.plain_text || "").join("").trim();
    return txt ? [txt] : [];
  }

  // select / multi_select
  if (type === "select") {
    return prop.select && prop.select.name ? [prop.select.name] : [];
  }
  if (type === "multi_select") {
    return (prop.multi_select || []).map(s => s.name).filter(Boolean);
  }

  // status
  if (type === "status") {
    return prop.status && prop.status.name ? [prop.status.name] : [];
  }

  // people
  if (type === "people") {
    return (prop.people || []).map(p => p.name || (p.user && p.user.name) || "").filter(Boolean);
  }

  // files -> ignore for filtering (no textual)
  if (type === "files") return [];

  // checkbox -> return true/false as string (useful for debug)
  if (type === "checkbox") {
    return [prop.checkbox === true ? "true" : "false"];
  }

  // date -> ISO string if present
  if (type === "date") {
    return prop.date && prop.date.start ? [prop.date.start] : [];
  }

  // formula -> handle common formula result types
  if (type === "formula") {
    const f = prop.formula || {};
    // string
    if (f.type === "string" && typeof f.string === "string") {
      return f.string ? [f.string] : [];
    }
    // number
    if (f.type === "number" && (f.number !== null && f.number !== undefined)) {
      return [String(f.number)];
    }
    // boolean
    if (f.type === "checkbox" && (f.checkbox !== null && f.checkbox !== undefined)) {
      return [f.checkbox ? "true" : "false"];
    }
    // date
    if (f.type === "date" && f.date && f.date.start) {
      return [f.date.start];
    }
    // fallback: sometimes formula returns rich_text-like object
    if (f.string) return [f.string];
    return [];
  }

  // rollup (important)
  if (type === "rollup") {
    const arr = prop.rollup?.array || [];
    const out = [];
    for (const item of arr) {
      if (!item) continue;
      if (item.type === "title" && item.title) {
        out.push(safePlainTextFromTitleArray(item.title));
      } else if (item.type === "rich_text" && item.rich_text) {
        out.push((item.rich_text || []).map(t => t.plain_text || "").join(""));
      } else if (item.type === "select" && item.select) {
        out.push(item.select.name);
      } else if (item.type === "status" && item.status) {
        out.push(item.status.name);
      } else if (item.type === "people" && item.people) {
        out.push(...(item.people || []).map(p => p.name || "").filter(Boolean));
      } else if (item.type === "relation" && item.relation) {
        // relation items only contain id — skip (can't resolve name without extra fetch)
      } else {
        // defensive attempts
        if (item.title) out.push(safePlainTextFromTitleArray(item.title));
        if (item.rich_text) out.push((item.rich_text || []).map(t => t.plain_text || "").join(""));
        if (typeof item === "string") out.push(item);
      }
    }
    return out.filter(Boolean);
  }

  // relation -> we can't get names here (Notion returns ids); return empty
  if (type === "relation") {
    return [];
  }

  // fallback
  return [];
}

async function fetchAllPages(databaseId, filter = undefined) {
  let pages = [];
  try {
    const opt = { database_id: databaseId, page_size: 100 };
    if (filter) opt.filter = filter;
    let q = await notion.databases.query(opt);
    pages = q.results || [];
    let cursor = q.has_more ? q.next_cursor : null;
    while (cursor) {
      const nextOpt = { database_id: databaseId, page_size: 100, start_cursor: cursor };
      if (filter) nextOpt.filter = filter;
      const n = await notion.databases.query(nextOpt);
      pages = pages.concat(n.results || []);
      cursor = n.has_more ? n.next_cursor : null;
    }
    return pages;
  } catch (err) {
    throw err;
  }
}

export default async function handler(req, res) {
  if (!DB_ID) return res.status(500).json({ ok: false, error: "Missing NOTION_DATABASE_ID" });

  // 1) retrieve DB schema so we build safe filters
  let schema;
  try {
    schema = await notion.databases.retrieve({ database_id: DB_ID });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Cannot retrieve DB schema: " + err.message });
  }

  const propNames = Object.keys(schema.properties || {});

  // build safe filter — only include checkbox filters if those props exist
  const safeAnd = [];
  if (propNames.includes("Archivado") && schema.properties["Archivado"].type === "checkbox") {
    safeAnd.push({ property: "Archivado", checkbox: { equals: false } });
  }
  if (propNames.includes("Hide") && schema.properties["Hide"].type === "checkbox") {
    safeAnd.push({ property: "Hide", checkbox: { equals: false } });
  }

  let pages = [];
  try {
    if (safeAnd.length > 0) {
      pages = await fetchAllPages(DB_ID, { and: safeAnd });
    } else {
      pages = await fetchAllPages(DB_ID);
    }
  } catch (err) {
    // fallback try without filter
    try {
      pages = await fetchAllPages(DB_ID);
    } catch (err2) {
      return res.status(500).json({ ok: false, error: "Query failed: " + err2.message });
    }
  }

  // collectors
  const clientsMap = new Map();
  const projectsMap = new Map();
  const platformsSet = new Set();
  const ownersMap = new Map();
  const statusesSet = new Set();

  // candidate property names (we'll try these in order)
  const clientProps = ["ClientName", "PostClient", "PostClients", "Client", "Clients"];
  const projectProps = ["ProjectName", "PostProject", "PostProjects", "Project", "Projects"];
  const platformProps = ["Platform", "Plataforma", "Platforms", "PostPlatform", "PostPlatforms", "PlatformName"];
  const ownerProps = ["Owner", "Owners", "People", "OwnerName"];
  const statusProps = ["Status", "Estado", "PostStatus"];

  for (const page of pages) {
    const props = page.properties || {};

    // CLIENT
    for (const n of clientProps) {
      if (props[n]) {
        const vals = extractStringsFromProperty(props[n]);
        vals.forEach(v => clientsMap.set(v, (clientsMap.get(v) || 0) + 1));
        break;
      }
    }

    // PROJECT
    for (const n of projectProps) {
      if (props[n]) {
        const vals = extractStringsFromProperty(props[n]);
        vals.forEach(v => projectsMap.set(v, (projectsMap.get(v) || 0) + 1));
        break;
      }
    }

    // PLATFORM
    for (const n of platformProps) {
      if (props[n]) {
        const vals = extractStringsFromProperty(props[n]);
        vals.forEach(v => platformsSet.add(v));
        break;
      }
    }

    // OWNER
    for (const n of ownerProps) {
      if (props[n]) {
        const vals = extractStringsFromProperty(props[n]);
        vals.forEach(v => ownersMap.set(v, (ownersMap.get(v) || 0) + 1));
        break;
      }
    }

    // STATUS
    for (const n of statusProps) {
      if (props[n]) {
        const vals = extractStringsFromProperty(props[n]);
        vals.forEach(v => statusesSet.add(v));
        break;
      }
    }
  }

  const clients = Array.from(clientsMap.entries()).map(([name, count]) => ({ name, count })).sort((a,b)=>b.count-a.count);
  const projects = Array.from(projectsMap.entries()).map(([name, count]) => ({ name, count })).sort((a,b)=>b.count-a.count);
  const owners = Array.from(ownersMap.entries()).map(([name, count]) => ({ name, count })).sort((a,b)=>b.count-a.count);
  const platforms = Array.from(platformsSet.values()).filter(Boolean).sort((a,b)=>a.localeCompare(b));
  const statuses = Array.from(statusesSet.values()).filter(Boolean).sort((a,b)=>a.localeCompare(b));

  const out = { ok: true, counts: { pages: pages.length }, clients, projects, platforms, owners, statuses };

  // debug param: return 3 samples of raw pages (with only a few props for investigation)
  if (req.query && (req.query.debug === "1" || req.query.debug === "true")) {
    out.debugSample = pages.slice(0,3).map(p => {
      const small = { id: p.id, props: {} };
      const interesting = ["PostClient","ClientName","PostProject","ProjectName","PostBrands","Platform","Owner","Status"];
      for (const k of interesting) {
        if (p.properties && p.properties[k]) {
          small.props[k] = p.properties[k];
        }
      }
      return small;
    });
    out.schema_properties = Object.keys(schema.properties || {}).reduce((acc,k)=>{
      acc[k] = { type: schema.properties[k].type };
      return acc;
    },{});
  }

  return res.status(200).json(out);
}
