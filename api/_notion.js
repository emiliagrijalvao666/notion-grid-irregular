// /api/_notion.js
import { Client } from '@notionhq/client';

export const notion = new Client({ auth: process.env.NOTION_TOKEN });

// Fallbacks para que funcione con tus vars actuales
export const CONTENT_DB_ID =
  process.env.CONTENT_DB_ID ||
  process.env.NOTION_DB_ID ||
  process.env.NOTION_DATABASE_ID || null;

export const PROJECTS_DB_ID =
  process.env.PROJECTS_DB_ID ||
  process.env.NOTION_DB_PROJECTS ||
  process.env.PROJECTS_DATABASE_ID || null;

export const CLIENTS_DB_ID =
  process.env.CLIENTS_DB_ID ||
  process.env.NOTION_DB_CLIENTS || null;

export function ensureEnv() {
  if (!process.env.NOTION_TOKEN) throw new Error('Missing NOTION_TOKEN');
  if (!CONTENT_DB_ID) throw new Error('Missing CONTENT_DB_ID/NOTION_DB_ID');
}

export async function safe(promise) {
  try { return await promise; }
  catch (e) { console.error('[Notion]', e?.message || e); return null; }
}
