import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN });

const DB_ID =
  process.env.NOTION_DB_ID ||
  process.env.NOTION_DATABASE_ID ||
  process.env.NOTION_DB_CONTENT;

// nombres reales que tienes en Notion ahora mismo
const ROLL_OR_REL_CLIENT = "PostClient";
const ROLL_OR_REL_BRAND = "PostBrands";
const ROLL_OR_REL_PROJECT = "PostProject"; // este lo vi como relation

// nombres “bonitos” por si mañana los creas
const ALT_ROLL_CLIENT = "ClientName";
const ALT_ROLL_BRAND = "BrandName";
const ALT_ROLL_PROJECT = "ProjectName";

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

const PUBLISHED_STATUSES = [
  "Publicado",
  "Entregado",
  "Scheduled",
  "Aprobado",
];

export default async function handler(req, res) {
  try {
    if (!process.env.NOTION_TOKEN || !DB_ID) {
      return res
        .status(500)
        .json({ ok: false, error: "Missing NOTION_TOKEN or NOTION_DB_ID" });
    }

    const {
      limit = 24,
      start_cursor,
      status = "all",
      platform,
      q,
      client,
      project,
      brand,
    } = req.query;

    const filter = buildFilter({
      status,
      platform,
      q,
      client,
      project,
      brand,
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

    // recolectar ids de relations por si alguno sí es relation
    const clientIds = new Set();
    const brandIds = new Set();
    const projectIds = new Set();

    const processed = pages
      .map((page) => {
        const props = page.properties || {};

        // ya vienen filtrados por hide/archive en el filter,
        // pero lo vuelvo a chequear por si acaso
        if (props[HIDE_KEY]?.checkbox) return null;
        if (props[ARCHIVE_KEY]?.checkbox) return null;

        // recolectar relations (por si PostProject sigue siendo relation)
        collectRelationIds(props[ROLL_OR_REL_CLIENT], clientIds);
        collectRelationIds(props[ROLL_OR_REL_BRAND], brandIds);
        collectRelationIds(props[ROLL_OR_REL_PROJECT], projectIds);

        return { id: page.id, props };
      })
      .filter(Boolean);

    // resolver nombres de las relaciones (solo las que sigan siendo relation)
    const clientNameById = await fetchPageNames(clientIds);
    const brandNameById = await fetchPageNames(brandIds);
    const projectNameById = await fetchPageNames(projectIds);

    // convertir a formato frontend
    const finalPosts = processed.map(({ id, props }) => {
      const title = getTitle(props);
      const date = getDate(props);
      const statusName = getStatus(props);
      const platforms = getPlatforms(props);
      const owner = getOwner(props);
      const pinned = props[PINNED_KEY]?.checkbox === true;
      const copy = getCopy(props);
      const assets = extractAssets(props);

      // 🔴 AQUÍ viene la parte que te dolía:
      // primero intento leer el ROLLUP con TU NOMBRE (PostClient),
      // si no, el alterno (ClientName),
      // si no, la relation.
      const clientName =
        getRollupText(props[ROLL_OR_REL_CLIENT]) ||
        getRollupText(props[ALT_ROLL_CLIENT]) ||
        getNameFromRelation(props[ROLL_OR_REL_CLIENT], clientNameById);

      const brandName =
        getRollupText(props[ROLL_OR_REL_BRAND]) ||
        getRollupText(props[ALT_ROLL_BRAND]) ||
        getNameFromRelation(props[ROLL_OR_REL_BRAND], brandNameById);

      const projectName =
        getRollupText(props[ROLL_OR_REL_PROJECT]) ||
        getRollupText(props[ALT_ROLL_PROJECT]) ||
        getNameFromRelation(props[ROLL_OR_REL_PROJECT], projectNameById);

      return {
        id,
        title,
        date,
        status: statusName,
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

    const filters = buildFiltersFromPosts(finalPosts);

    res.status(200).json({
      ok: true,
      posts: finalPosts,
      filters,
      has_more: resp.has_more,
      next_cursor: resp.next_cursor || null,
    });
  } catch (err) {
    console.error("GRID ERROR", err);
    res.status(500).json({
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

function buildFilter({ status, platform, q, client, project, brand }) {
  const and = [];

  // excluir hide
  and.push({
    or: [
      { property: HIDE_KEY, checkbox: { equals: false } },
      { property: HIDE_KEY, checkbox: { is_empty: true } },
    ],
  });

  // excluir archivado
  and.push({
    or: [
      { property: ARCHIVE_KEY, checkbox: { equals: false } },
      { property: ARCHIVE_KEY, checkbox: { is_empty: true } },
    ],
  });

  if (status !== "all") {
    and.push({
      or: PUBLISHED_STATUSES.map((s) => ({
        property: STATUS_KEY,
        status: { equals: s },
      })),
    });
  }

  if (platform && platform !== "all") {
    and.push({
      property: PLATFORM_KEY,
      multi_select: { contains: platform },
    });
  }

  // (opcional) si luego quieres filtrar por client desde la UI
  if (client && client !== "all") {
    // como tus client vienen como rollup/str, es más fácil filtrar en frontend
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

  const files = props[ATTACH_KEY]?.files || [];
  files.forEach((f) => {
    const url = f.file?.url || f.external?.url;
    if (url) {
      assets.push({ url, type: guessType(url), source: "attachment" });
    }
  });

  const linkUrl = props[LINK_KEY]?.url;
  if (linkUrl) {
    assets.push({ url: linkUrl, type: guessType(linkUrl), source: "link" });
  }

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

// lee rollup genérico (valido para PostClient cuando es rollup)
function getRollupText(prop) {
  if (!prop) return null;
  if (prop.type !== "rollup") return null;

  // casos típicos de rollup
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

  if (typeof prop.rollup?.number === "number") {
    return String(prop.rollup.number);
  }

  return null;
}

// si la prop es relation (como PostProject) buscamos en el map
function getNameFromRelation(prop, map) {
  if (!prop) return null;
  if (prop.type === "relation" && Array.isArray(prop.relation)) {
    const firstId = prop.relation[0]?.id;
    if (firstId && map[firstId]) return map[firstId];
    if (firstId) return firstId; // fallback
  }
  return null;
}

// recolecta ids de relations para luego resolver nombre
function collectRelationIds(prop, set) {
  if (!prop) return;
  if (prop.type === "relation" && Array.isArray(prop.relation)) {
    prop.relation.forEach((r) => set.add(r.id));
  }
}

// trae nombres de páginas relacionadas (cuando sí es relation)
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

// build filters from posts
function buildFiltersFromPosts(posts) {
  const clientCounts = {};
  const projectCounts = {};
  const brandCounts = {};
  const platforms = new Set();
  const owners = {};

  posts.forEach((p) => {
    if (p.client) {
      clientCounts[p.client] = (clientCounts[p.client] || 0) + 1;
    }
    if (p.project) {
      projectCounts[p.project] = (projectCounts[p.project] || 0) + 1;
    }
    if (p.brand) {
      brandCounts[p.brand] = (brandCounts[p.brand] || 0) + 1;
    }
    (p.platforms || []).forEach((pl) => platforms.add(pl));
    if (p.owner) {
      owners[p.owner] = (owners[p.owner] || 0) + 1;
    }
  });

  return {
    clients: Object.entries(clientCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    projects: Object.entries(projectCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    brands: Object.entries(brandCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    platforms: Array.from(platforms),
    owners: Object.entries(owners)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
  };
}
