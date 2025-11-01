// api/filters.js
// Vercel serverless (Node.js). Install: npm i @notionhq/client
const { Client } = require('@notionhq/client');

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DB_CONTENT_ID = process.env.NOTION_DB_CONTENT_ID;
const NOTION_DB_CLIENTS_ID = process.env.NOTION_DB_CLIENTS_ID;
const CACHE_TTL = parseInt(process.env.CACHE_TTL_SECONDS || '300', 10); // default 5 min

if (!NOTION_TOKEN || !NOTION_DB_CONTENT_ID || !NOTION_DB_CLIENTS_ID) {
  console.error('Missing env vars. Please set NOTION_TOKEN, NOTION_DB_CONTENT_ID, NOTION_DB_CLIENTS_ID');
}

const notion = new Client({ auth: NOTION_TOKEN });

// Simple in-memory cache for serverless invocation (works per warm instance)
let CACHE = { ts: 0, payload: null };

/** Helper: extract client names/ids from a post object */
function extractClientsFromPost(p) {
  // 3 possibilities:
  // 1) relation present: properties.PostClient.relation -> [{id:...}, ...]
  // 2) rollup present: properties.PostClient.rollup -> array with title/text
  // 3) fallback: properties.PostClient?.select/text
  const props = p.properties || {};
  const key = props.PostClient || props['PostClient'] || props['postclient'];
  const result = [];

  if (!key) return result;

  // relation
  if (key.relation && Array.isArray(key.relation) && key.relation.length) {
    for (const r of key.relation) {
      if (r.id) result.push({ id: r.id, name: null });
    }
  }

  // rollup
  if (key.rollup && Array.isArray(key.rollup) && key.rollup.length) {
    // try to get a textual name from the rollup item
    for (const item of key.rollup) {
      // Common forms: title array or plain_text
      if (item.title && Array.isArray(item.title) && item.title[0] && item.title[0].plain_text) {
        result.push({ id: null, name: item.title[0].plain_text });
      } else if (typeof item === 'string') {
        result.push({ id: null, name: item });
      } else if (item.name) {
        result.push({ id: null, name: item.name });
      }
    }
  }

  // sometimes Notion returns plain text in rich_text
  if (key.rich_text && Array.isArray(key.rich_text) && key.rich_text.length) {
    const t = key.rich_text.map(t => t.plain_text).join('').trim();
    if (t) result.push({ id: null, name: t });
  }

  return result;
}

/** Fetch pages from Content DB (paginated), but stop early if too many pages */
async function fetchAllPosts(limitPages = 20) {
  const pageSize = 100;
  let cursor = undefined;
  let pages = 0;
  const all = [];

  while (pages < limitPages) {
    pages++;
    const body = {
      database_id: NOTION_DB_CONTENT_ID,
      page_size: pageSize,
      sorts: [{ property: 'Publish Date', direction: 'descending' }]
    };

    if (cursor) body.start_cursor = cursor;

    const res = await notion.databases.query(body);
    if (!res || !Array.isArray(res.results)) break;
    all.push(...res.results);
    if (!res.has_more) break;
    cursor = res.next_cursor;
  }

  return all;
}

/** Fetch clients DB (to map id->name) */
async function fetchClientsMap() {
  const map = new Map();
  const pageSize = 100;
  let cursor = undefined;
  while (true) {
    const body = { database_id: NOTION_DB_CLIENTS_ID, page_size: pageSize };
    if (cursor) body.start_cursor = cursor;
    const res = await notion.databases.query(body);
    if (!res) break;
    for (const p of res.results) {
      const nameProp = p.properties?.Name || p.properties?.name;
      let name = null;
      if (nameProp?.title && nameProp.title[0]) name = nameProp.title.map(t => t.plain_text).join('');
      map.set(p.id, name || null);
    }
    if (!res.has_more) break;
    cursor = res.next_cursor;
  }
  return map;
}

module.exports = async (req, res) => {
  try {
    // Cache check
    if (CACHE.payload && (Date.now() - CACHE.ts) / 1000 < CACHE_TTL) {
      return res.json({ ok: true, cached: true, ...CACHE.payload });
    }

    // Fetch posts (bounded)
    const posts = await fetchAllPosts(20); // 20 * 100 = up to 2000 posts (tweak if needed)
    const clientsMap = await fetchClientsMap(); // id -> name

    // counts
    const clientCounts = new Map();
    const projectCounts = new Map();
    const ownerCounts = new Map();
    const platformCounts = new Map();

    for (const p of posts) {
      // skip archived/hidden if those properties exist and are true
      const archived = p.properties?.Archivado?.checkbox === true;
      const hidden = p.properties?.Hide?.checkbox === true;
      if (archived || hidden) continue;

      // owner
      const owner = p.properties?.Owner?.people?.[0]?.name;
      if (owner) ownerCounts.set(owner, (ownerCounts.get(owner) || 0) + 1);

      // platforms (multi_select)
      const platforms = p.properties?.Platform?.multi_select || [];
      for (const pl of platforms) {
        const name = pl.name || pl;
        if (name) platformCounts.set(name, (platformCounts.get(name) || 0) + 1);
      }

      // client(s)
      const cands = extractClientsFromPost(p);
      if (cands.length) {
        for (const c of cands) {
          // Prefer id -> resolve name from clientsMap
          let name = c.name;
          if (!name && c.id && clientsMap.has(c.id)) name = clientsMap.get(c.id);
          if (!name) name = c.name || 'Unknown';
          clientCounts.set(name, (clientCounts.get(name) || 0) + 1);
        }
      } else {
        // fallback: maybe a text field "Client" exists
        const plainClient = (p.properties?.Client || p.properties?.ClientName)?.rich_text?.map(t => t.plain_text).join('') ||
                            p.properties?.Client?.title?.map(t => t.plain_text).join('');
        if (plainClient) clientCounts.set(plainClient, (clientCounts.get(plainClient) || 0) + 1);
      }

      // projects (try PostProject rollup)
      const projProp = p.properties?.PostProject;
      if (projProp) {
        // try rollup extraction
        if (projProp.rollup && Array.isArray(projProp.rollup) && projProp.rollup.length) {
          for (const item of projProp.rollup) {
            const name = (item.title && item.title[0] && item.title[0].plain_text) || item.name || null;
            if (name) projectCounts.set(name, (projectCounts.get(name) || 0) + 1);
          }
        } else if (projProp.relation && projProp.relation.length) {
          // relation -> name could be looked up but skip (clients map only)
          projectCounts.set('RelatedProject', (projectCounts.get('RelatedProject') || 0) + 1);
        }
      }
    }

    // convert to sorted arrays
    const toSorted = (map) => Array.from(map.entries()).map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    const payload = {
      clients: toSorted(clientCounts),
      projects: toSorted(projectCounts),
      platforms: toSorted(platformCounts),
      owners: toSorted(ownerCounts),
      total_posts_scanned: posts.length,
    };

    // cache
    CACHE = { ts: Date.now(), payload };

    return res.json({ ok: true, cached: false, ...payload });
  } catch (err) {
    console.error('filters error', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
