import { v4 as uuidv4 } from 'uuid';
import { getSupabase } from '../config/database';
import { getRedis } from '../config/redis';
import { logger } from '../config/logger';
import { NotFoundError, ValidationError, AuthorizationError } from '../types';
import { ACTIVITY_ACTIONS } from '../constants';
import { activityService } from './activity.service';

interface IntegrationConfig {
  app_id: string;
  tenant_id: string;
  user_id: string;
  config: Record<string, any>;
  permissions: string[];
}

interface DataSharingRequest {
  source_app_id: string;
  target_app_id: string;
  tenant_id: string;
  data_types: string[];
  expires_at?: Date;
}

class IntegrationService {
  private getSupabaseClient() {
    return getSupabase();
  }
  private redis = getRedis();

  async validateAccess(tenantId: string, appId: string, userId: string, permissions?: string[]) {
    try {
      // Check if app is installed for tenant
      const { data: installation } = await this.getSupabaseClient()
        .from('app_installations')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('app_id', appId)
        .eq('is_active', true)
        .single();

      if (!installation) {
        throw new NotFoundError('App not installed for this tenant');
      }

      // Check permissions if specified
      if (permissions && permissions.length > 0) {
        const { data: appPermissions } = await this.getSupabaseClient()
          .from('app_permissions')
          .select('permission')
          .eq('installation_id', installation.id)
          .in('permission', permissions);

        const grantedPermissions = appPermissions?.map(p => p.permission) || [];
        const missingPermissions = permissions.filter(p => !grantedPermissions.includes(p));

        if (missingPermissions.length > 0) {
          throw new AuthorizationError(`Missing permissions: ${missingPermissions.join(', ')}`);
        }
      }

      await activityService.create({
        tenantId,
        userId,
        action: ACTIVITY_ACTIONS.INTEGRATION_ACCESS,
        resource: 'integration',
        resourceId: appId,
        metadata: { permissions }
      });

      return { valid: true, installation };
    } catch (error) {
      logger.error('Validate access failed:', error);
      throw error;
    }
  }

  async shareData(request: DataSharingRequest) {
    try {
      const id = uuidv4();
      
      // Validate both apps are installed
      await this.validateAccess(request.tenant_id, request.source_app_id, 'system');
      await this.validateAccess(request.tenant_id, request.target_app_id, 'system');

      const { data, error } = await this.getSupabaseClient()
        .from('data_sharing_agreements')
        .insert({
          id,
          ...request,
          created_at: new Date().toISOString(),
          is_active: true
        })
        .select()
        .single();

      if (error) throw error;

      // Clear cache
      await this.redis.del(`integrations:${request.tenant_id}:*`);

      return data;
    } catch (error) {
      logger.error('Share data failed:', error);
      throw error;
    }
  }

  async getIntegrations(tenantId: string) {
    try {
      const cacheKey = `integrations:${tenantId}:list`;
      const cached = await this.redis.get(cacheKey);
      if (cached) return JSON.parse(cached);

      const { data, error } = await this.getSupabaseClient()
        .from('app_installations')
        .select(`
          *,
          app:apps(*),
          permissions:app_permissions(*)
        `)
        .eq('tenant_id', tenantId)
        .eq('is_active', true);

      if (error) throw error;

      await this.redis.setex(cacheKey, 300, JSON.stringify(data));
      return data;
    } catch (error) {
      logger.error('Get integrations failed:', error);
      throw error;
    }
  }

  async configure(config: IntegrationConfig) {
    try {
      const { data: installation } = await this.getSupabaseClient()
        .from('app_installations')
        .select('id')
        .eq('tenant_id', config.tenant_id)
        .eq('app_id', config.app_id)
        .single();

      if (!installation) {
        throw new NotFoundError('App not installed');
      }

      const { error } = await this.getSupabaseClient()
        .from('app_installations')
        .update({
          config: config.config,
          updated_at: new Date().toISOString()
        })
        .eq('id', installation.id);

      if (error) throw error;

      // Update permissions
      if (config.permissions) {
        await this.getSupabaseClient()
          .from('app_permissions')
          .delete()
          .eq('installation_id', installation.id);

        const permissions = config.permissions.map(permission => ({
          installation_id: installation.id,
          permission,
          granted_at: new Date().toISOString()
        }));

        await this.getSupabaseClient()
          .from('app_permissions')
          .insert(permissions);
      }

      await this.redis.del(`integrations:${config.tenant_id}:*`);
      return { success: true };
    } catch (error) {
      logger.error('Configure integration failed:', error);
      throw error;
    }
  }
}

export const integrationService = new IntegrationService();