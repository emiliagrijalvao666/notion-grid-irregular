import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN });

const DB_ID =
  process.env.NOTION_DB_ID ||
  process.env.NOTION_DATABASE_ID ||
  process.env.NOTION_DB_CONTENT;

// 🔒 NOMBRES REALES DE TU DB
const NAME_KEY = "Name";
const DATE_KEY = "Publish Date";
const STATUS_KEY = "Status";
const PLATFORM_KEY = "Platform";
const OWNER_KEY = "Owner";
const HIDE_KEY = "Hide";
const ARCHIVE_KEY = "Archivado";
const PINNED_KEY = "Pinned";
const ATTACH_KEY = "Attachment";
const LINK_KEY = "Link";
const CANVA_KEY = "Canva";
const COPY_KEY = "Copy";

// relations / rollups
const REL_CLIENT = "PostClient";
const REL_BRAND = "PostBrands";
const REL_PROJECT = "PostProject";

// rollups alternos (si los creas)
const ROLL_CLIENT = "ClientName";
const ROLL_BRAND = "BrandName";
const ROLL_PROJECT = "ProjectName";

// ✅ tu lista OFICIAL de platforms
const PLATFORM_OPTIONS = [
  "Tiktok",
  "Instagram",
  "Youtube",
  "Facebook",
  "Página web",
  "Pantalla",
];

// ✅ tu lista OFICIAL de status (ALL)
const STATUS_ALL = [
  "Draft",
  "Idea",
  "Archivado",
  "Diseño",
  "Scripting",
  "On Hold",
  "En Revisión",
  "Production",
  "Raw",
  "Editing",
  "Corregir",
  "Aprobado",
  "Scheduled",
  "Entregado",
  "Publicado",
];

// ✅ tu lista OFICIAL de publicados
const STATUS_PUBLISHED = ["Publicado", "Entregado", "Scheduled", "Aprobado"];

// paleta para owners
const OWNER_COLORS = [
  "#10B981", // verde
  "#8B5CF6", // morado
  "#EC4899", // rosa
  "#F59E0B", // naranja
  "#3B82F6", // azul
  "#EF4444", // rojo
  "#FCD34D", // amarillo
  "#14B8A6", // teal
  "#A855F7", // púrpura
  "#22C55E", // lima
];

