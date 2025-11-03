// /api/filters.js
import { CONTENT_DB_ID, contentSchema } from './schema.js';
import { queryDatabase, getProp } from './_notion.js';

export default async function handler(req, res) {
  try {
    const pages = await queryDatabase(CONTENT_DB_ID, {
      page_size: 100,
    });

    const clients = new Set();
    const projects = new Set();
    const platforms = new Set();
    const owners = new Set();
    const statuses = new Set();

    for (const p of pages) {
      // client
      const c = getProp(p, contentSchema.clientRel);
      if (Array.isArray(c) && c.length === 0) {
        // nada
      } else if (typeof c === 'string') {
        clients.add(c);
      }

      // project (relación)
      const proj = getProp(p, contentSchema.projectRel);
      if (typeof proj === 'string' && proj) {
        projects.add(proj);
      }

      // plataforma
      const pls = getProp(p, contentSchema.platforms);
      if (Array.isArray(pls)) {
        pls.forEach(pl => platforms.add(pl));
      } else if (typeof pls === 'string' && pls) {
        platforms.add(pls);
      }

      // owner
      const o = getProp(p, contentSchema.owners);
      if (typeof o === 'string' && o) {
        owners.add(o);
      }

      // status
      const st = getProp(p, contentSchema.status);
      if (typeof st === 'string' && st) {
        statuses.add(st);
      }
    }

    res.status(200).json({
      clients: Array.from(clients).sort(),
      projects: Array.from(projects).sort(),
      platforms: Array.from(platforms).sort(),
      owners: Array.from(owners).sort(),
      statuses: Array.from(statuses).sort(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'filters failed' });
  }
}
