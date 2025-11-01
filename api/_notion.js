import { Client } from "@notionhq/client";

export const notion = new Client({
  auth: process.env.NOTION_TOKEN
});

// IDs de bases (env)
export const DB = {
  content: process.env.CONTENT_DB_ID,        // DB de contenido (posts)
  projects: process.env.PROJECTS_DB_ID || "" // Opcional (catálogo de proyectos)
};

export function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }

export function err(res, code, msg){
  return res.status(code).json({ ok:false, error: msg || 'error' });
}

// Utilidades para leer propiedades de Notion
export function titleOf(page){
  const prop = Object.values(page.properties).find(p=>p.type==='title');
  if(!prop) return 'Untitled';
  const t = (prop.title||[]).map(r=>r.plain_text).join('').trim();
  return t || 'Untitled';
}
export function richText(prop){
  if(!prop) return '';
  if(prop.type === 'rich_text') return (prop.rich_text||[]).map(r=>r.plain_text).join('').trim();
  if(prop.type === 'title') return (prop.title||[]).map(r=>r.plain_text).join('').trim();
  return '';
}
export function prop(meta, candidates){
  for(const key of Object.keys(meta.properties||{})){
    const norm = key.toLowerCase().trim();
    if(candidates.some(c => norm === c.toLowerCase().trim())) return key;
  }
  return null;
}
export async function getDbMeta(dbId){
  try { return await notion.databases.retrieve({ database_id: dbId }); }
  catch { return null; }
}
export async function getPageTitle(pageId){
  try { const pg = await notion.pages.retrieve({ page_id: pageId }); return titleOf(pg); }
  catch { return 'Untitled'; }
}