export default async function handler(req, res) {
  try {
    if (!process.env.NOTION_TOKEN || !DB_ID) {
      return res.status(500).json({
        ok: false,
        error: "Missing NOTION_TOKEN or NOTION_DB_ID",
      });
    }

    const {
      limit = 24,
      start_cursor,
      status = "all",
      platform,
      client,
      project,
      brand,
      q,
    } = req.query;

    // 🧠 construir filtro
    const filter = buildFilter({
      status,
      platform,
    });

    const resp = await notion.databases.query({
      database_id: DB_ID,
      filter,
      sorts: [
        { property: PINNED_KEY, direction: "descending" },
        { property: DATE_KEY, direction: "descending" },
      ],
      page_size: Number(limit),
      start_cursor: start_cursor || undefined,
    });

    const pages = resp.results || [];

    // recolectar ids de relations para luego pedir sus nombres
    const clientIds = new Set();
    const brandIds = new Set();
    const projectIds = new Set();

    const rawPosts = pages
      .map((page) => {
        const props = page.properties || {};

        // doble seguridad (ya filtramos en query pero por si acaso)
        if (props[HIDE_KEY]?.checkbox === true) return null;
        if (props[ARCHIVE_KEY]?.checkbox === true) return null;

        collectRelationIds(props[REL_CLIENT], clientIds);
        collectRelationIds(props[REL_BRAND], brandIds);
        collectRelationIds(props[REL_PROJECT], projectIds);

        return { id: page.id, props };
      })
      .filter(Boolean);

    // pedir nombres de relations
    const clientNameById = await fetchPageNames(clientIds);
    const brandNameById = await fetchPageNames(brandIds);
    const projectNameById = await fetchPageNames(projectIds);

    // convertir a formato frontend
    const posts = rawPosts.map(({ id, props }) => {
      const title = getTitle(props);
      const date = getDate(props);
      const st = getStatus(props);
      const platforms = getPlatforms(props);
      const owner = getOwner(props);
      const pinned = props[PINNED_KEY]?.checkbox === true;
      const copy = getCopy(props);
      const assets = extractAssets(props);

      // client
      const clientName =
        getRollupText(props[ROLL_CLIENT]) ||
        getNameFromRelation(props[REL_CLIENT], clientNameById);

      // brand
      const brandName =
        getRollupText(props[ROLL_BRAND]) ||
        getNameFromRelation(props[REL_BRAND], brandNameById);

      // project
      const projectName =
        getRollupText(props[ROLL_PROJECT]) ||
        getNameFromRelation(props[REL_PROJECT], projectNameById);

      return {
        id,
        title,
        date,
        status: st,
        type: props.Type?.select?.name || null,
        platforms,
        client: clientName,
        project: projectName,
        brand: brandName,
        owner,
        pinned,
        archived: false,
        hidden: false,
        copy,
        assets,
      };
    });

    // construir filtros dinámicos (con contadores)
    const filters = buildFiltersFromPosts(posts);

    // ⚠️ aplicar filtros del query (client / project / brand) DEL LADO DEL SERVER
    const filteredPosts = posts.filter((p) => {
      if (client && client !== "all" && p.client !== client) return false;
      if (project && project !== "all" && p.project !== project) return false;
      if (brand && brand !== "all" && p.brand !== brand) return false;
      if (q && q.trim()) {
        const qq = q.toLowerCase();
        const inTitle = p.title?.toLowerCase().includes(qq);
        const inCopy = p.copy?.toLowerCase().includes(qq);
        if (!inTitle && !inCopy) return false;
      }
      return true;
    });

    return res.status(200).json({
      ok: true,
      posts: filteredPosts,
      filters,
      has_more: resp.has_more,
      next_cursor: resp.next_cursor || null,
    });
  } catch (err) {
    console.error("GRID ERROR", err);
    return res.status(500).json({
      ok: false,
      error: err.message,
      posts: [],
      filters: {
        clients: [],
        projects: [],
        brands: [],
        platforms: PLATFORM_OPTIONS,
        owners: [],
        statuses: {
          published: STATUS_PUBLISHED,
          all: STATUS_ALL,
        },
      },
    });
  }
}

/**
 * Construye el filtro PRINCIPAL para Notion
 * - siempre excluye Hide y Archivado
 * - status: published only vs all
 * - platform: opcional
 */
function buildFilter({ status, platform }) {
  const and = [];

  // excluir HIDE
  and.push({
    or: [
      { property: HIDE_KEY, checkbox: { equals: false } },
      { property: HIDE_KEY, checkbox: { does_not_equal: true } },
    ],
  });

  // excluir ARCHIVADO
  and.push({
    or: [
      { property: ARCHIVE_KEY, checkbox: { equals: false } },
      { property: ARCHIVE_KEY, checkbox: { does_not_equal: true } },
    ],
  });

  // published only
  if (status !== "all") {
    and.push({
      or: STATUS_PUBLISHED.map((s) => ({
        property: STATUS_KEY,
        status: { equals: s },
      })),
    });
  }

  // platform
  if (platform && platform !== "all") {
    and.push({
      property: PLATFORM_KEY,
      multi_select: { contains: platform },
    });
  }

  if (and.length === 1) return and[0];
  return { and };
}

function getTitle(props) {
  const t = props[NAME_KEY]?.title || [];
  return t.map((p) => p.plain_text).join("") || "Untitled";
}

function getDate(props) {
  return props[DATE_KEY]?.date?.start || null;
}

function getStatus(props) {
  return props[STATUS_KEY]?.status?.name || null;
}

function getPlatforms(props) {
  return (
    props[PLATFORM_KEY]?.multi_select?.map((p) => p.name).filter(Boolean) || []
  );
}

function getOwner(props) {
  const people = props[OWNER_KEY]?.people || [];
  if (people.length) return people[0].name || null;
  return null;
}

