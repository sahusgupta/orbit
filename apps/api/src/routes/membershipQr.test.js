import { describe, expect, it } from 'vitest';
import membershipQrRoutes from './membershipQr.js';

describe('membership QR route security ordering', () => {
  it('blocks a deleting Player before membership QR issuance', () => {
    const routes = [];
    const app = {
      post(path, ...handlers) { routes.push({ path, handlers }); }
    };
    membershipQrRoutes.registerMembershipQrRoutes(app, {});
    const issue = routes.find((route) => route.path === '/player/membership-qr');
    expect(issue?.handlers.map((handler) => handler.name)).toContain('requireActivePlayerAccount');
    expect(issue.handlers.findIndex((handler) => handler.name === 'requireActivePlayerAccount')).toBe(2);
    expect(issue.handlers.findIndex((handler) => handler.name === 'requireVerifiedPlayerAge')).toBe(3);
    expect(issue.handlers.findIndex((handler) => handler.name === 'requireVerifiedPlayerAge'))
      .toBeLessThan(issue.handlers.length - 1);
  });
});
