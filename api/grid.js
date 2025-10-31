// /api/grid.js

import { Client } from "@notionhq/client";

// IMPORTANTE: respeta estos nombres porque es como tú los pusiste en Vercel
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DB_ID =
  process.env.NOTION_DB_ID ||
  process.env.NOTION_DATABASE_ID ||
  process.env.NOTION_DB_CONTENT;

// cachecito en memoria (se borra cuando Vercel duerme, pero sirve)
let FILTER_CACHE = null;
let FILTER_CACHE_TS = 0; // timestamp en ms
const FILTER_CACHE_TTL = 5 * 60 * 1000; // 5 minutos

const notion = new Client({ auth: NOTION_TOKEN });

// helper seguro para leer texto
function getText(prop) {
  if (!prop) return "";
  if (Array.isArray(prop)) {
    return prop.map((t) => t.plain_text).join("");
  }
  if (prop.rich_text) {
    return prop.rich_text.map((t) => t.plain_text).join("");
  }
  if (prop.title) {
    return prop.title.map((t) => t.plain_text).join("");
  }
  return "";
}

// extraer assets (attachments / links / canva)
function extractAssets(properties) {
  const assets = [];

  // 1. Files & media
  if (properties.Attachment && properties.Attachment.files) {
    properties.Attachment.files.forEach((file) => {
      if (file.external) {
        assets.push({
          url: file.external.url,
          type: "image",
          source: "attachment",
        });
      } else if (file.file) {
        assets.push({
          url: file.file.url,
          type: "image",
          source: "attachment",
        });
      }
    });
  }

  // 2. Link (drive, etc.)
  if (properties.Link && properties.Link.url) {
    assets.push({
      url: properties.Link.url,
      type: "image",
      source: "link",
    });
  }

  // 3. Canva
  if (properties.Canva && properties.Canva.url) {
    assets.push({
      url: properties.Canva.url,
      type: "image",
      source: "canva",
    });
  }

  return assets;
}

// procesar 1 post de Notion → objeto plano para el front
function processPost(page) {
  const props = page.properties;

  // nombres de propiedades que tú usas en tu DB
  const nameKey = "Post";
  const dateKey = "Publish Date";
  const statusKey = "Status";
  const clientRollKey = "ClientName";
  const projectRollKey = "ProjectName";
  const brandRollKey = "BrandName";
  const platformKey = "Platform";
  const copyKey = "Copy";
  const ownerKey = "Owner";
  const pinnedKey = "Pinned";
  const archivedKey = "Archivado";
  const hiddenKey = "Hide";

  // name
  const title =
    getText(props[nameKey]?.title) ||
    getText(props["Name"]?.title) ||
    getText(props["Post"]?.title) ||
    "Untitled";

  // date
  const date =
    props[dateKey]?.date?.start ||
    props["Date"]?.date?.start ||
    props["Fecha"]?.date?.start ||
    null;

  // status
  const status =
    props[statusKey]?.status?.name ||
    props["Estado"]?.status?.name ||
    props["Status"]?.select?.name ||
    null;

  // rollups legibles
  const client = getText(props[clientRollKey]);
  const project = getText(props[projectRollKey]);
  const brand = getText(props[brandRollKey]);

  // platforms
  const platforms = props[platformKey]?.multi_select
    ? props[platformKey].multi_select.map((p) => p.name)
    : [];

  // copy
  const copy = getText(props[copyKey]);

  // owner
  const owner =
    props[ownerKey]?.people?.[0]?.name ||
    props[ownerKey]?.rich_text?.[0]?.plain_text ||
    null;

  // flags
  const pinned = props[pinnedKey]?.checkbox === true;
  const archived = props[archivedKey]?.checkbox === true;
  const hidden = props[hiddenKey]?.checkbox === true;

  const assets = extractAssets(props);

  return {
    id: page.id,
    title,
    date,
    status,
    type: props.Type?.select?.name || null,
    platforms,
    client: client || null,
    project: project || null,
    brand: brand || null,
    owner,
    pinned,
    archived,
    hidden,
    copy,
    assets,
  };
}

