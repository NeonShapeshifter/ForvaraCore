import { z } from 'zod';
import validator from 'validator';

/**
 * Validadores personalizados de Zod
 */

// Email
export const emailSchema = z
  .string()
  .email('Email inválido')
  .transform(val => val.toLowerCase().trim());

// Teléfono
export const phoneSchema = z
  .string()
  .refine(val => validator.isMobilePhone(val, 'any'), {
    message: 'Número de teléfono inválido'
  });

// RUC Ecuatoriano
export const rucSchema = z
  .string()
  .regex(/^\d{13}$/, 'RUC debe tener 13 dígitos')
  .refine(val => {
    // Validación básica de RUC ecuatoriano
    const province = parseInt(val.substring(0, 2));
    const thirdDigit = parseInt(val[2]);
    
    return province >= 1 && province <= 24 && thirdDigit >= 0 && thirdDigit <= 6;
  }, {
    message: 'RUC inválido'
  });

// Contraseña segura
export const passwordSchema = z
  .string()
  .min(8, 'La contraseña debe tener al menos 8 caracteres')
  .regex(/[A-Z]/, 'Debe contener al menos una mayúscula')
  .regex(/[a-z]/, 'Debe contener al menos una minúscula')
  .regex(/[0-9]/, 'Debe contener al menos un número')
  .regex(/[^A-Za-z0-9]/, 'Debe contener al menos un carácter especial');

// UUID
export const uuidSchema = z.string().uuid('ID inválido');

// Fecha
export const dateSchema = z.string().datetime('Fecha inválida');

// URL
export const urlSchema = z.string().url('URL inválida');

// Paginación
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc')
});

// Búsqueda
export const searchSchema = z.object({
  query: z.string().trim().optional(),
  filters: z.record(z.any()).optional()
});

// Forvara Mail username
export const forvaraMailSchema = z
  .string()
  .min(3, 'Mínimo 3 caracteres')
  .max(30, 'Máximo 30 caracteres')
  .regex(/^[a-z0-9._]+$/, 'Solo letras minúsculas, números, puntos y guiones bajos')
  .refine(val => !val.startsWith('.') && !val.endsWith('.'), {
    message: 'No puede empezar o terminar con punto'
  })
  .refine(val => !val.includes('..'), {
    message: 'No puede contener puntos consecutivos'
  });

// Moneda
export const currencySchema = z
  .number()
  .positive('Debe ser un valor positivo')
  .multipleOf(0.01, 'Máximo 2 decimales');

// Porcentaje
export const percentageSchema = z
  .number()
  .min(0, 'Mínimo 0%')
  .max(100, 'Máximo 100%');

// Tags
export const tagsSchema = z
  .array(z.string().trim().min(1))
  .max(10, 'Máximo 10 tags')
  .optional();

// Metadata JSON
export const metadataSchema = z
  .record(z.any())
  .optional()
  .refine(val => {
    try {
      if (val) JSON.stringify(val);
      return true;
    } catch {
      return false;
    }
  }, {
    message: 'Metadata debe ser un objeto JSON válido'
  });

// Archivo
export const fileUploadSchema = z.object({
  mimetype: z.string(),
  size: z.number().max(50 * 1024 * 1024, 'Archivo muy grande (máx 50MB)')
});

// Coordenadas geográficas
export const coordinatesSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180)
});

// Rango de fechas
export const dateRangeSchema = z.object({
  from: dateSchema,
  to: dateSchema
}).refine(data => new Date(data.from) <= new Date(data.to), {
  message: 'La fecha inicial debe ser anterior a la fecha final'
});

// Configuración de notificaciones
export const notificationPreferencesSchema = z.object({
  email: z.boolean().default(true),
  push: z.boolean().default(true),
  sms: z.boolean().default(false),
  inApp: z.boolean().default(true),
  frequency: z.enum(['instant', 'hourly', 'daily', 'weekly']).default('instant')
});

/**
 * Funciones de validación
 */

