// /api/grid.js
import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DB_ID = process.env.NOTION_DATABASE_ID || process.env.NOTION_DB_ID;

export default async function handler(req, res) {
  if (!DB_ID) {
    return res.status(500).json({ ok: false, error: "Missing NOTION_DATABASE_ID", posts: [] });
  }

  const {
    client = "",
    project = "",
    platform = "",
    owner = "",
    status = "",
    q = "",
    cursor = "",
  } = req.query;

  // armamos filtros dinámicos
  const andFilters = [];

  // excluir archivados/hide SOLO SI existen — lo probamos en 2 pasos
  // paso 1: intentamos con todo
  let queryBody = {
    database_id: DB_ID,
    page_size: 24,
  };

  // filtros de negocio
  if (client) {
    andFilters.push({
      property: "ClientName",
      rich_text: {
        equals: client,
      },
    });
  }

  if (project) {
    andFilters.push({
      property: "ProjectName",
      rich_text: {
        equals: project,
      },
    });
  }

  if (platform) {
    // puede llamarse Platform o Plataforma
    andFilters.push({
      or: [
        {
          property: "Platform",
          select: { equals: platform },
        },
        {
          property: "Plataforma",
          select: { equals: platform },
        },
        {
          property: "Platforms",
          multi_select: { contains: platform },
        },
      ],
    });
  }

  if (owner) {
    andFilters.push({
      property: "Owner",
      people: {
        contains: owner,
      },
    });
  }

  if (status) {
    andFilters.push({
      property: "Status",
      status: {
        equals: status,
      },
    });
  }

  if (q) {
    andFilters.push({
      property: "Name",
      title: {
        contains: q,
      },
    });
  }

  if (cursor) {
    queryBody.start_cursor = cursor;
  }

  // intentamos con Archivado + Hide
  if (andFilters.length) {
    queryBody.filter = {
      and: [
        {
          property: "Archivado",
          checkbox: { equals: false },
        },
        {
          property: "Hide",
          checkbox: { equals: false },
        },
        ...andFilters,
      ],
    };
  } else {
    queryBody.filter = {
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
    };
  }

  let data;
  try {
    data = await notion.databases.query(queryBody);
  } catch (err) {
    // si aquí te volviera a salir:
    // body.filter.and[0].or[1].checkbox.equals should be defined
    // es porque alguna de esas 2 propiedades no existe
    // volvemos a intentar SIN esos 2 filtros
    try {
      const fallbackBody = {
        database_id: DB_ID,
        page_size: 24,
      };
      if (andFilters.length) {
        fallbackBody.filter = { and: andFilters };
      }
      if (cursor) fallbackBody.start_cursor = cursor;
      data = await notion.databases.query(fallbackBody);
    } catch (err2) {
      return res
        .status(500)
        .json({ ok: false, error: err2.message, posts: [], has_more: false, next_cursor: null });
    }
  }

  const posts = data.results.map((page) => {
    const props = page.properties || {};
    const titleProp = props["Name"] || props["Título"] || props["Title"];
    const title =
      (titleProp?.title || [])
        .map((t) => t.plain_text)
        .join("")
        .trim() || "Untitled";

    const dateProp = props["Publish date"] || props["Fecha"] || props["Date"];
    const date =
      dateProp?.date?.start ||
      page.created_time?.split("T")[0] ||
      "";

    // imagen
    let cover = null;
    if (page.cover && page.cover.type === "file") {
      cover = page.cover.file.url;
    } else if (page.cover && page.cover.type === "external") {
      cover = page.cover.external.url;
    } else if (props["Media"] && props["Media"].type === "files") {
      if (props["Media"].files.length) {
        const f = props["Media"].files[0];
        cover = f.external?.url || f.file?.url || null;
      }
    }

    return {
      id: page.id,
      title,
      publish_date: date,
      cover,
    };
  });

  return res.status(200).json({
    ok: true,
    posts,
    has_more: data.has_more,
    next_cursor: data.has_more ? data.next_cursor : null,
  });
}
