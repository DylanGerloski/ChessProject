'use strict';

/**
 * Shared server + Chromium + Lighthouse machinery. Extracted from
 * scripts/visual-qa.js so scripts/lighthouseBudget.js (the CI Lighthouse
 * budget gate) can reuse it rather than duplicating the static-file server
 * and CDP wiring. Zero new dependencies: playwright and lighthouse are
 * already devDependencies.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');
const lighthouse = require('lighthouse').default;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function isHttpUrl(target) {
  return /^https?:\/\//i.test(target);
}

/** Serves `rootDir` (recursively) on localhost only, on an OS-assigned port. */
function startStaticServer(rootDir) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let reqPath;
      try {
        reqPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      } catch {
        res.writeHead(400);
        res.end('Bad request');
        return;
      }
      const resolved = path.normalize(path.join(rootDir, reqPath));
      if (!resolved.startsWith(path.normalize(rootDir))) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      fs.readFile(resolved, (err, data) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not found');
          return;
        }
        const ext = path.extname(resolved).toLowerCase();
        res.writeHead(200, { 'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(0, 'localhost', () => resolve(server));
  });
}

/**
 * Resolves `target` (an http(s) URL or a local file path) to a real
 * http://localhost URL, starting a throwaway static server rooted at the
 * file's directory for a local path (so relative asset links resolve, and
 * so Lighthouse gets a real http:// URL -- its navigation runner does not
 * accept file:// or data: URLs). Returns { pageUrl, cleanup }; cleanup()
 * closes the server if one was started (a no-op for a bare URL target).
 */
async function resolveTarget(target) {
  if (isHttpUrl(target)) {
    return { pageUrl: target, cleanup: async () => {} };
  }
  const absPath = path.resolve(target);
  if (!fs.existsSync(absPath)) {
    throw new Error(`File not found: ${absPath}`);
  }
  const rootDir = path.dirname(absPath);
  const server = await startStaticServer(rootDir);
  const port = server.address().port;
  return {
    pageUrl: `http://localhost:${port}/${path.basename(absPath)}`,
    cleanup: () => new Promise((resolve) => server.close(resolve)),
  };
}

/**
 * Launches a headless Chromium instance with a fixed CDP debug port (a
 * fixed port is required, not OS-assigned/0, because Lighthouse needs the
 * port before Chrome finishes starting). Caller owns calling browser.close().
 */
function launchBrowser(cdpPort) {
  return chromium.launch({
    headless: true,
    args: [`--remote-debugging-port=${cdpPort}`],
  });
}

/**
 * Runs a Lighthouse audit against pageUrl over the given CDP port. Returns the lhr (report).
 * `skipAudits` (optional) is passed straight through to Lighthouse's own
 * config -- see scripts/lighthouseBudget.js's usage for the one caller that
 * sets it and why.
 */
async function runLighthouse(pageUrl, { categories, cdpPort, skipAudits }) {
  const result = await lighthouse(pageUrl, {
    port: cdpPort,
    output: 'json',
    logLevel: 'error',
    onlyCategories: categories,
    ...(skipAudits ? { skipAudits } : {}),
  });
  if (!result || !result.lhr) {
    throw new Error(`Lighthouse did not return a report for ${pageUrl}`);
  }
  return result.lhr;
}

module.exports = {
  CONTENT_TYPES,
  isHttpUrl,
  startStaticServer,
  resolveTarget,
  launchBrowser,
  runLighthouse,
};
