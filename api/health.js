const { Client } = require('@notionhq/client');

function getDbId() {
  return process.env.NOTION_DB_ID
      || process.env.NOTION_DATABASE_ID
      || process.env.NOTION_DB_CONTENT
      || process.env.NOTION_DB;
}

module.exports = async (req, res) => {
  const token = process.env.NOTION_TOKEN;
  const db = getDbId();
  const hasToken = !!token;
  const hasDb = !!db;

  // Intento mínimo de conexión si hay credenciales
  let ok = false, errors = [];
  if (hasToken && hasDb) {
    try {
      const notion = new Client({ auth: token });
      await notion.databases.retrieve({ database_id: db });
      ok = true;
    } catch (e) {
      ok = false;
      errors.push(e.message || String(e));
    }
  }

  res.setHeader('Content-Type', 'application/json');
  res.status(200).send(JSON.stringify({
    ok,
    hasToken,
    hasDb,
    env: {
      NOTION_TOKEN: hasToken ? 'present' : 'missing',
      NOTION_DB_ID_or_NOTION_DATABASE_ID: hasDb ? 'present' : 'missing'
    },
    now: new Date().toISOString(),
    errors
  }));
};
