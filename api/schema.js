// /api/schema.js
export const schema = {
  title: 'Post',
  date: 'Publish Date',
  owners: 'Owner',
  status: 'Status',
  platforms: 'Platform',
  // Puedes tener las tres; 'Link' y 'Canva' como texto; 'Attachment' como files
  files: ['Link', 'Canva', 'Attachment'],
  clientRel: 'Client',   // <- tal como lo usas
  projectRel: 'Project', // <- tal como lo usas
};
export default function handler(req, res) {
  res.json({ ok: true, schema });
}