export function isValidEmail(email: string): boolean {
  return validator.isEmail(email);
}

export function isValidPhone(phone: string): boolean {
  return validator.isMobilePhone(phone, 'any');
}

export function isValidRUC(ruc: string): boolean {
  try {
    rucSchema.parse(ruc);
    return true;
  } catch {
    return false;
  }
}

export function isValidUUID(uuid: string): boolean {
  return validator.isUUID(uuid);
}

export function isValidURL(url: string): boolean {
  return validator.isURL(url, {
    protocols: ['http', 'https'],
    require_protocol: true
  });
}

export function sanitizeInput(input: string): string {
  return validator.escape(input).trim();
}

export function isStrongPassword(password: string): boolean {
  return validator.isStrongPassword(password, {
    minLength: 8,
    minLowercase: 1,
    minUppercase: 1,
    minNumbers: 1,
    minSymbols: 1
  });
}

/**
 * Schemas de validación para endpoints
 */

// Login
export const loginSchema = z.object({
  username: z.string().trim().min(1, 'Username requerido'),
  password: z.string().min(1, 'Contraseña requerida'),
  rememberMe: z.boolean().optional()
});

// Registro
export const registerSchema = z.object({
  nombre: z.string().trim().min(2, 'Nombre muy corto'),
  apellido: z.string().trim().min(2, 'Apellido muy corto'),
  email: emailSchema.optional(),
  telefono: phoneSchema,
  password: passwordSchema,
  acceptTerms: z.boolean().refine(val => val === true, {
    message: 'Debes aceptar los términos y condiciones'
  })
});

// Crear empresa
export const createTenantSchema = z.object({
  ruc: rucSchema,
  razon_social: z.string().trim().min(3, 'Razón social muy corta'),
  nombre_comercial: z.string().trim().optional(),
  direccion: z.string().trim().optional(),
  telefono: phoneSchema.optional(),
  email: emailSchema.optional()
});

// Invitar usuario
export const inviteUserSchema = z.object({
  email: emailSchema,
  role: z.enum(['admin', 'manager', 'member', 'viewer']),
  permissions: z.array(z.string()).optional(),
  sendEmail: z.boolean().default(true)
});

// Actualizar perfil
export const updateProfileSchema = z.object({
  nombre: z.string().trim().min(2).optional(),
  apellido: z.string().trim().min(2).optional(),
  email: emailSchema.optional(),
  telefono: phoneSchema.optional(),
  bio: z.string().max(500).optional(),
  avatar_url: urlSchema.optional()
});

// Cambiar contraseña
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Contraseña actual requerida'),
  newPassword: passwordSchema,
  confirmPassword: z.string()
}).refine(data => data.newPassword === data.confirmPassword, {
  message: 'Las contraseñas no coinciden',
  path: ['confirmPassword']
});

// Crear suscripción
export const createSubscriptionSchema = z.object({
  planId: uuidSchema,
  paymentMethodId: z.string(),
  quantity: z.number().int().min(1).default(1),
  couponCode: z.string().optional()
});

// Enviar mensaje
export const sendMessageSchema = z.object({
  content: z.string().trim().min(1, 'Mensaje vacío').max(5000, 'Mensaje muy largo'),
  attachments: z.array(uuidSchema).max(10).optional(),
  replyToId: uuidSchema.optional(),
  mentions: z.array(uuidSchema).optional()
});

// Subir archivo
export const uploadFileSchema = z.object({
  folderId: uuidSchema.optional(),
  description: z.string().max(500).optional(),
  tags: tagsSchema,
  isPublic: z.boolean().default(false)
});

/**
 * Validador de formularios dinámicos
 */
export function createDynamicValidator(fields: Record<string, z.ZodSchema>) {
  return z.object(fields);
}

/**
 * Combinar múltiples schemas
 */
export function mergeSchemas(...schemas: z.ZodSchema[]): z.ZodSchema {
  return schemas.reduce((acc, schema) => acc.and(schema));
}