function getCopy(props) {
  const rt = props[COPY_KEY]?.rich_text || [];
  return rt.map((t) => t.plain_text).join("") || "";
}

function extractAssets(props) {
  const assets = [];

  // files
  const files = props[ATTACH_KEY]?.files || [];
  files.forEach((f) => {
    const url = f.file?.url || f.external?.url;
    if (url) {
      assets.push({ url, type: guessType(url), source: "attachment" });
    }
  });

  // link
  const linkUrl = props[LINK_KEY]?.url;
  if (linkUrl) {
    assets.push({ url: linkUrl, type: guessType(linkUrl), source: "link" });
  }

  // canva
  const canvaUrl = props[CANVA_KEY]?.url;
  if (canvaUrl) {
    assets.push({ url: canvaUrl, type: "image", source: "canva" });
  }

  if (!assets.length) {
    assets.push({ url: null, type: "none", source: "none" });
  }

  return assets;
}

function guessType(url) {
  if (!url) return "image";
  const l = url.toLowerCase();
  if (l.endsWith(".mp4") || l.includes("video")) return "video";
  return "image";
}

// ---------- rollups / relations helpers ----------

function getRollupText(prop) {
  if (!prop) return null;
  if (prop.type !== "rollup") return null;

  // típico rollup de relation->name
  if (prop.rollup?.array?.length) {
    const first = prop.rollup.array[0];
    if (first?.title?.length) {
      return first.title.map((t) => t.plain_text).join("");
    }
    if (first?.rich_text?.length) {
      return first.rich_text.map((t) => t.plain_text).join("");
    }
  }

  if (prop.rollup?.rich_text?.length) {
    return prop.rollup.rich_text.map((t) => t.plain_text).join("");
  }

  return null;
}

function collectRelationIds(prop, set) {
  if (!prop) return;
  if (prop.type === "relation" && Array.isArray(prop.relation)) {
    prop.relation.forEach((r) => set.add(r.id));
  }
}

async function fetchPageNames(idSet) {
  const map = {};
  const ids = Array.from(idSet);
  for (const id of ids) {
    try {
      const page = await notion.pages.retrieve({ page_id: id });
      const titleProp = page.properties?.Name?.title || [];
      const name = titleProp.map((t) => t.plain_text).join("");
      map[id] = name || id;
    } catch (e) {
      map[id] = id;
    }
  }
  return map;
}

function getNameFromRelation(prop, map) {
  if (!prop) return null;
  if (prop.type === "relation" && Array.isArray(prop.relation)) {
    const firstId = prop.relation[0]?.id;
    if (firstId && map[firstId]) return map[firstId];
    // fallback: mostrar el id
    if (firstId) return firstId;
  }
  return null;
}

// ---------- build filters / owners with colors ----------

function buildFiltersFromPosts(posts) {
  const clientCounts = {};
  const projectCounts = {};
  const brandCounts = {};
  const ownerCounts = {};

  posts.forEach((p) => {
    if (p.client) clientCounts[p.client] = (clientCounts[p.client] || 0) + 1;
    if (p.project) projectCounts[p.project] = (projectCounts[p.project] || 0) + 1;
    if (p.brand) brandCounts[p.brand] = (brandCounts[p.brand] || 0) + 1;
    if (p.owner) ownerCounts[p.owner] = (ownerCounts[p.owner] || 0) + 1;
  });

  // ordenar por cantidad
  const clients = Object.entries(clientCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  const projects = Object.entries(projectCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  const brands = Object.entries(brandCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  const ownerEntries = Object.entries(ownerCounts).sort(
    (a, b) => b[1] - a[1]
  );

  const owners = ownerEntries.map(([name, count], idx) => ({
    name,
    count,
    color: OWNER_COLORS[idx % OWNER_COLORS.length],
    initials: getInitials(name),
  }));

  return {
    clients,
    projects,
    brands,
    platforms: PLATFORM_OPTIONS,
    owners,
    statuses: {
      published: STATUS_PUBLISHED,
      all: STATUS_ALL,
    },
  };
}

function getInitials(name) {
  if (!name) return "??";
  return name.substring(0, 2).toUpperCase();
}
