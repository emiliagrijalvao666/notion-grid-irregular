// api/grid.js
import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN });

const DB_ID =
  process.env.NOTION_DB_ID ||
  process.env.NOTION_DATABASE_ID ||
  process.env.NOTION_DB_CONTENT ||
  process.env.NOTION_CONTENT_DB_ID;

// cache simple en memoria para no pedir mil veces el mismo relation
const relationCache = {
  byId: {}, // { "page_id": "Nombre bonito" }
};

// helper: obtiene el name/title de una página relacionada
async function getRelationName(pageId) {
  if (!pageId) return null;
  if (relationCache.byId[pageId]) return relationCache.byId[pageId];

  try {
    const page = await notion.pages.retrieve({ page_id: pageId });
    // 1) si tiene propiedad Name
    const props = page.properties || {};
    // busca una propiedad de tipo title
    const titleProp = Object.values(props).find((p) => p.type === "title");
    let name = null;
    if (titleProp && Array.isArray(titleProp.title) && titleProp.title[0]) {
      name = titleProp.title[0].plain_text;
    }
    // fallback al título de la página
    if (!name && page.object === "page" && page.id) {
      name = `Item ${page.id.slice(0, 6)}`;
    }
    relationCache.byId[pageId] = name;
    return name;
  } catch (e) {
    console.warn("cannot fetch relation name", pageId, e.message);
    return null;
  }
}

