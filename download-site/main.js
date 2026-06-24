async function loadManifest() {
  try {
    const response = await fetch('./downloads/manifest.json', { cache: 'no-store' });
    if (!response.ok) return;
    const manifest = await response.json();
    const updatedAt = manifest.installer?.updatedAt || manifest.zip?.updatedAt || manifest.generatedAt;

    document.querySelector('#version').textContent = manifest.version || '0.1.13';
    document.querySelector('#updated').textContent = updatedAt
      ? new Date(updatedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
      : 'Latest staged build';
  } catch {
    document.querySelector('#updated').textContent = 'Build metadata unavailable';
  }
}

loadManifest();
