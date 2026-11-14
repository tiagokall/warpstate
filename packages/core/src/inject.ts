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
  const payload = JSON.stringify(snapshot)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

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
