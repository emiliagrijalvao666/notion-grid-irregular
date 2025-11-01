// /api/grid.js  (Node ESM en Vercel)
import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DB_ID = process.env.NOTION_DB_ID;

// --- helpers de extracción de Notion ---
const getFormulaText = (prop) =>
  prop?.type === "formula" && prop.formula?.type === "string"
    ? (prop.formula.string || "").trim()
    : "";

const getTitle = (p) =>
  p.properties?.Post?.type === "title"
    ? (p.properties.Post.title || []).map(t => t.plain_text).join("") || "Untitled"
    : "Untitled";

const getDate = (p) =>
  p.properties?.["Publish Date"]?.type === "date"
    ? p.properties["Publish Date"].date?.start || null
    : null;

const getAttachment = (p) => {
  const f = p.properties?.Attachment;
  if (f?.type === "files" && Array.isArray(f.files) && f.files.length) {
    const file = f.files[0];
    return file.external?.url || file.file?.url || null;
  }
  return null;
};

const getPlatforms = (p) =>
  p.properties?.Platform?.type === "multi_select"
    ? (p.properties.Platform.multi_select || []).map(o => o.name)
    : [];

const getOwners = (p) =>
  p.properties?.Owner?.type === "people"
    ? (p.properties.Owner.people || []).map(o => o.name || o.id)
    : [];

const getStatus = (p) =>
  p.properties?.Status?.type === "status" ? (p.properties.Status.status?.name || "") : "";

const getCheckbox = (p, name) =>
  p.properties?.[name]?.type === "checkbox" ? !!p.properties[name].checkbox : false;

// Si existen fórmulas ClientName/ProjectName, úsalas. Si no, cae al id de la relation (texto plano, no [object Object]).
const getClients = (p) => {
  const byFormula = getFormulaText(p.properties?.ClientName);
  if (byFormula) return [byFormula];

  const rel = p.properties?.Client;
  if (rel?.type === "relation" && rel.relation?.length) {
    return rel.relation.map(r => `Client ${r.id.slice(0, 6)}`);
  }
  return [];
};

const getProjects = (p) => {
  const byFormula = getFormulaText(p.properties?.ProjectName);
  if (byFormula) return [byFormula];

  const rel = p.properties?.Project;
  if (rel?.type === "relation" && rel.relation?.length) {
    return rel.relation.map(r => `Project ${r.id.slice(0, 6)}`);
  }
  return [];
};

const countMapToArray = (map) =>
  Array.from(map.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

const buildFilters = (items) => {
  const mClients = new Map();
  const mProjects = new Map();
  const mPlatforms = new Map();
  const mOwners = new Map();
  const mStatuses = new Map();

  for (const it of items) {
    it.clients.forEach(c => mClients.set(c, (mClients.get(c) || 0) + 1));
    it.projects.forEach(p => mProjects.set(p, (mProjects.get(p) || 0) + 1));
    it.platforms.forEach(pl => mPlatforms.set(pl, (mPlatforms.get(pl) || 0) + 1));
    it.owners.forEach(o => mOwners.set(o, (mOwners.get(o) || 0) + 1));
    if (it.status) mStatuses.set(it.status, (mStatuses.get(it.status) || 0) + 1);
  }

  return {
    clients: countMapToArray(mClients),
    projects: countMapToArray(mProjects),
    platforms: countMapToArray(mPlatforms),
    owners: countMapToArray(mOwners),
    statuses: countMapToArray(mStatuses),
  };
};

export default async function handler(req, res) {
  if (!DB_ID || !process.env.NOTION_TOKEN) {
    return res.status(500).json({ ok: false, error: "Missing NOTION_TOKEN or NOTION_DB_ID" });
  }

  try {
    // 1) Trae SOLO visibles (Archivado=false, Hide=false)
    const q = await notion.databases.query({
      database_id: DB_ID,
      filter: {
        and: [
          { property: "Archivado", checkbox: { equals: false } },
          { property: "Hide", checkbox: { equals: false } },
        ],
      },
      sorts: [{ property: "Publish Date", direction: "descending" }],
    });

    const rows = q.results || [];

    // 2) Mapea a formato del widget
    const all = rows.map((p) => {
      const item = {
        id: p.id,
        title: getTitle(p),
        publishDate: getDate(p),
        attachment: getAttachment(p),
        clients: getClients(p),
        projects: getProjects(p),
        platforms: getPlatforms(p),
        owners: getOwners(p),
        status: getStatus(p),
        pinned: getCheckbox(p, "Pinned"),
        draft: getCheckbox(p, "Draft"), // tu Draft es formula -> aquí solo lo incluimos si lo transformas a checkbox a futuro
      };
      return item;
    });

    // 3) Filtros dinámicos (client, project, platform, owner, status)
    const { client, project, platform, owner, status } = req.query || {};
    let list = all;

    if (client && client !== "All Clients") list = list.filter((x) => x.clients.includes(client));
    if (project && project !== "All Projects") list = list.filter((x) => x.projects.includes(project));
    if (platform && platform !== "All Platforms") list = list.filter((x) => x.platforms.includes(platform));
    if (owner && owner !== "All Owners") list = list.filter((x) => x.owners.includes(owner));
    if (status && status !== "All Status") list = list.filter((x) => x.status === status);

    // 4) Orden: pinned primero, luego por fecha descendente
    list.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      if (a.publishDate && b.publishDate) return a.publishDate < b.publishDate ? 1 : -1;
      return 0;
    });

    // 5) Arma filtros a partir de TODOS los visibles
    const filters = buildFilters(all);

    return res.status(200).json({ ok: true, posts: list, filters });
  } catch (err) {
    console.error("Notion error:", err?.body || err?.message || err);
    return res.status(500).json({ ok: false, error: "Notion error", detail: err?.body || err?.message || null });
  }
}
