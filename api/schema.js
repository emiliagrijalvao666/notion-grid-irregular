// /api/schema.js
export const SCHEMA = {
  POSTS_DB_ID: process.env.NOTION_DATABASE_ID,     // Posts
  CLIENTS_DB_ID: process.env.NOTION_DB_CLIENTS,    // Clients
  PROJECTS_DB_ID: process.env.NOTION_DB_PROJECTS,  // Projects

  // Nombres de propiedades en tu DB de Posts (ajusta si difieren)
  PROPS: {
    title: 'Name',                 // Título
    date: 'Publish Date',          // Fecha (date)
    clients: 'PostClient',         // Relation → Clients
    projects: 'PostProject',       // Relation → Projects
    platform: 'Platform',          // Select
    owners: 'Owner',               // People
    status: 'Status',              // Status
    pinned: 'Pinned',              // Checkbox
    hide: 'Hide',                  // Checkbox (si no existe, se ignora)
    archived: 'Archivado',         // Checkbox (si no existe, se ignora)
    // Archivos (files & media):
    fileA: 'Attachment',
    fileB: 'Link',
    fileC: 'Canva Design',
  },

  // En Projects, relación hacia Client
  PROJECTS_CLIENT_PROP: 'Client',  // Relation (Projects → Clients)
};
