#!/usr/bin/env node
/**
 * Production build script — copies public/ to dist/, then patches the output
 * files so the dist/ folder is a fully self-contained static website that
 * works without the Express backend.
 *
 * Static-mode patches applied after the copy:
 *  1. dist/js/api.js      — STATIC_MODE forced true; auth routes also handled by the mock
 *  2. dist/js/app.js      — checkAuth() auto-authenticates instead of redirecting to login
 *  3. dist/login.html     — replaced with a lightweight "Continue as Local User" page
 *  4. dist/verify-email.html — replaced with a redirect to /
 *
 * All data (sources, favorites, settings, history) is persisted in the
 * browser's localStorage — no server required.
 */

const fs = require('fs')
const path = require('path')

const SRC = path.resolve(__dirname, '..', 'public')
const DEST = path.resolve(__dirname, '..', 'dist')

// ─── Helpers ──────────────────────────────────────────────────────────────────

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src)) {
    const srcPath = path.join(src, entry)
    const destPath = path.join(dest, entry)
    if (fs.statSync(srcPath).isDirectory()) {
      copyDir(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

function patchFile(filePath, patches) {
  let content = fs.readFileSync(filePath, 'utf8')
  for (const [from, to, required = true] of patches) {
    if (content.includes(from)) {
      content = content.split(from).join(to)
    } else if (required) {
      console.warn(`  WARN: patch target not found in ${path.relative(DEST, filePath)}:`)
      console.warn(`    ${JSON.stringify(from.slice(0, 100))}`)
    }
  }
  fs.writeFileSync(filePath, content, 'utf8')
}

// ─── Copy ─────────────────────────────────────────────────────────────────────

console.log('Building...')

if (fs.existsSync(DEST)) {
  fs.rmSync(DEST, { recursive: true, force: true })
}

copyDir(SRC, DEST)

// ─── Patch 1: dist/js/api.js ──────────────────────────────────────────────────
// • Force STATIC_MODE = true so all /api/ calls go through the client-side mock.
// • Remove the !isAuthApi guard so /api/auth/* calls also go through the mock
//   (the mock already handles /auth/me, /auth/logout, /auth/firebase, etc.).

console.log('  Patching js/api.js...')
patchFile(path.join(DEST, 'js', 'api.js'), [
  [
    '    // Default to real backend API mode.\n    return false;',
    '    // Static build: always use the client-side mock.\n    return true;'
  ],
  [
    'if (STATIC_MODE && isApi && !isAuthApi) return handleApiFetch(input, init);',
    'if (STATIC_MODE && isApi) return handleApiFetch(input, init);'
  ]
])

// ─── Patch 2: dist/js/app.js ──────────────────────────────────────────────────
// In checkAuth(), if there is no stored token and we are in static mode,
// mint a local token instead of bouncing the user to login.html.

console.log('  Patching js/app.js...')
patchFile(path.join(DEST, 'js', 'app.js'), [
  [
    "        const token = localStorage.getItem('authToken');\r\n        if (!token) {\r\n            window.location.replace('/login.html');\r\n            return;\r\n        }",
    "        let token = localStorage.getItem('authToken');\r\n        if (!token) {\r\n            if (window.API && window.API.isStaticMode) {\r\n                // Static build: auto-authenticate as Local User (no server needed).\r\n                localStorage.setItem('authToken', 'static-local-user');\r\n                token = 'static-local-user';\r\n            } else {\r\n                window.location.replace('/login.html');\r\n                return;\r\n            }\r\n        }"
  ]
])

// ─── Patch 3: dist/login.html ─────────────────────────────────────────────────
// Replace the Firebase-dependent login page with a simple static entry page.

console.log('  Patching login.html...')
fs.writeFileSync(path.join(DEST, 'login.html'), `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LurkedTV</title>
  <link rel="icon" type="image/png" href="/img/LurkedTV.png?v=2">
  <link rel="shortcut icon" type="image/png" href="/img/LurkedTV.png?v=2">
  <link rel="stylesheet" href="css/main.css">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    html, body {
      margin: 0; padding: 0;
      background: var(--color-bg-primary);
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      min-height: 100vh;
    }
    .static-login-wrap {
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh;
    }
    .static-login {
      display: flex; flex-direction: column; align-items: center;
      gap: 20px; padding: 56px 40px;
      background: var(--color-bg-secondary, rgba(255,255,255,0.04));
      border: 1px solid var(--color-border, rgba(255,255,255,0.08));
      border-radius: 20px; max-width: 380px; width: 100%;
    }
    .static-login img { width: 68px; height: 68px; border-radius: 14px; }
    .static-login h1 {
      margin: 0;
      color: var(--color-text-primary, #fff);
      font-size: 1.5rem; font-weight: 700;
    }
    .static-login p {
      margin: 0; text-align: center; line-height: 1.6;
      color: var(--color-text-secondary, #aaa); font-size: 0.9rem;
    }
    .btn-enter {
      width: 100%; padding: 13px 0;
      background: var(--color-accent, #7c3aed);
      color: #fff; border: none; border-radius: 10px;
      font-size: 1rem; font-weight: 600; cursor: pointer;
      font-family: inherit; transition: opacity 0.15s;
    }
    .btn-enter:hover { opacity: 0.85; }
  </style>
</head>
<body>
  <div class="static-login-wrap">
    <div class="static-login">
      <img src="/img/LurkedTV.png" alt="LurkedTV">
      <h1>LurkedTV</h1>
      <p>Running in offline / static mode.<br>All your data is stored locally in this browser.</p>
      <button class="btn-enter" onclick="enter()">Continue as Local User</button>
    </div>
  </div>
  <script>
    // If already authenticated, skip straight to the app.
    if (localStorage.getItem('authToken')) {
      window.location.replace('/');
    }
    function enter() {
      localStorage.setItem('authToken', 'static-local-user');
      window.location.replace('/');
    }
  </script>
</body>
</html>
`, 'utf8')

// ─── Patch 4: dist/verify-email.html ──────────────────────────────────────────
// Email verification is not needed in static mode — redirect straight to app.

console.log('  Patching verify-email.html...')
fs.writeFileSync(path.join(DEST, 'verify-email.html'), `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="0;url=/">
  <title>LurkedTV</title>
</head>
<body>
  <script>window.location.replace('/');</script>
</body>
</html>
`, 'utf8')

// ─── Done ─────────────────────────────────────────────────────────────────────

const fileCount = (function count(dir) {
  let n = 0
  for (const entry of fs.readdirSync(dir)) {
    const p = path.join(dir, entry)
    n += fs.statSync(p).isDirectory() ? count(p) : 1
  }
  return n
})(DEST)

console.log(`Build complete: public/ -> dist/ (${fileCount} files) [static mode enabled]`)
