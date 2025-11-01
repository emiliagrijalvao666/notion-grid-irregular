// /api/grid.js
import { Client } from "@notionhq/client";

const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

export default async function handler(req, res) {
  try {
    const {
      client = "all",
      project = "all",
      platform = "all",
      owner = "all",
      status = "all",
      pageSize = 12,
    } = req.query || {};

    const databaseId = process.env.NOTION_DATABASE_ID;
    if (!databaseId) {
      return res.status(500).json({
        ok: false,
        error: "Missing NOTION_DATABASE_ID",
      });
    }

    // 1. filtro base (para que NO vuelva el error de checkbox undefined)
    const filters = [
      {
        property: "Hide",
        checkbox: {
          equals: false,
        },
      },
      {
        property: "Archivado",
        checkbox: {
          equals: false,
        },
      },
    ];

    // 2. filtros dinámicos
    if (client !== "all") {
      filters.push({
        property: "Client",
        relation: {
          contains: client,
        },
      });
    }

    if (project !== "all") {
      filters.push({
        property: "Project",
        relation: {
          contains: project,
        },
      });
    }

    if (platform !== "all") {
      filters.push({
        property: "Platform",
        multi_select: {
          contains: platform,
        },
      });
    }

    if (owner !== "all") {
      filters.push({
        property: "Owner",
        people: {
          contains: owner,
        },
      });
    }

    if (status !== "all") {
      filters.push({
        property: "Status",
        status: {
          equals: status,
        },
      });
    }

    // 3. query a notion
    const query = await notion.databases.query({
      database_id: databaseId,
      filter: {
        and: filters,
      },
      sorts: [
        {
          property: "Publish Date",
          direction: "descending",
        },
      ],
      page_size: Number(pageSize) || 12,
    });

    // 4. mapear results a un formato que el front pueda pintar
    const items = query.results.map((page) => {
      const props = page.properties || {};

      // title
      const titleProp = props["Post"] || props["Name"] || props["Post "] || props["Aa Post"];
      const title =
        (titleProp &&
          titleProp.title &&
          titleProp.title.length &&
          titleProp.title[0].plain_text) ||
        "Sin nombre";

      // fecha
      const dateProp = props["Publish Date"] || props["Publish date"];
      const date = dateProp && dateProp.date ? dateProp.date.start : null;

      // client (relation)
      let clientName = "";
      if (props["Client"] && props["Client"].relation && props["Client"].relation.length > 0) {
        // cuando es relation, notion NO envía el nombre, solo el id
        // pero en /api/filters ya mandamos {id, name}, así que aquí devolvemos el id para matchear en front
        clientName = props["Client"].relation[0].id;
      }

      // project (relation)
      let projectName = "";
      if (props["Project"] && props["Project"].relation && props["Project"].relation.length > 0) {
        projectName = props["Project"].relation[0].id;
      }

      // owner
      let ownerId = "";
      let ownerName = "";
      if (props["Owner"] && props["Owner"].people && props["Owner"].people.length > 0) {
        ownerId = props["Owner"].people[0].id;
        ownerName = props["Owner"].people[0].name || "";
      }

      // status
      let statusName = "";
      if (props["Status"] && props["Status"].status) {
        statusName = props["Status"].status.name;
      }

      // media: Attachment, Link, Canva (en ese orden)
      const mediaProps = ["Attachment", "Link", "Canva"];
      const media = [];
      mediaProps.forEach((mp) => {
        const p = props[mp];
        if (p && p.files && p.files.length > 0) {
          p.files.forEach((f) => {
            // notion puede mandar file o external
            if (f.file && f.file.url) {
              media.push({ url: f.file.url, type: "image" });
            } else if (f.external && f.external.url) {
              // podría ser imagen o video externo, el front decide
              media.push({ url: f.external.url, type: "external" });
            }
          });
        }
      });

      const pinned = props["Pinned"] && props["Pinned"].checkbox === true;
      const isVideo =
        media.length > 0 &&
        (media[0].url.endsWith(".mp4") ||
          media[0].url.includes("vimeo") ||
          media[0].url.includes("youtube"));

      return {
        id: page.id,
        title,
        date,
        clientId: clientName,
        projectId: projectName,
        ownerId,
        ownerName,
        status: statusName,
        media,
        pinned,
        isVideo,
      };
    });

    // 5. devolver
    return res.status(200).json({
      ok: true,
      items,
    });
  } catch (err) {
    console.error("GRID ERROR", err.message);
    return res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
}
