// /api/grid.js
import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN });

export default async function handler(req, res) {
  try {
    const { NOTION_TOKEN, NOTION_DATABASE_ID } = process.env;
    if (!NOTION_TOKEN || !NOTION_DATABASE_ID) {
      return res.status(500).json({ ok: false, error: "Missing NOTION_TOKEN or NOTION_DATABASE_ID" });
    }

    // filtros que manda el front (pueden venir vacíos)
    const {
      clientId = "all",
      projectId = "all",
      platformId = "all",
      ownerId = "all",
      statusId = "all",
    } = req.query;

    // armamos el filtro base
    const andFilters = [
      // Hide != true
      {
        or: [
          {
            property: "Hide",
            checkbox: {
              equals: false,
            },
          },
          {
            property: "Hide",
            checkbox: {
              does_not_equal: true,
            },
          },
        ],
      },
      // Archivado != true
      {
        or: [
          {
            property: "Archivado",
            checkbox: {
              equals: false,
            },
          },
          {
            property: "Archivado",
            checkbox: {
              does_not_equal: true,
            },
          },
        ],
      },
    ];

    // si viene CLIENT
    if (clientId !== "all") {
      andFilters.push({
        property: "Client",
        relation: {
          contains: clientId,
        },
      });
    }

    // si viene PROJECT
    if (projectId !== "all") {
      andFilters.push({
        property: "Project",
        relation: {
          contains: projectId,
        },
      });
    }

    // si viene PLATFORM
    if (platformId !== "all") {
      andFilters.push({
        property: "Platform",
        multi_select: {
          contains: platformId,
        },
      });
    }

    // si viene OWNER
    if (ownerId !== "all") {
      andFilters.push({
        property: "Owner",
        people: {
          contains: ownerId,
        },
      });
    }

    // si viene STATUS
    if (statusId !== "all") {
      andFilters.push({
        property: "Status",
        status: {
          equals: statusId,
        },
      });
    }

    const results = await queryAll({
      database_id: NOTION_DATABASE_ID,
      filter: {
        and: andFilters,
      },
      sorts: [
        {
          property: "Pinned",
          direction: "descending",
        },
        {
          property: "Publish Date",
          direction: "descending",
        },
        {
          timestamp: "created_time",
          direction: "descending",
        },
      ],
    });

    // mapeamos para el front
    const posts = results.map((page) => {
      const title = getTitle(page, "Post") || "Untitled";
      const date = getDate(page, "Publish Date");
      const client = getRelationFirstId(page, "Client");
      const project = getRelationFirstId(page, "Project");
      const pinned = getCheckbox(page, "Pinned");
      const attachments = getFiles(page, "Attachment");

      return {
        id: page.id,
        title,
        date,
        client,
        project,
        pinned,
        attachments,
      };
    });

    return res.status(200).json({ ok: true, posts });
  } catch (err) {
    console.error("grid error:", err);
    return res.status(200).json({
      ok: false,
      error: err.message || "Error en /api/grid",
      posts: [],
    });
  }
}

async function queryAll(params) {
  const pages = [];
  let hasMore = true;
  let cursor = undefined;

  while (hasMore) {
    const resp = await notion.databases.query({
      ...params,
      start_cursor: cursor,
      page_size: 50,
    });
    pages.push(...resp.results);
    hasMore = resp.has_more;
    cursor = resp.next_cursor;
  }

  return pages;
}

function getTitle(page, propName) {
  const prop = page.properties?.[propName];
  if (!prop) return "";
  if (prop.type === "title") {
    return prop.title.map((t) => t.plain_text).join("") || "";
  }
  if (prop.type === "rich_text") {
    return prop.rich_text.map((t) => t.plain_text).join("") || "";
  }
  return "";
}

function getDate(page, propName) {
  const prop = page.properties?.[propName];
  if (prop && prop.type === "date" && prop.date && prop.date.start) {
    return prop.date.start;
  }
  return null;
}

function getRelationFirstId(page, propName) {
  const prop = page.properties?.[propName];
  if (prop && prop.type === "relation" && prop.relation.length > 0) {
    return prop.relation[0].id;
  }
  return null;
}

function getCheckbox(page, propName) {
  const prop = page.properties?.[propName];
  if (prop && prop.type === "checkbox") {
    return prop.checkbox;
  }
  return false;
}

function getFiles(page, propName) {
  const prop = page.properties?.[propName];
  if (!prop || prop.type !== "files") return [];
  return prop.files.map((f) => {
    if (f.type === "file") {
      return f.file.url;
    } else if (f.type === "external") {
      return f.external.url;
    }
    return null;
  }).filter(Boolean);
}
