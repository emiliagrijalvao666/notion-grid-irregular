// /api/filters.js
import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN });

export default async function handler(req, res) {
  try {
    const {
      NOTION_TOKEN,
      NOTION_DATABASE_ID,
      NOTION_DB_CLIENTS,
      NOTION_DB_PROJECTS,
    } = process.env;

    if (!NOTION_TOKEN || !NOTION_DATABASE_ID) {
      return res.status(500).json({ ok: false, error: "Missing NOTION_TOKEN or NOTION_DATABASE_ID" });
    }

    // 1) Traer CLIENTS
    let clients = [];
    if (NOTION_DB_CLIENTS) {
      clients = await fetchAllFromDB(NOTION_DB_CLIENTS);
      clients = clients
        .map((p) => ({
          id: p.id,
          name: getTitle(p, "Name") || getTitle(p, "Client") || "Sin nombre",
        }))
        .filter((c) => c.name && c.name !== "Sin nombre");
    }

    // 2) Traer PROJECTS
    let projects = [];
    if (NOTION_DB_PROJECTS) {
      const rawProjects = await fetchAllFromDB(NOTION_DB_PROJECTS);
      projects = rawProjects.map((p) => {
        const name =
          getTitle(p, "Project name") ||
          getTitle(p, "Name") ||
          "Sin nombre";

        // relación hacia Clients en la DB Projects
        const rel = p.properties?.Client;
        let clientId = null;
        if (rel && rel.type === "relation" && rel.relation.length > 0) {
          clientId = rel.relation[0].id;
        }

        return {
          id: p.id,
          name,
          client_id: clientId,
        };
      });
    }

    // 3) Para Platforms / Owners / Status necesitamos mirar el CONTENT
    const contentPages = await fetchAllFromDB(NOTION_DATABASE_ID);

    // platforms (multi select)
    const platformsSet = new Map();
    // owners (people)
    const ownersSet = new Map();
    // statuses (status)
    const statusesSet = new Map();

    for (const page of contentPages) {
      // Platform
      const plat = page.properties?.Platform;
      if (plat && plat.type === "multi_select") {
        for (const opt of plat.multi_select) {
          if (!platformsSet.has(opt.id)) {
            platformsSet.set(opt.id, { id: opt.id, name: opt.name });
          }
        }
      }

      // Owner
      const owner = page.properties?.Owner;
      if (owner && owner.type === "people") {
        for (const person of owner.people) {
          const name = person.name || person.email || person.id;
          if (!ownersSet.has(person.id)) {
            ownersSet.set(person.id, { id: person.id, name });
          }
        }
      }

      // Status
      const status = page.properties?.Status;
      if (status && status.type === "status" && status.status) {
        const stId = status.status.id;
        const stName = status.status.name;
        if (!statusesSet.has(stId)) {
          statusesSet.set(stId, { id: stId, name: stName });
        }
      }
    }

    const platforms = Array.from(platformsSet.values());
    const owners = Array.from(ownersSet.values());
    const statuses = Array.from(statusesSet.values());

    return res.status(200).json({
      ok: true,
      filters: {
        clients,
        projects,
        platforms,
        owners,
        statuses,
      },
    });
  } catch (err) {
    console.error("filters error:", err);
    // Para que el front no vuelva a decir "A server error..."
    return res.status(200).json({
      ok: false,
      error: err.message || "Error interno en /api/filters",
      filters: {
        clients: [],
        projects: [],
        platforms: [],
        owners: [],
        statuses: [],
      },
    });
  }
}

async function fetchAllFromDB(database_id) {
  const pages = [];
  let hasMore = true;
  let cursor = undefined;

  while (hasMore) {
    const resp = await notion.databases.query({
      database_id,
      start_cursor: cursor,
      page_size: 100,
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