// ← NUEVO: función que cuenta ocurrencias
function buildCounts(posts) {
  const clients = {};
  const projects = {};
  const brands = {};
  const owners = {};

  posts.forEach((post) => {
    // excluimos los que no se muestran
    if (post.archived || post.hidden) return;

    if (post.client) {
      clients[post.client] = (clients[post.client] || 0) + 1;
    }
    if (post.project) {
      projects[post.project] = (projects[post.project] || 0) + 1;
    }
    if (post.brand) {
      brands[post.brand] = (brands[post.brand] || 0) + 1;
    }
    if (post.owner) {
      owners[post.owner] = (owners[post.owner] || 0) + 1;
    }
  });

  // pasamos a arrays ordenados
  const toArr = (obj) =>
    Object.entries(obj)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

  return {
    clients: toArr(clients),
    projects: toArr(projects),
    brands: toArr(brands),
    owners: toArr(owners),
  };
}

export default async function handler(req, res) {
  // 1. validar env
  if (!NOTION_TOKEN || !NOTION_DB_ID) {
    return res.status(200).json({
      ok: false,
      error: "Missing NOTION_TOKEN or NOTION_DB_ID",
      posts: [],
      filters: {
        clients: [],
        projects: [],
        brands: [],
        platforms: [],
        owners: [],
      },
    });
  }

  const {
    limit = 24,
    start_cursor = null,
    client,
    project,
    brand,
    platform,
    status,
    meta,
  } = req.query;

  try {
    // 2. construir filtros base
    const andFilters = [];

    // excluir archivados / ocultos SIEMPRE
    andFilters.push({
      or: [
        {
          property: "Archivado",
          checkbox: { equals: false },
        },
        {
          property: "Archivado",
          checkbox: { is_empty: true },
        },
      ],
    });

    andFilters.push({
      or: [
        {
          property: "Hide",
          checkbox: { equals: false },
        },
        {
          property: "Hide",
          checkbox: { is_empty: true },
        },
      ],
    });

    // filtros opcionales
    if (client && client !== "all") {
      andFilters.push({
        property: "ClientName",
        rich_text: { equals: client },
      });
    }

    if (project && project !== "all") {
      andFilters.push({
        property: "ProjectName",
        rich_text: { equals: project },
      });
    }

    if (brand && brand !== "all") {
      andFilters.push({
        property: "BrandName",
        rich_text: { equals: brand },
      });
    }

    if (platform && platform !== "all") {
      andFilters.push({
        property: "Platform",
        multi_select: { contains: platform },
      });
    }

    // STATUS:
    // Published Only → mostramos “Publicado”, “Aprobado”, “Entregado”, “Scheduled”
    // All Status → no filtramos
    if (status && status !== "all" && status !== "All Status") {
      andFilters.push({
        property: "Status",
        status: {
          equals: status,
        },
      });
    }

    // 3. query a Notion
    const queryPayload = {
      database_id: NOTION_DB_ID,
      page_size: Number(limit),
      sorts: [
        {
          property: "Publish Date",
          direction: "descending",
        },
      ],
    };

    if (andFilters.length > 0) {
      queryPayload.filter = { and: andFilters };
    }

    if (start_cursor) {
      queryPayload.start_cursor = start_cursor;
    }

    const notionRes = await notion.databases.query(queryPayload);

    // 4. procesar posts
    const posts = notionRes.results.map(processPost);

    // 5. construir platforms únicos (esto ya lo tenías)
    const platformsSet = new Set();
    posts.forEach((p) => {
      (p.platforms || []).forEach((pl) => platformsSet.add(pl));
    });

    // 6. CONTADORES (con cache)
    let counts = null;
    const now = Date.now();
    const cacheIsValid =
      FILTER_CACHE && now - FILTER_CACHE_TS < FILTER_CACHE_TTL;

    if (cacheIsValid) {
      counts = FILTER_CACHE;
    } else {
      // OJO: aquí estamos contando SOLO sobre los posts de ESTA query.
      // Para una cuenta de tooooda la DB necesitaríamos paginar,
      // pero eso lo dejamos para la versión 2.
      counts = buildCounts(posts);
      FILTER_CACHE = counts;
      FILTER_CACHE_TS = now;
    }

    // 7. respuesta
    return res.status(200).json({
      ok: true,
      posts,
      filters: {
        clients: counts.clients,
        projects: counts.projects,
        brands: counts.brands,
        platforms: Array.from(platformsSet),
        owners: counts.owners,
      },
      has_more: notionRes.has_more,
      next_cursor: notionRes.next_cursor || null,
      // esto es útil para depurar
      debug: {
        db: NOTION_DB_ID,
        filters_applied: andFilters,
      },
    });
  } catch (err) {
    console.error("Error in /api/grid:", err);
    return res.status(500).json({
      ok: false,
      error: err.message,
      posts: [],
      filters: {
        clients: [],
        projects: [],
        brands: [],
        platforms: [],
        owners: [],
      },
    });
  }
}
