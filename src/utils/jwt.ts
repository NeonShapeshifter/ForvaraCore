import jwt from 'jsonwebtoken';
import { config } from '../config';
import { logger } from '../config/logger';

export interface JWTPayload {
  userId: string;
  email?: string;
  tenantId?: string;
  role?: string;
  sessionId?: string;
  type?: 'access' | 'refresh' | 'temp' | 'reset';
  iat?: number;
  exp?: number;
}

/**
 * Generar token de acceso
 */
export async function generateToken(
  userId: string,
  additionalPayload?: Partial<JWTPayload>
): Promise<string> {
  try {
    const payload: JWTPayload = {
      userId,
      type: 'access',
      sessionId: generateSessionId(),
      ...additionalPayload
    };

    const token = jwt.sign(payload, config.JWT_SECRET, {
      expiresIn: config.JWT_EXPIRY || '7d',
      issuer: 'forvara',
      audience: 'forvara-api'
    } as jwt.SignOptions);

    logger.debug({ userId, type: payload.type }, 'Token generated');

    return token;
  } catch (error) {
    logger.error({ error, userId }, 'Generate token failed');
    throw new Error('Failed to generate token');
  }
}

/**
 * Generar refresh token
 */
export async function generateRefreshToken(userId: string): Promise<string> {
  try {
    const payload: JWTPayload = {
      userId,
      type: 'refresh',
      sessionId: generateSessionId()
    };

    const token = jwt.sign(payload, config.JWT_SECRET, {
      expiresIn: '30d',
      issuer: 'forvara',
      audience: 'forvara-api'
    });

    logger.debug({ userId }, 'Refresh token generated');

    return token;
  } catch (error) {
    logger.error({ error, userId }, 'Generate refresh token failed');
    throw new Error('Failed to generate refresh token');
  }
}

/**
 * Verificar token
 */
export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET, {
      issuer: 'forvara',
      audience: 'forvara-api'
    }) as JWTPayload;

    return decoded;
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      logger.debug({ token: token.substring(0, 20) }, 'Token expired');
    } else if (error.name === 'JsonWebTokenError') {
      logger.warn({ error: error.message }, 'Invalid token');
    } else {
      logger.error({ error }, 'Token verification failed');
    }
    
    return null;
  }
}

/**
 * Decodificar token sin verificar
 */
export function decodeToken(token: string): JWTPayload | null {
  try {
    return jwt.decode(token) as JWTPayload;
  } catch (error) {
    logger.error({ error }, 'Decode token failed');
    return null;
  }
}

/**
 * Verificar si token está por expirar
 */
export function isTokenExpiringSoon(token: string, thresholdSeconds: number = 3600): boolean {
  try {
    const decoded = decodeToken(token);
    if (!decoded || !decoded.exp) {
      return true;
    }

    const now = Math.floor(Date.now() / 1000);
    const timeUntilExpiry = decoded.exp - now;

    return timeUntilExpiry <= thresholdSeconds;
  } catch (error) {
    return true;
  }
}

/**
 * Generar token temporal
 */
export function generateTempToken(
  userId: string,
  purpose: string,
  expiresIn: string = '15m'
): string {
  const payload = {
    userId,
    type: 'temp',
    purpose
  };

  return jwt.sign(payload, config.JWT_SECRET, {
    expiresIn,
    issuer: 'forvara'
  } as jwt.SignOptions);
}

/**
 * Generar session ID único
 */
function generateSessionId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Extraer token del header Authorization
 */
export function extractTokenFromHeader(authHeader?: string): string | null {
  if (!authHeader) return null;

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }

  return parts[1] || null;
}

/**
 * Crear token para email
 */
export function generateEmailToken(email: string, purpose: string): string {
  const payload = {
    email,
    purpose,
    type: 'email'
  };

  return jwt.sign(payload, config.JWT_SECRET, {
    expiresIn: '24h',
    issuer: 'forvara'
  });
}

/**
 * Verificar token de email
 */
export function verifyEmailToken(token: string, expectedPurpose: string): { email: string } | null {
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET, {
      issuer: 'forvara'
    }) as any;

    if (decoded.type !== 'email' || decoded.purpose !== expectedPurpose) {
      return null;
    }

    return { email: decoded.email };
  } catch (error) {
    return null;
  }
}

/**
 * Rotar tokens
 */
export async function rotateTokens(
  refreshToken: string
): Promise<{ accessToken: string; refreshToken: string } | null> {
  try {
    // Verificar refresh token
    const payload = await verifyToken(refreshToken);
    if (!payload || payload.type !== 'refresh') {
      return null;
    }

    // Generar nuevos tokens
    const accessToken = await generateToken(payload.userId);
    const newRefreshToken = await generateRefreshToken(payload.userId);

    return { accessToken, refreshToken: newRefreshToken };
  } catch (error) {
    logger.error({ error }, 'Rotate tokens failed');
    return null;
  }
}

/**
 * Generar token para API
 */
export function generateApiToken(
  appId: string,
  permissions: string[],
  expiresIn?: string
): string {
  const payload = {
    appId,
    permissions,
    type: 'api',
    iat: Math.floor(Date.now() / 1000)
  };

  const options: jwt.SignOptions = {
    issuer: 'forvara',
    audience: 'forvara-api'
  };

  if (expiresIn) {
    options.expiresIn = expiresIn as string;
  }

  return jwt.sign(payload, config.JWT_SECRET, options);
}
