// /api/grid.js
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

const TEXT_SPLIT = /[\n,;]+/;

function normalizeDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return {
    raw: dateStr,
    short: d.toLocaleDateString('es-EC', {
      month: 'short',
      day: 'numeric',
    }),
  };
}

function isDrive(url) {
  return typeof url === 'string' && url.includes('drive.google.com');
}

function toDrivePreview(url) {
  if (!url) return url;
  // /file/d/{id}/...
  if (url.includes('/file/d/')) {
    const m = url.match(/\/file\/d\/([^/]+)/);
    if (m) {
      return `https://drive.google.com/file/d/${m[1]}/preview`;
    }
  }
  // ?id=...
  if (url.includes('open?id=')) {
    const u = new URL(url);
    const id = u.searchParams.get('id');
    if (id) {
      return `https://drive.google.com/file/d/${id}/preview`;
    }
  }
  return url;
}

function isCanva(url) {
  return typeof url === 'string' && url.includes('canva.com');
}

export default async function handler(req, res) {
  try {
    const { client, project, platform, owner, status } = req.query;

    // 1. traemos las 3 bases
    const [contentPages, clientPages, projectPages] = await Promise.all([
      queryDatabase(CONTENT_DB_ID, {}),
      queryDatabase(CLIENTS_DB_ID, {}),
      queryDatabase(PROJECTS_DB_ID, {}),
    ]);

    // 2. mapa id -> nombre
    const clientMap  = pagesToMap(clientPages);
    const projectMap = pagesToMap(projectPages);

    const rows = [];

    for (const page of contentPages) {
      // CLIENTE
      const relClients = getProp(page, contentSchema.clientRel);
      const clientName = Array.isArray(relClients) && relClients.length
        ? (clientMap[relClients[0]] || null)
        : null;

      // PROYECTO
      const relProjects = getProp(page, contentSchema.projectRel);
      const projectName = Array.isArray(relProjects) && relProjects.length
        ? (projectMap[relProjects[0]] || null)
        : null;

      // ---- FILTROS (por NOMBRE) ----
      if (client && clientName !== client) continue;
      if (project && projectName !== project) continue;

      // PLATFORM
      const pagePlats = getProp(page, contentSchema.platforms);
      if (platform) {
        if (Array.isArray(pagePlats)) {
          if (!pagePlats.includes(platform)) continue;
        } else if (pagePlats !== platform) continue;
      }

      // OWNER
      const pageOwner = getProp(page, contentSchema.owners);
      if (owner && pageOwner !== owner) continue;

      // STATUS
      const pageStatus = getProp(page, contentSchema.status);
      if (status && pageStatus !== status) continue;

      // ---------- MEDIA ----------
      const medias = [];

      // 1) Attachment (files o external)
      const att = getProp(page, 'Attachment');
      if (Array.isArray(att) && att.length) {
        att.forEach(f => {
          if (f.external) {
            medias.push({
              type: 'external',
              src: f.external.url,
            });
          } else if (f.file) {
            // normalmente imagen
            medias.push({
              type: 'image',
              src: f.file.url,
            });
          }
        });
      }

      // helper para "limpiar" texto -> array de urls
      const addFromText = (text, labelHint) => {
        if (typeof text !== 'string' || !text.trim()) return;
        const parts = text.split(TEXT_SPLIT).map(s => s.trim()).filter(Boolean);
        parts.forEach(url => {
          if (isDrive(url)) {
            medias.push({
              type: 'external',
              src: toDrivePreview(url),
              label: 'drive',
            });
          } else if (isCanva(url)) {
            medias.push({
              type: 'external',
              src: url,
              label: 'canva',
            });
          } else {
            medias.push({
              type: 'external',
              src: url,
              label: labelHint || 'link',
            });
          }
        });
      };

      // 2) Link (texto)
      addFromText(getProp(page, 'Link'), 'link');

      // 3) Canva (texto)
      addFromText(getProp(page, 'Canva'), 'canva');

      // ---------- PREVIEW ----------
      let preview = null;
      let previewLabel = null;

      if (medias.length) {
        const first = medias[0];
        if (first.type === 'image') {
          preview = { type: 'image', src: first.src };
        } else {
          // external (canva, drive, etc)
          preview = { type: 'external' };
          previewLabel = first.label || 'external';
        }
      }

      // título / fecha
      const title =
        getProp(page, contentSchema.title) ||
        getProp(page, 'Name') ||
        projectName ||
        clientName ||
        '—';

      const date = normalizeDate(getProp(page, contentSchema.date));

      // mostramos copy SOLO cuando está abierto / publicado / aprobado
      const showCopy = !status || ['Publicado', 'Aprobado', 'Scheduled', 'Entregado'].includes(pageStatus || '');

      rows.push({
        id: page.id,
        title,
        client: clientName,
        project: projectName,
        owner: pageOwner || null,
        status: pageStatus || null,
        date,
        medias,
        preview,
        previewLabel,
        showCopy,
      });
    }

    // ordenamos por fecha descendente
    rows.sort((a, b) => {
      const da = a.date?.raw ? new Date(a.date.raw).getTime() : 0;
      const db = b.date?.raw ? new Date(b.date.raw).getTime() : 0;
      return db - da;
    });

    res.status(200).json({ rows });
  } catch (err) {
    console.error('grid error', err);
    res.status(500).json({ error: 'grid failed' });
  }
}
