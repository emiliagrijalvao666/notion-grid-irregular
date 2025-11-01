// /api/grid.js

const { Client } = require("@notionhq/client");

module.exports = async (req, res) => {
  // 1. leer envs (acepta los 2 nombres tuyos)
  const NOTION_TOKEN =
    process.env.NOTION_TOKEN || process.env.NEXT_PUBLIC_NOTION_TOKEN;
  const NOTION_DB_ID =
    process.env.NOTION_DB_ID ||
    process.env.NOTION_DATABASE_ID || // tú lo tenías así
    process.env.NOTION_DB ||
    null;

  if (!NOTION_TOKEN || !NOTION_DB_ID) {
    return res.status(500).json({
      ok: false,
      error: "Missing NOTION_TOKEN or NOTION_DB_ID",
    });
  }

  const notion = new Client({ auth: NOTION_TOKEN });

  // 2. leer filtros que manda el frontend
  // si no manda nada, ponemos "all"
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

  // 3. filtros base (estos son los que te estaban rompiendo)
  // NO usamos or. Todo definido.
  const filters = [
    // no mostrar archivados
    {
      property: "Archivado",
      checkbox: {
        does_not_equal: true,
      },
    },
    // no mostrar ocultos
    {
      property: "Hide",
      checkbox: {
        does_not_equal: true,
      },
    },
  ];

  // 4. filtros dinámicos
  // CLIENT (tu columna es Relation → Clients)
  if (client && client !== "all") {
    filters.push({
      property: "Client",
      relation: {
        contains: client,
      },
    });
  }

  // PROJECT (tu columna es Relation → Projects)
  if (project && project !== "all") {
    filters.push({
      property: "Project",
      relation: {
        contains: project,
      },
    });
  }

  // PLATFORM (multi-select)
  if (platform && platform !== "all") {
    filters.push({
      property: "Platform",
      multi_select: {
        contains: platform,
      },
    });
  }

  // OWNER (people)
  if (owner && owner !== "all") {
    filters.push({
      property: "Owner",
      people: {
        contains: owner,
      },
    });
  }

  // STATUS (status de tu DB: Idea, Diseño, Editing, Publicado, etc.)
  // tú dijiste: “ya funciona All Status, no lo muevas” → entonces solo
  // aplicamos si NO es "all"
  if (status && status !== "all") {
    filters.push({
      property: "Status",
      status: {
        equals: status,
      },
    });
  }

  // 5. armar query para Notion
  const query = {
    database_id: NOTION_DB_ID,
    filter: {
      and: filters,
    },
    sorts: [
      // primero los pineados
      {
        property: "Pinned",
        direction: "descending",
      },
      // luego por Publish Date desc
      {
        property: "Publish Date",
        direction: "descending",
      },
      // y como respaldo, fecha de creación
      {
        timestamp: "created_time",
        direction: "descending",
      },
    ],
    page_size: 100,
  };

  try {
    const response = await notion.databases.query(query);

    // 6. mapear a algo más bonito para el frontend
    const items = (response.results || []).map((page) => {
      const props = page.properties || {};

      const titleProp = props["Post"] || props["Name"] || {};
      const title =
        (titleProp.title && titleProp.title[0] && titleProp.title[0].plain_text) ||
        "Untitled";

      const coverFiles = props["Attachment"]?.files || [];
      const firstImage = coverFiles.length ? coverFiles[0] : null;

      // relations devuelven ids → el frontend ya las está usando en el select
      const clientRel = props["Client"]?.relation || [];
      const projectRel = props["Project"]?.relation || [];
      const platformMS = props["Platform"]?.multi_select || [];
      const ownerPeople = props["Owner"]?.people || [];

      const statusProp = props["Status"]?.status || null;
      const publishDate = props["Publish Date"]?.date?.start || null;

      return {
        id: page.id,
        title,
        image: firstImage?.file?.url || firstImage?.external?.url || null,
        clientIds: clientRel.map((r) => r.id),
        projectIds: projectRel.map((r) => r.id),
        platforms: platformMS.map((p) => p.name),
        owners: ownerPeople.map((p) => p.id),
        status: statusProp ? statusProp.name : null,
        publishDate,
      };
    });

    return res.status(200).json({
      ok: true,
      items,
    });
  } catch (err) {
    console.error("Notion query error", err.body || err);
    return res.status(500).json({
      ok: false,
      error: err.body || err.message || "Notion query failed",
    });
  }
};
