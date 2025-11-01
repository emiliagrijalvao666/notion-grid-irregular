// /api/schema.js
import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DB_ID = process.env.NOTION_DATABASE_ID || process.env.NOTION_DB_ID;

export default async function handler(req, res) {
  if (!DB_ID) {
    return res.status(500).json({ ok: false, error: "Missing DB id" });
  }
  try {
    const db = await notion.databases.retrieve({ database_id: DB_ID });
    return res.status(200).json({ ok: true, properties: db.properties });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
