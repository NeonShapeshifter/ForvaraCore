/**
 * Expresiones regulares comunes
 */
export const REGEX_PATTERNS = {
  // Identificadores
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  SLUG: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  
  // Contacto
  EMAIL: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
  PHONE: /^[\+]?[(]?[0-9]{3}[)]?[-\s\.]?[(]?[0-9]{3}[)]?[-\s\.]?[0-9]{4,6}$/,
  PHONE_ECUADOR: /^(\+593|0)[0-9]{9}$/,
  
  // Documentos Ecuador
  RUC: /^\d{13}$/,
  CEDULA: /^\d{10}$/,
  
  // Seguridad
  STRONG_PASSWORD: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/,
  JWT_TOKEN: /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_.+/=]*$/,
  API_KEY: /^[A-Za-z0-9_-]{32,}$/,
  
  // Web
  URL: /^https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)$/,
  IPV4: /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/,
  IPV6: /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4})$/i,
  
  // Nombres y texto
  FORVARA_MAIL: /^[a-z0-9._]+$/,
  USERNAME: /^[a-zA-Z0-9_-]{3,30}$/,
  
  // Archivos
  IMAGE_EXTENSIONS: /\.(jpg|jpeg|png|gif|webp|svg)$/i,
  DOCUMENT_EXTENSIONS: /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv)$/i,
  
  // Texto
  ALPHANUMERIC: /^[a-zA-Z0-9]+$/,
  LETTERS_ONLY: /^[a-zA-Z\s]+$/,
  NUMBERS_ONLY: /^\d+$/,
  
  // Validaciones específicas
  CREDIT_CARD: /^(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|3[0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})$/,
  BITCOIN_ADDRESS: /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/,
  
  // Fechas
  ISO_DATE: /^\d{4}-\d{2}-\d{2}$/,
  ISO_DATETIME: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/,
  
  // Colores
  HEX_COLOR: /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/,
  RGB_COLOR: /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/,
  
  // Versiones
  SEMANTIC_VERSION: /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/,
  
  // Medidas
  PERCENTAGE: /^(100|[1-9]?\d)%$/,
  CURRENCY: /^\$?\d{1,3}(,\d{3})*(\.\d{2})?$/
};

/**
 * Funciones de validación usando regex
 */
export const validateWith = {
  email: (value: string): boolean => REGEX_PATTERNS.EMAIL.test(value),
  phone: (value: string): boolean => REGEX_PATTERNS.PHONE.test(value),
  ruc: (value: string): boolean => REGEX_PATTERNS.RUC.test(value),
  cedula: (value: string): boolean => REGEX_PATTERNS.CEDULA.test(value),
  strongPassword: (value: string): boolean => REGEX_PATTERNS.STRONG_PASSWORD.test(value),
  url: (value: string): boolean => REGEX_PATTERNS.URL.test(value),
  uuid: (value: string): boolean => REGEX_PATTERNS.UUID.test(value),
  slug: (value: string): boolean => REGEX_PATTERNS.SLUG.test(value),
  username: (value: string): boolean => REGEX_PATTERNS.USERNAME.test(value),
  hexColor: (value: string): boolean => REGEX_PATTERNS.HEX_COLOR.test(value),
  semanticVersion: (value: string): boolean => REGEX_PATTERNS.SEMANTIC_VERSION.test(value),
  isoDate: (value: string): boolean => REGEX_PATTERNS.ISO_DATE.test(value),
  creditCard: (value: string): boolean => REGEX_PATTERNS.CREDIT_CARD.test(value)
};

/**
 * Sanitización de texto
 */
export const sanitize = {
  slug: (text: string): string => {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
  },
  
  alphanumeric: (text: string): string => {
    return text.replace(/[^a-zA-Z0-9]/g, '');
  },
  
  phoneNumber: (phone: string): string => {
    return phone.replace(/\D/g, '');
  },
  
  filename: (filename: string): string => {
    return filename.replace(/[^a-zA-Z0-9.-]/g, '_');
  }
};

export default REGEX_PATTERNS;