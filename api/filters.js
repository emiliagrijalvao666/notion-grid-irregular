// /api/filters.js
import {
  CONTENT_DB_ID,
  CLIENTS_DB_ID,
  PROJECTS_DB_ID,
  contentSchema,
} from './schema.js';

import {
  queryDatabase,
  getProp,
  pagesToMap,
} from './_notion.js';

export default async function handler(req, res) {
  try {
    // leemos las 3 bases
    const [contentPages, clientPages, projectPages] = await Promise.all([
      queryDatabase(CONTENT_DB_ID, {}),
      queryDatabase(CLIENTS_DB_ID, {}),
      queryDatabase(PROJECTS_DB_ID, {}),
    ]);

    const clientMap  = pagesToMap(clientPages);
    const projectMap = pagesToMap(projectPages);

    const clients   = new Set();
    const projects  = new Set();
    const platforms = new Set();
    const owners    = new Set();
    const statuses  = new Set();

    for (const p of contentPages) {
      // CLIENTS
      const relClients = getProp(p, contentSchema.clientRel);
      if (Array.isArray(relClients)) {
        relClients.forEach(id => {
          const name = clientMap[id];
          if (name) clients.add(name);
        });
      }

      // PROJECTS
      const relProjects = getProp(p, contentSchema.projectRel);
      if (Array.isArray(relProjects)) {
        relProjects.forEach(id => {
          const name = projectMap[id];
          if (name) projects.add(name);
        });
      }

      // PLATFORM
      const pls = getProp(p, contentSchema.platforms);
      if (Array.isArray(pls)) {
        pls.forEach(pl => platforms.add(pl));
      } else if (typeof pls === 'string' && pls) {
        platforms.add(pls);
      }

      // OWNER
      const ow = getProp(p, contentSchema.owners);
      if (typeof ow === 'string' && ow) owners.add(ow);

      // STATUS
      const st = getProp(p, contentSchema.status);
      if (typeof st === 'string' && st) statuses.add(st);
    }

    res.status(200).json({
      clients:   Array.from(clients).sort(),
      projects:  Array.from(projects).sort(),
      platforms: Array.from(platforms).sort(),
      owners:    Array.from(owners).sort(),
      statuses:  Array.from(statuses).sort(),
    });
  } catch (err) {
    console.error('filters error', err);
    res.status(500).json({ error: 'filters failed' });
  }
}
