async function readSameOriginManifest(path) {
  const response = await fetch(path, { cache: 'force-cache', credentials: 'same-origin' });
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return null;
  const payload = await response.json();
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
}

async function loadManifest() {
  const versionElement = document.querySelector('#version');
  const updatedElement = document.querySelector('#updated');
  const installerLink = document.querySelector('#installer-link');
  const releaseStatus = document.querySelector('#release-status');
  if (!versionElement || !updatedElement || !installerLink || !releaseStatus) return;

  releaseStatus.classList.add('is-loading');
  releaseStatus.setAttribute('aria-busy', 'true');

  try {
    const staged = import.meta.env.DEV
      ? await readSameOriginManifest('./downloads/manifest.json')
      : null;
    const release = staged || await readSameOriginManifest('./release-manifest.json');
    if (!release) throw new Error('Release manifest is unavailable.');
    const updatedAt = release.installer?.updatedAt || release.zip?.updatedAt || release.generatedAt;
    const installerUrl = release.installer?.fileName
      ? `./downloads/${encodeURIComponent(release.installer.fileName)}`
      : release.installerUrl;

    versionElement.textContent = release.version || versionElement.textContent;
    updatedElement.textContent = updatedAt
      ? new Date(updatedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
      : release.publishedLabel || 'Available after approved promotion';
    if (typeof installerUrl === 'string' && installerUrl) {
      installerLink.href = installerUrl;
      installerLink.textContent = 'Download for Windows';
    }
  } catch {
    updatedElement.textContent = 'Release metadata unavailable';
  } finally {
    releaseStatus.classList.remove('is-loading');
    releaseStatus.removeAttribute('aria-busy');
  }
}

loadManifest();
