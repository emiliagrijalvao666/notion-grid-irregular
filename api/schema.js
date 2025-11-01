import { getDbMeta, prop } from "./_notion.js";

// Detecta nombres reales de propiedades (tolerante a variantes)
export async function detectContentSchema(contentDbId){
  const meta = await getDbMeta(contentDbId);
  if(!meta) return null;

  const p = (names)=> prop(meta, names);

  return {
    titleKey: p(['name','título','title']),
    dateKey:  p(['publish date','fecha','date','published']),
    ownerKey: p(['owner','owners']),
    statusKey:p(['status','estado']),
    platformKey: p(['platform','platforms','plataforma','plataformas']),
    clientKey:  p(['client','postclient','cliente']),
    projectKey: p(['project','postproject','proyecto']),
    copyKey:    p(['copy','caption','contenido','content']),
    pinnedKey:  p(['pinned','pin']),
    hideKey:    p(['hide','hidden']),
    // Cualquier "files & media" se tratará como asset
    fileKeys: Object.entries(meta.properties)
              .filter(([,v])=>v.type==='files')
              .map(([k])=>k)
  };
}
