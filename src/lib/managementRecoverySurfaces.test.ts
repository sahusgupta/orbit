import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const read = (relativePath: string) => readFileSync(resolve(repositoryRoot, relativePath), 'utf8');

describe('management recovery surfaces', () => {
  it('keeps owner controls explicit and credentials out of browser storage', () => {
    const html = read('apps/api/public/dashboard.html');
    const script = read('apps/api/public/dashboard.js');
    const routes = read('apps/api/src/routes/dashboard.js');
    expect(html).toContain('Management account access');
    expect(html).toContain('short-lived and single-use');
    expect(html).toContain('Security activity');
    expect(script).toContain('data-account-action="start-recovery"');
    expect(script).toContain('data-account-action="send-reset-email"');
    expect(script).toContain('data-account-action="change-password"');
    expect(script).toContain('data-account-action="create-login"');
    expect(script).toContain('data-account-source=');
    expect(script).toContain('Copy data & create login');
    expect(script).toContain('/management-account`');
    expect(routes).toContain("app.post('/dashboard/licenses/:licenseDocumentId/management-account'");
    expect(routes).toContain("event: 'management-account-provisioned'");
    expect(script).toContain("license.status === 'active'");
    expect(script).toContain('data-active-license-account-controls');
    expect(script).toContain('handleManagementAccountAction(event, elements.licenses)');
    expect(script).toContain("'x-orbit-csrf': '1'");
    expect(script).not.toMatch(/localStorage|sessionStorage/);
  });

  it('routes venue recovery through the trusted Electron boundary and labels it separately from email reset', () => {
    const main = read('src/main.tsx');
    const preload = read('electron/preload.cjs');
    expect(main).toContain('Use owner-assisted recovery');
    expect(main).toContain('this override can be used only once');
    expect(preload).toContain("ipcRenderer.invoke('get-management-recovery-status', access)");
    expect(preload).toContain("ipcRenderer.invoke('complete-management-recovery', payload)");
  });
});
