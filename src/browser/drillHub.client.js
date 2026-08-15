'use strict';

/**
 * PLACEHOLDER esbuild entry point for /drill.html's bundle (drill-hub.js).
 * The follow-on task that builds Drill Engine v2 (spec
 * WS-1 spec section 3.3) replaces this file's contents entirely
 * -- see src/renderDrillHub.js's header comment for the full reasoning.
 * That task may end up repurposing src/browser/drill.client.js instead of
 * this file for the hub's real bundle; either way, src/buildStatic.js's
 * buildDrillHubBundle() call (bundleBrowserEntry pointed at THIS path)
 * never changes on its own, so update this file's own require() if the
 * real implementation moves elsewhere, not buildStatic.js.
 *
 * Deliberately does nothing yet -- the placeholder page has no interactive
 * element for this to wire up.
 */

console.log('Opening drill hub: coming soon.');
