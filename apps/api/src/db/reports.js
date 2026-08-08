const crypto = require('crypto');
const { sanitizeAccountKey } = require('../orbitCore');
const { getDatabase } = require('./connection');

function storeAnalyticalReport(report) {
  if (!report || typeof report !== 'object') throw new Error('Report payload must be an object.');
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const accountKey = sanitizeAccountKey(report.account?.accountKey || report.account?.license || report.account?.email || report.account?.clubName || 'unlicensed-local');
  getDatabase().prepare(`
    INSERT INTO analytical_reports (id, account_key, created_at, report_json, delivery_status, delivery_error)
    VALUES (?, ?, ?, ?, 'stored', '')
  `).run(id, accountKey, createdAt, JSON.stringify(report));
  return { ok: true, id, accountKey, createdAt, deliveryStatus: 'stored' };
}

module.exports = { storeAnalyticalReport };
