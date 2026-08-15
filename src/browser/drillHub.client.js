'use strict';

/**
 * esbuild entry point for /drill.html's bundle (drill-hub.js).
 * src/buildStatic.js's buildDrillHubBundle() call (bundleBrowserEntry
 * pointed at THIS path) is a FROZEN, shared-file call site (WS-1 spec
 * section 6.2's mitigation -- this task does not touch buildStatic.js).
 * The Drill Engine v2 task's own file footprint names
 * src/browser/drill.client.js, not this file, so the real hub+session
 * controller lives there; this file only require()s it, exactly the
 * indirection this file's own placeholder-era header comment already
 * anticipated ("that task may end up repurposing src/browser/drill.client.js
 * instead of this file for the hub's real bundle ... update this file's
 * own require() if the real implementation moves elsewhere, not
 * buildStatic.js").
 */

require('./drill.client');
