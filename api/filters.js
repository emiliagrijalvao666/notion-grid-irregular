// /api/filters.js
import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DB_ID = process.env.NOTION_DATABASE_ID || process.env.NOTION_DB_ID || process.env.NOTION_DB_CONTENT;

function getRollupNames(prop) {
  // rollup → array de relaciones → cada una tiene title
  if (!prop) return [];
  if (prop.type === "rollup") {
    const arr = prop.rollup?.array || [];
    return arr
      .map((item) => {
        // item puede ser 'title', 'rich_text' o 'people'
        if (item.type === "title" && item.title.length) {
          return item.title.map(t => t.plain_text).join(" ");
        }
        if (item.type === "rich_text" && item.rich_text.length) {
          return item.rich_text.map(t => t.plain_text).join(" ");
        }
        if (item.type === "people" && item.people.length) {
          return item.people.map(p => p.name).join(" ");
        }
        // si es una page relation: suele venir como 'relation'
        if (item.type === "relation" && item.relation.length) {
          // aquí no tenemos el título directamente
          return null;
        }
        return null;
      })
      .filter(Boolean);
  }
  return [];
}

function getRelationNames(prop) {
  if (!prop) return [];
  if (prop.type === "relation") {
    // ojo: relation sola NO trae el nombre, solo el id de la page
    // así que aquí sólo vamos a devolver el id para no romper
    return prop.relation.map((r) => r.id);
  }
  return [];
}

function getSelectValues(prop) {
  if (!prop) return [];
  if (prop.type === "select") {
    return [prop.select.name];
  }
  if (prop.type === "multi_select") {
    return prop.multi_select.map((m) => m.name);
  }
  return [];
}

function getPeople(prop) {
  if (!prop) return [];
  if (prop.type === "people") {
    return prop.people.map((p) => p.name || p.id);
  }
  return [];
}

export default async function handler(req, res) {
  if (!DB_ID) {
    return res.status(500).json({ ok: false, error: "Missing database id" });
  }

  const filter = {
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
  };

  let hasMore = true;
  let start_cursor = undefined;

  const clientCounts = {};
  const projectCounts = {};
  const platformSet = new Set();
  const ownerCounts = {};
  const statusSet = new Set();

  try {
    while (hasMore) {
      const resp = await notion.databases.query({
        database_id: DB_ID,
        filter,
        start_cursor,
      });

      for (const page of resp.results) {
        const props = page.properties || {};

        // 1) CLIENTES desde PostClient (rollup)
        const rollupClients = getRollupNames(props.PostClient);
        rollupClients.forEach((name) => {
          clientCounts[name] = (clientCounts[name] || 0) + 1;
        });

        // 2) PROYECTOS desde PostProject (relation)
        const relProjects = getRelationNames(props.PostProject);
        // como relation no trae el nombre, al menos guardamos el id para que no se rompa
        relProjects.forEach((id) => {
          if (!id) return;
          projectCounts[id] = (projectCounts[id] || 0) + 1;
        });

        // 3) PLATAFORMAS
        const plats = getSelectValues(props.Platforms || props.Platform || props.Plataforma);
        plats.forEach((p) => platformSet.add(p));

        // 4) OWNERS
        const owners = getPeople(props.Owner || props.Owners);
        owners.forEach((o) => {
          ownerCounts[o] = (ownerCounts[o] || 0) + 1;
        });

        // 5) STATUS (para que el frontend pueda pintar el dropdown real)
        if (props.Status && props.Status.type === "status" && props.Status.status) {
          statusSet.add(props.Status.status.name);
        }
      }

      hasMore = resp.has_more;
      start_cursor = resp.next_cursor;
    }

    // ordenar clientes por count desc
    const clients = Object.entries(clientCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    // proyectos: por ahora vendrán con id, hasta que configuremos ClientName/ProjectName
    const projects = Object.entries(projectCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    const platforms = Array.from(platformSet).filter(Boolean);
    const owners = Object.entries(ownerCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    const statuses = Array.from(statusSet).filter(Boolean);

    return res.json({
      ok: true,
      clients,
      projects,
      platforms,
      owners,
      statuses,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