export default async function handler(req, res) {
  // 0. validar env
  if (!process.env.NOTION_TOKEN || !DB_ID) {
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

  // 1. leer query del front
  const {
    status, // "Published Only" | "All Status"
    client, // nombre de cliente que eligió el user
    project,
    brand,
    platform,
    owner,
    cursor,
    limit,
  } = req.query;

  // 2. SIEMPRE filtrar hide / archivado en Notion
  const baseFilters = [
    {
      or: [
        { property: "Hide", checkbox: { equals: false } },
        { property: "Hide", checkbox: { is_empty: true } },
      ],
    },
    {
      or: [
        { property: "Archivado", checkbox: { equals: false } },
        { property: "Archivado", checkbox: { is_empty: true } },
      ],
    },
  ];

  // 3. status: si el front NO dice "All Status", filtramos a publicados
  const wantsAllStatus =
    status && (status === "All Status" || status === "all" || status === "all-status");

  if (!wantsAllStatus) {
    baseFilters.push({
      or: [
        { property: "Status", status: { equals: "Publicado" } },
        { property: "Status", status: { equals: "Aprobado" } },
        { property: "Status", status: { equals: "Scheduled" } },
        { property: "Status", status: { equals: "Entregado" } },
      ],
    });
  }

  // 4. query a Notion (solo con los filtros que SÍ sabe hacer Notion)
  const body = {
    database_id: DB_ID,
    filter: { and: baseFilters },
    sorts: [
      {
        property: "Publish Date",
        direction: "descending",
      },
    ],
    page_size: limit ? Number(limit) : 50,
  };

  if (cursor) {
    body.start_cursor = cursor;
  }

  let notionResp;
  try {
    notionResp = await notion.databases.query(body);
  } catch (err) {
    console.error("Notion query error:", err.body || err.message);
    return res.status(200).json({
      ok: false,
      error: err.body?.message || err.message,
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

  const rawPages = notionResp.results || [];

  // 5. transformar pages → posts
  // aquí también vamos a construir los filtros
  const clientsSet = new Map(); // name -> count
  const projectsSet = new Map();
  const brandsSet = new Map();
  const platformsSet = new Map();
  const ownersSet = new Map();

  // como las relations vienen con IDs, primero recogemos TODOS los ids
  const relationIdsToFetch = new Set();

  for (const page of rawPages) {
    const props = page.properties || {};

    // relations crudas
    const postClient = props["PostClient"]?.relation || [];
    const postBrands = props["PostBrands"]?.relation || [];
    const postProject = props["PostProject"]?.relation || [];

    postClient.forEach((r) => relationIdsToFetch.add(r.id));
    postBrands.forEach((r) => relationIdsToFetch.add(r.id));
    postProject.forEach((r) => relationIdsToFetch.add(r.id));
  }

  // 5.1. fetch de nombres de relations que todavía no tenemos en cache
  const toFetch = Array.from(relationIdsToFetch).filter(
    (id) => !relationCache.byId[id]
  );

  // NOTA: esto lo hacemos en serie simple para no pegarle demasiado a Notion
  for (const id of toFetch) {
    // eslint-disable-next-line no-await-in-loop
    await getRelationName(id);
  }

  // 6. ahora sí: armar lista de posts ya con nombres
  const posts = [];

  for (const page of rawPages) {
    const props = page.properties || {};
    const titleProp = props["Name"] || props["Post"] || props["Title"];
    const title =
      (titleProp &&
        titleProp.title &&
        titleProp.title[0] &&
        titleProp.title[0].plain_text) ||
      "Untitled";

    const dateProp = props["Publish Date"] || props["Date"] || null;
    const date =
      dateProp && dateProp.date ? dateProp.date.start : null;

    const statusProp = props["Status"] || null;
    const statusVal =
      statusProp && statusProp.status ? statusProp.status.name : null;

    // relations → nombres
    const postClient = props["PostClient"]?.relation || [];
    const clientNames = postClient
      .map((r) => relationCache.byId[r.id])
      .filter(Boolean);

    const postProject = props["PostProject"]?.relation || [];
    const projectNames = postProject
      .map((r) => relationCache.byId[r.id])
      .filter(Boolean);

    const postBrands = props["PostBrands"]?.relation || [];
    const brandNames = postBrands
      .map((r) => relationCache.byId[r.id])
      .filter(Boolean);

    // platforms
    const platformProp = props["Platform"] || props["Platforms"];
    const platforms =
      platformProp && platformProp.multi_select
        ? platformProp.multi_select.map((p) => p.name)
        : [];

    // owner
    const ownerProp = props["Owner"] || props["Asignado a"] || null;
    const ownerName =
      ownerProp && ownerProp.people && ownerProp.people[0]
        ? ownerProp.people[0].name
        : ownerProp && ownerProp.rich_text
        ? ownerProp.rich_text.map((t) => t.plain_text).join(" ")
        : null;

    // assets
    const assetsProp =
      props["Assets"] || props["Link"] || props["Attachment"] || null;
    let assets = [];
    if (assetsProp?.files) {
      assets = assetsProp.files.map((f) => ({
        url: f.file ? f.file.url : f.external ? f.external.url : "",
        type: "image",
        source: "attachment",
      }));
    }

    // 6.1 FILTRO EN MEMORIA (porque Notion no filtra por nombre de relation)
    // client
    if (client && client !== "all") {
      if (!clientNames.includes(client)) {
        continue; // saltar este post
      }
    }
    // project
    if (project && project !== "all") {
      if (!projectNames.includes(project)) {
        continue;
      }
    }
    // brand
    if (brand && brand !== "all") {
      if (!brandNames.includes(brand)) {
        continue;
      }
    }
    // platform
    if (platform && platform !== "all") {
      if (!platforms.includes(platform)) {
        continue;
      }
    }
    // owner
    if (owner && owner !== "all") {
      if (ownerName !== owner) {
        continue;
      }
    }

    // crear el post que va al front
    posts.push({
      id: page.id,
      title,
      date,
      status: statusVal,
      clients: clientNames,
      projects: projectNames,
      brands: brandNames,
      platforms,
      owner: ownerName,
      assets,
    });

    // alimentar filtros
    clientNames.forEach((n) => {
      clientsSet.set(n, (clientsSet.get(n) || 0) + 1);
    });
    projectNames.forEach((n) => {
      projectsSet.set(n, (projectsSet.get(n) || 0) + 1);
    });
    brandNames.forEach((n) => {
      brandsSet.set(n, (brandsSet.get(n) || 0) + 1);
    });
    platforms.forEach((n) => {
      platformsSet.set(n, (platformsSet.get(n) || 0) + 1);
    });
    if (ownerName) {
      ownersSet.set(ownerName, (ownersSet.get(ownerName) || 0) + 1);
    }
  }

  // 7. armar filtros ordenados
  const toArr = (map) =>
    Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

  const filters = {
    clients: toArr(clientsSet),
    projects: toArr(projectsSet),
    brands: toArr(brandsSet),
    platforms: toArr(platformsSet),
    owners: toArr(ownersSet),
  };

  return res.status(200).json({
    ok: true,
    posts,
    filters,
    has_more: notionResp.has_more,
    next_cursor: notionResp.next_cursor || null,
  });
}
