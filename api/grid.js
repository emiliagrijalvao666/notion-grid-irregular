// /api/grid.js
// Widget Irregular — versión estable con Hide y Archivado separados
// Requiere:
//  - NOTION_TOKEN
//  - NOTION_DATABASE_ID   (o NOTION_DB_CONTENT como fallback)

export default async function handler(req, res) {
  // 1. ENV
  const notionToken =
    process.env.NOTION_TOKEN ||
    process.env.NOTION_SECRET || // por si acaso
    null;

  const dbId =
    process.env.NOTION_DATABASE_ID ||
    process.env.NOTION_DB_CONTENT ||
    process.env.NOTION_DB_ID ||
    null;

  if (!notionToken || !dbId) {
    return res.status(200).json({
      ok: false,
      error: "Missing NOTION_TOKEN or NOTION_DATABASE_ID",
      posts: [],
      filters: { clients: [], projects: [], brands: [], platforms: [], owners: [] },
    });
  }

  // 2. Leer query params
  const {
    limit = "12",
    cursor,
    status,
    client,
    project,
    brand,
    platform,
    owner,
    includeArchived,
    meta,
  } = req.query;

  // 3. Armar filtro base
  // SIEMPRE: ocultar los que están en Hide = true
  // SOLO si NO nos piden includeArchived: también ocultar Archivado = true
  const andFilter = [
    {
      property: "Hide",
      checkbox: { equals: false },
    },
  ];

  if (!includeArchived) {
    andFilter.push({
      property: "Archivado",
      checkbox: { equals: false },
    });
  }

  // 3.1 Filtros opcionales (solo si vienen en la URL)
  // Todos estos son best-effort porque depende de cómo se llamen EXACTO en tu DB
  if (status && status !== "all") {
    andFilter.push({
      property: "Status",
      status: { equals: status },
    });
  }

  if (client) {
    // aquí asumimos que ya tienes el rollup ClientName
    andFilter.push({
      property: "ClientName",
      rich_text: { equals: client },
    });
  }

  if (project) {
    andFilter.push({
      property: "ProjectName",
      rich_text: { equals: project },
    });
  }

  if (brand) {
    andFilter.push({
      property: "BrandName",
      rich_text: { equals: brand },
    });
  }

  if (platform) {
    // Platform es multi-select → contains
    andFilter.push({
      property: "Platform",
      multi_select: { contains: platform },
    });
  }

  if (owner) {
    andFilter.push({
      property: "Owner",
      people: { contains: owner },
    });
  }

  // 4. Construir body para Notion
  const body = {
    filter: {
      and: andFilter,
    },
    sorts: [
      // primero pineados
      {
        property: "Pinned",
        direction: "descending",
      },
      // luego por Publish Date desc
      {
        property: "Publish Date",
        direction: "descending",
      },
    ],
    page_size: parseInt(limit, 10),
  };

  if (cursor) {
    body.start_cursor = cursor;
  }

  try {
    // 5. Llamar a Notion
    const r = await fetch("https://api.notion.com/v1/databases/" + dbId + "/query", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${notionToken}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const json = await r.json();

    if (!r.ok) {
      // aquí estaba saliendo tu error de "body failed validation..."
      return res.status(200).json({
        ok: false,
        error: json?.message || "Notion query failed",
        detail: json,
        posts: [],
        filters: { clients: [], projects: [], brands: [], platforms: [], owners: [] },
      });
    }

    // 6. Procesar resultados → convertir Notion → formato widget
    const results = Array.isArray(json.results) ? json.results : [];
    const posts = results.map(mapNotionPageToWidget);

    // 7. Si nos pidieron meta=1 devolvemos contadores básicos (del lote actual)
    const filters = meta ? buildFiltersFromPosts(posts) : { clients: [], projects: [], brands: [], platforms: [], owners: [] };

    return res.status(200).json({
      ok: true,
      posts,
      filters,
      has_more: json.has_more,
      next_cursor: json.next_cursor || null,
    });
  } catch (err) {
    return res.status(200).json({
      ok: false,
      error: err.message,
      posts: [],
      filters: { clients: [], projects: [], brands: [], platforms: [], owners: [] },
    });
  }
}

/* ============================================================
    HELPERS
   ============================================================ */

function mapNotionPageToWidget(page) {
  const props = page.properties || {};

  // helpers para no repetir
  const getTitle = (p) =>
    (p?.title || []).map((t) => t.plain_text).join("") || "";

  const getRichText = (p) =>
    (p?.rich_text || []).map((t) => t.plain_text).join("") || "";

  const getSelect = (p) => p?.select?.name || null;

  const getMultiSelect = (p) => (p?.multi_select || []).map((t) => t.name);

  const getDate = (p) => p?.date?.start || null;

  // Rollups (ClientName, ProjectName, BrandName) pueden venir de varias formas,
  // hacemos el mismo patrón: texto plano
  const getRollupText = (p) => {
    if (!p) return null;
    // a veces viene como array de rich_text
    if (Array.isArray(p?.rollup?.array) && p.rollup.array.length > 0) {
      // agarrar el primero
      const first = p.rollup.array[0];
      if (first?.title) {
        return first.title.map((t) => t.plain_text).join("");
      }
      if (first?.rich_text) {
        return first.rich_text.map((t) => t.plain_text).join("");
      }
    }
    // a veces Notion ya lo entrega como plain_text en rich_text
    if (p?.rich_text) {
      return p.rich_text.map((t) => t.plain_text).join("");
    }
    return null;
  };

  // Assets: preferimos Attachment, pero tú a veces metes Link o Canva
  const assets = [];

  // 1) Attachment (files & media)
  if (props.Attachment && Array.isArray(props.Attachment.files)) {
    props.Attachment.files.forEach((f) => {
      if (f.external?.url) {
        assets.push({ url: f.external.url, type: guessAssetType(f.external.url), source: "attachment" });
      } else if (f.file?.url) {
        assets.push({ url: f.file.url, type: guessAssetType(f.file.url), source: "attachment" });
      }
    });
  }

  // 2) Link
  if (props.Link && props.Link.url) {
    assets.push({ url: props.Link.url, type: guessAssetType(props.Link.url), source: "link" });
  }

  // 3) Canva
  if (props.Canva && props.Canva.url) {
    assets.push({ url: props.Canva.url, type: guessAssetType(props.Canva.url), source: "canva" });
  }

  // Copy
  const copy = getRichText(props.Copy);

  return {
    id: page.id,
    title: getTitle(props.Post || props.Name || props.Title || props["Name/Post"]),
    date: getDate(props["Publish Date"] || props.Date),
    status: getSelect(props.Status),
    type: getSelect(props.Type),
    platforms: getMultiSelect(props.Platform),
    client: getRollupText(props.ClientName),
    project: getRollupText(props.ProjectName),
    brand: getRollupText(props.BrandName),
    owner: (props.Owner && props.Owner.people && props.Owner.people[0]?.name) || null,
    pinned: props.Pinned?.checkbox === true,
    archived: props.Archivado?.checkbox === true,
    hidden: props.Hide?.checkbox === true,
    copy,
    assets,
  };
}

function guessAssetType(url) {
  if (!url) return "image";
  const lower = url.toLowerCase();
  if (lower.includes(".mp4") || lower.includes("video")) return "video";
  return "image";
}

function buildFiltersFromPosts(posts) {
  const countBy = (key) => {
    const map = new Map();
    posts.forEach((p) => {
      const val = p[key];
      if (!val) return;
      // algunos campos son array (platforms)
      if (Array.isArray(val)) {
        val.forEach((v) => {
          map.set(v, (map.get(v) || 0) + 1);
        });
      } else {
        map.set(val, (map.get(val) || 0) + 1);
      }
    });
    // ordenar desc por count
    const arr = Array.from(map.entries()).map(([name, count]) => ({ name, count }));
    arr.sort((a, b) => b.count - a.count);
    return arr;
  };

  return {
    clients: countBy("client"),
    projects: countBy("project"),
    brands: countBy("brand"),
    platforms: countBy("platforms"),
    owners: countBy("owner"),
  };
}
