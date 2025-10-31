// /api/health.js
export default function handler(req, res) {
  const token = process.env.NOTION_TOKEN;
  // aceptar varios nombres
  const dbId =
    process.env.NOTION_DATABASE_ID ||
    process.env.NOTION_DB_ID ||
    process.env.NOTION_DB_CONTENT;

  const ok = !!token && !!dbId;

  return res.status(ok ? 200 : 500).json({
    ok,
    hasToken: !!token,
    hasDb: !!dbId,
    env: {
      NOTION_TOKEN: token ? "present" : "missing",
      NOTION_DATABASE_ID: process.env.NOTION_DATABASE_ID || "missing",
      NOTION_DB_ID: process.env.NOTION_DB_ID || "missing",
      NOTION_DB_CONTENT: process.env.NOTION_DB_CONTENT || "missing",
    },
  });
}
