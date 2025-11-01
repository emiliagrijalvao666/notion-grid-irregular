// /api/grid.js
import { Client } from "@notionhq/client";

export default async function handler(req, res) {
  // 1. leer las env que YA tienes en Vercel
  const NOTION_TOKEN = process.env.NOTION_TOKEN;
  const NOTION_DB_ID =
    process.env.NOTION_DB_ID ||
    process.env.NOTION_DATABASE_ID || // así la tienes en Vercel
    null;

  if (!NOTION_TOKEN || !NOTION_DB_ID) {
    return res.status(500).json({
      ok: false,
      error: "Missing NOTION_TOKEN or NOTION_DB_ID",
    });
  }

  // 2. client de Notion
  const notion = new Client({ auth: NOTION_TOKEN });

  // 3. leer filtros que manda el front
  let body = {};
  if (req.method === "POST") {
    try {
      body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    } catch (e) {
      body = {};
    }
  }

  const {
    client = "all",
    project = "all",
    platform = "all",
    owner = "all",
    status = "all",
  } = body || {};

  // 4. filtros base — AQUÍ era donde se rompía
  const filters = [
    // no mostrar archivados
    {
      property: "Archivado",
      checkbox: {
        // si la casilla es distinta de true => lo mostramos
        does_not_equal: true,
      },
    },
    // no mostrar los que tienen Hide
    {
      property: "Hide",
      checkbox: {
        does_not_equal: true,
      },
    },
  ];

  // 5. filtros dinámicos según TU DB de Content

  // Client → relation con DB Clients
  if (client !== "all") {
    filters.push({
      property: "Client",
      relation: {
        contains: client,
      },
    });
  }

  // Project → relation con DB Projects
  if (project !== "all") {
    filters.push({
      property: "Project",
      relation: {
        contains: project,
      },
    });
  }

  // Platform → multi-select
  if (platform !== "all") {
    filters.push({
      property: "Platform",
      multi_select: {
        contains: platform,
      },
    });
  }

  // Owner → people
  if (owner !== "all") {
    filters.push({
      property: "Owner",
      people: {
        contains: owner,
      },
    });
  }

  // Status → status
  if (status !== "all") {
    filters.push({
      property: "Status",
      status: {
        equals: status,
      },
    });
  }

  // 6. armar query final
  const query = {
    database_id: NOTION_DB_ID,
    filter: {
      and: filters,
    },
    sorts: [
      // primero pineados
      {
        property: "Pinned",
        direction: "descending",
      },
      // luego por fecha de publicación
      {
        property: "Publish Date",
        direction: "descending",
      },
      // por si acaso, por fecha de creación
      {
        timestamp: "created_time",
        direction: "descending",
      },
    ],
    page_size: 100,
  };

  try {
    const resp = await notion.databases.query(query);

    // 7. normalizar los items para el front
    const items = (resp.results || []).map((page) => {
      const props = page.properties || {};

      const titleProp = props["Post"] || props["Name"] || {};
      const title =
        (titleProp.title &&
          titleProp.title[0] &&
          titleProp.title[0].plain_text) ||
        "Untitled";

      const files = props["Attachment"]?.files || [];
      const firstFile = files.length ? files[0] : null;

      const clientRel = props["Client"]?.relation || [];
      const projectRel = props["Project"]?.relation || [];
      const platforms = props["Platform"]?.multi_select || [];
      const owners = props["Owner"]?.people || [];
      const statusProp = props["Status"]?.status || null;
      const publishDate = props["Publish Date"]?.date?.start || null;

      return {
        id: page.id,
        title,
        image: firstFile?.file?.url || firstFile?.external?.url || null,
        clientIds: clientRel.map((r) => r.id),
        projectIds: projectRel.map((r) => r.id),
        platforms: platforms.map((p) => p.name),
        owners: owners.map((p) => p.id),
        status: statusProp ? statusProp.name : null,
        publishDate,
      };
    });

    return res.status(200).json({
      ok: true,
      items,
    });
  } catch (err) {
    console.error("Notion error:", err.body || err);
    return res.status(500).json({
      ok: false,
      error: err.body || err.message || "Notion query failed",
    });
  }
}
