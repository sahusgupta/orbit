const { version } = require('../../package.json');

function getReleaseVersion(environment = process.env) {
  const candidate = String(environment.ORBIT_RELEASE_SHA || environment.VERCEL_GIT_COMMIT_SHA || '').trim();
  const sourceSha = /^[a-f0-9]{40}$/i.test(candidate) ? candidate.toLowerCase() : null;
  return { ok: Boolean(sourceSha), service: 'orbit-api', version, sourceSha };
}

module.exports = { getReleaseVersion };
