// /api/diag.js
import { CONTENT_DB_ID, PROJECTS_DB_ID, CLIENTS_DB_ID } from './_notion.js';
import { getContentMeta, readOptions } from './schema.js';

export default async function handler(req, res) {
  try {
    const haveEnv = {
      NOTION_TOKEN: !!process.env.NOTION_TOKEN,
      NOTION_DB_ID: !!(process.env.NOTION_DB_ID || process.env.NOTION_DATABASE_ID || process.env.CONTENT_DB_ID),
      NOTION_DB_PROJECTS: !!(process.env.NOTION_DB_PROJECTS || process.env.PROJECTS_DB_ID),
      NOTION_DB_CLIENTS: !!(process.env.NOTION_DB_CLIENTS || process.env.CLIENTS_DB_ID),
    };

    let schema = null, platforms = [], statuses = [];
    if (CONTENT_DB_ID) {
      schema = await getContentMeta();
      platforms = readOptions(schema.raw, schema.platforms);
      statuses  = readOptions(schema.raw, schema.status);
    }

    res.status(200).json({
      ok: true,
      haveEnv,
      contentDbId: CONTENT_DB_ID || null,
      projectsDbId: PROJECTS_DB_ID || null,
      clientsDbId: CLIENTS_DB_ID || null,
      schema: schema ? {
        title: schema.title, date: schema.date, owners: schema.owners,
        status: schema.status, platforms: schema.platforms,
        files: schema.files, clientRel: schema.clientRel, projectRel: schema.projectRel
      } : null,
      platforms, statuses,
    });
  } catch (e) {
    res.status(200).json({ ok: false, error: e.message });
  }
}
