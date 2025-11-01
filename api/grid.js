// api/grid.js
import { Client as NotionClient } from "@notionhq/client";

const NOTION_TOKEN =
  process.env.NOTION_TOKEN ||
  process.env.NOTION_SECRET ||
  "";
const DB_ID =
  process.env.NOTION_DB_ID ||
  process.env.NOTION_DATABASE_ID ||
  "";

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
  // igual que en filters: si no hay credenciales, devolvemos posts vacíos
  if (!NOTION_TOKEN || !DB_ID) {
    return res.status(200).json({
      ok: true,
      warning: "NOTION_TOKEN or NOTION_DB_ID not found in env. Returning empty posts.",
      posts: [],
    });
  }

  const notion = new NotionClient({ auth: NOTION_TOKEN });

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
          { timestamp: "last_edited_time", direction: "descending" },
        ],
      });

      pages.push(...response.results);
      cursor = response.has_more ? response.next_cursor : undefined;
    } while (cursor);

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

        const attachments = (p["Attachment"]?.files || []).map((f) => ({
          url: f.external?.url || f.file?.url || "",
          name: f.name || "",
        }));

        const publishDate = p["Publish Date"]?.date?.start || null;

        return {
          id: page.id,
          title,
          clientName,
          projectName,
          platforms,
          ownerName,
          statusName,
          publishDate,
          attachments,
        };
      })
      .filter((item) => {
        if (client !== "all" && item.clientName !== client) return false;
        if (project !== "all" && item.projectName !== project) return false;
        if (platform !== "all" && !item.platforms.includes(platform)) return false;
        if (owner !== "all" && item.ownerName !== owner) return false;
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
