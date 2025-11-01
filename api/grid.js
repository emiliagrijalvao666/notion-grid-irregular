// /api/grid.js
import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN });

export default async function handler(req, res) {
  try {
    const { NOTION_TOKEN, NOTION_DATABASE_ID } = process.env;
    if (!NOTION_TOKEN || !NOTION_DATABASE_ID) {
      return res
        .status(500)
        .json({ ok: false, error: "Missing NOTION_TOKEN or NOTION_DATABASE_ID" });
    }

    const {
      clientId = "all",
      projectId = "all",
      platformId = "all",
      ownerId = "all",
      statusId = "all",
    } = req.query;

    const andFilters = [
      // Hide != true
      {
        or: [
          { property: "Hide", checkbox: { equals: false } },
          { property: "Hide", checkbox: { does_not_equal: true } },
        ],
      },
      // Archivado != true
      {
        or: [
          { property: "Archivado", checkbox: { equals: false } },
          { property: "Archivado", checkbox: { does_not_equal: true } },
        ],
      },
    ];

    if (clientId !== "all") {
      andFilters.push({
        property: "Client",
        relation: { contains: clientId },
      });
    }

    if (projectId !== "all") {
      andFilters.push({
        property: "Project",
        relation: { contains: projectId },
      });
    }

    if (platformId !== "all") {
      andFilters.push({
        property: "Platform",
        multi_select: { contains: platformId },
      });
    }

    if (ownerId !== "all") {
      andFilters.push({
        property: "Owner",
        people: { contains: ownerId },
      });
    }

    if (statusId !== "all") {
      andFilters.push({
        property: "Status",
        status: { equals: statusId },
      });
    }

    const pages = await queryAll({
      database_id: NOTION_DATABASE_ID,
      filter: { and: andFilters },
      sorts: [
        { property: "Pinned", direction: "descending" },
        { property: "Publish Date", direction: "descending" },
        { timestamp: "created_time", direction: "descending" },
      ],
    });

    const posts = pages.map((page) => {
      const title = getTitle(page, "Post") || getTitle(page, "Name") || "Untitled";
      const date = getDate(page, "Publish Date");
      const pinned = getCheckbox(page, "Pinned");

      // media prioritario
      const mediaUrl =
        getFirstFile(page, "Attachment") ||
        getFirstFile(page, "Link") ||
        getFirstFile(page, "Canva") ||
        getFirstFile(page, "Image") ||
        getFirstFile(page, "Image Source") ||
        null;

      // platforms
      const platforms = getMultiSelect(page, "Platform");
      // owners
      const owners = getPeople(page, "Owner");
      // status
      const status = getStatus(page, "Status");

      return {
        id: page.id,
        title,
        date,
        pinned,
        mediaUrl,
        platforms,
        owners,
        status,
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
  const out = [];
  let hasMore = true;
  let cursor = undefined;

  while (hasMore) {
    const resp = await notion.databases.query({
      ...params,
      start_cursor: cursor,
      page_size: 50,
    });
    out.push(...resp.results);
    hasMore = resp.has_more;
    cursor = resp.next_cursor;
  }
  return out;
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
  if (prop && prop.type === "date" && prop.date?.start) {
    return prop.date.start;
  }
  return null;
}

function getCheckbox(page, propName) {
  const prop = page.properties?.[propName];
  return prop && prop.type === "checkbox" ? prop.checkbox : false;
}

function getFirstFile(page, propName) {
  const prop = page.properties?.[propName];
  if (!prop || prop.type !== "files") return null;
  const first = prop.files[0];
  if (!first) return null;
  if (first.type === "file") return first.file.url;
  if (first.type === "external") return first.external.url;
  return null;
}

function getMultiSelect(page, propName) {
  const prop = page.properties?.[propName];
  if (prop && prop.type === "multi_select") {
    return prop.multi_select.map((m) => m.name);
  }
  return [];
}

function getPeople(page, propName) {
  const prop = page.properties?.[propName];
  if (prop && prop.type === "people") {
    return prop.people.map((p) => p.name || p.email || p.id);
  }
  return [];
}

function getStatus(page, propName) {
  const prop = page.properties?.[propName];
  if (prop && prop.type === "status" && prop.status) {
    return prop.status.name;
  }
  return null;
}
