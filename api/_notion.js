import { Client } from "@notionhq/client";

export const notion = new Client({ auth: process.env.NOTION_TOKEN });

export function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

export const DB_IDS = {
  posts: process.env.NOTION_DATABASE_ID,
  clients: process.env.NOTION_DB_CLIENTS || null,
  projects: process.env.NOTION_DB_PROJECTS || null,
};
