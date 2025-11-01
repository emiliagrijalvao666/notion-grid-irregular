// /api/grid.js
import { Client } from "@notionhq/client";
import * as nd from "./_notion.js";

// Usa el cliente de tu _notion.js si existe; si no, crea uno aquí.
const notion = nd.notion || nd.default || new Client({ auth: process.env.NOTION_TOKEN });
const DB_ID = process.env.NOTION_DATABASE_ID;

// Posibles nombres de propiedades en tu DB (soporta tus variantes)
const PROP = {
  title:     ["Name","Post Name","Nombre","Name/Title"],
  date:      ["Publish Date","Fecha","Date","Publish"],
  platform:  ["Platform","Platforms"],
  status:    ["Status","Estado"],
  owners:    ["Owner","Owners"],
  clientRel: ["Client","PostClient"],
  projectRel:["Project","PostProject"],
  pinned:    ["Pinned","Pin"],
  hide:      ["Hide","Hidden","Ocultar"],
  archived:  ["Archivado","Archived"]
};

const pickProp = (props, names) => names.find(n => props[n]);

const isVideoUrl = (url="") => /\.(mp4|mov|webm|m4v)(\?|$)/i.test(url);

// helpers de extracción
function extractText(rich) {
  if (!rich || !Array.isArray(rich)) return "";
  return rich.map(t => t?.plain_text || "").join("").trim();
}
function extractDate(val) {
  const iso = val?.date?.start || val?.date?.end || null;
  return iso || null;
}
function extractMedia(props) {
  // Tus 3 campos Files & media
  const candidates = ["Attachment","Link","Canva Design","Image","Images"];
  const media = [];
  for (const name of candidates) {
    const f = props[name];
    if (!f || f.type !== "files" || !Array.isArray(f.files)) continue;
    f.files.forEach(item => {
      const url = item?.file?.url || item?.external?.url || "";
      if (!url) return;
      media.push({ type: isVideoUrl(url) ? "video" : "image", url });
    });
  }
  return media;
}

// Construye filtro dinámico según tipo real de la propiedad en Notion
function buildFilter(params, metaProps) {
  const and = [];

  const hideName = pickProp(metaProps, PROP.hide);
  if (hideName) and.push({ property: hideName, checkbox: { equals: false } });

  const archivedName = pickProp(metaProps, PROP.archived);
  if (archivedName) and.push({ property: archivedName, checkbox: { equals: false } });

  // Clients (relation)
  const clientRel = pickProp(metaProps, PROP.clientRel);
  const clients = params.getAll("client").concat(params.getAll("clientId"));
  if (clientRel && clients.length) {
    and.push({ or: clients.map(id => ({ property: clientRel, relation: { contains: id } })) });
  }

  // Projects (relation)
  const projectRel = pickProp(metaProps, PROP.projectRel);
  const projects = params.getAll("project").concat(params.getAll("projectId"));
  if (projectRel && projects.length) {
    and.push({ or: projects.map(id => ({ property: projectRel, relation: { contains: id } })) });
  }

  // Platforms (select o multi_select)
  const platformProp = pickProp(metaProps, PROP.platform);
  const platforms = params.getAll("platform").concat(params.getAll("platforms"));
  if (platformProp && platforms.length) {
    const t = metaProps[platformProp]?.type;
    if (t === "select") {
      and.push({ or: platforms.map(v => ({ property: platformProp, select: { equals: v } })) });
    } else if (t === "multi_select") {
      and.push({ or: platforms.map(v => ({ property: platformProp, multi_select: { contains: v } })) });
    }
  }

  // Status (select)
  const statusProp = pickProp(metaProps, PROP.status);
  const statuses = params.getAll("status").concat(params.getAll("statuses"));
  if (statusProp && statuses.length) {
    and.push({ or: statuses.map(v => ({ property: statusProp, select: { equals: v } })) });
  }

  // Owners (people)
  const ownersProp = pickProp(metaProps, PROP.owners);
  const owners = params.getAll("owner").concat(params.getAll("ownerId"));
  if (ownersProp && owners.length) {
    and.push({ or: owners.map(id => ({ property: ownersProp, people: { contains: id } })) });
  }

  return and.length ? { and } : undefined;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.status(405).json({ ok:false, error:"Method not allowed" });
      return;
    }

    const { searchParams } = new URL(req.url, `http://${req.headers.host}`);
    const pageSize = Math.min(Number(searchParams.get("pageSize") || 12), 50);
    const cursor   = searchParams.get("cursor") || undefined;

    const meta = await notion.databases.retrieve({ database_id: DB_ID });
    const props = meta.properties;

    const filter = buildFilter(searchParams, props);

    const dateName = pickProp(props, PROP.date);
    const titleName = pickProp(props, PROP.title);
    const pinnedName = pickProp(props, PROP.pinned);

    const sorts = dateName
      ? [{ property: dateName, direction: "descending" }]
      : [{ timestamp: "last_edited_time", direction: "descending" }];

    const resp = await notion.databases.query({
      database_id: DB_ID,
      page_size: pageSize,
      start_cursor: cursor,
      filter,
      sorts
    });

    const posts = resp.results.map(page => {
      const p = page.properties;
      const title = titleName ? extractText(p[titleName]?.title || p[titleName]?.rich_text) : page.id;
      const date  = dateName ? extractDate(p[dateName]) : null;
      const pinned = pinnedName ? !!p[pinnedName]?.checkbox : false;
      const media = extractMedia(p);
      const copyName = "Copy";
      const copy = p[copyName]?.rich_text ? extractText(p[copyName].rich_text) : "";
      return { id: page.id, title, date, pinned, copy, media };
    });

    res.status(200).json({ ok: true, posts, next_cursor: resp.has_more ? resp.next_cursor : null });

  } catch (err) {
    console.error("grid error:", err);
    res.status(200).json({ ok:false, error: String(err?.message || err) });
  }
}
