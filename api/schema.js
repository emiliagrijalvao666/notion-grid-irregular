// /api/schema.js
export const CONTENT_DB_ID = process.env.NOTION_DB_ID;          // posts
export const PROJECTS_DB_ID = process.env.NOTION_DB_PROJECTS;   // projects
export const CLIENTS_DB_ID  = process.env.NOTION_DB_CLIENTS;    // clients

// esto es LO QUE YA TENÍAS en el dump que me pasaste:
export const contentSchema = {
  title: 'Post',
  date: 'Publish Date',
  owners: 'Owner',
  status: 'Status',
  platforms: 'Platform',

  // archivos / medias
  files: ['Link', 'Canva', 'Attachment'],

  // relaciones
  clientRel: 'Client',
  projectRel: 'Project',           // 👈 OJO: aquí usamos "Project" porque es la que tú usas y SÍ está llena
  // si algún día vuelves a usar “PostProject” lo activamos de nuevo
};

// helpers para nombres que mostramos en filtros
export const FILTER_LIMIT = 200;
