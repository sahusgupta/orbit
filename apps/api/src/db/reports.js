const crypto = require('crypto');
const { sanitizeAccountKey } = require('../orbitCore');
const { getDatabase } = require('./connection');

async function storeAnalyticalReport(report) {
  if (!report || typeof report !== 'object') throw new Error('Report payload must be an object.');
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const accountKey = sanitizeAccountKey(report.account?.accountKey || report.account?.license || report.account?.email || report.account?.clubName || 'unlicensed-local');
  const database = await getDatabase();
  await database.run(`
    INSERT INTO analytical_reports (id, account_key, created_at, report_json, delivery_status, delivery_error)
    VALUES ($1, $2, $3, $4, 'stored', '')
  `, [id, accountKey, createdAt, JSON.stringify(report)]);
  return { ok: true, id, accountKey, createdAt, deliveryStatus: 'stored' };
}

module.exports = { storeAnalyticalReport };
