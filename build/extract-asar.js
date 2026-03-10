/**
 * Extract app.asar from the built dist for upload as release asset.
 * Run after electron-builder: node build/extract-asar.js
 */
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'dist', 'win-unpacked', 'resources', 'app.asar');
const dest = path.join(__dirname, '..', 'dist', 'app.asar');

if (!fs.existsSync(src)) {
  console.error('app.asar not found at', src);
  process.exit(1);
}

fs.copyFileSync(src, dest);
const size = fs.statSync(dest).size;
console.log(`Extracted app.asar (${(size / 1024 / 1024).toFixed(2)} MB) to dist/app.asar`);
