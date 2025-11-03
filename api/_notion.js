// /api/_notion.js
import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_TOKEN });

export async function queryDatabase(dbId, body = {}) {
  const pages = [];
  let cursor = undefined;

  do {
    const res = await notion.databases.query({
      database_id: dbId,
      ...body,
      start_cursor: cursor,
    });
    pages.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);

  return pages;
}

export function getProp(page, name) {
  const p = page.properties?.[name];
  if (!p) return null;
  switch (p.type) {
    case 'title':
      return p.title.map(t => t.plain_text).join(' ');
    case 'rich_text':
      return p.rich_text.map(t => t.plain_text).join(' ');
    case 'select':
      return p.select ? p.select.name : null;
    case 'multi_select':
      return p.multi_select.map(s => s.name);
    case 'date':
      return p.date?.start || null;
    case 'relation':
      return p.relation?.map(r => r.id) || [];
    case 'files':
      return p.files || [];
    case 'url':
      return p.url || null;
    default:
      return null;
  }
}

export async function getPage(pageId) {
  return notion.pages.retrieve({ page_id: pageId });
}
