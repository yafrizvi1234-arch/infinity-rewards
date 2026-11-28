import type { NextFunction, Request, Response } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { adminAuth } from '../lib/firebase-admin.ts';

export const ADMIN_EMAIL = 'yafrizvi1234@gmail.com';

export interface VerifiedAuthUser {
  uid: string;
  email: string;
  emailVerified: boolean;
}

export interface AuthRequest extends Request {
  user?: DecodedIdToken;
  verifiedUser?: VerifiedAuthUser;
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required (Bearer token missing).' });
    return;
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    res.status(401).json({ error: 'Authentication required (empty token).' });
    return;
  }

  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    if (decodedToken.email_verified !== true || typeof decodedToken.email !== 'string') {
      res.status(403).json({ error: 'Verified email address is required.' });
      return;
    }

    req.user = decodedToken;
    req.verifiedUser = {
      uid: decodedToken.uid,
      email: decodedToken.email.trim().toLowerCase(),
      emailVerified: true,
    };
    next();
  } catch (error) {
    console.error('Error verifying Firebase ID token:', error);
    res.status(401).json({ error: 'Unauthorized: Invalid or expired token.' });
  }
};

export const requireAdmin = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void => {
  const verified = req.verifiedUser;
  if (!verified || !verified.emailVerified || verified.email !== ADMIN_EMAIL) {
    res.status(403).json({ error: 'Unauthorized: Verified admin email required.' });
    return;
  }
  next();
};
