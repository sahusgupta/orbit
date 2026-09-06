const crypto = require('crypto');
const zlib = require('zlib');
const { sanitizeAccountKey } = require('../orbitCore');
const { firestoreDocumentId, getDatabase } = require('./connection');

const reportsCollection = 'orbitAnalyticalReports';
const reportChunkSize = 400_000;
const maximumReportBytes = 8_000_000;
const deletionPageSize = 100;

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

async function deleteAnalyticalReportDocument(database, reportId) {
  const reportPath = `${reportsCollection}/${String(reportId)}`;
  let deletedChunks = 0;
  while (true) {
    const chunks = await database.queryCollection(`${reportPath}/chunks`, { limit: deletionPageSize });
    if (!chunks.length) break;
    await Promise.all(chunks.map((chunk) => database.deleteDocument(`${reportPath}/chunks/${chunk.id}`)));
    deletedChunks += chunks.length;
  }
  await database.deleteDocument(reportPath);
  return deletedChunks;
}

async function deleteAnalyticalReportsForAccounts(accountKeys, dependencies = {}) {
  const database = dependencies.database || await (dependencies.getDatabase || getDatabase)();
  const normalizedAccountKeys = [...new Set((accountKeys || [])
    .map((accountKey) => sanitizeAccountKey(accountKey))
    .filter(Boolean))];
  let deletedReports = 0;
  let deletedChunks = 0;
  for (const accountKey of normalizedAccountKeys) {
    while (true) {
      const reports = await database.queryCollection(reportsCollection, {
        filters: [{ field: 'accountKey', op: '==', value: accountKey }],
        limit: deletionPageSize
      });
      if (!reports.length) break;
      for (const report of reports) {
        deletedChunks += await deleteAnalyticalReportDocument(database, report.id);
        deletedReports += 1;
      }
    }
  }
  return {
    deletedAnalyticalReports: deletedReports,
    deletedAnalyticalReportChunks: deletedChunks
  };
}

module.exports = {
  deleteAnalyticalReportsForAccounts,
  reportsCollection,
  storeAnalyticalReport
};
