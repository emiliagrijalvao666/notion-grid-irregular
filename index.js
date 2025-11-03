   let mediaEl = `<div class="placeholder">No content</div>`;
   if (first) {
-    if (isVideo) {
+    if (isVideo) {
       mediaEl = `<video class="card__media" preload="metadata" muted playsinline src="${escapeHtml(
         first.url
       )}"></video>`;
-    } else if (isExternal) {
-      const label =
-        first.provider === 'canva'
-          ? 'Canva'
-          : first.provider === 'drive'
-          ? 'Drive'
-          : 'Link';
-      mediaEl = `<div class="card__external">${label}</div>`;
+    } else if (isExternal) {
+      // DRIVE: usar thumbnail como portada si es un file preview
+      if (first.provider === 'drive') {
+        const id = driveIdFromUrl(first.url);
+        if (id) {
+          const thumb = `https://drive.google.com/thumbnail?id=${id}&sz=w1200`;
+          mediaEl = `<img class="card__media" alt="" src="${escapeHtml(thumb)}" />`;
+        } else {
+          mediaEl = `<div class="card__external">Drive</div>`;
+        }
+      } else if (first.provider === 'canva') {
+        // Sin proxy: no hay cover garantizada. Mostramos chip Canva.
+        mediaEl = `<div class="card__external">Canva</div>`;
+      } else {
+        mediaEl = `<div class="card__external">Link</div>`;
+      }
     } else {
       mediaEl = `<img class="card__media" alt="" src="${escapeHtml(first.url)}" />`;
     }
   }
function driveIdFromUrl(u='') {
  try {
    const s = String(u);
    // admite .../file/d/<ID>/preview o /view
    if (s.includes('/file/d/')) return s.split('/file/d/')[1].split('/')[0];
    // fallback: si someone pegó el id suelto accidentalmente
    if (/^[A-Za-z0-9_-]{20,}$/.test(s)) return s;
  } catch {}
  return '';
}
