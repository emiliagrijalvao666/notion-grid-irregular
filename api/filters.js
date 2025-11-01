// /api/filters.js
import { Client } from "@notionhq/client";

const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

export default async function handler(req, res) {
  try {
    const databaseId = process.env.NOTION_DATABASE_ID;
    if (!databaseId) {
      return res.status(500).json({
        ok: false,
        error: "Missing NOTION_DATABASE_ID",
      });
    }

    // Traemos hasta 100 para armar los selects
    const query = await notion.databases.query({
      database_id: databaseId,
      page_size: 100,
      sorts: [
        {
          property: "Publish Date",
          direction: "descending",
        },
      ],
    });

    const clientsMap = new Map();
    const projectsMap = new Map();
    const platformsSet = new Set();
    const ownersMap = new Map();
    const statusSet = new Set();

    for (const page of query.results) {
      const props = page.properties || {};

      // CLIENT
      if (props["Client"] && props["Client"].relation && props["Client"].relation.length > 0) {
        props["Client"].relation.forEach((rel) => {
          // relation → solo id
          if (!clientsMap.has(rel.id)) {
            // dejamos el id como label temporal
            clientsMap.set(rel.id, {
              id: rel.id,
              name: rel.id, // si quieres nombre “bonito” se puede hacer otra llamada, pero esto es lo que Notion da aquí
            });
          }
        });
      }

      // PROJECT
      if (props["Project"] && props["Project"].relation && props["Project"].relation.length > 0) {
        props["Project"].relation.forEach((rel) => {
          if (!projectsMap.has(rel.id)) {
            projectsMap.set(rel.id, {
              id: rel.id,
              name: rel.id,
            });
          }
        });
      }

      // PLATFORM
      if (props["Platform"] && props["Platform"].multi_select) {
        props["Platform"].multi_select.forEach((opt) => {
          platformsSet.add(opt.name);
        });
      }

      // OWNER
      if (props["Owner"] && props["Owner"].people && props["Owner"].people.length > 0) {
        props["Owner"].people.forEach((p) => {
          if (!ownersMap.has(p.id)) {
            ownersMap.set(p.id, {
              id: p.id,
              name: p.name || p.id,
            });
          }
        });
      }

      // STATUS
      if (props["Status"] && props["Status"].status) {
        statusSet.add(props["Status"].status.name);
      }
    }

    return res.status(200).json({
      ok: true,
      clients: Array.from(clientsMap.values()),
      projects: Array.from(projectsMap.values()),
      platforms: Array.from(platformsSet.values()),
      owners: Array.from(ownersMap.values()),
      statuses: Array.from(statusSet.values()),
    });
  } catch (err) {
    console.error("FILTERS ERROR", err.message);
    return res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
}
