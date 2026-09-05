import { browserLocalPersistence } from 'firebase/auth';

// Metro selects playerAuthPersistence.native.ts for iOS and Android. This
// durable browser fallback also keeps Expo web sessions across reloads.
export const playerAuthPersistence = browserLocalPersistence;
