// api/filters.js  (ESM)
import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DB_CONTENT  = process.env.NOTION_DATABASE_ID;
const DB_CLIENTS  = process.env.NOTION_DB_CLIENTS;
const DB_PROJECTS = process.env.NOTION_DB_PROJECTS;

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }
  if (!process.env.NOTION_TOKEN || !DB_CONTENT) {
    res.status(200).json({ ok: false, error: "Missing NOTION_TOKEN or NOTION_DATABASE_ID" });
    return;
  }

  try {
    // schema de Content para options (status/platform)
    const schema = await notion.databases.retrieve({ database_id: DB_CONTENT });

    // Clients de su DB específica (si existe)
    const clients = DB_CLIENTS
      ? await collectFromDB(DB_CLIENTS, page => ({
          id: page.id,
          name: page.properties["Name"]?.title?.[0]?.plain_text || "Sin nombre"
        }))
      : await collectClientsFromContent(DB_CONTENT);

    // Projects + relación con clientes
    const projects = DB_PROJECTS
      ? await collectFromDB(DB_PROJECTS, page => ({
          id: page.id,
          name: page.properties["Project name"]?.title?.[0]?.plain_text
             || page.properties["Name"]?.title?.[0]?.plain_text
             || "Sin nombre",
          clientIds: (page.properties["Client"]?.relation || []).map(r => r.id)
        }))
      : await collectProjectsFromContent(DB_CONTENT);

    // Owners: gente que aparece en la DB de contenido (paginación completa)
    const ownersMap = new Map();
    await paginateDB(DB_CONTENT, (page) => {
      const people = page.properties["Owner"]?.people || [];
      people.forEach(p => {
        if (!ownersMap.has(p.id)) ownersMap.set(p.id, { id: p.id, name: p.name || "Unknown" });
      });
    });
    const owners = Array.from(ownersMap.values());

    // Platforms: opciones de select desde schema
    const platforms = (schema.properties["Platform"]?.select?.options || []).map(o => o.name);

    // Statuses: opciones de status desde schema
    const statuses = (schema.properties["Status"]?.status?.options || []).map(o => ({ name: o.name }));

    res.status(200).json({
      ok: true,
      clients,
      projects,
      owners,
      platforms,
      statuses
    });
  } catch (err) {
    res.status(200).json({ ok: false, error: err.message || String(err) });
  }
}

// ---------- helpers ----------

async function collectFromDB(database_id, mapFn) {
  const out = [];
  await paginateDB(database_id, (page) => out.push(mapFn(page)));
  return out;
}

async function collectClientsFromContent(DB_CONTENT) {
  const map = new Map();
  await paginateDB(DB_CONTENT, (page) => {
    const rels = page.properties["Client"]?.relation || page.properties["PostClient"]?.relation || [];
    rels.forEach(r => map.set(r.id, { id: r.id, name: r.id })); // sin nombre real desde Content
    const name = page.properties["ClientName"]?.rich_text?.[0]?.plain_text;
    if (name) {
      // cuando no tenemos id, aún exponemos el nombre (id sintético)
      const syntheticId = `name:${name}`;
      if (!map.has(syntheticId)) map.set(syntheticId, { id: syntheticId, name });
    }
  });
  return Array.from(map.values());
}

async function collectProjectsFromContent(DB_CONTENT) {
  const map = new Map();
  await paginateDB(DB_CONTENT, (page) => {
    const rels = page.properties["Project"]?.relation || [];
    rels.forEach(r => map.set(r.id, { id: r.id, name: r.id, clientIds: [] }));
    const name = page.properties["ProjectName"]?.rich_text?.[0]?.plain_text;
    if (name) {
      const syntheticId = `name:${name}`;
      if (!map.has(syntheticId)) map.set(syntheticId, { id: syntheticId, name, clientIds: [] });
    }
  });
  return Array.from(map.values());
}

async function paginateDB(database_id, onPage, page_size = 100) {
  let cursor;
  do {
    const resp = await notion.databases.query({
      database_id,
      start_cursor: cursor,
      page_size
    });
    resp.results.forEach(onPage);
    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);
}
