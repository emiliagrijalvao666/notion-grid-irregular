// pages/api/grid.js
import { Client } from "@notionhq/client";

const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

const DB_ID = process.env.NOTION_DB_ID;

// helpers -------------
// saca el nombre de una FORMULA de texto
function getFormulaString(prop) {
  if (!prop) return "";
  if (prop.type === "formula" && prop.formula && prop.formula.type === "string") {
    return prop.formula.string || "";
  }
  return "";
}

// saca nombres de una relation PERO usando la formula como plan A
function getClientNames(page) {
  // 1. intenta con formula ClientName
  const fromFormula = getFormulaString(page.properties?.ClientName);
  if (fromFormula) {
    return [fromFormula];
  }
  // 2. sino, usa relation Client (ids)
  const rel = page.properties?.Client;
  if (rel && rel.type === "relation" && Array.isArray(rel.relation) && rel.relation.length > 0) {
    // devolvemos ids como texto para que no salga [object Object]
    return rel.relation.map((r) => `Client ${r.id.slice(0, 6)}`);
  }
  return [];
}

function getProjectNames(page) {
  // 1. intenta con formula ProjectName
  const fromFormula = getFormulaString(page.properties?.ProjectName);
  if (fromFormula) {
    return [fromFormula];
  }
  // 2. sino, usa relation Project
  const rel = page.properties?.Project;
  if (rel && rel.type === "relation" && Array.isArray(rel.relation) && rel.relation.length > 0) {
    return rel.relation.map((r) => `Project ${r.id.slice(0, 6)}`);
  }
  return [];
}

function getPlatforms(page) {
  const p = page.properties?.Platform;
  if (p && p.type === "multi_select" && Array.isArray(p.multi_select)) {
    return p.multi_select.map((o) => o.name);
  }
  return [];
}

function getOwners(page) {
  const o = page.properties?.Owner;
  if (o && o.type === "people" && Array.isArray(o.people)) {
    return o.people.map((p) => p.name || p.id);
  }
  return [];
}

function getStatus(page) {
  const s = page.properties?.Status;
  if (s && s.type === "status" && s.status) {
    return s.status.name;
  }
  return "";
}

function getTitle(page) {
  const t = page.properties?.Post;
  if (t && t.type === "title" && Array.isArray(t.title)) {
    return t.title.map((p) => p.plain_text).join("") || "Untitled";
  }
  return "Untitled";
}

function getPublishDate(page) {
  const d = page.properties?.["Publish Date"];
  if (d && d.type === "date" && d.date && d.date.start) {
    return d.date.start;
  }
  return null;
}

function getAttachment(page) {
  const f = page.properties?.Attachment;
  if (f && f.type === "files" && Array.isArray(f.files) && f.files.length > 0) {
    const file = f.files[0];
    if (file.external) return file.external.url;
    if (file.file) return file.file.url;
  }
  return null;
}

function isHidden(page) {
  const h = page.properties?.Hide;
  if (h && h.type === "checkbox") {
    return h.checkbox === true;
  }
  return false;
}

function isArchived(page) {
  const a = page.properties?.Archivado;
  if (a && a.type === "checkbox") {
    return a.checkbox === true;
  }
  return false;
}

function isPinned(page) {
  const p = page.properties?.Pinned;
  if (p && p.type === "checkbox") {
    return p.checkbox === true;
  }
  return false;
}

function isDraft(page) {
  const d = page.properties?.Draft;
  if (d && d.type === "formula" && d.formula && d.formula.type === "boolean") {
    return d.formula.boolean === true;
  }
  return false;
}

