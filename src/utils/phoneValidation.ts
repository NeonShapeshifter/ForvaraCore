// Phone validation utilities for LATAM countries
// Using custom validation logic instead of external dependencies

// LATAM phone number specifications matching frontend
interface CountryPhoneSpec {
  code: string
  name: string
  callingCode: string
  mobilePattern: RegExp
  landlinePattern?: RegExp
  digitCount: number
  format: string
  example: string
}

const LATAM_PHONE_SPECS: Record<string, CountryPhoneSpec> = {
  PA: {
    code: 'PA',
    name: 'Panamá',
    callingCode: '+507',
    mobilePattern: /^[6][0-9]{7}$/,
    landlinePattern: /^[2-5][0-9]{6,7}$/,
    digitCount: 8, // Mobile always 8, landline can be 7 or 8
    format: 'XXXX-XXXX',
    example: '6123-4567'
  },
  CO: {
    code: 'CO',
    name: 'Colombia',
    callingCode: '+57',
    mobilePattern: /^[3][0-9]{9}$/,
    digitCount: 10,
    format: '3XX XXX XXXX',
    example: '312 345 6789'
  },
  MX: {
    code: 'MX',
    name: 'México',
    callingCode: '+52',
    mobilePattern: /^1[0-9]{10}$/,
    digitCount: 11,
    format: '1 XXX XXX XXXX',
    example: '1 555 123 4567'
  },
  AR: {
    code: 'AR',
    name: 'Argentina',
    callingCode: '+54',
    mobilePattern: /^9[0-9]{10}$/,
    digitCount: 11,
    format: '9 XX XXXX-XXXX',
    example: '9 11 1234-5678'
  },
  CL: {
    code: 'CL',
    name: 'Chile',
    callingCode: '+56',
    mobilePattern: /^9[0-9]{8}$/,
    digitCount: 9,
    format: '9 XXXX XXXX',
    example: '9 1234 5678'
  },
  BR: {
    code: 'BR',
    name: 'Brasil',
    callingCode: '+55',
    mobilePattern: /^[0-9]{2}9[0-9]{8}$/,
    digitCount: 11,
    format: 'XX 9XXXX-XXXX',
    example: '11 91234-5678'
  },
  PE: {
    code: 'PE',
    name: 'Perú',
    callingCode: '+51',
    mobilePattern: /^9[0-9]{8}$/,
    digitCount: 9,
    format: '9XX XXX XXX',
    example: '912 345 678'
  },
  EC: {
    code: 'EC',
    name: 'Ecuador',
    callingCode: '+593',
    mobilePattern: /^9[0-9]{8}$/,
    digitCount: 9,
    format: '9X XXX XXXX',
    example: '99 123 4567'
  },
  CR: {
    code: 'CR',
    name: 'Costa Rica',
    callingCode: '+506',
    mobilePattern: /^[6-8][0-9]{7}$/,
    digitCount: 8,
    format: 'XXXX-XXXX',
    example: '8123-4567'
  },
  SV: {
    code: 'SV',
    name: 'El Salvador',
    callingCode: '+503',
    mobilePattern: /^[67][0-9]{7}$/,
    digitCount: 8,
    format: 'XXXX-XXXX',
    example: '7123-4567'
  },
  GT: {
    code: 'GT',
    name: 'Guatemala',
    callingCode: '+502',
    mobilePattern: /^[45][0-9]{7}$/,
    digitCount: 8,
    format: 'XXXX XXXX',
    example: '5123 4567'
  },
  HN: {
    code: 'HN',
    name: 'Honduras',
    callingCode: '+504',
    mobilePattern: /^[9][0-9]{7}$/,
    digitCount: 8,
    format: 'XXXX-XXXX',
    example: '9123-4567'
  },
  NI: {
    code: 'NI',
    name: 'Nicaragua',
    callingCode: '+505',
    mobilePattern: /^[8][0-9]{7}$/,
    digitCount: 8,
    format: 'XXXX XXXX',
    example: '8123 4567'
  },
  BZ: {
    code: 'BZ',
    name: 'Belice',
    callingCode: '+501',
    mobilePattern: /^[6][0-9]{6}$/,
    digitCount: 7,
    format: 'XXX-XXXX',
    example: '612-3456'
  },
  UY: {
    code: 'UY',
    name: 'Uruguay',
    callingCode: '+598',
    mobilePattern: /^9[0-9]{7}$/,
    digitCount: 8,
    format: '9X XXX XXX',
    example: '91 234 567'
  },
  PY: {
    code: 'PY',
    name: 'Paraguay',
    callingCode: '+595',
    mobilePattern: /^9[0-9]{8}$/,
    digitCount: 9,
    format: '9XX XXX XXX',
    example: '961 234 567'
  },
  BO: {
    code: 'BO',
    name: 'Bolivia',
    callingCode: '+591',
    mobilePattern: /^[67][0-9]{7}$/,
    digitCount: 8,
    format: 'XXXX XXXX',
    example: '7123 4567'
  },
  VE: {
    code: 'VE',
    name: 'Venezuela',
    callingCode: '+58',
    mobilePattern: /^4[0-9]{9}$/,
    digitCount: 10,
    format: '4XX XXX XXXX',
    example: '412 345 6789'
  },
  GY: {
    code: 'GY',
    name: 'Guyana',
    callingCode: '+592',
    mobilePattern: /^[6][0-9]{6}$/,
    digitCount: 7,
    format: 'XXX XXXX',
    example: '612 3456'
  },
  SR: {
    code: 'SR',
    name: 'Surinam',
    callingCode: '+597',
    mobilePattern: /^[678][0-9]{6}$/,
    digitCount: 7,
    format: 'XXX-XXXX',
    example: '712-3456'
  },
  SE: {
    code: 'SE',
    name: 'Suecia',
    callingCode: '+46',
    mobilePattern: /^7[0-9]{8}$/,
    digitCount: 9,
    format: '7X XXX XX XX',
    example: '70 123 45 67'
  }
}

