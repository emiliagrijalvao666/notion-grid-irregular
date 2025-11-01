// api/grid.js
import { Client } from "@notionhq/client";

const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

const CONTENT_DB = process.env.NOTION_DATABASE_ID;

export default async function handler(req, res) {
  if (!process.env.NOTION_TOKEN || !CONTENT_DB) {
    return res.status(500).json({
      ok: false,
      error: "Missing NOTION_TOKEN or NOTION_DATABASE_ID",
    });
  }

  // vienen del front como query
  const {
    client = "all",
    project = "all",
    platform = "all",
    owner = "all",
    status = "all",
  } = req.query;

  // armamos el filtro paso a paso
  const andFilter = [];

  // 1) siempre ocultar Hide = true
  andFilter.push({
    property: "Hide",
    checkbox: {
      equals: false,
    },
  });

  // 2) siempre ocultar Archivado = true (si existe en tu DB)
  andFilter.push({
    property: "Archivado",
    checkbox: {
      equals: false,
    },
  });

  // 3) Status
  if (status !== "all") {
    andFilter.push({
      property: "Status",
      status: {
        equals: status,
      },
    });
  }

  // 4) Client (relation)
  if (client !== "all") {
    andFilter.push({
      property: "Client",
      relation: {
        contains: client,
      },
    });
  }

  // 5) Project (relation)
  if (project !== "all") {
    andFilter.push({
      property: "Project",
      relation: {
        contains: project,
      },
    });
  }

  // 6) Platform (multi-select)
  if (platform !== "all") {
    andFilter.push({
      property: "Platform",
      multi_select: {
        contains: platform,
      },
    });
  }

  // 7) Owner (people)
  if (owner !== "all") {
    andFilter.push({
      property: "Owner",
      people: {
        contains: owner,
      },
    });
  }

  try {
    const resp = await notion.databases.query({
      database_id: CONTENT_DB,
      filter: {
        and: andFilter,
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
      const title =
        page.properties?.Post?.title?.[0]?.plain_text ||
        "Untitled";

      // image
      const files = page.properties?.Attachment?.files || [];
      let image = null;
      if (files.length > 0) {
        const f = files[0];
        image = f.file?.url || f.external?.url || null;
      }

      // fecha
      const publishDate =
        page.properties?.["Publish Date"]?.date?.start || null;

      // client / project ids
      const clientRel =
        page.properties?.Client?.relation?.[0]?.id || null;
      const projectRel =
        page.properties?.Project?.relation?.[0]?.id || null;

      const platforms =
        page.properties?.Platform?.multi_select?.map((m) => m.name) ||
        [];

      const owners =
        page.properties?.Owner?.people?.map((p) => ({
          id: p.id,
          name: p.name || p.person?.email || p.id,
        })) || [];

      const statusName = page.properties?.Status?.status?.name || null;

      return {
        id: page.id,
        title,
        image,
        publishDate,
        clientId: clientRel,
        projectId: projectRel,
        platforms,
        owners,
        status: statusName,
      };
    });

    return res.status(200).json({
      ok: true,
      posts,
    });
  } catch (err) {
    console.error("grid error:", err.body || err.message);
    // 👇 esto es LO que te estaba saliendo como HTML. Ahora será JSON.
    return res.status(500).json({
      ok: false,
      error: "Error fetching grid from Notion",
      detail: err.body || err.message,
    });
  }
}
