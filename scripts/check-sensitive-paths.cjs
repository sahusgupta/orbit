const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const skippedDirectories = new Set([
  '.git', '.orbit', '.vercel', '.vite', 'coverage', 'dist', 'download-dist',
  'node_modules', 'out', 'playwright-report', 'release', 'test-results'
]);
const riskyNames = [
  /^\.env(?:\..+)?$/i,
  /^\.pilot-license-private-key\.pem$/i,
  /-pilot-key\.json$/i,
  /-firebase-adminsdk-.*\.json$/i,
  /^(?:firebase|firestore|ui)-debug\.log/i
];

function isAllowedExample(name) {
  return name.toLowerCase() === '.env.example';
}

function walk(directory, findings = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name)) walk(absolute, findings);
      continue;
    }
    if (!isAllowedExample(entry.name) && riskyNames.some((pattern) => pattern.test(entry.name))) {
      findings.push(path.relative(root, absolute).replaceAll('\\', '/'));
    }
  }
  return findings;
}

const findings = walk(root).sort();
if (findings.length) {
  console.error('Sensitive-looking paths must be moved to an approved secret store and rotated if live:');
  findings.forEach((filePath) => console.error(`- ${filePath}`));
  process.exitCode = 1;
} else {
  console.log('No sensitive-looking project paths were found.');
}
