const { getAdminApp, getAdminSdk, readServiceAccount } = require('../services/firebaseAdmin');

const memoryDocuments = new Map();
let memoryTransactionQueue = Promise.resolve();
let firestoreStore;

function normalizeFirestoreValue(value, inArray = false) {
  if (value === undefined) return inArray ? null : undefined;
  if (value === null || typeof value !== 'object') return value;
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Date) return new Date(value);
  if (Array.isArray(value)) return value.map((item) => normalizeFirestoreValue(item, true));
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  return Object.fromEntries(Object.entries(value)
    .map(([key, item]) => [key, normalizeFirestoreValue(item)])
    .filter(([, item]) => item !== undefined));
}

function clone(value) {
  const normalized = normalizeFirestoreValue(value);
  return normalized === undefined ? undefined : structuredClone(normalized);
}

function firestoreDocumentId(value) {
  const id = encodeURIComponent(String(value || '').trim());
  if (!id) throw new Error('A Firestore document identifier is required.');
  return id;
}

function validateDocumentPath(documentPath) {
  const segments = String(documentPath || '').split('/').filter(Boolean);
  if (!segments.length || segments.length % 2 !== 0) throw new Error('A valid Firestore document path is required.');
  return segments.join('/');
}

function validateCollectionPath(collectionPath) {
  const segments = String(collectionPath || '').split('/').filter(Boolean);
  if (!segments.length || segments.length % 2 !== 1) throw new Error('A valid Firestore collection path is required.');
  return segments.join('/');
}

function readField(document, field) {
  if (field === '__name__') return document.id;
  return String(field || '').split('.').reduce((value, key) => value?.[key], document.data);
}

function compareValues(left, right) {
  if (left === right) return 0;
  if (left === null || left === undefined) return -1;
  if (right === null || right === undefined) return 1;
  return left < right ? -1 : 1;
}

function matchesFilter(document, filter) {
  const value = readField(document, filter.field);
  switch (filter.op) {
    case '==': return value === filter.value;
    case '!=': return value !== filter.value;
    case '<': return compareValues(value, filter.value) < 0;
    case '<=': return value !== null && value !== undefined && compareValues(value, filter.value) <= 0;
    case '>': return compareValues(value, filter.value) > 0;
    case '>=': return compareValues(value, filter.value) >= 0;
    case 'in': return Array.isArray(filter.value) && filter.value.includes(value);
    case 'array-contains': return Array.isArray(value) && value.includes(filter.value);
    default: throw new Error(`Unsupported Firestore query operator: ${filter.op}`);
  }
}

function compareDocumentToCursor(document, orders, cursor) {
  for (let index = 0; index < orders.length; index += 1) {
    const order = orders[index];
    const comparison = compareValues(readField(document, order.field), cursor[index]);
    if (comparison) return order.direction === 'desc' ? -comparison : comparison;
  }
  return 0;
}

function createMemoryStore(documents = memoryDocuments) {
  const store = {
    mode: 'memory',
    async getDocument(documentPath) {
      const normalized = validateDocumentPath(documentPath);
      return documents.has(normalized) ? clone(documents.get(normalized)) : null;
    },
    async setDocument(documentPath, value, options = {}) {
      const normalized = validateDocumentPath(documentPath);
      const previous = documents.get(normalized);
      documents.set(normalized, clone(options.merge && previous ? { ...previous, ...value } : value));
    },
    async createDocument(documentPath, value) {
      const normalized = validateDocumentPath(documentPath);
      if (documents.has(normalized)) {
        const error = Object.assign(new Error('Firestore document already exists.'), { code: 'ALREADY_EXISTS' });
        throw error;
      }
      documents.set(normalized, clone(value));
    },
    async updateDocument(documentPath, value) {
      const normalized = validateDocumentPath(documentPath);
      if (!documents.has(normalized)) throw new Error('Firestore document does not exist.');
      documents.set(normalized, clone({ ...documents.get(normalized), ...value }));
    },
    async deleteDocument(documentPath) {
      documents.delete(validateDocumentPath(documentPath));
    },
    async queryCollection(collectionPath, options = {}) {
      const normalized = validateCollectionPath(collectionPath);
      const prefix = `${normalized}/`;
      const directDepth = normalized.split('/').length + 1;
      const filters = options.filters || [];
      const orders = options.orders?.length ? options.orders : [{ field: '__name__', direction: 'asc' }];
      let results = [...documents.entries()]
        .filter(([documentPath]) => documentPath.startsWith(prefix) && documentPath.split('/').length === directDepth)
        .map(([documentPath, data]) => ({ id: documentPath.slice(prefix.length), data: clone(data) }))
        .filter((document) => filters.every((filter) => matchesFilter(document, filter)))
        .sort((left, right) => compareDocumentToCursor(left, orders, orders.map((order) => readField(right, order.field))));
      if (options.startAfter?.length) {
        results = results.filter((document) => compareDocumentToCursor(document, orders, options.startAfter) > 0);
      }
      return results.slice(0, Math.max(Number(options.limit || 100), 1));
    },
    async countCollection(collectionPath, filters = []) {
      const documents = await store.queryCollection(collectionPath, { filters, limit: Number.MAX_SAFE_INTEGER });
      return documents.length;
    },
    async runTransaction(operation) {
      const execute = async () => {
        const working = new Map([...documents.entries()].map(([key, value]) => [key, clone(value)]));
        const transactionStore = createMemoryStore(working);
        const result = await operation(transactionStore);
        documents.clear();
        for (const [key, value] of working) documents.set(key, value);
        return result;
      };
      const pending = memoryTransactionQueue.then(execute, execute);
      memoryTransactionQueue = pending.catch(() => undefined);
      return pending;
    }
  };
  return store;
}

