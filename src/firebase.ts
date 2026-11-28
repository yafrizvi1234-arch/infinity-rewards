import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  getAuth,
  setPersistence,
} from 'firebase/auth';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const googleAuthProvider = new GoogleAuthProvider();
export const storage = getStorage(app);

setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.error('Auth persistence initialization warning:', err);
});

export const FIREBASE_PROJECT_ID = firebaseConfig.projectId;
