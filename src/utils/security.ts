import { rateLimit } from 'express-rate-limit';

// Input sanitization
export function sanitizeInput(input: string): string {
  if (!input || typeof input !== 'string') return '';
  
  return input
    .trim()
    // Remove HTML tags
    .replace(/<[^>]*>/g, '')
    // Remove script content
    .replace(/javascript:/gi, '')
    // Remove potential XSS vectors
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
    // Limit length
    .substring(0, 255);
}

// Sanitize name fields (more restrictive)
export function sanitizeName(name: string): string {
  if (!name || typeof name !== 'string') return '';
  
  return name
    .trim()
    // Allow only letters, spaces, hyphens, apostrophes
    .replace(/[^a-zA-ZÀ-ÿ\s\-']/g, '')
    // Remove extra spaces
    .replace(/\s+/g, ' ')
    // Limit length
    .substring(0, 50);
}

// Sanitize company names (allow more characters)
export function sanitizeCompanyName(name: string): string {
  if (!name || typeof name !== 'string') return '';
  
  return name
    .trim()
    // Allow letters, numbers, spaces, common business chars
    .replace(/[^a-zA-ZÀ-ÿ0-9\s\-&.,()]/g, '')
    .replace(/\s+/g, ' ')
    .substring(0, 100);
}

// Rate limiting configurations
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: {
    error: {
      message: 'Too many login attempts, please try again later',
      code: 'RATE_LIMITED'
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
});

export const registerRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 registrations per hour per IP
  message: {
    error: {
      message: 'Too many registration attempts, please try again later',
      code: 'RATE_LIMITED'
    }
  },
});

export const generalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: {
    error: {
      message: 'Too many requests, please slow down',
      code: 'RATE_LIMITED'
    }
  },
});