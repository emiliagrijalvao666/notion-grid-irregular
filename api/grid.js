// /api/grid.js
import { Client } from "@notionhq/client";
import * as nd from "./_notion.js";

const notion = nd.notion || nd.default || new Client({ auth: process.env.NOTION_TOKEN });
const DB_ID  = process.env.NOTION_DATABASE_ID;

/* ---------- helpers de propiedades ---------- */
function firstKeyByType(props, type, prefer = []) {
  for (const name of prefer) if (props[name]?.type === type) return name;
  for (const [k, v] of Object.entries(props)) if (v?.type === type) return k;
  return null;
}
function anyKeysByType(props, type) {
  return Object.entries(props)
    .filter(([, v]) => v?.type === type)
    .map(([k]) => k);
}
const isVideo = (url = "") => /\.(mp4|mov|webm|m4v)(\?|$)/i.test(url);
const text = rich => (Array.isArray(rich) ? rich.map(t => t?.plain_text || "").join("") : "") || "";

/* ---------- filtros dinámicos ---------- */
function buildFilter(params, props) {
  const and = [];

  // Hide/Archived checkboxes si existen
  const hideProp = Object.keys(props).find(k => props[k]?.type === "checkbox" && /hide|hidden/i.test(k));
  const archProp = Object.keys(props).find(k => props[k]?.type === "checkbox" && /archiv/i.test(k));
  if (hideProp) and.push({ property: hideProp, checkbox: { equals: false } });
  if (archProp) and.push({ property: archProp, checkbox: { equals: false } });

  // Clients (relation)
  const clientProp = firstKeyByType(props, "relation", ["Client", "PostClient"]);
  const clients = params.getAll("client").concat(params.getAll("clientId"));
  if (clientProp && clients.length) {
    and.push({ or: clients.map(id => ({ property: clientProp, relation: { contains: id } })) });
  }

  // Projects (relation)
  const projectProp = firstKeyByType(props, "relation", ["Project", "PostProject"]);
  const projects = params.getAll("project").concat(params.getAll("projectId"));
  if (projectProp && projects.length) {
    and.push({ or: projects.map(id => ({ property: projectProp, relation: { contains: id } })) });
  }

  // Platforms (select o multi_select)
  const platformProp =
    firstKeyByType(props, "select", ["Platform", "Platforms"]) ||
    firstKeyByType(props, "multi_select", ["Platforms", "Platform"]);
  const platforms = params.getAll("platform").concat(params.getAll("platforms"));
  if (platformProp && platforms.length) {
    const t = props[platformProp]?.type;
    if (t === "select") {
      and.push({ or: platforms.map(v => ({ property: platformProp, select: { equals: v } })) });
    } else if (t === "multi_select") {
      and.push({ or: platforms.map(v => ({ property: platformProp, multi_select: { contains: v } })) });
    }
  }

  // Status (select)
  const statusProp = firstKeyByType(props, "select", ["Status", "Estado"]);
  const statuses   = params.getAll("status").concat(params.getAll("statuses"));
  if (statusProp && statuses.length) {
    and.push({ or: statuses.map(v => ({ property: statusProp, select: { equals: v } })) });
  }

  // Owners (people)
  const ownersProp = firstKeyByType(props, "people", ["Owner", "Owners"]);
  const owners     = params.getAll("owner").concat(params.getAll("ownerId"));
  if (ownersProp && owners.length) {
    and.push({ or: owners.map(id => ({ property: ownersProp, people: { contains: id } })) });
  }

  return and.length ? { and } : undefined;
}

/* ---------- extracción de campos ---------- */
function extractMediaFromPageProperties(p) {
  // Junta TODOS los “files & media” que existan
  const filesProps = Object.entries(p).filter(([, v]) => v?.type === "files");
  const out = [];
  for (const [, val] of filesProps) {
    (val.files || []).forEach(item => {
      const url = item?.file?.url || item?.external?.url || "";
      if (!url) return;
      out.push({ type: isVideo(url) ? "video" : "image", url });
    });
  }
  return out;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.status(405).json({ ok: false, error: "Method not allowed" });
      return;
    }

    const { searchParams } = new URL(req.url, `http://${req.headers.host}`);
    const pageSize = Math.min(Number(searchParams.get("pageSize") || 12), 50);
    const cursor   = searchParams.get("cursor") || undefined;

    const meta  = await notion.databases.retrieve({ database_id: DB_ID });
    const props = meta.properties;

    const filter = buildFilter(searchParams, props);

    const titleProp = firstKeyByType(props, "title", ["Name", "Post Name"]);
    const dateProp  = firstKeyByType(props, "date",  ["Publish Date","Date","Publish"]);

    const sorts = dateProp
      ? [{ property: dateProp, direction: "descending" }]
      : [{ timestamp: "last_edited_time", direction: "descending" }];

    const resp = await notion.databases.query({
      database_id: DB_ID,
      page_size: pageSize,
      start_cursor: cursor,
      filter,
      sorts
    });

    const posts = resp.results.map(pg => {
      const p = pg.properties;

      const title =
        (titleProp && text(p[titleProp]?.title || p[titleProp]?.rich_text)) ||
        pg.id;

      const date = dateProp
        ? (p[dateProp]?.date?.start || p[dateProp]?.date?.end || null)
        : null;

      // pinned (checkbox opcional)
      const pinKey = Object.keys(p).find(k => p[k]?.type === "checkbox" && /pin/i.test(k));
      const pinned = pinKey ? !!p[pinKey]?.checkbox : false;

      // copy (rich_text opcional)
      const copyKey = Object.keys(p).find(k => p[k]?.type === "rich_text" && /copy|caption|texto/i.test(k));
      const copy = copyKey ? text(p[copyKey]?.rich_text) : "";

      const media = extractMediaFromPageProperties(p);

      return { id: pg.id, title, date, pinned, copy, media };
    });

    res.status(200).json({
      ok: true,
      posts,
      next_cursor: resp.has_more ? resp.next_cursor : null
    });

  } catch (err) {
    console.error("grid error:", err);
    res.status(200).json({ ok: false, error: String(err?.message || err) });
  }
}
