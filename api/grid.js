// /api/grid.js
import { Client } from "@notionhq/client";

const NOTION_TOKEN = process.env.NOTION_TOKEN;
// ← AQUÍ el multi-fallback
const NOTION_DB_ID =
  process.env.NOTION_DATABASE_ID ||
  process.env.NOTION_DB_ID ||
  process.env.NOTION_DB_CONTENT;

const notion = new Client({ auth: NOTION_TOKEN });

export default async function handler(req, res) {
  // 1. validación súper clara
  if (!NOTION_TOKEN || !NOTION_DB_ID) {
    return res.status(500).json({
      ok: false,
      error: "Missing NOTION_TOKEN or NOTION_DB_ID",
      debug: {
        hasToken: !!NOTION_TOKEN,
        hasDb: !!NOTION_DB_ID,
        envSeen: Object.keys(process.env).filter((k) =>
          k.startsWith("NOTION")
        ),
      },
    });
  }

  const {
    client,
    project,
    brand,
    platform,
    status,
    q,
    limit = 12,
    cursor,
    meta,
  } = req.query;

  try {
    // armamos el filtro base
    const filters = [
      {
        property: "Hide",
        checkbox: { equals: false },
      },
      {
        property: "Archivado",
        checkbox: { equals: false },
      },
    ];

    // status logic
    if (status && status !== "all" && status !== "All Status") {
      // published only
      filters.push({
        property: "Status",
        status: {
          contains: "",
        },
      });
      // tu lógica de published-only la puedes afinar aquí
    }

    if (client && client !== "all") {
      filters.push({
        property: "ClientName",
        rich_text: { equals: client },
      });
    }

    if (project && project !== "all") {
      filters.push({
        property: "ProjectName",
        rich_text: { equals: project },
      });
    }

    if (brand && brand !== "all") {
      filters.push({
        property: "BrandName",
        rich_text: { equals: brand },
      });
    }

    if (platform && platform !== "all") {
      filters.push({
        property: "Platform",
        multi_select: { contains: platform },
      });
    }

    if (q) {
      filters.push({
        property: "Post",
        title: { contains: q },
      });
    }

    const query = {
      database_id: NOTION_DB_ID,
      filter: { and: filters },
      sorts: [
        {
          property: "Publish Date",
          direction: "descending",
        },
      ],
      page_size: Number(limit) || 12,
    };

    if (cursor) {
      query.start_cursor = cursor;
    }

    const response = await notion.databases.query(query);

    const posts = response.results.map((page) => mapPost(page));

    // si solo quieren meta
    if (meta === "1") {
      return res.status(200).json({
        ok: true,
        filters: buildFilters(posts),
      });
    }

    return res.status(200).json({
      ok: true,
      posts,
      has_more: response.has_more,
      next_cursor: response.next_cursor || null,
    });
  } catch (err) {
    console.error("NOTION ERROR", err.body || err);
    return res.status(500).json({
      ok: false,
      error: "Notion query failed",
      detail: err.body || err.message,
    });
  }
}

function mapPost(page) {
  const props = page.properties || {};
  const title =
    (props.Post?.title || props.Name?.title || [])
      .map((t) => t.plain_text)
      .join("") || "Untitled";

  const date =
    props["Publish Date"]?.date?.start || props["Fecha"]?.date?.start || null;

  const status = props.Status?.status?.name || null;

  const client =
    props.ClientName?.rich_text?.map((t) => t.plain_text).join("") || null;

  const project =
    props.ProjectName?.rich_text?.map((t) => t.plain_text).join("") || null;

  const brand =
    props.BrandName?.rich_text?.map((t) => t.plain_text).join("") || null;

  const owner = props.Owner?.people?.[0]?.name || null;

  const copy = (props.Copy?.rich_text || [])
    .map((t) => t.plain_text)
    .join("");

  const platforms =
    props.Platform?.multi_select?.map((p) => p.name) || [];

  const assets = extractAssets(props);

  return {
    id: page.id,
    title,
    date,
    status,
    client,
    project,
    brand,
    owner,
    platforms,
    copy,
    pinned: props.Pinned?.checkbox || false,
    archived: props.Archivado?.checkbox || false,
    hidden: props.Hide?.checkbox || false,
    assets,
  };
}

function extractAssets(props) {
  // soportar Attachment, Link, Canva
  const out = [];

  const att = props.Attachment?.files || props.Attachments?.files;
  if (att && att.length) {
    att.forEach((f) => {
      out.push({
        url: f.external?.url || f.file?.url,
        type: "image",
        source: "attachment",
      });
    });
  }

  const link = props.Link?.url;
  if (link) {
    out.push({
      url: link,
      type: "image",
      source: "link",
    });
  }

  const canva = props.Canva?.url;
  if (canva) {
    out.push({
      url: canva,
      type: "image",
      source: "canva",
    });
  }

  return out;
}

function buildFilters(posts) {
  const clients = new Set();
  const projects = new Set();
  const brands = new Set();
  const owners = new Map();

  posts.forEach((p) => {
    if (p.client) clients.add(p.client);
    if (p.project) projects.add(p.project);
    if (p.brand) brands.add(p.brand);
    if (p.owner) {
      const prev = owners.get(p.owner) || 0;
      owners.set(p.owner, prev + 1);
    }
  });

  return {
    clients: Array.from(clients),
    projects: Array.from(projects),
    brands: Array.from(brands),
    platforms: [
      "Instagram",
      "Tiktok",
      "Youtube",
      "Facebook",
      "Página web",
      "Pantalla",
    ],
    owners: Array.from(owners.entries()).map(([name, count], i) => ({
      name,
      count,
      color: ownerColor(i),
      initials: name.slice(0, 2).toUpperCase(),
    })),
  };
}

function ownerColor(i) {
  const COLORS = [
    "#10B981",
    "#8B5CF6",
    "#EC4899",
    "#F59E0B",
    "#3B82F6",
    "#EF4444",
    "#FCD34D",
    "#14B8A6",
  ];
  return COLORS[i % COLORS.length];
}
