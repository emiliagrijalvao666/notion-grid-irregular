// api/grid.js
import { Client as NotionClient } from "@notionhq/client";

const notion = new NotionClient({
  auth: process.env.NOTION_TOKEN,
});

const DB_ID = process.env.NOTION_DB_ID;

// helpers
function getFormulaString(prop) {
  if (!prop) return "";
  if (prop.type === "formula" && prop.formula.type === "string") {
    return prop.formula.string || "";
  }
  return "";
}

function getMultiSelect(prop) {
  if (!prop) return [];
  if (prop.type === "multi_select") {
    return prop.multi_select.map((o) => o.name).filter(Boolean);
  }
  return [];
}

function getPeopleName(prop) {
  if (!prop) return "";
  if (prop.type === "people" && prop.people.length > 0) {
    return prop.people[0].name || prop.people[0].id || "";
  }
  return "";
}

function getStatusName(prop) {
  if (!prop) return "";
  if (prop.type === "status") {
    return prop.status?.name || "";
  }
  return "";
}

export default async function handler(req, res) {
  if (!DB_ID || !process.env.NOTION_TOKEN) {
    return res.status(500).json({ ok: false, error: "Missing NOTION_TOKEN or NOTION_DB_ID" });
  }

  const {
    client = "all",
    project = "all",
    platform = "all",
    owner = "all",
    status = "all",
  } = (req.method === "POST" ? req.body : req.query) || {};

  try {
    const pages = [];
    let cursor = undefined;

    // 1. Traemos TODO lo visible
    do {
      const response = await notion.databases.query({
        database_id: DB_ID,
        start_cursor: cursor,
        page_size: 100,
        filter: {
          and: [
            {
              or: [
                { property: "Hide", checkbox: { equals: false } },
                { property: "Hide", checkbox: { is_empty: true } },
              ],
            },
            {
              or: [
                { property: "Archivado", checkbox: { equals: false } },
                { property: "Archivado", checkbox: { is_empty: true } },
              ],
            },
          ],
        },
        sorts: [
          { property: "Pinned", direction: "descending" },
          { property: "Publish Date", direction: "descending" },
          { property: "Last edited time", direction: "descending" },
        ],
      });

      pages.push(...response.results);
      cursor = response.has_more ? response.next_cursor : undefined;
    } while (cursor);

    // 2. Normalizamos y filtramos en memoria
    const items = pages
      .map((page) => {
        const p = page.properties || {};

        const title =
          p["Post"]?.title?.[0]?.plain_text ||
          p["Name"]?.title?.[0]?.plain_text ||
          "Untitled";

        const clientName = getFormulaString(p["ClientName"]);
        const projectName = getFormulaString(p["ProjectName"]);
        const platforms = getMultiSelect(p["Platform"]);
        const ownerName = getPeopleName(p["Owner"]);
        const statusName = getStatusName(p["Status"]);

        // attachments
        const attachments = (p["Attachment"]?.files || []).map((f) => ({
          url: f.external?.url || f.file?.url || "",
          name: f.name || "",
        }));

        return {
          id: page.id,
          title,
          clientName,
          projectName,
          platforms,
          ownerName,
          statusName,
          attachments,
          raw: p,
        };
      })
      .filter((item) => {
        // CLIENT
        if (client !== "all" && item.clientName !== client) return false;
        // PROJECT
        if (project !== "all" && item.projectName !== project) return false;
        // PLATFORM
        if (platform !== "all" && !item.platforms.includes(platform)) return false;
        // OWNER
        if (owner !== "all" && item.ownerName !== owner) return false;
        // STATUS
        if (status !== "all" && item.statusName !== status) return false;

        return true;
      });

    return res.status(200).json({
      ok: true,
      posts: items,
    });
  } catch (err) {
    console.error("grid error", err);
    return res.status(500).json({ ok: false, error: err.message || "Unknown error" });
  }
}
