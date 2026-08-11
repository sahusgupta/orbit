function getArg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? '' : String(process.argv[index + 1] || '');
}

function usage() {
  console.log([
    'Usage:',
    '  ORBIT_API_URL=<api-origin> ORBIT_CLIENT_API_KEY=<owner-key> node scripts/publish-firestore-layout.cjs [--limit 25]',
    '',
    'Requests the authoritative API to drain already-committed publication-outbox work.',
    'It cannot import arbitrary state or publish Firebase directly.'
  ].join('\n'));
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    usage();
    return;
  }

  const apiOrigin = String(process.env.ORBIT_API_URL || '').trim().replace(/\/$/, '');
  const ownerKey = String(process.env.ORBIT_CLIENT_API_KEY || '').trim();
  if (!apiOrigin || !ownerKey) {
    throw new Error('ORBIT_API_URL and ORBIT_CLIENT_API_KEY are required. Credentials are sent only in the request header.');
  }

  const requestedLimit = Number(getArg('--limit') || 25);
  const limit = Math.min(Math.max(Number.isInteger(requestedLimit) ? requestedLimit : 25, 1), 100);
  const response = await fetch(`${apiOrigin}/publications/drain`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-orbit-api-key': ownerKey
    },
    body: JSON.stringify({ limit })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || `Publication drain failed with HTTP ${response.status}.`);
  }
  console.log(`Authoritative API processed ${Number(payload.processed || 0)} publication job(s).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Publication drain failed.');
  process.exitCode = 1;
});
