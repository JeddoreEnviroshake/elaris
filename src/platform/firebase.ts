import { getApp, getApps, initializeApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import { getAuth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import { initializeFirestore, persistentLocalCache } from 'firebase/firestore';

export interface FirebaseServices {
  auth: Auth;
  firestore: Firestore;
}

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const configured = Object.values(firebaseConfig).every(
  (value): value is string => typeof value === 'string' && value.trim().length > 0,
);

let services: FirebaseServices | null | undefined;

export function firebaseIsConfigured(): boolean {
  return configured;
}

/** Lazily initialize Firebase so local tests and unconfigured dev builds remain usable. */
export function getFirebaseServices(): FirebaseServices | null {
  if (services !== undefined) return services;
  if (!configured) {
    services = null;
    return services;
  }

  const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  services = {
    auth: getAuth(app),
    firestore: initializeFirestore(app, { localCache: persistentLocalCache({}) }),
  };
  return services;
}
