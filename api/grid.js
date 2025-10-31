// /api/grid.js
import { Client } from "@notionhq/client";

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DB_ID = process.env.NOTION_DB_ID;

export default async function handler(req, res) {
  if (!NOTION_TOKEN || !NOTION_DB_ID) {
    return res.status(200).json({
      ok: false,
      error: "Missing NOTION_TOKEN or NOTION_DB_ID",
    });
  }

  const notion = new Client({ auth: NOTION_TOKEN });

  const {
    client,
    project,
    brand,
    platform,
    status,
    q,
    cursor,
    limit = 12,
    meta,
  } = req.query;

  // armamos filtro base
  const andFilters = [
    // NO archivados
    {
      property: "Archivado",
      checkbox: { equals: false },
    },
    // NO ocultos
    {
      property: "Hide",
      checkbox: { equals: false },
    },
  ];

  // status
  const publishedSet = ["Publicado", "Entregado", "Scheduled", "Aprobado"];

  if (status && status !== "all") {
    // Published Only
    andFilters.push({
      property: "Status",
      status: {
        contains: "", // ponemos contains en blanco y luego filtramos en memoria
      },
    });
  }

  // client rollup
  if (client && client !== "all") {
    andFilters.push({
      property: "ClientName",
      rich_text: { equals: client },
    });
  }

  // project rollup
  if (project && project !== "all") {
    andFilters.push({
      property: "ProjectName",
      rich_text: { equals: project },
    });
  }

  // brand rollup
  if (brand && brand !== "all") {
    andFilters.push({
      property: "BrandName",
      rich_text: { equals: brand },
    });
  }

  // platform (multi-select)
  if (platform && platform !== "all") {
    andFilters.push({
      property: "Platform",
      multi_select: {
        contains: platform,
      },
    });
  }

  // search (lo haremos en memoria si quieres, pero probemos así)
  // Notion search con rich_text
  if (q) {
    andFilters.push({
      property: "Post",
      title: {
        contains: q,
      },
    });
  }

  try {
    const query = {
      database_id: NOTION_DB_ID,
      filter: {
        and: andFilters,
      },
      sorts: [
        {
          property: "Publish Date",
          direction: "descending",
        },
      ],
      page_size: Number(limit),
    };

    if (cursor) {
      query.start_cursor = cursor;
    }

    const resp = await notion.databases.query(query);

    const posts = resp.results.map((page) => {
      const props = page.properties;

      // helpers
      const title =
        (props.Post?.title || props.Name?.title || [])
          .map((t) => t.plain_text)
          .join("") || "Sin título";

      const date =
        props["Publish Date"]?.date?.start ||
        props["Fecha"]?.date?.start ||
        null;

      const statusName = props.Status?.status?.name || null;

      const platforms =
        props.Platform?.multi_select?.map((p) => p.name) || [];

      // rollups legibles
      const clientName = extractRichText(props.ClientName);
      const projectName = extractRichText(props.ProjectName);
      const brandName = extractRichText(props.BrandName);

      // owner (person)
      const owner =
        props.Owner?.people?.[0]?.name ||
        props.Owner?.people?.[0]?.person?.email ||
        null;

      // pinned
      const pinned = props.Pinned?.checkbox || false;

      // copy
      const copy =
        (props.Copy?.rich_text || [])
          .map((t) => t.plain_text)
          .join("") || "";

      // assets
      const assets = extractAssets(props);

      return {
        id: page.id,
        title,
        date,
        status: statusName,
        platforms,
        client: clientName,
        project: projectName,
        brand: brandName,
        owner,
        pinned,
        archived: props.Archivado?.checkbox || false,
        hidden: props.Hide?.checkbox || false,
        copy,
        assets,
      };
    });

    // si pidió solo published
    let finalPosts = posts;
    if (status && status !== "all") {
      finalPosts = posts.filter((p) => publishedSet.includes(p.status));
    }

    // si pidió solo meta
    if (meta === "1") {
      const filters = buildFiltersFromPosts(finalPosts);
      return res.status(200).json({
        ok: true,
        posts: [],
        filters,
        has_more: resp.has_more,
        next_cursor: resp.next_cursor || null,
      });
    }

    const filters = buildFiltersFromPosts(finalPosts);

    return res.status(200).json({
      ok: true,
      posts: finalPosts,
      filters,
      has_more: resp.has_more,
      next_cursor: resp.next_cursor || null,
      debug: {
        nameKey: "Post",
        dateKey: "Publish Date",
        statusKey: "Status",
        clientRollKey: "ClientName",
        brandRollKey: "BrandName",
        projectRollKey: "ProjectName",
        attachKey: "Attachment",
        copyKey: "Copy",
        ownerKey: "Owner",
        platformKey: "Platform",
        pinnedKey: "Pinned",
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(200).json({
      ok: false,
      error: err.message,
    });
  }
}

function extractRichText(prop) {
  if (!prop) return null;
  if (Array.isArray(prop.rich_text)) {
    return prop.rich_text.map((t) => t.plain_text).join("") || null;
  }
  if (Array.isArray(prop.rollup?.array)) {
    // a veces Notion manda rollup como array de rich_text
    const first = prop.rollup.array[0];
    if (first?.title) {
      return first.title.map((t) => t.plain_text).join("");
    }
  }
  return null;
}

function extractAssets(props) {
  // prioridad 1: Attachment (files)
  if (props.Attachment?.files?.length) {
    return props.Attachment.files.map((f) => ({
      url: f.file?.url || f.external?.url,
      type: guessAssetType(f.file?.url || f.external?.url),
      source: "attachment",
    }));
  }

  // prioridad 2: Link (url)
  if (props.Link?.url) {
    return [
      {
        url: props.Link.url,
        type: guessAssetType(props.Link.url),
        source: "link",
      },
    ];
  }

  // prioridad 3: Canva
  if (props.Canva?.url) {
    return [
      {
        url: props.Canva.url,
        type: "image",
        source: "canva",
      },
    ];
  }

  return [];
}

function guessAssetType(url) {
  if (!url) return "image";
  const lower = url.toLowerCase();
  if (lower.endsWith(".mp4") || lower.includes("video")) return "video";
  return "image";
}

function buildFiltersFromPosts(posts) {
  const clients = new Set();
  const projects = new Set();
  const brands = new Set();
  const platforms = new Set();
  const ownersMap = new Map();

  posts.forEach((p) => {
    if (p.client) clients.add(p.client);
    if (p.project) projects.add(p.project);
    if (p.brand) brands.add(p.brand);
    (p.platforms || []).forEach((pl) => platforms.add(pl));
    if (p.owner) {
      if (!ownersMap.has(p.owner)) {
        ownersMap.set(p.owner, 1);
      } else {
        ownersMap.set(p.owner, ownersMap.get(p.owner) + 1);
      }
    }
  });

  // owners con color
  const OWNER_COLORS = [
    "#10B981",
    "#8B5CF6",
    "#EC4899",
    "#F59E0B",
    "#3B82F6",
    "#EF4444",
    "#FCD34D",
    "#14B8A6",
  ];

  const owners = Array.from(ownersMap.entries()).map(
    ([name, count], idx) => ({
      name,
      color: OWNER_COLORS[idx % OWNER_COLORS.length],
      initials: name.substring(0, 2).toUpperCase(),
      count,
    })
  );

  return {
    clients: Array.from(clients),
    projects: Array.from(projects),
    brands: Array.from(brands),
    platforms: Array.from(platforms),
    owners,
  };
}
