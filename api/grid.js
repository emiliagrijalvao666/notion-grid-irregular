// /api/grid.js
import { Client } from "@notionhq/client";

const notion = new Client({
  auth: process.env.NOTION_TOKEN
});

// helper para sacar texto plano de rich_text / title
function plain(rt = []) {
  if (!Array.isArray(rt)) return "";
  return rt.map((r) => r.plain_text || "").join("");
}

// saca el title principal de la página
function getTitle(prop = {}) {
  if (!prop) return "";
  if (prop.type === "title") return plain(prop.title);
  if (prop.type === "rich_text") return plain(prop.rich_text);
  return "";
}

// saca la fecha de publicación
function getDate(prop = {}) {
  if (prop.type === "date" && prop.date && prop.date.start) {
    return prop.date.start;
  }
  return null;
}

// saca el status
function getStatus(prop = {}) {
  if (prop.type === "status" && prop.status) {
    return prop.status.name;
  }
  return null;
}

// multi-select → array de strings
function getMulti(prop = {}) {
  if (prop.type === "multi_select" && Array.isArray(prop.multi_select)) {
    return prop.multi_select.map((m) => m.name).filter(Boolean);
  }
  return [];
}

// person → array de names
function getPeople(prop = {}) {
  if (prop.type === "people" && Array.isArray(prop.people)) {
    return prop.people.map((p) => p.name || p.id).filter(Boolean);
  }
  return [];
}

// files → assets
function getAssets(prop = {}) {
  if (prop.type === "files" && Array.isArray(prop.files)) {
    return prop.files.map((f) => {
      if (f.type === "file") {
        return { url: f.file.url, type: "image", source: "file" };
      } else if (f.type === "external") {
        return { url: f.external.url, type: "image", source: "external" };
      }
      return null;
    }).filter(Boolean);
  }
  return [];
}

// rollup que puede traer relations adentro
function extractRollupItems(prop) {
  const names = new Set();
  const relationIds = new Set();
  if (!prop) return { names: [], relationIds: [] };

  if (prop.type === "rollup") {
    const r = prop.rollup || {};
    if (r.type === "array" && Array.isArray(r.array)) {
      r.array.forEach((item) => {
        // relación embebida
        if (item.relation && Array.isArray(item.relation)) {
          item.relation.forEach((rel) => {
            if (rel.id) relationIds.add(rel.id);
          });
        }
        // item con title
        else if (item.title) {
          const s = plain(item.title);
          if (s) names.add(s);
        }
        // item con rich_text
        else if (item.rich_text) {
          const s = plain(item.rich_text);
          if (s) names.add(s);
        }
        // item con name
        else if (item.name) {
          names.add(item.name);
        }
      });
    } else if (r.type === "rich_text" && r.rich_text) {
      const s = plain(r.rich_text);
      if (s) names.add(s);
    }
  }

  return {
    names: Array.from(names),
    relationIds: Array.from(relationIds)
  };
}

// trae título de varias páginas (para cuando el rollup viene como relation-id)
async function fetchTitlesForIds(ids = []) {
  const out = {};
  const BATCH = 20;
  for (let i = 0; i < ids.length; i += BATCH) {
    const slice = ids.slice(i, i + BATCH);
    await Promise.all(
      slice.map(async (id) => {
        try {
          const page = await notion.pages.retrieve({ page_id: id });
          const t =
            getTitle(page.properties?.Name) ||
            getTitle(page.properties?.title) ||
            page.id;
          out[id] = t;
        } catch (e) {
          out[id] = "—";
        }
      })
    );
  }
  return out;
}

// pagina todo el contenido
async function fetchAllFromDB(dbId, extraFilter = null) {
  const pages = [];
  let cursor = undefined;

  // filtro base: no archivado, no hide
  const baseFilter = {
    and: [
      {
        property: "Archivado",
        checkbox: {
          does_not_equal: true
        }
      },
      {
        property: "Hide",
        checkbox: {
          does_not_equal: true
        }
      }
    ]
  };

  // si el cliente mandó otro filtro lo metemos al AND
  if (extraFilter) {
    baseFilter.and.push(extraFilter);
  }

  do {
    const resp = await notion.databases.query({
      database_id: dbId,
      filter: baseFilter,
      start_cursor: cursor
    });
    pages.push(...resp.results);
    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);

  return pages;
}

