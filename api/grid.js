// api/grid.js  (ESM)
import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DB_CONTENT = process.env.NOTION_DATABASE_ID;

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }
  if (!process.env.NOTION_TOKEN || !DB_CONTENT) {
    res.status(200).json({ ok: false, error: "Missing NOTION_TOKEN or NOTION_DATABASE_ID" });
    return;
  }

  try {
    // schema para detectar qué propiedades existen
    const schema = await notion.databases.retrieve({ database_id: DB_CONTENT });
    const hasProp = (name) => !!schema.properties[name];

    // helpers query
    const q = req.query || {};
    const toArr = (v) => (Array.isArray(v) ? v : v ? [v] : []);
    const pageSize = Math.min(50, Math.max(1, parseInt(q.pageSize || "12", 10)));
    const startCursor = q.cursor || undefined;

    const clientIds    = toArr(q.client);
    const clientNames  = toArr(q.client_name);
    const projectIds   = toArr(q.project);
    const projectNames = toArr(q.project_name);
    const platforms    = toArr(q.platform);
    const owners       = toArr(q.owner);
    const statuses     = toArr(q.status);

    // --- Construcción de filtros seguros ---
    const and = [];

    // protocolo Hide/Archivado (si existen)
    if (hasProp("Hide"))       and.push({ property: "Hide", checkbox: { equals: false } });
    if (hasProp("Archivado"))  and.push({ property: "Archivado", checkbox: { equals: false } });

    // Clients: por relation ID o por nombre (formula/texto: ClientName)
    if ((clientIds.length && (hasProp("Client") || hasProp("PostClient"))) ||
        (clientNames.length && hasProp("ClientName"))) {
      const or = [];
      if (clientIds.length && hasProp("Client")) {
        clientIds.forEach(id => or.push({ property: "Client", relation: { contains: id } }));
      }
      // compat viejo
      if (clientIds.length && !hasProp("Client") && hasProp("PostClient")) {
        clientIds.forEach(id => or.push({ property: "PostClient", relation: { contains: id } }));
      }
      if (clientNames.length && hasProp("ClientName")) {
        clientNames.forEach(n => or.push({ property: "ClientName", rich_text: { contains: n } }));
      }
      if (or.length) and.push({ or });
    }

    // Projects: por relation ID o por nombre (ProjectName)
    if ((projectIds.length && hasProp("Project")) || (projectNames.length && hasProp("ProjectName"))) {
      const or = [];
      if (projectIds.length && hasProp("Project")) {
        projectIds.forEach(id => or.push({ property: "Project", relation: { contains: id } }));
      }
      if (projectNames.length && hasProp("ProjectName")) {
        projectNames.forEach(n => or.push({ property: "ProjectName", rich_text: { contains: n } }));
      }
      if (or.length) and.push({ or });
    }

    // Platform (select)
    if (platforms.length && hasProp("Platform")) {
      and.push({
        or: platforms.map(v => ({ property: "Platform", select: { equals: v } }))
      });
    }

    // Owners (people)
    if (owners.length && hasProp("Owner")) {
      and.push({
        or: owners.map(id => ({ property: "Owner", people: { contains: id } }))
      });
    }

    // Status (status)
    if (statuses.length && hasProp("Status")) {
      and.push({
        or: statuses.map(s => ({ property: "Status", status: { equals: s } }))
      });
    }

    // query Notion
    const resp = await notion.databases.query({
      database_id: DB_CONTENT,
      start_cursor: startCursor,
      page_size: pageSize,
      filter: and.length ? { and } : undefined,
      sorts: buildSorts(schema)
    });

    // map de resultados
    const posts = resp.results.map(page => pageToPost(page, schema));

    res.status(200).json({
      ok: true,
      posts,
      next_cursor: resp.has_more ? resp.next_cursor : null
    });
  } catch (err) {
    res.status(200).json({ ok: false, error: cleanErr(err) });
  }
}

// ---------- helpers ----------

function buildSorts(schema) {
  const sorts = [];
  if (schema.properties["Publish Date"]?.type === "date") {
    sorts.push({ property: "Publish Date", direction: "descending" });
  }
  // fallback por created_time para mantener feed fresco
  sorts.push({ timestamp: "created_time", direction: "descending" });
  return sorts;
}

function pageToPost(page, schema) {
  const get = (prop) => page.properties[prop];

  const title =
    get("Post")?.title?.map(t=>t.plain_text).join("") ||
    get("Name")?.title?.map(t=>t.plain_text).join("") ||
    "";

  const date =
    get("Publish Date")?.date?.start ||
    page.created_time;

  const pinned = schema.properties["Pinned"]?.type === "checkbox"
    ? !!get("Pinned")?.checkbox
    : false;

  const copy = (get("Copy")?.rich_text || []).map(t=>t.plain_text).join(" ").trim();

  // media: Attachment, Link, Canva (Files & media)
  const media = []
    .concat(filesFrom(get("Attachment")))
    .concat(filesFrom(get("Link")))
    .concat(filesFrom(get("Canva")));

  return {
    id: page.id,
    title,
    date,
    pinned,
    copy,
    media: media.length ? media : []
  };
}

function filesFrom(prop) {
  if (!prop) return [];
  const arr = prop.files || [];
  return arr.map(f => {
    const url = f.type === "file" ? f.file?.url : f.external?.url;
    return {
      url,
      type: isVideo(url) ? "video" : "image"
    };
  }).filter(x => !!x.url);
}

function isVideo(url="") {
  return /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(url.split("?")[0]);
}

function cleanErr(e) {
  try {
    const j = JSON.parse(e.body);
    return j?.message || e.message || String(e);
  } catch {
    return e.message || String(e);
  }
}
