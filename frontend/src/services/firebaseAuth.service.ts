import { signInWithPopup, signOut as fbSignOut } from 'firebase/auth';
import { auth, googleAuthProvider } from '../config/firebase.config';

export interface FirebaseSignInResult {
  idToken: string;
  email: string;
  name: string;
  avatarUrl: string;
}

export async function signInWithGoogle(): Promise<FirebaseSignInResult> {
  const result = await signInWithPopup(auth, googleAuthProvider);
  const idToken = await result.user.getIdToken(true);

  const email = result.user.email || '';
  const name = result.user.displayName || email.split('@')[0] || 'Developer';
  const avatarUrl =
    result.user.photoURL ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=4285F4&color=fff`;

  return {
    idToken,
    email,
    name,
    avatarUrl,
  };
}

export async function signOutFirebase(): Promise<void> {
  try {
    await fbSignOut(auth);
  } catch (err) {
    console.error('Error signing out of Firebase:', err);
  }
}
