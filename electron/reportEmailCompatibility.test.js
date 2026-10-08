import { describe, expect, it, vi } from 'vitest';
import nodemailer from 'nodemailer';
import { createLocalStore } from './localStore.cjs';

describe('report email transport compatibility', () => {
  it('renders the existing report envelope, summary, and JSON attachment without SMTP', async () => {
    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
    const sendMail = vi.fn((message) => transport.sendMail(message));
    const createTransport = vi.fn(() => ({ sendMail }));
    const store = createLocalStore({
      environment: {
        TABLEMANAGER_SMTP_HOST: '127.0.0.1',
        TABLEMANAGER_SMTP_USER: 'sender@example.test',
        TABLEMANAGER_SMTP_PASS: 'synthetic-test-only',
        TABLEMANAGER_SMTP_PORT: '587'
      },
      mailer: { createTransport }
    });
    const report = {
      generatedAt: '2026-10-08T12:00:00.000Z',
      account: { accountKey: 'fixture-club', clubName: 'Fixture Room' },
      operational: { occupiedSeatHours: 12 },
      usage: { features: [], actions: [] }
    };

    await store.sendReportEmail(report, 'recipient@example.test');

    expect(createTransport).toHaveBeenCalledWith({
      host: '127.0.0.1', port: 587, secure: false,
      auth: { user: 'sender@example.test', pass: 'synthetic-test-only' }
    });
    const rendered = await sendMail.mock.results[0].value;
    expect(rendered.envelope).toEqual({ from: 'sender@example.test', to: ['recipient@example.test'] });
    const message = rendered.message.toString('utf8');
    expect(message).toContain('Subject: Orbit report - Fixture Room - 2026-10-08');
    expect(message).toContain('Occupied seat-hours: 12');
    expect(message).toContain('Content-Type: application/json; name=tablemanager-report-2026-10-08.json');
    expect(message.replace(/\r?\n/g, '')).toContain(Buffer.from(JSON.stringify(report, null, 2)).toString('base64'));
  });
});
