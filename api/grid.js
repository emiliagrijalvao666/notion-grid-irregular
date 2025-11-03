// /api/grid.js
import { schema } from './schema';
import { getNotionRows } from './_notion'; // tu helper existente

const CANVA_RE = /https?:\/\/(?:www\.)?canva\.com\/design\/([^\/?#\s]+)[^\s]*/i;
const DRIVE_FILE_RE = /https?:\/\/(?:drive\.google\.com\/file\/d\/|drive\.google\.com\/open\?id=|drive\.google\.com\/uc\?id=)([A-Za-z0-9_-]+)/i;
const DRIVE_QUERY_ID_RE = /[?&]id=([A-Za-z0-9_-]+)/i;

function splitLinks(text) {
  if (!text) return [];
  // separa por saltos de línea, comas y espacios múltiples
  return text.split(/[\n,\s]+/).map(s => s.trim()).filter(Boolean);
}

function driveIdFrom(url) {
  if (!url) return null;
  let m = url.match(DRIVE_FILE_RE);
  if (m && m[1]) return m[1];
  m = url.match(DRIVE_QUERY_ID_RE);
  if (m && m[1]) return m[1];
  // fallback: /folders/... no se embeddea
  return null;
}

async function canvaCover(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }});
    const html = await r.text();
    // busca og:image
    const m = html.match(/property=["']og:image["']\s+content=["']([^"']+)["']/i);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

async function resolveExternalLinks(linkTexts) {
  const media = [];
  for (const url of linkTexts) {
    if (!/^https?:\/\//i.test(url)) continue;

    // DRIVE
    const did = driveIdFrom(url);
    if (did) {
      media.push({
        kind: 'drive',
        href: `https://drive.google.com/file/d/${did}/preview`,
        cover: `https://drive.google.com/thumbnail?id=${did}`,
        label: 'Drive',
      });
      continue;
    }

    // CANVA
    if (CANVA_RE.test(url)) {
      const cover = await canvaCover(url); // puede ser null si no hay acceso
      media.push({
        kind: cover ? 'external-cover' : 'external',
        href: url,
        cover: cover || null,
        label: 'Canva',
      });
      continue;
    }

    // Otros externos
    media.push({ kind: 'external', href: url, cover: null, label: 'Link' });
  }
  return media;
}

function notionFilesToMedia(notionFilesProp) {
  // Notion files (Attachment) ya te daban portada; mantenemos eso
  if (!Array.isArray(notionFilesProp)) return [];
  return notionFilesProp.map(f => {
    const fileUrl = f?.file?.url || f?.external?.url || null;
    return fileUrl ? { kind: 'file', href: fileUrl, cover: fileUrl, label: 'File' } : null;
  }).filter(Boolean);
}

export default async function handler(req, res) {
  try {
    const rows = await getNotionRows(schema); // mantiene tu lógica
    const enriched = [];
    for (const row of rows) {
      const files = [];

      // 1) Files/Attachment de Notion (imágenes, videos subidos)
      const att = row.files?.Attachment;
      files.push(...notionFilesToMedia(att));

      // 2) Links externos desde texto (Link y/o Canva)
      const linkTxt = row.files?.Link;
      const canvaTxt = row.files?.Canva;
      const allTxt = splitLinks([linkTxt, canvaTxt].filter(Boolean).join('\n'));
      const ext = await resolveExternalLinks(allTxt);
      files.push(...ext);

      // cover del card = 1er media que tenga cover
      const cover = (files.find(f => f.cover)?.cover) || null;

      enriched.push({
        ...row,
        files,
        cover,
      });
    }
    res.json({ ok: true, rows: enriched });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || 'grid failed' });
  }
}
