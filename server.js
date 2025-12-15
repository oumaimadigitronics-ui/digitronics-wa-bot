diff --git a/server.js b/server.js
--- a/server.js
+++ b/server.js
@@
 function safeLower(s) {
   return String(s || "").toLowerCase();
 }
 
+// Normalize Arabic-Indic digits (٣٢ / ۳۲ / ٠١٢...) to Latin digits (32 / 01...)
+function normalizeDigits(input) {
+  const s = String(input || "");
+  const ar = "٠١٢٣٤٥٦٧٨٩"; // U+0660..0669
+  const fa = "۰۱۲۳۴۵۶۷۸۹"; // U+06F0..06F9
+  let out = "";
+  for (const ch of s) {
+    const i1 = ar.indexOf(ch);
+    if (i1 !== -1) {
+      out += String(i1);
+      continue;
+    }
+    const i2 = fa.indexOf(ch);
+    if (i2 !== -1) {
+      out += String(i2);
+      continue;
+    }
+    out += ch;
+  }
+  return out;
+}
+
 function normalizeNumber(x) {
   const raw = String(x || "").trim();
   const cleaned = raw.replace(/[^\d+]/g, "").slice(0, 32);
   return cleaned || "unknown";
 }
@@
 function hasTvSizeToken(text) {
-  const s = safeLower(text);
+  const s = safeLower(normalizeDigits(text));
   return /\b(24|32|40|43|50|55|65|75|85)\b/.test(s);
 }
 
 function extractWantedTvSize(text) {
-  const s = safeLower(text);
+  const s = safeLower(normalizeDigits(text));
   const m = s.match(/\b(24|32|40|43|50|55|65|75|85)\b/);
   return m ? Number(m[1]) : null;
 }
@@
 function wantsAndroidTv(text) {
   const s = safeLower(text);
   return s.includes("android tv") || s.includes("androidtv");
 }
 
 /**
  * TV intent:
  * - explicit words: tv/tele/television...
- * - OR (brand exists AND message contains standard TV size token)
+ * - OR (brand exists in message OR history) AND message contains standard TV size token
  */
-function isTvIntent(text) {
-  const raw = String(text || "");
-  const s = safeLower(raw);
+function isTvIntent(text, last6) {
+  const raw = normalizeDigits(String(text || ""));
+  const s = safeLower(raw);
 
   const hasTvWords =
     /\b(tv|smart tv|television|télévision|télé|tele)\b/i.test(s) ||
     /تلفاز|تلفزيون/i.test(raw);
 
   if (hasTvWords) return true;
 
   // If customer writes: "visio 32" / "فيزيو 32" => treat as TV intent
-  if (hasTvSizeToken(raw) && detectBrand(raw)) {
+  const brand = detectBrand(raw) || getLastBrandFromHistory(last6);
+  if (hasTvSizeToken(raw) && brand) {
     // exclude obvious non-TV contexts
     if (s.includes("btu") || s.includes("kg") || s.includes("litre") || s.includes("l ") || s.includes("wh")) return false;
     return true;
   }
 
   return false;
 }
@@
-function applyTvFilters(products, userText) {
-  if (!isTvIntent(userText)) return products;
+function applyTvFilters(products, userText, last6) {
+  if (!isTvIntent(userText, last6)) return products;
 
   let out = Array.isArray(products) ? [...products] : [];
   out = out.filter(productIsTv);
 
   const wanted = extractWantedTvSize(userText);
   if (wanted) {
@@
 function extractSearchKeyWithContext(text, last6) {
-  const raw = String(text || "");
-  const s = applyBrandSynonyms(raw); // important for Arabic brand -> latin slug
+  const raw = normalizeDigits(String(text || ""));
+  const s = applyBrandSynonyms(raw); // important for Arabic brand -> latin slug
@@
   const brand = detectBrand(s) || getLastBrandFromHistory(last6);
   const sizeMatch = s.match(/\b(24|32|40|43|50|55|65|75|85)\b/);
@@
-  if (brand && isTvIntent(s)) return `${brand} tv`;
+  if (brand && isTvIntent(s, last6)) return `${brand} tv`;
   if (brand) return brand;
 
   return text;
 }
@@
-    catalogMatches = applyTvFilters(catalogMatches, userTextRaw);
+    catalogMatches = applyTvFilters(catalogMatches, userTextRaw, last6);
