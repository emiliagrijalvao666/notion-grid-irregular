// /api/schema.js
export const SCHEMA = {
  POSTS_DB_ID: process.env.NOTION_DATABASE_ID,
  CLIENTS_DB_ID: process.env.NOTION_DB_CLIENTS || null,   // opcional
  PROJECTS_DB_ID: process.env.NOTION_DB_PROJECTS || null, // opcional
};

// Lista de candidatos por tipo para autodetección
export const CANDIDATES = {
  title:        ['Name','Title','Post Title'],
  date:         ['Publish Date','Date','Fecha'],
  clients:      ['Client','PostClient'],                 // <— preferimos Client
  projects:     ['Project name','Project','PostProject'],
  platform:     ['Platform','Platforms','Channel'],
  owners:       ['Owner','Owners'],
  status:       ['Status'],
  pinned:       ['Pinned'],
  hide:         ['Hide','Ocultar'],
  archived:     ['Archivado','Archived'],

  files:        ['Attachment','Link','Canva Design']     // files & media
};
