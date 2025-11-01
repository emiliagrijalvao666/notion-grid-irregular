// api/filters.js
import { Client } from "@notionhq/client";

const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

const CONTENT_DB = process.env.NOTION_DATABASE_ID;
const CLIENTS_DB = process.env.NOTION_DB_CLIENTS;
const PROJECTS_DB = process.env.NOTION_DB_PROJECTS;

export default async function handler(req, res) {
  // Validación de envs
  if (!process.env.NOTION_TOKEN || !CONTENT_DB) {
    return res.status(500).json({
      ok: false,
      error: "Missing NOTION_TOKEN or NOTION_DATABASE_ID",
    });
  }

  try {
    // 1) Traemos TODOS los clients reales
    let clients = [];
    if (CLIENTS_DB) {
      const clientsResp = await notion.databases.query({
        database_id: CLIENTS_DB,
        page_size: 100,
      });

      clients = clientsResp.results.map((page) => {
        const name =
          page.properties?.Name?.title?.[0]?.plain_text ||
          page.properties?.Título?.title?.[0]?.plain_text ||
          "Sin nombre";

        return {
          id: page.id,
          name,
        };
      });
    }

    // 2) Traemos TODOS los projects reales
    let projects = [];
    if (PROJECTS_DB) {
      const projectsResp = await notion.databases.query({
        database_id: PROJECTS_DB,
        page_size: 100,
      });

      projects = projectsResp.results.map((page) => {
        const name =
          page.properties?.Name?.title?.[0]?.plain_text ||
          page.properties?.Proyecto?.title?.[0]?.plain_text ||
          "Sin nombre";

        // ojo: este es el relation hacia Clients dentro de Projects
        const clientRel =
          page.properties?.Client?.relation?.[0]?.id ||
          page.properties?.Cliente?.relation?.[0]?.id ||
          null;

        return {
          id: page.id,
          name,
          clientId: clientRel, // esto lo usamos en el front para filtrar projects cuando cambias de client
        };
      });
    }

    // 3) Del CONTENT sacamos platforms / owners / statuses
    let hasMore = true;
    let cursor = undefined;

    const platformsSet = new Set();
    const ownersMap = new Map(); // id -> name
    const statusesSet = new Set();

    while (hasMore) {
      const resp = await notion.databases.query({
        database_id: CONTENT_DB,
        page_size: 100,
        start_cursor: cursor,
      });

      resp.results.forEach((page) => {
        // Platform (multi-select)
        const platforms =
          page.properties?.Platform?.multi_select || [];
        platforms.forEach((p) => {
          if (p?.name) platformsSet.add(p.name);
        });

        // Owners (people)
        const owners = page.properties?.Owner?.people || [];
        owners.forEach((person) => {
          const name = person.name || person?.person?.email || person.id;
          if (!ownersMap.has(person.id)) {
            ownersMap.set(person.id, name);
          }
        });

        // Status
        const statusName = page.properties?.Status?.status?.name;
        if (statusName) {
          statusesSet.add(statusName);
        }
      });

      hasMore = resp.has_more;
      cursor = resp.next_cursor;
    }

    const platforms = Array.from(platformsSet).sort();
    const owners = Array.from(ownersMap.entries()).map(([id, name]) => ({
      id,
      name,
    }));
    const statuses = Array.from(statusesSet).sort();

    return res.status(200).json({
      ok: true,
      filters: {
        clients, // [{id,name}]
        projects, // [{id,name,clientId}]
        platforms, // [string]
        owners, // [{id,name}]
        statuses, // [string]
      },
    });
  } catch (err) {
    console.error("filters error:", err.message);
    return res.status(500).json({
      ok: false,
      error: "Error fetching filters from Notion",
      detail: err.message,
    });
  }
}
