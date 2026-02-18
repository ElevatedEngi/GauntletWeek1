import { getAuth } from 'firebase-admin/auth';
import { Request } from 'firebase-functions/v2/https';

export interface AuthenticatedRequest extends Request {
  user?: {
    uid: string;
    email?: string;
    name?: string;
  };
}

/**
 * Verify Firebase ID token from Authorization header
 * @param authHeader Authorization header value
 * @returns Decoded token with user info
 */
export async function verifyFirebaseToken(authHeader: string | undefined) {
  if (!authHeader) {
    throw new Error('No authorization header');
  }

  const parts = authHeader.split('Bearer ');
  if (parts.length !== 2) {
    throw new Error('Invalid authorization header format');
  }

  const token = parts[1];
  if (!token) {
    throw new Error('No token provided');
  }

  try {
    const decodedToken = await getAuth().verifyIdToken(token);
    return {
      uid: decodedToken.uid,
      email: decodedToken.email,
      name: decodedToken.name,
    };
  } catch (error) {
    console.error('Token verification failed:', error);
    throw new Error('Invalid or expired token');
  }
}

/**
 * Middleware to authenticate requests
 * Attaches user info to request object
 */
export async function authenticate(req: AuthenticatedRequest): Promise<void> {
  const user = await verifyFirebaseToken(req.headers.authorization);
  req.user = user;
}