export interface PhoneValidationResult {
  isValid: boolean
  error?: string
  countryCode?: string
  nationalNumber?: string
  internationalFormat?: string
  e164Format?: string
  countryName?: string
  isLATAM?: boolean
}

/**
 * Parse phone number and extract country code
 */
function parsePhoneNumber(phoneNumber: string): { country?: string; nationalNumber: string; e164: string } | null {
  const cleaned = phoneNumber.replace(/\D/g, '')
  
  // Check for international format with +
  if (phoneNumber.startsWith('+')) {
    // Extract country calling codes for LATAM + Sweden
    const countryCodeMap: Record<string, string> = {
      '507': 'PA',  // Panama
      '57': 'CO',   // Colombia
      '52': 'MX',   // Mexico
      '54': 'AR',   // Argentina
      '56': 'CL',   // Chile
      '55': 'BR',   // Brazil
      '51': 'PE',   // Peru
      '593': 'EC',  // Ecuador
      '506': 'CR',  // Costa Rica
      '503': 'SV',  // El Salvador
      '502': 'GT',  // Guatemala
      '504': 'HN',  // Honduras
      '505': 'NI',  // Nicaragua
      '501': 'BZ',  // Belize
      '598': 'UY',  // Uruguay
      '595': 'PY',  // Paraguay
      '591': 'BO',  // Bolivia
      '58': 'VE',   // Venezuela
      '592': 'GY',  // Guyana
      '597': 'SR',  // Suriname
      '46': 'SE'    // Sweden
    }
    
    // Try to match country codes (longest first)
    for (const [code, country] of Object.entries(countryCodeMap).sort((a, b) => b[0].length - a[0].length)) {
      if (cleaned.startsWith(code)) {
        return {
          country,
          nationalNumber: cleaned.substring(code.length),
          e164: '+' + cleaned
        }
      }
    }
  }
  
  return {
    nationalNumber: cleaned,
    e164: '+' + cleaned
  }
}

/**
 * Validate phone number with LATAM-specific rules
 */
export function validatePhoneNumber(phoneNumber: string | undefined | null): PhoneValidationResult {
  if (!phoneNumber || phoneNumber.trim() === '') {
    return {
      isValid: false,
      error: 'El número de teléfono es obligatorio'
    }
  }

  const trimmedPhone = phoneNumber.trim()

  try {
    // Basic format validation
    if (!/^\+?[\d\s\-\(\)]+$/.test(trimmedPhone)) {
      return {
        isValid: false,
        error: 'Formato de número inválido - solo números, espacios, guiones y paréntesis'
      }
    }

    // Parse the phone number
    const parsed = parsePhoneNumber(trimmedPhone)
    
    if (!parsed) {
      return {
        isValid: false,
        error: 'No se pudo procesar el número'
      }
    }

    const country = parsed.country
    const nationalNum = parsed.nationalNumber
    
    // Check if it's a LATAM country
    const isLATAM = country ? Object.keys(LATAM_PHONE_SPECS).includes(country) : false
    
    if (isLATAM && country) {
      // Apply LATAM-specific validation
      const spec = LATAM_PHONE_SPECS[country]
      const cleanNumber = nationalNum.replace(/\D/g, '')
      
      // Check patterns first, then digit count based on pattern
      const isMobile = spec.mobilePattern.test(cleanNumber)
      const isLandline = spec.landlinePattern ? spec.landlinePattern.test(cleanNumber) : false
      
      if (!isMobile && !isLandline) {
        return {
          isValid: false,
          error: `Número no válido para ${spec.name}`,
          countryCode: country,
          countryName: spec.name,
          isLATAM: true
        }
      }
      
      // For mobile numbers, always check digit count
      if (isMobile && cleanNumber.length !== spec.digitCount) {
        return {
          isValid: false,
          error: `Número móvil debe tener ${spec.digitCount} dígitos para ${spec.name}`,
          countryCode: country,
          countryName: spec.name,
          isLATAM: true
        }
      }
      
      // For landlines, digit count already validated by regex pattern
      
      // Format the number for display
      const nationalFormatted = formatNationalNumber(cleanNumber, spec)
      
      return {
        isValid: true,
        countryCode: country,
        nationalNumber: nationalFormatted,
        internationalFormat: `${spec.callingCode} ${nationalFormatted}`,
        e164Format: parsed.e164,
        countryName: spec.name,
        isLATAM: true
      }
    }

    // For non-LATAM countries, basic validation
    const cleanNumber = nationalNum.replace(/\D/g, '')
    if (cleanNumber.length < 7 || cleanNumber.length > 15) {
      return {
        isValid: false,
        error: 'Número debe tener entre 7 y 15 dígitos'
      }
    }

    // All validations passed
    return {
      isValid: true,
      countryCode: country,
      nationalNumber: nationalNum,
      internationalFormat: parsed.e164,
      e164Format: parsed.e164,
      countryName: country,
      isLATAM: false
    }

  } catch (error) {
    console.error('Phone validation error:', error)
    return {
      isValid: false,
      error: 'Error al validar el número'
    }
  }
}

