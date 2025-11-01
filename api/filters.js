// api/filters.js
import { Client as NotionClient } from "@notionhq/client";

const NOTION_TOKEN =
  process.env.NOTION_TOKEN ||
  process.env.NOTION_SECRET || // por si lo nombraste así
  "";
const DB_ID =
  process.env.NOTION_DB_ID ||
  process.env.NOTION_DATABASE_ID || // por si lo nombraste así
  "";

export default async function handler(req, res) {
  // si NO hay credenciales: devolvemos filtros vacíos pero NO rompemos la UI
  if (!NOTION_TOKEN || !DB_ID) {
    return res.status(200).json({
      ok: true,
      warning: "NOTION_TOKEN or NOTION_DB_ID not found in env. Returning empty filters.",
      filters: {
        clients: [],
        projects: [],
        platforms: [],
        owners: [],
        statuses: [],
      },
    });
  }

  const notion = new NotionClient({ auth: NOTION_TOKEN });

  // helpers
  function getPlainTextFromFormula(prop) {
    if (!prop) return "";
    if (prop.type === "formula" && prop.formula.type === "string") {
      return prop.formula.string || "";
    }
    return "";
  }

  function getPlainTextFromRelation(prop) {
    if (!prop) return "";
    if (prop.type === "relation" && Array.isArray(prop.relation) && prop.relation.length > 0) {
      // Notion no da el nombre en la relation, solo el id
      return prop.relation[0].id;
    }
    return "";
  }

  function getPlainTextFromPeople(prop) {
    if (!prop) return "";
    if (prop.type === "people" && Array.isArray(prop.people) && prop.people.length > 0) {
      const p = prop.people[0];
      return p.name || p.id || "";
    }
    return "";
  }

  function getMultiSelectNames(prop) {
    if (!prop) return [];
    if (prop.type === "multi_select") {
      return prop.multi_select.map((o) => o.name).filter(Boolean);
    }
    return [];
  }

  function getStatusName(prop) {
    if (!prop) return "";
    if (prop.type === "status") {
      return prop.status?.name || "";
    }
    return "";
  }

  try {
    const pages = [];
    let cursor = undefined;

    do {
      const response = await notion.databases.query({
        database_id: DB_ID,
        start_cursor: cursor,
        page_size: 100,
        filter: {
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
        },
      });

      pages.push(...response.results);
      cursor = response.has_more ? response.next_cursor : undefined;
    } while (cursor);

    const clientsSet = new Set();
    const projectsSet = new Set();
    const platformsSet = new Set();
    const ownersSet = new Set();
    const statusesSet = new Set();

    for (const page of pages) {
      const props = page.properties || {};

      // CLIENTS
      const clientNameFromFormula = getPlainTextFromFormula(props["ClientName"]);
      if (clientNameFromFormula) {
        clientsSet.add(clientNameFromFormula);
      } else {
        const clientFromRelation = getPlainTextFromRelation(props["Client"]);
        if (clientFromRelation) clientsSet.add(clientFromRelation);
      }

      // PROJECTS
      const projectNameFromFormula = getPlainTextFromFormula(props["ProjectName"]);
      if (projectNameFromFormula) {
        projectsSet.add(projectNameFromFormula);
      } else {
        const projectFromRelation = getPlainTextFromRelation(props["Project"]);
        if (projectFromRelation) projectsSet.add(projectFromRelation);
      }

      // PLATFORMS
      const platforms = getMultiSelectNames(props["Platform"]);
      platforms.forEach((p) => platformsSet.add(p));

      // OWNERS
      const owner = getPlainTextFromPeople(props["Owner"]);
      if (owner) ownersSet.add(owner);

      // STATUS
      const st = getStatusName(props["Status"]);
      if (st) statusesSet.add(st);
    }

    const clients = Array.from(clientsSet).filter(Boolean).sort();
    const projects = Array.from(projectsSet).filter(Boolean).sort();
    const platforms = Array.from(platformsSet).filter(Boolean).sort();
    const owners = Array.from(ownersSet).filter(Boolean).sort();
    const statuses = Array.from(statusesSet).filter(Boolean).sort();

    return res.status(200).json({
      ok: true,
      filters: {
        clients,
        projects,
        platforms,
        owners,
        statuses,
      },
    });
  } catch (err) {
    console.error("filters error", err);
    return res.status(500).json({ ok: false, error: err.message || "Unknown error" });
  }
}
