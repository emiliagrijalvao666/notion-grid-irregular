// /api/filters.js
import { Client } from "@notionhq/client";
const notion = new Client({ auth: process.env.NOTION_TOKEN });

const CACHE = { time: 0, data: null };
const TTL = 5 * 60 * 1000; // 5 min

async function fetchClientsCounts(dbContentId) {
  // Similar a fetchAllFromDB con filtros Archivado/Hide, pero solo contamos client rollups
  // Para perf: consulta paginada y cuenta rollup values (names) y relation ids fallback
  // (Implementación simplificada — usa tu función fetchAllFromDB existente)
  // retorno: [{ name, count }]
}

async function fetchProjectsForClient(clientNameOrId, projectsDbId) {
  // Strategy A: if projectsDbId provided -> query Projects DB filtering by relation to client (by id)
  // Strategy B: fallback -> scan content DB and aggregate posts with matching rollup client
  // retorno: [{ name, count }]
}

export default async function handler(req, res) {
  try {
    const now = Date.now();
    if (CACHE.data && (now - CACHE.time) < TTL && !req.query.client) {
      // return cached only for global filters (no client param)
      return res.json(CACHE.data);
    }

    const dbContent = process.env.NOTION_DB_CONTENT;
    if (!dbContent) return res.status(500).json({ ok: false, error: "Missing NOTION_DB_CONTENT env" });

    // 1) Build clients (counts) — prefer cached or compute
    // Use your existing fetchAllFromDB() logic and aggregation
    const clients = await buildClientsList(dbContent); // implement using earlier code: clientsArr

    const out = { clients, platforms: /*...*/, owners: /*...*/, statuses: /*...*/ };

    // 2) if client provided, also compute projects & brands filtered
    if (req.query.client) {
      const client = req.query.client;
      const projectsDbId = process.env.NOTION_DB_PROJECTS;
      const brandsDbId = process.env.NOTION_DB_BRANDS;
      const projects = projectsDbId ? await fetchProjectsForClient(client, projectsDbId) : await fetchProjectsFromContent(client, dbContent);
      const brands = brandsDbId ? await fetchBrandsForClient(client, brandsDbId) : await fetchBrandsFromContent(client, dbContent);
      out.projects = projects;
      out.brands = brands;
    }

    // Cache global (only when no client filter)
    if (!req.query.client) {
      CACHE.time = Date.now();
      CACHE.data = out;
    }

    return res.json(out);
  } catch (err) {
    console.error("FILTERS ERROR", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