export default async function handler(req, res) {
  const token = process.env.NOTION_TOKEN;
  const dbId =
    process.env.NOTION_DB_ID ||
    process.env.NOTION_DATABASE_ID ||
    process.env.NOTION_DB_CONTENT;

  if (!token || !dbId) {
    return res.status(500).json({
      ok: false,
      error: "Missing NOTION_TOKEN or NOTION_DB_ID"
    });
  }

  try {
    // parámetros del front
    const {
      client = "all",
      project = "all",
      brand = "all",
      platform = "all",
      status = "publishedOnly" // default
    } = req.query;

    // status filter
    let extraFilter = null;
    if (status && status !== "all" && status !== "publishedOnly") {
      // filtrar por un status exacto
      extraFilter = {
        property: "Status",
        status: { equals: status }
      };
    } else if (status === "publishedOnly") {
      // publicar solo "Publicado" o "Aprobado"
      extraFilter = {
        or: [
          {
            property: "Status",
            status: { equals: "Publicado" }
          },
          {
            property: "Status",
            status: { equals: "Aprobado" }
          }
        ]
      };
    }

    // 1. Traemos TODO lo que pase el filtro base + status
    const pages = await fetchAllFromDB(dbId, extraFilter);

    // sets para filtros
    const clientsSet = new Set();
    const brandsSet = new Set();
    const projectsSet = new Set();
    const platformsSet = new Set();
    const ownersSet = new Set();
    const statusesSet = new Set();

    // ids pendientes de rollups
    const pendingClientIds = new Set();
    const pendingBrandIds = new Set();
    const pendingProjectIds = new Set();

    // 2. normalizamos posts
    const posts = pages.map((pg) => {
      const p = pg.properties || {};

      const title =
        getTitle(p.Name) ||
        getTitle(p.title) ||
        "Untitled";
      const date = getDate(p["Publish Date"] || p["Fecha"] || {});
      const statusName = getStatus(p.Status || {});
      if (statusName) statusesSet.add(statusName);

      const platforms = getMulti(p.Platform || p.Platforms || {});
      platforms.forEach((pl) => platformsSet.add(pl));

      const owners = getPeople(p.Owner || p.Owners || {});
      owners.forEach((o) => ownersSet.add(o));

      // rollups:
      const postClient = p.PostClient;
      const postBrands = p.PostBrands;
      const postProject = p.PostProject;

      const extractedClients = extractRollupItems(postClient);
      const extractedBrands = extractRollupItems(postBrands);

      extractedClients.names.forEach((n) => clientsSet.add(n));
      extractedBrands.names.forEach((n) => brandsSet.add(n));
      extractedClients.relationIds.forEach((id) => pendingClientIds.add(id));
      extractedBrands.relationIds.forEach((id) => pendingBrandIds.add(id));

      // project
      let projectNames = [];
      if (postProject) {
        if (postProject.type === "relation") {
          (postProject.relation || []).forEach((rel) => {
            if (rel.id) pendingProjectIds.add(rel.id);
          });
          projectNames = (postProject.relation || []).map((rel) => ({
            __pid: rel.id
          }));
        } else if (postProject.type === "rollup") {
          const ex = extractRollupItems(postProject);
          projectNames = ex.names.map((n) => n);
          ex.relationIds.forEach((id) => pendingProjectIds.add(id));
        }
      }

      // assets
      const assets =
        getAssets(p.Attachments || p.Assets || p.Files || {}) ||
        [];

      // copy
      let copy = "";
      if (p.Copy && p.Copy.type === "rich_text") {
        copy = plain(p.Copy.rich_text);
      }

      // hide/archived (ya filtramos, pero lo mandamos igual)
      const hidden =
        p.Hide && p.Hide.type === "checkbox" ? !!p.Hide.checkbox : false;
      const archived =
        p.Archivado && p.Archivado.type === "checkbox"
          ? !!p.Archivado.checkbox
          : false;

      return {
        id: pg.id,
        title,
        date,
        status: statusName,
        platforms,
        owners,
        clients: extractedClients.names,
        brands: extractedBrands.names,
        projectNames,
        hidden,
        archived,
        copy,
        assets
      };
    });

    // 3. resolver los IDs pendientes de rollups
    const [clientsMap, brandsMap, projectsMap] = await Promise.all([
      fetchTitlesForIds(Array.from(pendingClientIds)),
      fetchTitlesForIds(Array.from(pendingBrandIds)),
      fetchTitlesForIds(Array.from(pendingProjectIds))
    ]);

    // 4. sustituir en los posts los que vinieron como {__pid:...}
    posts.forEach((post) => {
      // clients: si venía vacío pero había ids, rellenamos con todos los nombres conocidos
      if ((!post.clients || post.clients.length === 0) &&
          Object.keys(clientsMap).length) {
        post.clients = Array.from(new Set(Object.values(clientsMap)));
      }

      if ((!post.brands || post.brands.length === 0) &&
          Object.keys(brandsMap).length) {
        post.brands = Array.from(new Set(Object.values(brandsMap)));
      }

      if (Array.isArray(post.projectNames)) {
        const resolved = [];
        post.projectNames.forEach((p) => {
          if (p && p.__pid) {
            const t = projectsMap[p.__pid];
            if (t) resolved.push(t);
          } else if (typeof p === "string") {
            resolved.push(p);
          }
        });
        post.projectNames = resolved;
        resolved.forEach((r) => projectsSet.add(r));
      }
    });

    // 5. construir respuesta
    return res.status(200).json({
      ok: true,
      posts,
      filters: {
        clients: Array.from(clientsSet).filter(Boolean).sort(),
        projects: Array.from(projectsSet).filter(Boolean).sort(),
        brands: Array.from(brandsSet).filter(Boolean).sort(),
        platforms: Array.from(platformsSet).filter(Boolean).sort(),
        owners: Array.from(ownersSet).filter(Boolean).sort(),
        statuses: Array.from(statusesSet).filter(Boolean).sort()
      }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      ok: false,
      error: err.message || "Unknown error"
    });
  }
}
