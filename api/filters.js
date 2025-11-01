// api/filters.js
import { Client as NotionClient } from "@notionhq/client";

const notion = new NotionClient({
  auth: process.env.NOTION_TOKEN,
});

const DB_ID = process.env.NOTION_DB_ID;

// helpers
function getPlainTextFromFormula(prop) {
  if (!prop) return "";
  if (prop.type === "formula") {
    if (prop.formula.type === "string") return prop.formula.string || "";
  }
  return "";
}

function getPlainTextFromRelation(prop) {
  // por si algún día quieres leer directo de la relation
  if (!prop) return "";
  if (prop.type === "relation" && Array.isArray(prop.relation) && prop.relation.length > 0) {
    // Notion no da el nombre aquí, solo el id
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

export default async function handler(req, res) {
  if (!DB_ID || !process.env.NOTION_TOKEN) {
    return res.status(500).json({ ok: false, error: "Missing NOTION_TOKEN or NOTION_DB_ID" });
  }

  try {
    const pages = [];
    let cursor = undefined;

    // traemos TODO lo visible (sin Hide y sin Archivado)
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

    // sets
    const clientsSet = new Set();
    const projectsSet = new Set();
    const platformsSet = new Set();
    const ownersSet = new Set();
    const statusesSet = new Set();

    for (const page of pages) {
      const props = page.properties || {};

      // CLIENTS
      // 1) fórmula ClientName (la que acabas de corregir)
      const clientNameFromFormula = getPlainTextFromFormula(props["ClientName"]);
      if (clientNameFromFormula) {
        clientsSet.add(clientNameFromFormula);
      } else {
        // 2) por si tienes algo directo en Client
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

      // PLATFORMS (multi-select)
      const platforms = getMultiSelectNames(props["Platform"]);
      platforms.forEach((p) => platformsSet.add(p));

      // OWNERS (people)
      const owner = getPlainTextFromPeople(props["Owner"]);
      if (owner) ownersSet.add(owner);

      // STATUS
      const st = getStatusName(props["Status"]);
      if (st) statusesSet.add(st);
    }

    // ordenar un poco
    const clients = Array.from(clientsSet).filter(Boolean).sort((a, b) => a.localeCompare(b));
    const projects = Array.from(projectsSet).filter(Boolean).sort((a, b) => a.localeCompare(b));
    const platforms = Array.from(platformsSet).filter(Boolean).sort((a, b) => a.localeCompare(b));
    const owners = Array.from(ownersSet).filter(Boolean).sort((a, b) => a.localeCompare(b));
    const statuses = Array.from(statusesSet).filter(Boolean).sort((a, b) => a.localeCompare(b));

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
