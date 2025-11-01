// /api/filters.js
import { Client as NotionClient } from "@notionhq/client";

export default async function handler(req, res) {
  const token = process.env.NOTION_TOKEN;
  const contentDB = process.env.NOTION_DATABASE_ID;
  const clientsDB = process.env.NOTION_DB_CLIENTS;
  const projectsDB = process.env.NOTION_DB_PROJECTS;

  if (!token || !contentDB) {
    return res.status(500).json({
      ok: false,
      error: "Missing NOTION_TOKEN or NOTION_DATABASE_ID",
    });
  }

  const notion = new NotionClient({ auth: token });

  // 1) leemos TODOS los posts de la DB CONTENT
  const posts = [];
  let cursor = undefined;
  try {
    do {
      const r = await notion.databases.query({
        database_id: contentDB,
        start_cursor: cursor,
        page_size: 100,
      });
      posts.push(...r.results);
      cursor = r.has_more ? r.next_cursor : undefined;
    } while (cursor);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "Error leyendo posts: " + err.message,
    });
  }

  // 2) recolectamos ids que aparecen en los posts
  const clientIds = new Set();
  const projectIds = new Set();
  const platforms = new Set();
  const owners = new Map(); // id -> name
  const statuses = new Set();

  for (const page of posts) {
    const props = page.properties || {};

    // Client (RELATION)
    if (props.Client && props.Client.type === "relation") {
      for (const rel of props.Client.relation) {
        clientIds.add(rel.id);
      }
    }

    // Project (RELATION)
    if (props.Project && props.Project.type === "relation") {
      for (const rel of props.Project.relation) {
        projectIds.add(rel.id);
      }
    }

    // Platform (MULTI-SELECT)
    if (props.Platform && props.Platform.type === "multi_select") {
      for (const m of props.Platform.multi_select) {
        platforms.add(m.name);
      }
    }

    // Owner (PEOPLE)
    if (props.Owner && props.Owner.type === "people") {
      for (const p of props.Owner.people) {
        const niceName = p.name || p.person?.email || p.id;
        owners.set(p.id, niceName);
      }
    }

    // Status (STATUS)
    if (props.Status && props.Status.type === "status") {
      const st = props.Status.status;
      if (st && st.name) {
        statuses.add(st.name);
      }
    }
  }

  // 3) traemos las DB auxiliares para traducir ids → nombre
  // --- CLIENTS ---
  const clientMap = {}; // id -> { id, name }
  if (clientsDB) {
    let cCursor = undefined;
    const clientPages = [];
    do {
      const r = await notion.databases.query({
        database_id: clientsDB,
        start_cursor: cCursor,
        page_size: 100,
      });
      clientPages.push(...r.results);
      cCursor = r.has_more ? r.next_cursor : undefined;
    } while (cCursor);

    for (const cp of clientPages) {
      // trataremos de adivinar la prop de título
      const titleProp =
        cp.properties.Name ||
        cp.properties.Client ||
        cp.properties.Title ||
        cp.properties["Cliente"];
      let name = "";
      if (titleProp && titleProp.type === "title") {
        name =
          (titleProp.title[0] && titleProp.title[0].plain_text) || "";
      }
      clientMap[cp.id] = {
        id: cp.id,
        name: name || cp.id,
      };
    }
  }

  // --- PROJECTS ---
  const projectMap = {}; // id -> { id, name, clientIds: [] }
  if (projectsDB) {
    let pCursor = undefined;
    const projectPages = [];
    do {
      const r = await notion.databases.query({
        database_id: projectsDB,
        start_cursor: pCursor,
        page_size: 100,
      });
      projectPages.push(...r.results);
      pCursor = r.has_more ? r.next_cursor : undefined;
    } while (pCursor);

    for (const pp of projectPages) {
      const titleProp =
        pp.properties.Name ||
        pp.properties.Project ||
        pp.properties.Title ||
        pp.properties["Proyecto"];
      let name = "";
      if (titleProp && titleProp.type === "title") {
        name =
          (titleProp.title[0] && titleProp.title[0].plain_text) || "";
      }

      // aquí es donde vemos con qué cliente(s) se relaciona este proyecto
      // asumo que tu DB Projects tiene una relation con Clients que se llama "Client" o "Cliente"
      let projClientIds = [];
      const projClientProp =
        pp.properties.Client ||
        pp.properties.Cliente ||
        pp.properties["Clients"];
      if (
        projClientProp &&
        projClientProp.type === "relation" &&
        projClientProp.relation.length > 0
      ) {
        projClientIds = projClientProp.relation.map((r) => r.id);
      }

      projectMap[pp.id] = {
        id: pp.id,
        name: name || pp.id,
        clientIds: projClientIds,
      };
    }
  }

  // 4) armamos la respuesta final PARA EL FRONT
  return res.status(200).json({
    ok: true,
    filters: {
      // siempre ponemos una opción "All ..."
      clients: [
        { id: "all", name: "All Clients" },
        ...Array.from(clientIds).map((id) => {
          // si no encontramos el nombre, devolvemos el id
          return clientMap[id] || { id, name: id };
        }),
      ],
      projects: [
        { id: "all", name: "All Projects", clientIds: [] },
        ...Array.from(projectIds).map((id) => {
          return (
            projectMap[id] || {
              id,
              name: id,
              clientIds: [],
            }
          );
        }),
      ],
      platforms: ["All Platforms", ...Array.from(platforms)],
      owners: [
        { id: "all", name: "All Owners" },
        ...Array.from(owners.entries()).map(([id, name]) => ({
          id,
          name,
        })),
      ],
      statuses: ["All Status", ...Array.from(statuses)],
    },
  });
}
