const { Client } = require('@notionhq/client');

function getDbId() {
  return process.env.NOTION_DB_ID
      || process.env.NOTION_DATABASE_ID
      || process.env.NOTION_DB_CONTENT
      || process.env.NOTION_DB;
}

module.exports = async (req, res) => {
  try {
    const notion = new Client({ auth: process.env.NOTION_TOKEN });
    const db = getDbId();
    const info = await notion.databases.retrieve({ database_id: db });

    const props = info.properties || {};
    const exists = (k) => Object.prototype.hasOwnProperty.call(props, k);

    const schema = {
      has: {
        PostClient: exists('PostClient'),
        PostBrands: exists('PostBrands'),
        PostProject: exists('PostProject'),
        Status: exists('Status'),
        Platform: exists('Platform'),
        Owner: exists('Owner'),
        Hide: exists('Hide'),
        Archivado: exists('Archivado'),
        Copy: exists('Copy'),
        Link: exists('Link'),
        Assets: exists('Assets'),
        'Publish Date': exists('Publish Date'),
        Name: exists('Name')
      },
      raw: Object.keys(props).reduce((acc, k) => {
        acc[k] = { type: props[k].type };
        return acc;
      }, {})
    };

    res.setHeader('Content-Type', 'application/json');
    res.status(200).send(JSON.stringify({ ok: true, schema }));
  } catch (e) {
    res.status(200).send(JSON.stringify({ ok: false, error: e.message }));
  }
};
