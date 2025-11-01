// /api/grid.js
import { Client } from "@notionhq/client";

export default async function handler(req, res) {
  // 1. ENV
  const NOTION_TOKEN = process.env.NOTION_TOKEN;
  const NOTION_DB_ID =
    process.env.NOTION_DB_ID ||
    process.env.NOTION_DATABASE_ID || // así la tienes en Vercel
    null;

  if (!NOTION_TOKEN || !NOTION_DB_ID) {
    return res.status(500).json({
      ok: false,xa// /api/grid.js
import { Client as NotionClient } from "@notionhq/client";

export default async function handler(req, res) {
  const token = process.env.NOTION_TOKEN;
  const contentDB = process.env.NOTION_DATABASE_ID;

  if (!token || !contentDB) {
    return res.status(500).json({
      ok: false,
      error: "Missing NOTION_TOKEN or NOTION_DATABASE_ID",
    });
  }

  const notion = new NotionClient({ auth: token });

  const {
    client = "all",
    project = "all",
    platform = "All Platforms",
    owner = "all",
    status = "All Status",
  } = req.query;

  const filters = [];

  // 1. NO mostrar si Hide = true
  filters.push({
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

  // 2. NO mostrar si Archivado = true
  filters.push({
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

  // 3. Client
  if (client && client !== "all" && client !== "All Clients") {
    filters.push({
      property: "Client",
      relation: {
        contains: client,
      },
    });
  }

  // 4. Project
  if (project && project !== "all" && project !== "All Projects") {
    filters.push({
      property: "Project",
      relation: {
        contains: project,
      },
    });
  }

  // 5. Platform
  if (platform && platform !== "All Platforms") {
    filters.push({
      property: "Platform",
      multi_select: {
        contains: platform,
      },
    });
  }

  // 6. Owner
  if (owner && owner !== "all" && owner !== "All Owners") {
    // aquí usamos el ID de la persona, no el nombre
    filters.push({
      property: "Owner",
      people: {
        contains: owner,
      },
    });
  }

  // 7. Status
  if (status && status !== "All Status") {
    filters.push({
      property: "Status",
      status: {
        equals: status,
      },
    });
  }

  try {
    const resp = await notion.databases.query({
      database_id: contentDB,
      filter: {
        and: filters,
      },
      sorts: [
        {
          property: "Publish Date",
          direction: "descending",
        },
      ],
      page_size: 100,
    });

    const posts = resp.results.map((page) => {
      const props = page.properties || {};

      // título
      let title = "Untitled";
      const titleProp =
        props.Post ||
        props.Title ||
        props.Name ||
        props["Post"] ||
        props["Posts"];
      if (titleProp && titleProp.type === "title") {
        title =
          (titleProp.title[0] && titleProp.title[0].plain_text) ||
          "Untitled";
      }

      // fecha
      let date = "";
      const dateProp = props["Publish Date"] || props.Date;
      if (dateProp && dateProp.date && dateProp.date.start) {
        date = dateProp.date.start;
      }

      // imagen
      let image = null;
      if (props.Attachment && props.Attachment.type === "files") {
        const f = props.Attachment.files[0];
        if (f) {
          image = f.external ? f.external.url : f.file.url;
        }
      }

      return {
        id: page.id,
        title,
        date,
        image,
      };
    });

    return res.status(200).json({
      ok: true,
      posts,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
}
      error: "Missing NOTION_TOKEN or NOTION_DB_ID",
    });
  }

  const notion = new Client({ auth: NOTION_TOKEN });

  // 2. leer body
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

  // 3. filtros base (ESTE era el que antes te daba el error del checkbox)
  const filters = [
    {
      property: "Archivado",
      checkbox: {
        does_not_equal: true,
      },
    },
    {
      property: "Hide",
      checkbox: {
        does_not_equal: true,
      },
    },
  ];

  // 4. filtros dinámicos
  if (client !== "all") {
    filters.push({
      property: "Client",
      relation: {
        contains: client,
      },
    });
  }

  if (project !== "all") {
    filters.push({
      property: "Project",
      relation: {
        contains: project,
      },
    });
  }

  if (platform !== "all") {
    filters.push({
      property: "Platform",
      multi_select: {
        contains: platform,
      },
    });
  }

  if (owner !== "all") {
    filters.push({
      property: "Owner",
      people: {
        contains: owner,
      },
    });
  }

  if (status !== "all") {
    filters.push({
      property: "Status",
      status: {
        equals: status,
      },
    });
  }

  const query = {
    database_id: NOTION_DB_ID,
    filter: { and: filters },
    sorts: [
      { property: "Pinned", direction: "descending" },
      { property: "Publish Date", direction: "descending" },
      { timestamp: "created_time", direction: "descending" },
    ],
    page_size: 100,
  };

  try {
    const resp = await notion.databases.query(query);

    const items = (resp.results || []).map((page) => {
      const props = page.properties || {};

      // título
      const titleProp = props["Post"] || props["Name"] || {};
      const title =
        (titleProp.title &&
          titleProp.title[0] &&
          titleProp.title[0].plain_text) ||
        "Untitled";

      // media
      const files = props["Attachment"]?.files || [];
      const firstFile = files.length ? files[0] : null;
      const image =
        firstFile?.file?.url || firstFile?.external?.url || null;

      // relations
      const clientRel = props["Client"]?.relation || [];
      const projectRel = props["Project"]?.relation || [];

      // multi
      const platforms = props["Platform"]?.multi_select || [];
      const owners = props["Owner"]?.people || [];
      const statusProp = props["Status"]?.status || null;

      const publishDate = props["Publish Date"]?.date?.start || null;

      return {
        id: page.id,
        title,
        image,
        clientIds: clientRel.map((r) => r.id),
        projectIds: projectRel.map((r) => r.id),
        platforms: platforms.map((p) => p.name),
        owners: owners.map((p) => p.id),
        status: statusProp ? statusProp.name : null,
        publishDate,
      };
    });

    // 5. construir filtros para la UI (lo que te está pidiendo index.js)
    const clientSet = new Set();
    const projectSet = new Set();
    const platformSet = new Set();
    const ownerSet = new Set();
    const statusSet = new Set();

    items.forEach((item) => {
      (item.clientIds || []).forEach((c) => clientSet.add(c));
      (item.projectIds || []).forEach((p) => projectSet.add(p));
      (item.platforms || []).forEach((pl) => platformSet.add(pl));
      (item.owners || []).forEach((o) => ownerSet.add(o));
      if (item.status) statusSet.add(item.status);
    });

    const filtersForUI = {
      clients: Array.from(clientSet),
      projects: Array.from(projectSet),
      platforms: Array.from(platformSet),
      owners: Array.from(ownerSet),
      statuses: Array.from(statusSet),
    };

    return res.status(200).json({
      ok: true,
      items,
      filters: filtersForUI,
    });
  } catch (err) {
    console.error("Notion error:", err.body || err);
    return res.status(500).json({
      ok: false,
      error: err.body || err.message || "Notion query failed",
    });
  }
}
