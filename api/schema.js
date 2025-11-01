// Mapeo tolerante y utilidades seguras
export const PROP = {
  // aceptamos múltiples nombres o detectamos dinámico
  titleCandidates: ["Post","Name","Title"],

  date: "Publish Date",
  status: "Status",

  owners: "Owner",                  // people
  platformCandidates: ["Platform","Platforms"],

  clientRelCandidates: ["Client","PostClient"],     // relation
  projectRelCandidates: ["Project","PostProject"],  // relation

  clientNameFx: "ClientName",       // fórmula opcional, fallback
  projectNameFx: "ProjectName",     // fórmula opcional, fallback

  pinned: "Pinned",                 // checkbox
  hide: "Hide",                     // checkbox
  archived: "Archivado",            // checkbox

  files: ["Attachment","Image Source","Canva","Canva Design","Link"], // files/url
};

export function getProp(page, key){
  return page.properties?.[key];
}
export function getExistingKey(meta, candidates){
  for (const k of Array.isArray(candidates)?candidates:[candidates]) {
    if (meta?.properties?.[k]) return k;
  }
  return null;
}
export function getTitleFromPage(page){
  // busca la propiedad de tipo 'title' sin importar el nombre
  const props = page.properties || {};
  for (const [key, val] of Object.entries(props)){
    if (val?.type === 'title') {
      return (val.title||[]).map(t=>t.plain_text).join("") || "";
    }
  }
  return "";
}
export function toDate(page){
  const p = getProp(page, PROP.date);
  return p?.date?.start || page.created_time;
}
export function toStatusName(page){
  const p = getProp(page, PROP.status);
  return p?.status?.name || "";
}
export function toOwners(page, ownersKey){
  const p = ownersKey ? getProp(page, ownersKey) : null;
  return (p?.people || []).map(x => ({ id:x.id, name:(x.name || x.person?.email || "Unknown") }));
}
export function toPlatforms(page, platformKey){
  const p = platformKey ? getProp(page, platformKey) : null;
  return (p?.multi_select || []).map(x => x.name).filter(Boolean);
}
export function toCheckbox(page, key){
  const p = key ? getProp(page, key) : null;
  return !!p?.checkbox;
}
export function toRelationIds(page, relKey){
  const p = relKey ? getProp(page, relKey) : null;
  return p?.relation?.map(r=>r.id) || [];
}
export function toFormulaText(page, key){
  const p = key ? getProp(page, key) : null;
  return p?.formula?.string || "";
}
export function toMedia(page){
  const out = [];
  for (const key of PROP.files){
    const prop = getProp(page, key);
    if (!prop) continue;

    if (prop.type === 'files') {
      const files = prop.files || [];
      for (const f of files){
        const url = f?.file?.url || f?.external?.url;
        if (!url) continue;
        const isVid = /\.(mp4|mov|m4v|webm)$/i.test(url);
        out.push({ type:isVid ? "video" : "image", url });
      }
    } else if (prop.type === 'url') {
      const url = prop.url;
      if (url) {
        const isVid = /\.(mp4|mov|m4v|webm)$/i.test(url);
        out.push({ type:isVid ? "video" : "image", url });
      }
    }
  }
  return out;
}
