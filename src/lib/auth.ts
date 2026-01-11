import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { prisma } from './prisma';
import { User, UserRole } from '@prisma/client';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

export interface JWTPayload {
  userId: string;
  email: string;
  role: UserRole;
  companyId: string | null;
}

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  companyId: string | null;
  company?: {
    id: string;
    name: string;
  } | null;
}

// Hash password
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

// Verify password
export async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword);
}

// Generate JWT token
export function generateToken(payload: JWTPayload): string {
  // Convert expiry string to seconds for jwt.sign
  const expiresIn = JWT_EXPIRES_IN.includes('d') 
    ? parseInt(JWT_EXPIRES_IN) * 24 * 60 * 60 
    : JWT_EXPIRES_IN.includes('h')
    ? parseInt(JWT_EXPIRES_IN) * 60 * 60
    : 7 * 24 * 60 * 60; // Default 7 days
  
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

// Verify JWT token
export function verifyToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
  } catch (error) {
    return null;
  }
}

// Extract token from Authorization header
export function extractTokenFromHeader(authHeader: string | null): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7);
}

// Get user from token
export async function getUserFromToken(token: string): Promise<AuthUser | null> {
  const payload = verifyToken(token);
  if (!payload) return null;

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      companyId: true,
      isActive: true,
      company: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  if (!user || !user.isActive) return null;

  return user;
}

// Create session
export async function createSession(userId: string, token: string, ipAddress?: string, userAgent?: string) {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

  return prisma.session.create({
    data: {
      userId,
      token,
      expiresAt,
      ipAddress,
      userAgent,
    },
  });
}

// Invalidate session
export async function invalidateSession(token: string) {
  return prisma.session.deleteMany({
    where: { token },
  });
}

// Check if user has required role
export function hasRole(userRole: UserRole, requiredRoles: UserRole[]): boolean {
  return requiredRoles.includes(userRole);
}

// Permission check helpers
export const permissions = {
  canCreateInvoice: (role: UserRole) => ['ADMIN', 'ACCOUNTANT'].includes(role),
  canApproveInvoice: (role: UserRole) => ['ADMIN'].includes(role),
  canDeleteInvoice: (role: UserRole) => ['ADMIN'].includes(role),
  canViewAllInvoices: (role: UserRole) => ['ADMIN', 'AUDITOR'].includes(role),
  canManageUsers: (role: UserRole) => ['ADMIN'].includes(role),
  canManageCompany: (role: UserRole) => ['ADMIN'].includes(role),
  canVerifyBlockchain: (role: UserRole) => ['ADMIN', 'AUDITOR', 'ACCOUNTANT'].includes(role),
};
