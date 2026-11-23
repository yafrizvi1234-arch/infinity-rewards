import {
  GoogleAuthProvider,
  User,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from 'firebase/auth';
import { auth } from '../firebase';

export interface MappedAuthError {
  message: string;
  isProviderDisabled?: boolean;
  code?: string;
}

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export function mapFirebaseAuthError(error: unknown): MappedAuthError {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';

  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return {
        code,
        message: 'Invalid email or password. Please double-check your credentials and try again.',
      };
    case 'auth/invalid-email':
      return {
        code,
        message: 'Please enter a valid email address.',
      };
    case 'auth/email-already-in-use':
      return {
        code,
        message: 'An account with this email already exists. Try signing in instead.',
      };
    case 'auth/weak-password':
      return {
        code,
        message: 'Password is too weak. Please use at least 6 characters.',
      };
    case 'auth/too-many-requests':
      return {
        code,
        message: 'Too many attempts detected. Please wait a moment and try again.',
      };
    case 'auth/user-disabled':
      return {
        code,
        message: 'This account has been disabled. Please contact support.',
      };
    case 'auth/operation-not-allowed':
      return {
        code,
        isProviderDisabled: true,
        message:
          'Email/Password sign-in is not yet enabled in Firebase Console for this project. Enable it under Authentication → Sign-in method, or use Continue with Google.',
      };
    case 'auth/popup-closed-by-user':
      return {
        code,
        message: 'Google sign-in popup was closed before completing.',
      };
    case 'auth/popup-blocked':
      return {
        code,
        message: 'Browser blocked the sign-in popup. Please allow popups for this site.',
      };
    case 'auth/network-request-failed':
      return {
        code,
        message: 'Network error while contacting authentication servers. Check your connection.',
      };
    default:
      return {
        code,
        message:
          error instanceof Error
            ? error.message
            : 'Authentication request failed. Please try again.',
      };
  }
}

export async function signUpWithEmail(
  displayName: string,
  email: string,
  password: string
): Promise<User> {
  const trimmedName = displayName.trim();
  const trimmedEmail = email.trim();

  const credential = await createUserWithEmailAndPassword(auth, trimmedEmail, password);
  if (trimmedName) {
    await updateProfile(credential.user, { displayName: trimmedName });
  }
  await sendEmailVerification(credential.user);
  return credential.user;
}

export async function signInWithEmail(email: string, password: string): Promise<User> {
  const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
  return credential.user;
}

export async function signInWithGooglePopup(): Promise<User> {
  const credential = await signInWithPopup(auth, googleProvider);
  return credential.user;
}

export async function requestPasswordReset(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email.trim());
}

export async function resendVerificationEmail(user: User): Promise<void> {
  await sendEmailVerification(user);
}

export async function refreshAuthUser(user: User): Promise<User> {
  await user.reload();
  const current = auth.currentUser ?? user;
  if (current.emailVerified) {
    await current.getIdToken(true);
  }
  return current;
}

export async function logoutUser(): Promise<void> {
  await signOut(auth);
}
