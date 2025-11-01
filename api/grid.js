// /api/grid.js
import { Client } from "@notionhq/client";

const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

const CONTENT_DB = process.env.NOTION_DATABASE_ID;

function getFilesArray(prop) {
  if (!prop) return [];
  if (prop.type === "files" && Array.isArray(prop.files)) {
    return prop.files
      .map((f) => ({
        url: f.file?.url || f.external?.url || "",
      }))
      .filter((f) => f.url);
  }
  return [];
}

function guessKind(url = "") {
  const lower = url.toLowerCase();
  if (
    lower.endsWith(".mp4") ||
    lower.endsWith(".mov") ||
    lower.endsWith(".m4v")
  ) {
    return "video";
  }
  return "image";
}

export default async function handler(req, res) {
  try {
    if (!CONTENT_DB || !process.env.NOTION_TOKEN) {
      return res
        .status(500)
        .json({ ok: false, error: "Missing NOTION_TOKEN or NOTION_DATABASE_ID" });
    }

    const { client, project, platform, owner, status, pageSize } = req.query || {};

    // 🔐 FILTROS BASE
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

    if (client && client !== "all") {
      filters.push({
        property: "Client",
        relation: { contains: client },
      });
    }

    if (project && project !== "all") {
      filters.push({
        property: "Project",
        relation: { contains: project },
      });
    }

    if (platform && platform !== "all") {
      filters.push({
        property: "Platform",
        multi_select: { contains: platform },
      });
    }

    if (owner && owner !== "all") {
      filters.push({
        property: "Owner",
        people: { contains: owner },
      });
    }

    if (status && status !== "all") {
      filters.push({
        property: "Status",
        status: { equals: status },
      });
    }

    const limit = Number(pageSize) || 15;

    const { results } = await notion.databases.query({
      database_id: CONTENT_DB,
      filter: { and: filters },
      sorts: [
        { property: "Pinned", direction: "descending" },
        { property: "Publish Date", direction: "descending" },
        { timestamp: "created_time", direction: "descending" },
      ],
      page_size: limit,
    });

    const posts = results.map((page) => {
      const props = page.properties || {};

      // PRIORIDAD DE MEDIA
      const attachmentFiles = getFilesArray(props["Attachment"]);
      const linkFiles = getFilesArray(props["Link"]);
      const canvaFiles = getFilesArray(props["Canva"]);
      const mediaRaw = [...attachmentFiles, ...linkFiles, ...canvaFiles];

      const media = mediaRaw.map((m) => ({
        url: m.url,
        kind: guessKind(m.url),
      }));

      const title =
        props["Post"]?.title?.[0]?.plain_text ||
        props["Name"]?.title?.[0]?.plain_text ||
        "Sin nombre";

      const date = props["Publish Date"]?.date?.start || null;
      const pinned = props["Pinned"]?.checkbox || false;
      const copy =
        props["Copy"]?.rich_text?.map((t) => t.plain_text).join(" ") || "";

      return {
        id: page.id,
        title,
        date,
        pinned,
        copy,
        media,
      };
    });

    return res.status(200).json({ ok: true, posts });
  } catch (err) {
    console.error("GRID ERROR:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
