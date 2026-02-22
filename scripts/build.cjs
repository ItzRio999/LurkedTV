#!/usr/bin/env node
/**
 * Production build script — copies public/ to dist/.
 *
 * We deliberately do NOT bundle/transform the frontend JS files because
 * they rely on classic <script> tag load order and global variable assignment.
 * A plain file copy preserves all existing behaviour while giving us a clean
 * dist/ directory to deploy.
 */

const fs = require('fs')
const path = require('path')

const SRC = path.resolve(__dirname, '..', 'public')
const DEST = path.resolve(__dirname, '..', 'dist')

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

console.log('Building...')

if (fs.existsSync(DEST)) {
  fs.rmSync(DEST, { recursive: true, force: true })
}

copyDir(SRC, DEST)

const fileCount = (function count(dir) {
  let n = 0
  for (const entry of fs.readdirSync(dir)) {
    const p = path.join(dir, entry)
    n += fs.statSync(p).isDirectory() ? count(p) : 1
  }
  return n
})(DEST)

console.log(`Build complete: public/ -> dist/ (${fileCount} files)`)
