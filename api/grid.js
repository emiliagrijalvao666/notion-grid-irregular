// api/grid.js
const { Client } = require('@notionhq/client');

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DB_CONTENT_ID = process.env.NOTION_DB_CONTENT_ID;
const NOTION_DB_CLIENTS_ID = process.env.NOTION_DB_CLIENTS_ID;

if (!NOTION_TOKEN || !NOTION_DB_CONTENT_ID) {
  console.error('Missing NOTION_TOKEN or NOTION_DB_CONTENT_ID');
}

const notion = new Client({ auth: NOTION_TOKEN });

function safeBoolParam(v) {
  if (v === undefined) return undefined;
  if (v === '1' || v === 'true') return true;
  if (v === '0' || v === 'false') return false;
  return undefined;
}

function buildBaseFilters({ includeArchived = false, includeHidden = false }) {
  // We want to EXCLUDE archived and hidden by default (so equals: false)
  const f = [];
  if (!includeArchived) {
    f.push({ property: 'Archivado', checkbox: { equals: false } });
  }
  if (!includeHidden) {
    f.push({ property: 'Hide', checkbox: { equals: false } });
  }
  return f;
}

async function resolveClientIdByName(name) {
  if (!name) return null;
  // Query Clients DB by Name equals
  const res = await notion.databases.query({
    database_id: NOTION_DB_CLIENTS_ID,
    filter: {
      property: 'Name',
      title: {
        equals: name
      }
    },
    page_size: 1
  });
  if (res && res.results && res.results[0]) return res.results[0].id;
  return null;
}

function extractRollupText(prop) {
  if (!prop) return null;
  if (prop.rollup && Array.isArray(prop.rollup) && prop.rollup.length) {
    const item = prop.rollup[0];
    if (item.title && item.title[0] && item.title[0].plain_text) return item.title[0].plain_text;
    if (item.plain_text) return item.plain_text;
  }
  if (prop.rich_text && Array.isArray(prop.rich_text)) {
    return prop.rich_text.map(t => t.plain_text).join('');
  }
  return null;
}

function processPostForFrontend(page) {
  const props = page.properties || {};
  const title = (props.Name?.title || []).map(t => t.plain_text).join('') || '(Untitled)';
  const date = props['Publish Date']?.date?.start || null;
  const status = props.Status?.status?.name || null;
  const owner = props.Owner?.people?.[0]?.name || null;
  const pinned = props.Pinned?.checkbox === true;
  const archived = props.Archivado?.checkbox === true;
  const hidden = props.Hide?.checkbox === true;

  // Client name: prefer relation -> clients rollup -> anything textual
  let clientName = null;
  if (props.PostClient?.relation && props.PostClient.relation.length) {
    // relation contains ids; we can't get names here without clients map
    clientName = null;
  } else {
    // try rollup text
    clientName = extractRollupText(props.PostClient) || null;
  }

  // Assets extraction (can be attachment files or Link/Canva)
  const assets = [];
  // Attachment / Files & Media
  if (props.Attachment && props.Attachment.files && props.Attachment.files.length) {
    for (const f of props.Attachment.files) {
      // file.external vs file.file
      if (f.external && f.external.url) {
        assets.push({ url: f.external.url, type: 'image', source: 'attachment' });
      } else if (f.file && f.file.url) {
        assets.push({ url: f.file.url, type: 'image', source: 'attachment' });
      }
    }
  }
  // Link
  if (props.Link && props.Link.url) {
    assets.push({ url: props.Link.url, type: 'link', source: 'link' });
  }
  // Copy
  const copyText = (props.Copy?.rich_text || []).map(t => t.plain_text).join('');

  return {
    id: page.id,
    title,
    date,
    status,
    owner,
    pinned,
    archived,
    hidden,
    client: clientName,
    copy: copyText,
    assets
  };
}

module.exports = async (req, res) => {
  try {
    const { client, status, q, page = 1, limit = 12, include_archived } = req.query;
    const includeArchived = safeBoolParam(include_archived) || false;

    const pageInt = Math.max(1, parseInt(page, 10) || 1);
    const pageSize = Math.min(100, parseInt(limit, 10) || 12);

    const filtersAnd = buildBaseFilters({ includeArchived });

    // Status filter (if provided and not 'all')
    if (status && status.toLowerCase() !== 'all') {
      filtersAnd.push({ property: 'Status', status: { equals: status } });
    } else {
      // default: if no status param, show only Published-like statuses? NO — follow frontend; here keep all unless specified
    }

    // Client filter
    if (client) {
      // if looks like uuid (36 chars with dashes) assume id, else try to resolve by name
      let clientId = null;
      const maybeId = client.trim();
      if (/^[0-9a-fA-F\-]{36,}$/.test(maybeId)) {
        clientId = maybeId;
      } else {
        clientId = await resolveClientIdByName(maybeId);
      }
      if (clientId) {
        filtersAnd.push({ property: 'PostClient', relation: { contains: clientId } });
      } else {
        // If can't resolve id, attempt to filter by rollup text (best-effort)
        filtersAnd.push({
          property: 'PostClient',
          rich_text: { contains: client } // fallback - may or may not work depending on rollup type
        });
      }
    }

    // q (search in title)
    if (q) {
      filtersAnd.push({
        property: 'Name',
        title: { contains: q }
      });
    }

    const finalFilter = filtersAnd.length ? { and: filtersAnd } : undefined;

    // Notion query - use page cursor calculation for pagination
    const startCursor = req.query.start_cursor || undefined;

    const body = {
      database_id: NOTION_DB_CONTENT_ID,
      page_size: pageSize,
      sorts: [{ property: 'Publish Date', direction: 'descending' }]
    };
    if (finalFilter) body.filter = finalFilter;
    if (startCursor) body.start_cursor = startCursor;

    const notionRes = await notion.databases.query(body);

    const posts = (notionRes.results || []).map(processPostForFrontend);

    return res.json({
      ok: true,
      posts,
      has_more: notionRes.has_more || false,
      next_cursor: notionRes.next_cursor || null
    });
  } catch (err) {
    console.error('grid error', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
