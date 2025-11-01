// /api/filters.js
import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DB_ID = process.env.NOTION_DATABASE_ID || process.env.NOTION_DB_ID;

function safePlainTextFromTitleArray(arr = []) {
  return arr.map(t => t.plain_text || "").join("").trim();
}

function extractStringsFromProperty(prop) {
  if (!prop) return [];

  const type = prop.type;

  // 1) title
  if (type === "title") {
    const txt = safePlainTextFromTitleArray(prop.title);
    return txt ? [txt] : [];
  }

  // 2) rich_text
  if (type === "rich_text") {
    const txt = (prop.rich_text || []).map(t => t.plain_text || "").join("").trim();
    return txt ? [txt] : [];
  }

  // 3) select / multi_select
  if (type === "select") {
    return prop.select && prop.select.name ? [prop.select.name] : [];
  }
  if (type === "multi_select") {
    return (prop.multi_select || []).map(s => s.name).filter(Boolean);
  }

  // 4) status
  if (type === "status") {
    return prop.status && prop.status.name ? [prop.status.name] : [];
  }

  // 5) people
  if (type === "people") {
    return (prop.people || []).map(p => p.name || (p.person && p.person.email) || "").filter(Boolean);
  }

  // 6) rollup - array of items (this is the important part)
  if (type === "rollup") {
    const arr = prop.rollup?.array || [];
    const out = [];
    for (const item of arr) {
      // item often has structure like { type: 'title', title: [...] } or 'rich_text' or 'select'
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
        // sometimes rollup of relation gives array of relation objects — they only have id, no name
        // ignore (can't resolve names here without extra queries)
      } else {
        // defensive: try any nested text arrays
        if (item.title) out.push(safePlainTextFromTitleArray(item.title));
        if (item.rich_text) out.push((item.rich_text || []).map(t => t.plain_text || "").join(""));
      }
    }
    return out.filter(Boolean);
  }

  // 7) relation (can't read names from relation type directly via this property)
  if (type === "relation") {
    // relation gives only ids, so we can't extract names here without additional Notion lookups
    return [];
  }

  // fallback
  return [];
}

export default async function handler(req, res) {
  if (!DB_ID) {
    return res.status(500).json({ ok: false, error: "Missing NOTION_DATABASE_ID", clients: [], projects: [], platforms: [], owners: [], statuses: [] });
  }

  // attempt to fetch pages with Archivado/Hide filters if available, fallback if not
  let pages = [];
  try {
    const q = await notion.databases.query({
      database_id: DB_ID,
      page_size: 100,
      filter: {
        and: [
          { property: "Archivado", checkbox: { equals: false } },
          { property: "Hide", checkbox: { equals: false } },
        ],
      },
    });
    pages = q.results;
    let cursor = q.has_more ? q.next_cursor : null;
    while (cursor) {
      const n = await notion.databases.query({ database_id: DB_ID, page_size: 100, start_cursor: cursor });
      pages = pages.concat(n.results);
      cursor = n.has_more ? n.next_cursor : null;
    }
  } catch (err) {
    // fallback: try without those two filters
    try {
      const q2 = await notion.databases.query({ database_id: DB_ID, page_size: 100 });
      pages = q2.results;
      let cursor = q2.has_more ? q2.next_cursor : null;
      while (cursor) {
        const n = await notion.databases.query({ database_id: DB_ID, page_size: 100, start_cursor: cursor });
        pages = pages.concat(n.results);
        cursor = n.has_more ? n.next_cursor : null;
      }
    } catch (err2) {
      return res.status(500).json({ ok: false, error: err2.message, clients: [], projects: [], platforms: [], owners: [], statuses: [] });
    }
  }

  // collectors
  const clientsMap = new Map();
  const projectsMap = new Map();
  const platformsSet = new Set();
  const ownersMap = new Map();
  const statusesSet = new Set();

  // name candidates for each concept (tries in order)
  const clientProps = ["ClientName", "PostClient", "PostClients", "Client", "Clients"];
  const projectProps = ["ProjectName", "PostProject", "PostProjects", "Project", "Projects"];
  const platformProps = ["Platform", "Plataforma", "Platforms", "PostPlatform", "PostPlatforms", "PlatformName"];
  const ownerProps = ["Owner", "Owners", "People", "OwnerName"];
  const statusProps = ["Status", "Estado", "PostStatus"];

  for (const page of pages) {
    const props = page.properties || {};

    // --- CLIENT
    for (const n of clientProps) {
      if (props[n]) {
        const vals = extractStringsFromProperty(props[n]);
        vals.forEach(v => clientsMap.set(v, (clientsMap.get(v) || 0) + 1));
        break;
      }
    }

    // --- PROJECT
    for (const n of projectProps) {
      if (props[n]) {
        const vals = extractStringsFromProperty(props[n]);
        vals.forEach(v => projectsMap.set(v, (projectsMap.get(v) || 0) + 1));
        break;
      }
    }

    // --- PLATFORMS
    for (const n of platformProps) {
      if (props[n]) {
        const vals = extractStringsFromProperty(props[n]);
        vals.forEach(v => platformsSet.add(v));
        break;
      }
    }

    // --- OWNERS
    for (const n of ownerProps) {
      if (props[n]) {
        const vals = extractStringsFromProperty(props[n]);
        vals.forEach(v => ownersMap.set(v, (ownersMap.get(v) || 0) + 1));
        break;
      }
    }

    // --- STATUS
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

  return res.status(200).json({
    ok: true,
    clients,
    projects,
    platforms,
    owners,
    statuses
  });
}
