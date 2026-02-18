"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyFirebaseToken = verifyFirebaseToken;
exports.authenticate = authenticate;
const auth_1 = require("firebase-admin/auth");
/**
 * Verify Firebase ID token from Authorization header
 * @param authHeader Authorization header value
 * @returns Decoded token with user info
 */
async function verifyFirebaseToken(authHeader) {
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
        const decodedToken = await (0, auth_1.getAuth)().verifyIdToken(token);
        return {
            uid: decodedToken.uid,
            email: decodedToken.email,
            name: decodedToken.name,
        };
    }
    catch (error) {
        console.error('Token verification failed:', error);
        throw new Error('Invalid or expired token');
    }
}
/**
 * Middleware to authenticate requests
 * Attaches user info to request object
 */
async function authenticate(req) {
    const user = await verifyFirebaseToken(req.headers.authorization);
    req.user = user;
}
//# sourceMappingURL=auth.js.map