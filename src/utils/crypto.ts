import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { config } from '../config';

const ALGORITHM = 'aes-256-gcm';
const SALT_LENGTH = 32;
const TAG_LENGTH = 16;
const IV_LENGTH = 16;

/**
 * Encriptar texto
 */
export function encrypt(text: string, key?: string): string {
  try {
    const encryptionKey = key || config.ENCRYPTION_KEY;
    if (!encryptionKey) {
      throw new Error('Encryption key not configured');
    }

    // Generar IV aleatorio
    const iv = crypto.randomBytes(IV_LENGTH);
    
    // Crear cipher
    const cipher = crypto.createCipheriv(
      ALGORITHM,
      Buffer.from(encryptionKey, 'hex'),
      iv
    );

    // Encriptar
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    // Obtener tag de autenticación
    const tag = cipher.getAuthTag();

    // Combinar IV + tag + encrypted
    const combined = Buffer.concat([
      iv,
      tag,
      Buffer.from(encrypted, 'hex')
    ]);

    return combined.toString('base64');
  } catch (error) {
    throw new Error('Encryption failed: ' + error);
  }
}

/**
 * Desencriptar texto
 */
export function decrypt(encryptedText: string, key?: string): string {
  try {
    const encryptionKey = key || config.ENCRYPTION_KEY;
    if (!encryptionKey) {
      throw new Error('Encryption key not configured');
    }

    // Decodificar de base64
    const combined = Buffer.from(encryptedText, 'base64');

    // Extraer componentes
    const iv = combined.slice(0, IV_LENGTH);
    const tag = combined.slice(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const encrypted = combined.slice(IV_LENGTH + TAG_LENGTH);

    // Crear decipher
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      Buffer.from(encryptionKey, 'hex'),
      iv
    );

    // Establecer tag de autenticación
    decipher.setAuthTag(tag);

    // Desencriptar
    let decrypted = decipher.update(encrypted, undefined, 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    throw new Error('Decryption failed: ' + error);
  }
}

/**
 * Hash de contraseña
 */
export async function hashPassword(password: string): Promise<string> {
  const rounds = config.BCRYPT_ROUNDS || 10;
  return bcrypt.hash(password, rounds);
}

/**
 * Verificar contraseña
 */
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Generar salt aleatorio
 */
export function generateSalt(length: number = SALT_LENGTH): string {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Hash SHA256
 */
export function sha256(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Hash MD5 (solo para checksums, no seguridad)
 */
export function md5(data: string): string {
  return crypto.createHash('md5').update(data).digest('hex');
}

/**
 * HMAC
 */
export function hmac(
  data: string,
  secret: string,
  algorithm: string = 'sha256'
): string {
  return crypto.createHmac(algorithm, secret).update(data).digest('hex');
}

/**
 * Generar token seguro
 */
export function generateSecureToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Generar UUID v4
 */
export function generateUUID(): string {
  return crypto.randomUUID();
}

/**
 * Derivar clave de contraseña
 */
export async function deriveKey(
  password: string,
  salt: string,
  iterations: number = 100000,
  keyLength: number = 32
): Promise<string> {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, iterations, keyLength, 'sha256', (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey.toString('hex'));
    });
  });
}

/**
 * Encriptar objeto
 */
export function encryptObject(obj: any, key?: string): string {
  const json = JSON.stringify(obj);
  return encrypt(json, key);
}

/**
 * Desencriptar objeto
 */
export function decryptObject<T = any>(encryptedText: string, key?: string): T {
  const json = decrypt(encryptedText, key);
  return JSON.parse(json);
}

/**
 * Generar código OTP
 */
export function generateOTP(length: number = 6): string {
  const digits = '0123456789';
  let otp = '';
  
  for (let i = 0; i < length; i++) {
    const randomIndex = crypto.randomInt(0, digits.length);
    otp += digits[randomIndex];
  }
  
  return otp;
}

/**
 * Verificar integridad con checksum
 */
export function generateChecksum(data: string | Buffer): string {
  const hash = crypto.createHash('sha256');
  hash.update(data);
  return hash.digest('hex');
}

/**
 * Firmar datos
 */
export function signData(
  data: string,
  privateKey: string,
  algorithm: string = 'RSA-SHA256'
): string {
  const sign = crypto.createSign(algorithm);
  sign.update(data);
  sign.end();
  return sign.sign(privateKey, 'hex');
}

/**
 * Verificar firma
 */
export function verifySignature(
  data: string,
  signature: string,
  publicKey: string,
  algorithm: string = 'RSA-SHA256'
): boolean {
  const verify = crypto.createVerify(algorithm);
  verify.update(data);
  verify.end();
  return verify.verify(publicKey, signature, 'hex');
}

/**
 * Ofuscar datos sensibles
 */
export function obfuscate(value: string, visibleChars: number = 4): string {
  if (value.length <= visibleChars) {
    return '*'.repeat(value.length);
  }
  
  const start = value.substring(0, Math.floor(visibleChars / 2));
  const end = value.substring(value.length - Math.ceil(visibleChars / 2));
  const middle = '*'.repeat(value.length - visibleChars);
  
  return `${start}${middle}${end}`;
}

/**
 * Sanitizar datos para logs
 */
export function sanitizeForLogging(data: any): any {
  const sensitiveFields = [
    'password',
    'token',
    'secret',
    'key',
    'authorization',
    'credit_card',
    'ssn',
    'api_key'
  ];

  if (typeof data !== 'object' || data === null) {
    return data;
  }

  const sanitized = Array.isArray(data) ? [...data] : { ...data };

  for (const key in sanitized) {
    if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof sanitized[key] === 'object') {
      sanitized[key] = sanitizeForLogging(sanitized[key]);
    }
  }

  return sanitized;
}