/**
 * Format national number according to country spec
 */
function formatNationalNumber(number: string, spec: CountryPhoneSpec): string {
  // Apply basic formatting based on country
  switch (spec.code) {
    case 'PA':
    case 'CR':
    case 'SV':
    case 'HN':
      return `${number.substring(0, 4)}-${number.substring(4)}`
    case 'CO':
      return `${number.substring(0, 3)} ${number.substring(3, 6)} ${number.substring(6)}`
    case 'MX':
      return `${number.substring(0, 1)} ${number.substring(1, 4)} ${number.substring(4, 7)} ${number.substring(7)}`
    case 'AR':
      return `${number.substring(0, 1)} ${number.substring(1, 3)} ${number.substring(3, 7)}-${number.substring(7)}`
    case 'CL':
      return `${number.substring(0, 1)} ${number.substring(1, 5)} ${number.substring(5)}`
    case 'BR':
      return `${number.substring(0, 2)} ${number.substring(2, 7)}-${number.substring(7)}`
    case 'PE':
      return `${number.substring(0, 3)} ${number.substring(3, 6)} ${number.substring(6)}`
    case 'EC':
      return `${number.substring(0, 2)} ${number.substring(2, 5)} ${number.substring(5)}`
    case 'GT':
    case 'NI':
    case 'BO':
      return `${number.substring(0, 4)} ${number.substring(4)}`
    case 'BZ':
    case 'GY':
      return `${number.substring(0, 3)} ${number.substring(3)}`
    case 'UY':
      return `${number.substring(0, 2)} ${number.substring(2, 5)} ${number.substring(5)}`
    case 'PY':
      return `${number.substring(0, 3)} ${number.substring(3, 6)} ${number.substring(6)}`
    case 'VE':
      return `${number.substring(0, 3)} ${number.substring(3, 6)} ${number.substring(6)}`
    case 'SR':
      return `${number.substring(0, 3)}-${number.substring(3)}`
    case 'SE':
      return `${number.substring(0, 2)} ${number.substring(2, 5)} ${number.substring(5, 7)} ${number.substring(7)}`
    default:
      return number
  }
}

/**
 * Normalize phone number to E.164 format
 */
export function normalizePhoneNumber(phoneNumber: string): string | null {
  const validation = validatePhoneNumber(phoneNumber)
  return validation.isValid ? validation.e164Format || null : null
}

/**
 * Check if a country code is supported in LATAM
 */
export function isLATAMCountry(countryCode: string): boolean {
  return Object.keys(LATAM_PHONE_SPECS).includes(countryCode)
}

/**
 * Get country specification for LATAM countries
 */
export function getCountrySpec(countryCode: string): CountryPhoneSpec | null {
  return LATAM_PHONE_SPECS[countryCode] || null
}

/**
 * Get all supported LATAM countries
 */
export function getSupportedLATAMCountries(): CountryPhoneSpec[] {
  return Object.values(LATAM_PHONE_SPECS)
}

/**
 * Validate multiple phone numbers
 */
export function validatePhoneNumbers(phoneNumbers: string[]): PhoneValidationResult[] {
  return phoneNumbers.map(validatePhoneNumber)
}

/**
 * Format phone number for display (national format)
 */
export function formatPhoneForDisplay(phoneNumber: string): string {
  const validation = validatePhoneNumber(phoneNumber)
  return validation.isValid && validation.nationalNumber ? validation.nationalNumber : phoneNumber
}

/**
 * Format phone number for storage (E.164 format)
 */
export function formatPhoneForStorage(phoneNumber: string): string | null {
  return normalizePhoneNumber(phoneNumber)
}