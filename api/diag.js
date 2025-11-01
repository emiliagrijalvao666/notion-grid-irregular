import { DB, getDbMeta } from "./_notion.js";
import { detectContentSchema } from "./schema.js";

export default async function handler(req,res){
  try{
    const haveEnv = { NOTION_TOKEN: !!process.env.NOTION_TOKEN, CONTENT_DB_ID: !!DB.content, PROJECTS_DB_ID: !!process.env.PROJECTS_DB_ID };
    const schema = DB.content ? await detectContentSchema(DB.content) : null;
    const meta   = DB.content ? await getDbMeta(DB.content) : null;

    res.status(200).json({
      ok:true,
      haveEnv,
      contentDbId: DB.content || null,
      schema,
      platformType: schema?.platformKey ? meta?.properties?.[schema.platformKey]?.type : null,
      statusType:   schema?.statusKey   ? meta?.properties?.[schema.statusKey]?.type   : null
    });
  }catch(e){
    res.status(500).json({ ok:false, error: e.message||String(e) });
  }
}
