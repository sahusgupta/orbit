async function loadManifest() {
  const versionElement = document.querySelector('#version');
  const updatedElement = document.querySelector('#updated');
  const installerLink = document.querySelector('#installer-link');

  try {
    const response = await fetch('https://api.github.com/repos/sahusgupta/orbit/releases/latest', { cache: 'no-store' });
    if (!response.ok) throw new Error('GitHub release metadata unavailable');
    const release = await response.json();
    const installer = (release.assets || []).find((asset) =>
      /\.exe$/i.test(asset.name || '') && !/blockmap$/i.test(asset.name || '')
    );

    if (release.name || release.tag_name) {
      versionElement.textContent = String(release.name || release.tag_name).replace(/^v/i, '');
    }
    if (release.published_at) {
      updatedElement.textContent = new Date(release.published_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    }
    if (installer?.browser_download_url) {
      installerLink.href = installer.browser_download_url;
    }
    return;
  } catch {
    installerLink.href = 'https://github.com/sahusgupta/orbit/releases/latest';
  }

  try {
    const response = await fetch('./downloads/manifest.json', { cache: 'no-store' });
    if (!response.ok) return;
    const manifest = await response.json();
    const updatedAt = manifest.installer?.updatedAt || manifest.zip?.updatedAt || manifest.generatedAt;

    versionElement.textContent = manifest.version || '0.1.13';
    updatedElement.textContent = updatedAt
      ? new Date(updatedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
      : 'Latest staged build';
  } catch {
    updatedElement.textContent = 'Build metadata unavailable';
  }
}

loadManifest();
