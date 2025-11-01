// /api/schema.js
import { notion, CONTENT_DB_ID } from './_notion.js';

export async function getContentMeta() {
  const meta = await notion.databases.retrieve({ database_id: CONTENT_DB_ID });
  const props = meta.properties;

  const firstOf = (type) =>
    Object.entries(props).find(([, p]) => p.type === type)?.[0];

  const findBy = (type, re) =>
    Object.entries(props).find(([k, p]) => p.type === type && re.test(k))?.[0];

  const title     = firstOf('title');
  const date      = findBy('date', /publish|date|fecha/i) || firstOf('date');
  const owners    = findBy('people', /owner|owners|dueñ/i) || firstOf('people');
  const status    = findBy('status', /status/i) || findBy('select', /status/i);
  const platforms = findBy('multi_select', /platform/i) || findBy('select', /platform/i);
  const pinned    = findBy('checkbox', /pin|pinned/i);
  const copy      = findBy('rich_text', /copy|descrip|texto/i);

  const files = Object.entries(props)
    .filter(([, p]) => p.type === 'files')
    .map(([k]) => k); // e.g., ["Attachment","Image Source","Canva Design"]

  const clientRel  = findBy('relation', /client|postclient/i);
  const projectRel = findBy('relation', /project|postproject/i);

  return { title, date, owners, status, platforms, pinned, copy, files, clientRel, projectRel, raw: meta };
}

export function readOptions(meta, propName) {
  if (!propName) return [];
  const p = meta.properties[propName];
  if (!p) return [];
  const t = p.type;
  const path = t === 'status' ? 'status' : (t === 'select' ? 'select' : 'multi_select');
  return p[path]?.options?.map(o => o.name) || [];
}
