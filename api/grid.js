// /api/grid.js
import {
  CONTENT_DB_ID,
  contentSchema,
} from './schema.js';

import {
  queryDatabase,
  getProp,
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
  if (!url) return false;
  return url.includes('drive.google.com');
}

function toDrivePreview(url) {
  // soporta: https://drive.google.com/file/d/ID/view?...
  //          https://drive.google.com/open?id=ID
  if (!url) return url;
  if (url.includes('/file/d/')) {
    const m = url.match(/\/file\/d\/([^/]+)/);
    if (m) {
      return `https://drive.google.com/file/d/${m[1]}/preview`;
    }
  }
  if (url.includes('open?id=')) {
    const u = new URL(url);
    const id = u.searchParams.get('id');
    if (id) return `https://drive.google.com/file/d/${id}/preview`;
  }
  // carpeta → no hay preview
  return url;
}

function isCanva(url) {
  if (!url) return false;
  return url.includes('canva.com');
}

// convierte strings (link o canva) en medias
function linksToMedias(arr, label = 'external') {
  return arr
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((url) => ({
      type: 'external',
      src: url,
      label,
    }));
}

export default async function handler(req, res) {
  try {
    const {
      client,
      project,
      platform,
      owner,
      status,
      cursor,
    } = req.query;

    // NOTA: estamos trayendo todo porque tu DB no es gigante aún
    const pages = await queryDatabase(CONTENT_DB_ID, {});

    let items = [];

    for (const page of pages) {
      // FILTROS
      // client
      let pageClient = getProp(page, contentSchema.clientRel);
      // en tu caso suele venir como texto directo por el publish de la vista
      if (Array.isArray(pageClient) && pageClient.length === 0) {
        pageClient = null;
      }

      if (client && pageClient !== client) continue;

      // project
      const pageProject = getProp(page, contentSchema.projectRel);
      if (project && pageProject !== project) continue;

      // platform
      let pagePlatforms = getProp(page, contentSchema.platforms);
      if (platform) {
        if (Array.isArray(pagePlatforms)) {
          if (!pagePlatforms.includes(platform)) continue;
        } else if (pagePlatforms !== platform) {
          continue;
        }
      }

      // owner
      const pageOwner = getProp(page, contentSchema.owners);
      if (owner && pageOwner !== owner) continue;

      // status
      const pageStatus = getProp(page, contentSchema.status);
      if (status && pageStatus !== status) continue;

      // -----------------------------
      // MEDIAS
      // -----------------------------
      let medias = [];
      let preview = null;
      let previewLabel = null;

      // 1) attachments (Notion files)
      const notionFiles = getProp(page, 'Attachment');
      if (Array.isArray(notionFiles) && notionFiles.length) {
        notionFiles.forEach((f) => {
          if (f.external) {
            medias.push({
              type: 'external',
              src: f.external.url,
            });
          } else if (f.file) {
            medias.push({
              type: 'image',
              src: f.file.url,
            });
          }
        });
      }

      // 2) LINK (texto)
      const rawLink = getProp(page, 'Link');
      if (typeof rawLink === 'string' && rawLink.trim()) {
        const parts = rawLink.split(TEXT_SPLIT).map(s => s.trim()).filter(Boolean);
        parts.forEach((url) => {
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
              label: 'link',
            });
          }
        });
      }

      // 3) CANVA (texto)
      const rawCanva = getProp(page, 'Canva');
      if (typeof rawCanva === 'string' && rawCanva.trim()) {
        const parts = rawCanva.split(TEXT_SPLIT).map(s => s.trim()).filter(Boolean);
        parts.forEach((url) => {
          medias.push({
            type: 'external',
            src: url,
            label: 'canva',
          });
        });
      }

      // elegir preview
      if (medias.length) {
        const first = medias[0];
        if (first.type === 'image') {
          preview = {
            type: 'image',
            src: first.src,
          };
        } else if (first.type === 'external') {
          preview = {
            type: 'external',
          };
          previewLabel = first.label || 'external';
        } else if (first.type === 'video') {
          preview = {
            type: 'video',
          };
        }
      } else {
        preview = null;
      }

      // title
      const title = getProp(page, contentSchema.title) || getProp(page, 'Name') || null;
      const date = normalizeDate(getProp(page, contentSchema.date));

      // copy: SOLO si el status es "Publicado", "Aprobado", "Scheduled", etc.
      // para no mostrar tus copies internos
      let copy = '';
      const safeStatuses = ['Publicado', 'Aprobado', 'Scheduled', 'Entregado'];
      if (safeStatuses.includes(pageStatus)) {
        copy = title || '';
      }

      items.push({
        id: page.id,
        title: title,
        clientName: pageClient,
        clientShort: pageClient ? pageClient.slice(0, 2).toUpperCase() : null,
        projectName: pageProject,
        date: date?.raw || null,
        dateShort: date?.short || null,
        status: pageStatus,
        owner: pageOwner,
        medias,
        mediaCount: medias.length,
        preview,
        previewLabel,
        copy,
      });
    }

    // orden: por fecha desc y luego creado
    items.sort((a, b) => {
      if (a.date && b.date) {
        return new Date(b.date) - new Date(a.date);
      }
      if (a.date && !b.date) return -1;
      if (!a.date && b.date) return 1;
      return 0;
    });

    // paginación simple
    const PAGE_SIZE = 50;
    let result = items;
    let nextCursor = null;

    if (cursor) {
      const n = Number(cursor);
      result = items.slice(n, n + PAGE_SIZE);
      if (n + PAGE_SIZE < items.length) {
        nextCursor = String(n + PAGE_SIZE);
      }
    } else {
      result = items.slice(0, PAGE_SIZE);
      if (PAGE_SIZE < items.length) {
        nextCursor = String(PAGE_SIZE);
      }
    }

    res.status(200).json({
      items: result,
      nextCursor,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'grid failed' });
  }
}
