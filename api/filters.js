// /api/filters.js
import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN });

const CONTENT_DB = process.env.NOTION_DATABASE_ID;
const CLIENTS_DB = process.env.NOTION_DB_CLIENTS;
const PROJECTS_DB = process.env.NOTION_DB_PROJECTS;

async function getAllFromDB(database_id) {
  const pages = [];
  let cursor = undefined;

  do {
    const resp = await notion.databases.query({
      database_id,
      start_cursor: cursor,
      page_size: 100,
    });
    pages.push(...resp.results);
    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);

  return pages;
}

export default async function handler(req, res) {
  try {
    if (!process.env.NOTION_TOKEN) {
      return res.status(500).json({ ok: false, error: "Missing NOTION_TOKEN" });
    }
    if (!CONTENT_DB) {
      return res.status(500).json({ ok: false, error: "Missing NOTION_DATABASE_ID" });
    }

    // 1) CLIENTS
    let clients = [];
    if (CLIENTS_DB) {
      const clientPages = await getAllFromDB(CLIENTS_DB);
      clients = clientPages.map((p) => {
        const title = p.properties?.Name?.title?.[0]?.plain_text || "Sin nombre";
        return {
          id: p.id,
          name: title,
        };
      });
    }

    // 2) PROJECTS
    let projects = [];
    if (PROJECTS_DB) {
      const projectPages = await getAllFromDB(PROJECTS_DB);
      projects = projectPages.map((p) => {
        const title =
          p.properties?.["Project name"]?.title?.[0]?.plain_text ||
          p.properties?.Name?.title?.[0]?.plain_text ||
          "Sin nombre";

        // relación al cliente (puede venir vacía o múltiple)
        const rel = p.properties?.["Client"]?.relation || [];
        const clientIds = rel.map((r) => r.id);

        return {
          id: p.id,
          name: title,
          clientIds, // <- para el front "muéstrame solo los del cliente X"
        };
      });
    }

    // 3) CONTENT → owners, platforms, statuses
    const contentPages = await notion.databases.query({
      database_id: CONTENT_DB,
      page_size: 100,
    });

    const ownersSet = new Map();
    const platformsSet = new Set();
    const statusesSet = new Set();

    contentPages.results.forEach((page) => {
      const props = page.properties || {};

      // Owners (people)
      const people = props["Owner"]?.people || [];
      people.forEach((person) => {
        const name = person.name || person.id;
        ownersSet.set(person.id, name);
      });

      // Platforms (multi select)
      const platformMS = props["Platform"]?.multi_select || [];
      platformMS.forEach((pl) => {
        if (pl.name) platformsSet.add(pl.name);
      });

      // Status (status)
      const st = props["Status"]?.status?.name;
      if (st) statusesSet.add(st);
    });

    const owners = Array.from(ownersSet.entries()).map(([id, name]) => ({
      id,
      name,
    }));

    const platforms = Array.from(platformsSet).map((name) => ({
      id: name,
      name,
    }));

    const statuses = Array.from(statusesSet).map((name) => ({
      id: name,
      name,
    }));

    return res.status(200).json({
      ok: true,
      clients,
      projects,
      owners,
      platforms,
      statuses,
    });
  } catch (err) {
    console.error("FILTERS ERROR:", err);
    return res
      .status(500)
      .json({ ok: false, error: err.message || "Unknown error" });
  }
}
