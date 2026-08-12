const crypto = require('crypto');
const zlib = require('zlib');
const { sanitizeAccountKey } = require('../orbitCore');
const { firestoreDocumentId, getDatabase } = require('./connection');

const reportsCollection = 'orbitAnalyticalReports';
const reportChunkSize = 400_000;
const maximumReportBytes = 8_000_000;

async function storeAnalyticalReport(report) {
  if (!report || typeof report !== 'object') throw new Error('Report payload must be an object.');
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const accountKey = sanitizeAccountKey(report.account?.accountKey || report.account?.license || report.account?.email || report.account?.clubName || 'unlicensed-local');
  const source = Buffer.from(JSON.stringify(report), 'utf8');
  const compressed = zlib.gzipSync(source, { level: 6 });
  if (compressed.length > maximumReportBytes) throw new Error('The analytical report exceeds the Firestore transaction size limit.');
  const chunks = [];
  for (let offset = 0; offset < compressed.length; offset += reportChunkSize) {
    chunks.push(compressed.subarray(offset, offset + reportChunkSize));
  }
  if (!chunks.length) chunks.push(Buffer.alloc(0));
  const database = await getDatabase();
  const reportPath = `${reportsCollection}/${firestoreDocumentId(id)}`;
  await database.runTransaction(async (transaction) => {
    const existing = await transaction.getDocument(reportPath);
    if (existing) throw new Error('The analytical report already exists.');
    chunks.forEach((payload, index) => transaction.createDocument(
      `${reportPath}/chunks/${String(index).padStart(4, '0')}`,
      { index, encoding: 'gzip-json-chunks-v1', payload, createdAt }
    ));
    transaction.createDocument(reportPath, {
      id,
      accountKey,
      createdAt,
      encoding: 'gzip-json-chunks-v1',
      chunkCount: chunks.length,
      compressedBytes: compressed.length,
      sourceBytes: source.length,
      contentHash: crypto.createHash('sha256').update(source).digest('hex'),
      deliveryStatus: 'stored',
      deliveryError: ''
    });
  });
  return { ok: true, id, accountKey, createdAt, deliveryStatus: 'stored' };
}

module.exports = { reportsCollection, storeAnalyticalReport };
