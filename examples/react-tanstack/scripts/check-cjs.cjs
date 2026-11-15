// Node-side packages must load from CommonJS too: many Playwright setups
// (no "type": "module") compile specs to require() calls.
const assert = require("node:assert/strict");

const core = require("@warpstate/core");
assert.equal(typeof core.parseSnapshot, "function");
assert.equal(typeof require("@warpstate/core/noop").parseSnapshot, "function");
assert.equal(typeof require("@warpstate/playwright").warp, "function");
assert.equal(typeof require("@warpstate/vite").warpstate, "function");
console.log("OK: @warpstate/core, /noop, playwright and vite load with require().");
