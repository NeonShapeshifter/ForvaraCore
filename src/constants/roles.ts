/**
 * Roles de usuario en el sistema
 */
export enum UserRole {
  SUPER_ADMIN = 'super_admin',
  ADMIN = 'admin',
  MANAGER = 'manager',
  MEMBER = 'member',
  VIEWER = 'viewer',
  GUEST = 'guest'
}

/**
 * Alias para compatibilidad
 */
export const USER_ROLES = UserRole;

/**
 * Jerarquía de roles (mayor número = más permisos)
 */
export const RoleHierarchy: Record<UserRole, number> = {
  [UserRole.SUPER_ADMIN]: 100,
  [UserRole.ADMIN]: 80,
  [UserRole.MANAGER]: 60,
  [UserRole.MEMBER]: 40,
  [UserRole.VIEWER]: 20,
  [UserRole.GUEST]: 10
};

/**
 * Permisos por rol
 */
export const RolePermissions: Record<UserRole, string[]> = {
  [UserRole.SUPER_ADMIN]: ['*'], // Todos los permisos
  
  [UserRole.ADMIN]: [
    // Tenant
    'tenant.read',
    'tenant.update',
    'tenant.delete',
    'tenant.settings',
    'tenant.billing',
    
    // Team
    'team.read',
    'team.invite',
    'team.update',
    'team.remove',
    'team.update_role',
    
    // Subscriptions
    'subscription.read',
    'subscription.create',
    'subscription.update',
    'subscription.cancel',
    
    // Files
    'files.read',
    'files.upload',
    'files.update',
    'files.delete',
    'files.share',
    
    // Mail
    'mail.read',
    'mail.send',
    'mail.create_channel',
    'mail.manage_channel',
    
    // Reports
    'reports.read',
    'reports.create',
    'reports.export',
    
    // Settings
    'settings.read',
    'settings.update',
    
    // Activity
    'activity.read',
    'activity.export'
  ],
  
  [UserRole.MANAGER]: [
    // Tenant
    'tenant.read',
    'tenant.update',
    
    // Team
    'team.read',
    'team.invite',
    'team.update',
    
    // Files
    'files.read',
    'files.upload',
    'files.update',
    'files.delete',
    'files.share',
    
    // Mail
    'mail.read',
    'mail.send',
    'mail.create_channel',
    
    // Reports
    'reports.read',
    'reports.create',
    
    // Settings
    'settings.read',
    
    // Activity
    'activity.read'
  ],
  
  [UserRole.MEMBER]: [
    // Tenant
    'tenant.read',
    
    // Team
    'team.read',
    
    // Files
    'files.read',
    'files.upload',
    'files.update',
    
    // Mail
    'mail.read',
    'mail.send',
    
    // Reports
    'reports.read',
    
    // Settings
    'settings.read'
  ],
  
  [UserRole.VIEWER]: [
    // Tenant
    'tenant.read',
    
    // Team
    'team.read',
    
    // Files
    'files.read',
    
    // Mail
    'mail.read',
    
    // Reports
    'reports.read'
  ],
  
  [UserRole.GUEST]: [
    // Muy limitado
    'tenant.read',
    'files.read'
  ]
};

/**
 * Verificar si un rol tiene un permiso específico
 */
export function roleHasPermission(role: UserRole, permission: string): boolean {
  const permissions = RolePermissions[role];
  
  // Super admin tiene todos los permisos
  if (permissions.includes('*')) {
    return true;
  }
  
  // Verificar permiso exacto
  if (permissions.includes(permission)) {
    return true;
  }
  
  // Verificar permisos con wildcard
  const permissionParts = permission.split('.');
  for (let i = permissionParts.length; i > 0; i--) {
    const wildcardPermission = permissionParts.slice(0, i - 1).join('.') + '.*';
    if (permissions.includes(wildcardPermission)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Verificar si un rol es superior a otro
 */
export function isRoleSuperior(role1: UserRole, role2: UserRole): boolean {
  return RoleHierarchy[role1] > RoleHierarchy[role2];
}

/**
 * Obtener el nombre display de un rol
 */
export const RoleDisplayNames: Record<UserRole, string> = {
  [UserRole.SUPER_ADMIN]: 'Super Administrador',
  [UserRole.ADMIN]: 'Administrador',
  [UserRole.MANAGER]: 'Gerente',
  [UserRole.MEMBER]: 'Miembro',
  [UserRole.VIEWER]: 'Observador',
  [UserRole.GUEST]: 'Invitado'
};

/**
 * Colores para badges de roles
 */
export const RoleColors: Record<UserRole, string> = {
  [UserRole.SUPER_ADMIN]: '#FF0000',
  [UserRole.ADMIN]: '#FF6B6B',
  [UserRole.MANAGER]: '#4ECDC4',
  [UserRole.MEMBER]: '#45B7D1',
  [UserRole.VIEWER]: '#96CEB4',
  [UserRole.GUEST]: '#DDA0DD'
};
