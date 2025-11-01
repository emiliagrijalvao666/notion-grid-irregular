// /api/grid.js
// Kemi 2025-10 — versión que NO rompe nada y acepta varias envs
export default async function handler(req, res) {
  // 1. intentar todos los nombres posibles
  const NOTION_TOKEN =
    process.env.NOTION_TOKEN ||
    process.env.NOTION_SECRET ||
    req.headers["x-notion-token"] ||
    req.query.token ||
    "";

  const NOTION_DB_ID =
    process.env.NOTION_DB_ID ||
    process.env.NOTION_DATABASE_ID ||
    req.headers["x-notion-db"] ||
    req.query.db ||
    "";

  if (!NOTION_TOKEN || !NOTION_DB_ID) {
    return res.status(200).json({
      ok: false,
      error: "Missing NOTION_TOKEN or NOTION_DB_ID",
    });
  }

  // 2. leer los filtros que vienen del front
  const {
    client = "All Clients",
    project = "All Projects",
    platform = "All Platforms",
    owner = "All Owners",
    status = "All Status",
  } = req.query;

  // 3. función para pedir páginas de Notion con paginación
  async function fetchAllPages() {
    const url = `https://api.notion.com/v1/databases/${NOTION_DB_ID}/query`;
    const headers = {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    };

    let hasMore = true;
    let cursor = undefined;
    const pages = [];

    // filtro BASE: siempre ocultar Hide = true y Archivado = true
    const baseFilter = {
      and: [
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
      ],
    };

    while (hasMore) {
      const body = {
        filter: baseFilter,
        page_size: 100,
      };
      if (cursor) body.start_cursor = cursor;

      const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error("Notion query failed: " + text);
      }

      const data = await resp.json();
      pages.push(...data.results);
      hasMore = data.has_more;
      cursor = data.next_cursor;
    }

    return pages;
  }

  // 4. helpers para extraer propiedades de Notion
  function getTitle(p) {
    const prop = p.properties?.Post || p.properties?.Name || p.properties?.title;
    if (!prop) return "Untitled";
    const text = prop.title?.[0]?.plain_text;
    return text || "Untitled";
  }

  function getDate(p) {
    const prop = p.properties?.["Publish Date"];
    return prop?.date?.start || "";
  }

  // aquí VIENE LO IMPORTANTE:
  // ya no usamos PostClient / PostProject
  // usamos directamente Client (relation) y Project (relation)
  function getClients(p) {
    const rel = p.properties?.["Client"];
    if (!rel || rel.type !== "relation") return [];
    return (rel.relation || []).map((r) => r.id); // ids
  }

  // para mostrar nombres en el dropdown necesitamos texto, no ids
  // así que también intentamos leer la fórmula ClientName si existe
  function getClientNameFromFormula(p) {
    const f = p.properties?.["ClientName"];
    if (f && f.type === "formula") {
      const v = f.formula?.string;
      if (v) return v;
    }
    return null;
  }

  function getProjects(p) {
    const rel = p.properties?.["Project"];
    if (!rel || rel.type !== "relation") return [];
    return (rel.relation || []).map((r) => r.id);
  }

  function getProjectNameFromFormula(p) {
    const f = p.properties?.["ProjectName"];
    if (f && f.type === "formula") {
      const v = f.formula?.string;
      if (v) return v;
    }
    return null;
  }

  function getPlatforms(p) {
    const ms = p.properties?.["Platform"];
    if (!ms || ms.type !== "multi_select") return [];
    return ms.multi_select.map((o) => o.name).filter(Boolean);
  }

  function getOwners(p) {
    const ppl = p.properties?.["Owner"];
    if (!ppl || ppl.type !== "people") return [];
    return ppl.people.map((u) => u.name || u.id).filter(Boolean);
  }

  function getStatus(p) {
    const st = p.properties?.["Status"];
    if (!st || st.type !== "status") return "";
    return st.status?.name || "";
  }

  function getAttachment(p) {
    const att = p.properties?.["Attachment"];
    if (!att || att.type !== "files") return "";
    const file = att.files[0];
    if (!file) return "";
    if (file.external) return file.external.url;
    if (file.file) return file.file.url;
    return "";
  }

  function getPinned(p) {
    const pin = p.properties?.["Pinned"];
    if (!pin || pin.type !== "checkbox") return false;
    return !!pin.checkbox;
  }

  // 5. proceso principal
  try {
    const pages = await fetchAllPages();

    // para armar los dropdowns de client / project vamos a usar
    // 1) si existe fórmula ClientName / ProjectName, usamos eso
    // 2) si no, usamos el ID de la relation (para no dejar vacío)
    const clientSet = new Map(); // texto -> true
    const projectSet = new Map();
    const platformSet = new Map();
    const ownerSet = new Map();
    const statusSet = new Map();

    // adaptamos las páginas a un formato plano
    const flat = pages.map((p) => {
      const title = getTitle(p);
      const publishDate = getDate(p);
      const statusVal = getStatus(p);
      const platforms = getPlatforms(p);
      const owners = getOwners(p);
      const pinned = getPinned(p);
      const attachment = getAttachment(p);

      const clientFormulaName = getClientNameFromFormula(p);
      const projectFormulaName = getProjectNameFromFormula(p);

      const clientIds = getClients(p);
      const projectIds = getProjects(p);

      // client display
      const clientDisplay =
        clientFormulaName && clientFormulaName.trim().length > 0
          ? [clientFormulaName]
          : clientIds.length
          ? clientIds
          : [];

      // project display
      const projectDisplay =
        projectFormulaName && projectFormulaName.trim().length > 0
          ? [projectFormulaName]
          : projectIds.length
          ? projectIds
          : [];

      // ir llenando sets
      clientDisplay.forEach((c) => clientSet.set(c, true));
      projectDisplay.forEach((pname) => projectSet.set(pname, true));
      platforms.forEach((pl) => platformSet.set(pl, true));
      owners.forEach((o) => ownerSet.set(o, true));
      if (statusVal) statusSet.set(statusVal, true);

      return {
        id: p.id,
        title,
        publishDate,
        status: statusVal,
        clients: clientDisplay,
        projects: projectDisplay,
        platforms,
        owners,
        pinned,
        attachment,
      };
    });

    // 6. aplicar filtros del query (en memoria)
    const filtered = flat.filter((item) => {
      // client
      if (client !== "All Clients") {
        if (!item.clients.includes(client)) return false;
      }
      // project
      if (project !== "All Projects") {
        if (!item.projects.includes(project)) return false;
      }
      // platform
      if (platform !== "All Platforms") {
        if (!item.platforms.includes(platform)) return false;
      }
      // owner
      if (owner !== "All Owners") {
        if (!item.owners.includes(owner)) return false;
      }
      // status
      if (status !== "All Status") {
        if (item.status !== status) return false;
      }
      return true;
    });

    // 7. armar respuesta
    return res.status(200).json({
      ok: true,
      posts: filtered,
      filters: {
        clients: Array.from(clientSet.keys()).map((name) => ({ name })),
        projects: Array.from(projectSet.keys()).map((name) => ({ name })),
        platforms: Array.from(platformSet.keys()).map((name) => ({ name })),
        owners: Array.from(ownerSet.keys()).map((name) => ({ name })),
        statuses: Array.from(statusSet.keys()).map((name) => ({ name })),
      },
    });
  } catch (err) {
    return res.status(200).json({
      ok: false,
      error: err.message || "Unexpected error",
      posts: [],
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
