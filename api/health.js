// /api/health.js
export default async function handler(req, res) {
  const token = process.env.NOTION_TOKEN;
  const db =
    process.env.NOTION_DB_ID ||
    process.env.NOTION_DATABASE_ID ||
    process.env.NOTION_DB_CONTENT;

  return res.status(200).json({
    ok: !!(token && db),
    hasToken: !!token,
    hasDb: !!db,
    env: {
      NOTION_TOKEN: token ? "present" : "missing",
      NOTION_DB_ID_or_NOTION_DATABASE_ID: db ? "present" : "missing"
    }
  });
}
