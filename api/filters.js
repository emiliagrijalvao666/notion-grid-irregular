// /api/filters.js
import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DB_ID = process.env.NOTION_DATABASE_ID || process.env.NOTION_DB_ID;

export default async function handler(req, res) {
  if (!DB_ID) {
    return res.status(500).json({
      ok: false,
      error: "Missing NOTION_DATABASE_ID",
      clients: [],
      projects: [],
      platforms: [],
      owners: [],
      statuses: [],
    });
  }

  // 1) primero intentamos con los 2 checkboxes
  let pages = [];
  try {
    const first = await notion.databases.query({
      database_id: DB_ID,
      page_size: 100,
      filter: {
        and: [
          {
            property: "Archivado",
            checkbox: { equals: false },
          },
          {
            property: "Hide",
            checkbox: { equals: false },
          },
        ],
      },
    });
    pages = first.results;

    // si hay más páginas, las traemos rápido
    let cursor = first.has_more ? first.next_cursor : null;
    while (cursor) {
      const next = await notion.databases.query({
        database_id: DB_ID,
        page_size: 100,
        start_cursor: cursor,
      });
      pages = pages.concat(next.results);
      cursor = next.has_more ? next.next_cursor : null;
    }
  } catch (err) {
    // 2) si falló es porque alguna de las dos columnas no existe (pasó eso contigo antes)
    // volvemos a intentar SIN los checkboxes
    try {
      const fallback = await notion.databases.query({
        database_id: DB_ID,
        page_size: 100,
      });
      pages = fallback.results;
    } catch (err2) {
      return res.status(500).json({
        ok: false,
        error: err2.message,
        clients: [],
        projects: [],
        platforms: [],
        owners: [],
        statuses: [],
      });
    }
  }

  // ahora sí: recolectamos
  const clientsMap = new Map();
  const projectsMap = new Map();
  const platformsSet = new Set();
  const ownersMap = new Map();
  const statusesSet = new Set();

  for (const page of pages) {
    const props = page.properties || {};

    // --- CLIENTES: usamos SOLO ClientName (formula)
    const clientProp = props["ClientName"];
    if (clientProp && clientProp.type === "rich_text") {
      const txt = clientProp.rich_text.map((t) => t.plain_text).join("").trim();
      if (txt) {
        clientsMap.set(txt, (clientsMap.get(txt) || 0) + 1);
      }
    }

    // --- PROYECTOS: ProjectName (formula)
    const projectProp = props["ProjectName"];
    if (projectProp && projectProp.type === "rich_text") {
      const txt = projectProp.rich_text.map((t) => t.plain_text).join("").trim();
      if (txt) {
        projectsMap.set(txt, (projectsMap.get(txt) || 0) + 1);
      }
    }

    // --- PLATAFORMAS: puede ser "Platform" o "Plataforma" o "Platforms"
    let platformValue = null;
    if (props["Platform"] && props["Platform"].type === "select") {
      platformValue = props["Platform"].select?.name;
    } else if (props["Plataforma"] && props["Plataforma"].type === "select") {
      platformValue = props["Plataforma"].select?.name;
    } else if (props["Platforms"] && props["Platforms"].type === "multi_select") {
      // por si alguien puso varias
      const arr = props["Platforms"].multi_select.map((m) => m.name).filter(Boolean);
      arr.forEach((x) => platformsSet.add(x));
    }
    if (platformValue) {
      platformsSet.add(platformValue);
    }

    // --- OWNERS: person
    if (props["Owner"] && props["Owner"].type === "people") {
      const people = props["Owner"].people || [];
      people.forEach((p) => {
        const name = p.name || p.person?.email || "Unknown";
        ownersMap.set(name, (ownersMap.get(name) || 0) + 1);
      });
    }

    // --- STATUS
    if (props["Status"] && props["Status"].type === "status") {
      const st = props["Status"].status?.name;
      if (st) statusesSet.add(st);
    }
  }

  // convertimos a arrays ordenados
  const clients = Array.from(clientsMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  const projects = Array.from(projectsMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  const owners = Array.from(ownersMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  const platforms = Array.from(platformsSet.values()).sort((a, b) => a.localeCompare(b));

  const statuses = Array.from(statusesSet.values());

  return res.status(200).json({
    ok: true,
    clients,
    projects,
    platforms,
    owners,
    statuses,
  });
}