function firestoreField(admin, field) {
  return field === '__name__' ? admin.firestore.FieldPath.documentId() : field;
}

function createAdminFirestoreStore() {
  const admin = getAdminSdk();
  const database = admin.firestore(getAdminApp({ allowCredentialsFile: true }));
  const reference = (documentPath) => database.doc(validateDocumentPath(documentPath));
  const collection = (collectionPath) => database.collection(validateCollectionPath(collectionPath));
  const wrapTransaction = (transaction) => ({
    async getDocument(documentPath) {
      const snapshot = await transaction.get(reference(documentPath));
      return snapshot.exists ? snapshot.data() : null;
    },
    setDocument(documentPath, value, options = {}) {
      transaction.set(reference(documentPath), normalizeFirestoreValue(value), options);
    },
    createDocument(documentPath, value) {
      transaction.create(reference(documentPath), normalizeFirestoreValue(value));
    },
    updateDocument(documentPath, value) {
      transaction.update(reference(documentPath), normalizeFirestoreValue(value));
    },
    deleteDocument(documentPath) {
      transaction.delete(reference(documentPath));
    }
  });
  return {
    mode: 'firestore',
    async getDocument(documentPath) {
      const snapshot = await reference(documentPath).get();
      return snapshot.exists ? snapshot.data() : null;
    },
    async setDocument(documentPath, value, options = {}) {
      await reference(documentPath).set(normalizeFirestoreValue(value), options);
    },
    async createDocument(documentPath, value) {
      await reference(documentPath).create(normalizeFirestoreValue(value));
    },
    async updateDocument(documentPath, value) {
      await reference(documentPath).update(normalizeFirestoreValue(value));
    },
    async deleteDocument(documentPath) {
      await reference(documentPath).delete();
    },
    async queryCollection(collectionPath, options = {}) {
      /** @type {import('firebase-admin/firestore').Query} */
      let query = collection(collectionPath);
      for (const filter of options.filters || []) query = query.where(firestoreField(admin, filter.field), filter.op, filter.value);
      const orders = options.orders?.length ? options.orders : [{ field: '__name__', direction: 'asc' }];
      for (const order of orders) query = query.orderBy(firestoreField(admin, order.field), order.direction || 'asc');
      if (options.startAfter?.length) query = query.startAfter(...options.startAfter);
      query = query.limit(Math.max(Number(options.limit || 100), 1));
      const snapshot = await query.get();
      return snapshot.docs.map((document) => ({ id: document.id, data: document.data() }));
    },
    async countCollection(collectionPath, filters = []) {
      /** @type {import('firebase-admin/firestore').Query} */
      let query = collection(collectionPath);
      for (const filter of filters) query = query.where(firestoreField(admin, filter.field), filter.op, filter.value);
      const snapshot = await query.count().get();
      return Number(snapshot.data().count || 0);
    },
    runTransaction(operation) {
      return database.runTransaction((transaction) => operation(wrapTransaction(transaction)));
    }
  };
}

function useMemoryFirestore() {
  return process.env.NODE_ENV === 'test' || process.env.ORBIT_FIRESTORE_MEMORY === 'true';
}

function assertFirestoreConfiguration() {
  if (useMemoryFirestore()) {
    if (process.env.VERCEL) throw new Error('The in-memory Firestore test store is forbidden in hosted deployments.');
    return;
  }
  if (process.env.VERCEL && !readServiceAccount({ allowCredentialsFile: false })) {
    throw new Error('Firebase Admin credentials are required for the authoritative Firestore datastore.');
  }
}

function getDatabaseStatus() {
  assertFirestoreConfiguration();
  return {
    engine: 'firestore',
    durable: !useMemoryFirestore(),
    authoritative: true,
    mode: useMemoryFirestore() ? 'memory-test' : 'firebase-admin'
  };
}

async function getDatabase() {
  assertFirestoreConfiguration();
  if (useMemoryFirestore()) return createMemoryStore();
  firestoreStore = firestoreStore || createAdminFirestoreStore();
  return firestoreStore;
}

async function closeDatabase() {
  firestoreStore = undefined;
}

async function resetDatabaseForTests() {
  if (process.env.NODE_ENV !== 'test') throw new Error('The Firestore test store can be reset only in test mode.');
  memoryDocuments.clear();
  memoryTransactionQueue = Promise.resolve();
}

module.exports = {
  closeDatabase,
  firestoreDocumentId,
  getDatabase,
  getDatabaseStatus,
  resetDatabaseForTests
};
