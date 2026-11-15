import { WARP_GLOBAL_KEY } from "./global";
import type { WarpSnapshot } from "./schema";
import { PENDING_STORAGE_KEY } from "./pending";

/**
 * Returns a self-contained script that prepares `window.__WARPSTATE__` and writes
 * `snapshot.storage` before any app code runs. Use it with any runner that can run
 * code on new documents:
 *
 * - Playwright: `page.addInitScript({ content: createInitScript(snapshot) })`
 * - Puppeteer: `page.evaluateOnNewDocument(createInitScript(snapshot))`
 * - Cypress: `cy.visit(url, { onBeforeLoad: (win) => win.eval(createInitScript(snapshot)) })`
 * - WebDriver BiDi: `script.addPreloadScript` with the script wrapped in a function.
 *
 * The script only runs in the top-level frame.
 */
export function createInitScript(snapshot: WarpSnapshot | unknown): string {
  // JSON is a valid JS expression; escape characters that could close a <script> tag
  // or break older parsers if the string is ever inlined into HTML.
  //
  // Everything outside ASCII is escaped too: when this script is inlined at the top
  // of <head> (?warp= links), a large payload pushes <meta charset> past the first
  // 1024 bytes, browsers fall back to windows-1252 and "Berçário" turns into
  // "BerÃ§Ã¡rio". ASCII-only output reads the same under any charset.
  const payload = JSON.stringify(snapshot).replace(
    /[<\u007f-\uffff]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );

  return `(function (snapshot) {
  if (window.top !== window) return;
  var key = ${JSON.stringify(WARP_GLOBAL_KEY)};
  var g = window[key] || {};
  var settled = false;
  g.snapshot = snapshot;
  g.status = "pending";
  g.warnings = [];
  g.error = undefined;
  g.ready = new Promise(function (resolve, reject) {
    g._settle = function (error) {
      if (settled) return;
      settled = true;
      if (error) {
        var e = new Error(error.message);
        e.code = error.code;
        reject(e);
      } else resolve();
    };
  });
  g.ready.catch(function () {});
  try {
    window.sessionStorage.removeItem(${JSON.stringify(PENDING_STORAGE_KEY)});
    var storage = snapshot && snapshot.storage;
    if (storage) {
      var local = storage.local || {};
      var session = storage.session || {};
      for (var k in local) window.localStorage.setItem(k, String(local[k]));
      for (var s in session) window.sessionStorage.setItem(s, String(session[s]));
    }
    g.storageRestored = true;
  } catch (_) {
    g.storageRestored = false;
  }
  window[key] = g;
})(${payload});
`;
}