// build filters -------------
function buildFiltersFromPosts(posts) {
  const clientsMap = new Map();
  const projectsMap = new Map();
  const platformsMap = new Map();
  const ownersMap = new Map();
  const statusMap = new Map();

  for (const post of posts) {
    // clients
    const clients = post.clients;
    clients.forEach((c) => {
      if (!clientsMap.has(c)) clientsMap.set(c, 0);
      clientsMap.set(c, clientsMap.get(c) + 1);
    });

    // projects
    const projects = post.projects;
    projects.forEach((p) => {
      if (!projectsMap.has(p)) projectsMap.set(p, 0);
      projectsMap.set(p, projectsMap.get(p) + 1);
    });

    // platforms
    post.platforms.forEach((pl) => {
      if (!platformsMap.has(pl)) platformsMap.set(pl, 0);
      platformsMap.set(pl, platformsMap.get(pl) + 1);
    });

    // owners
    post.owners.forEach((o) => {
      if (!ownersMap.has(o)) ownersMap.set(o, 0);
      ownersMap.set(o, ownersMap.get(o) + 1);
    });

    // status
    if (post.status) {
      if (!statusMap.has(post.status)) statusMap.set(post.status, 0);
      statusMap.set(post.status, statusMap.get(post.status) + 1);
    }
  }

  const toArr = (m) =>
    Array.from(m.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

  return {
    clients: toArr(clientsMap),
    projects: toArr(projectsMap),
    platforms: toArr(platformsMap),
    owners: toArr(ownersMap),
    statuses: toArr(statusMap),
  };
}

export default async function handler(req, res) {
  if (!DB_ID || !process.env.NOTION_TOKEN) {
    return res.status(500).json({
      ok: false,
      error: "Missing NOTION_TOKEN or NOTION_DB_ID",
    });
  }

  try {
    // 1. traemos TODO lo visible
    const query = await notion.databases.query({
      database_id: DB_ID,
      filter: {
        and: [
          {
            property: "Archivado",
            checkbox: {
              equals: false,
            },
          },
          {
            property: "Hide",
            checkbox: {
              equals: false,
            },
          },
        ],
      },
      sorts: [
        {
          property: "Publish Date",
          direction: "descending",
        },
      ],
    });

    // 2. mapeamos a nuestro formato
    const pages = query.results || [];

    const mapped = pages.map((page) => {
      const clients = getClientNames(page);
      const projects = getProjectNames(page);
      const platforms = getPlatforms(page);
      const owners = getOwners(page);
      const status = getStatus(page);

      return {
        id: page.id,
        title: getTitle(page),
        publishDate: getPublishDate(page),
        clients,
        projects,
        platforms,
        owners,
        status,
        pinned: isPinned(page),
        draft: isDraft(page),
        attachment: getAttachment(page),
      };
    });

    // 3. filtrado por query (client, project, platform, owner, status)
    const { client, project, platform, owner, status } = req.query;

    let filtered = mapped;

    if (client && client !== "All Clients") {
      filtered = filtered.filter((p) => p.clients.includes(client));
    }

    if (project && project !== "All Projects") {
      filtered = filtered.filter((p) => p.projects.includes(project));
    }

    if (platform && platform !== "All Platforms") {
      filtered = filtered.filter((p) => p.platforms.includes(platform));
    }

    if (owner && owner !== "All Owners") {
      filtered = filtered.filter((p) => p.owners.includes(owner));
    }

    if (status && status !== "All Status") {
      filtered = filtered.filter((p) => p.status === status);
    }

    // 4. orden: pinned primero
    filtered.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      // luego por fecha
      if (a.publishDate && b.publishDate) {
        return a.publishDate < b.publishDate ? 1 : -1;
      }
      return 0;
    });

    // 5. construir filtros con base en TODOS los posts visibles (no solo filtrados)
    const filters = buildFiltersFromPosts(mapped);

    return res.status(200).json({
      ok: true,
      posts: filtered,
      filters,
      total: filtered.length,
    });
  } catch (err) {
    console.error("notion error", err.body || err.message || err);
    return res.status(500).json({
      ok: false,
      error: "Notion error",
      detail: err.body || err.message || null,
    });
  }
}
