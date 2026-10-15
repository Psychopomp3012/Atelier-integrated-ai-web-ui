import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

export const firebaseConfig = {
  apiKey: 'AIzaSyBaW014bjLdEn9IDoQ83cVAArpNAO0YFCE',
  authDomain: 'integrated-ai-cli.firebaseapp.com',
  projectId: 'integrated-ai-cli',
  storageBucket: 'integrated-ai-cli.firebasestorage.app',
  messagingSenderId: '218334209988',
  appId: '1:218334209988:web:404b8bf4e3c3c5b7cee691',
};

export const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleAuthProvider = new GoogleAuthProvider();
googleAuthProvider.addScope('email');
googleAuthProvider.addScope('profile');
googleAuthProvider.setCustomParameters({
  prompt: 'select_account',
});

