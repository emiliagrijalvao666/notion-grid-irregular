// /api/schema.js

// compat con tu Vercel: tú tienes NOTION_DB_ID, NOTION_DB_CLIENTS, NOTION_DB_PROJECTS
// y además tienes NOTION_DATABASE_ID. Dejamos fallback.
export const CONTENT_DB_ID =
  process.env.NOTION_DB_ID ||
  process.env.NOTION_DATABASE_ID;

export const CLIENTS_DB_ID = process.env.NOTION_DB_CLIENTS;
export const PROJECTS_DB_ID = process.env.NOTION_DB_PROJECTS;

// este es TU esquema real (el que vimos en el dump)
export const contentSchema = {
  title: 'Post',
  date: 'Publish Date',
  owners: 'Owner',
  status: 'Status',
  platforms: 'Platform',

  // aquí declaramos qué props pueden traer media
  files: ['Attachment', 'Link', 'Canva'],

  // en TU base la relación que sí está llena es "Client" y "Project"
  clientRel: 'Client',
  projectRel: 'Project',
};

// para paginaciones pequeñas
export const PAGE_SIZE = 200;
