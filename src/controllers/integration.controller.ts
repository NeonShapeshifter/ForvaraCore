import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { integrationService } from '../services/integration.service';
import { webhookService } from '../services/webhook.service';
import { activityService } from '../services/activity.service';
import { createApiResponse } from '../utils/responses';
import { logger } from '../config/logger';
import { ACTIVITY_ACTIONS } from '../constants';
import { NotFoundError, ValidationError, AuthorizationError } from '../types';
import crypto from 'crypto';

export const validateAccess = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { sourceApp, targetApp, resource, action, tenantId } = req.body;

    const validation = await integrationService.validateAppAccess({
      source_app: sourceApp,
      target_app: targetApp,
      resource,
      action,
      tenant_id: tenantId || req.tenantId
    });

    // Log validación
    await activityService.log({
      tenant_id: tenantId || req.tenantId,
      app_id: sourceApp,
      action: validation.allowed 
        ? ACTIVITY_ACTIONS.INTEGRATION_ACCESS_VALIDATED
        : ACTIVITY_ACTIONS.INTEGRATION_ACCESS_DENIED,
      details: {
        source_app: sourceApp,
        target_app: targetApp,
        resource,
        action,
        allowed: validation.allowed
      },
      success: validation.allowed
    });

    res.json(createApiResponse(
      true,
      validation,
      validation.allowed ? 'Acceso permitido' : 'Acceso denegado'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const shareData = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const tenantId = req.tenantId!;
    const userId = req.userId!;
    const { sourceApp, targetApp, dataType, data, options = {} } = req.body;

    // Validar acceso
    const validation = await integrationService.validateAppAccess({
      source_app: sourceApp,
      target_app: targetApp,
      resource: dataType,
      action: 'write',
      tenant_id: tenantId
    });

    if (!validation.allowed) {
      throw new AuthorizationError(validation.reason || 'Acceso denegado');
    }

    // Compartir datos
    const result = await integrationService.shareData({
      tenant_id: tenantId,
      source_app: sourceApp,
      target_app: targetApp,
      data_type: dataType,
      data,
      options,
      shared_by: userId
    });

    // Log actividad
    await activityService.log({
      user_id: userId,
      tenant_id: tenantId,
      app_id: sourceApp,
      action: ACTIVITY_ACTIONS.DATA_SHARED,
      details: {
        source_app: sourceApp,
        target_app: targetApp,
        data_type: dataType,
        records_count: Array.isArray(data) ? data.length : 1,
        sync: options.sync
      },
      ip_address: req.ip,
      user_agent: req.headers['user-agent'],
      success: true
    });

    res.status(201).json(createApiResponse(
      true,
      result,
      'Datos compartidos exitosamente'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const getSharedResources = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const tenantId = req.tenantId!;
    const appId = req.headers['x-app-id'] as string;
    const { direction = 'both', resourceType } = req.query;

    if (!appId) {
      throw new ValidationError('Se requiere X-App-ID header');
    }

    const resources = await integrationService.getSharedResources(
      tenantId,
      appId,
      {
        direction: direction as string,
        resourceType: resourceType as string
      }
    );

    res.json(createApiResponse(
      true,
      resources,
      'Recursos compartidos obtenidos'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const syncData = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const tenantId = req.tenantId!;
    const userId = req.userId!;
    const { sourceApp, targetApp, syncType, entities, lastSyncTime, options = {} } = req.body;

    // Iniciar sincronización
    const syncJob = await integrationService.startSync({
      tenant_id: tenantId,
      source_app: sourceApp,
      target_app: targetApp,
      sync_type: syncType,
      entities,
      last_sync_time: lastSyncTime,
      options,
      initiated_by: userId
    });

    res.json(createApiResponse(
      true,
      {
        sync_id: syncJob.id,
        status: syncJob.status,
        estimated_time: syncJob.estimated_time
      },
      'Sincronización iniciada'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const getWebhooks = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const tenantId = req.tenantId!;
    const appId = req.headers['x-app-id'] as string;

    const webhooks = await webhookService.getTenantWebhooks(tenantId, appId);

    res.json(createApiResponse(
      true,
      webhooks,
      'Webhooks obtenidos'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const createWebhook = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const tenantId = req.tenantId!;
    const userId = req.userId!;
    const { url, events, appId, secret, active = true, headers = {} } = req.body;

    // Generar secret si no se proporciona
    const webhookSecret = secret || crypto.randomBytes(32).toString('hex');

    const webhook = await webhookService.createWebhook({
      tenant_id: tenantId,
      app_id: appId,
      url,
      events,
      secret: webhookSecret,
      active,
      headers,
      created_by: userId
    });

    res.status(201).json(createApiResponse(
      true,
      {
        ...webhook,
        secret: webhookSecret // Solo mostrar en creación
      },
      'Webhook creado exitosamente'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const updateWebhook = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { webhookId } = req.params;
    const tenantId = req.tenantId!;
    const updates = req.body;

    const webhook = await webhookService.getWebhookById(webhookId, tenantId);
    
    if (!webhook) {
      throw new NotFoundError('Webhook');
    }

    const updatedWebhook = await webhookService.updateWebhook(
      webhookId,
      updates
    );

    res.json(createApiResponse(
      true,
      updatedWebhook,
      'Webhook actualizado'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const deleteWebhook = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { webhookId } = req.params;
    const tenantId = req.tenantId!;

    const webhook = await webhookService.getWebhookById(webhookId, tenantId);
    
    if (!webhook) {
      throw new NotFoundError('Webhook');
    }

    await webhookService.deleteWebhook(webhookId);

res.json(createApiResponse(
     true,
     null,
     'Webhook eliminado'
   ));
 } catch (error: any) {
   throw error;
 }
};

export const testWebhook = async (
 req: AuthenticatedRequest,
 res: Response
): Promise<void> => {
 try {
   const { webhookId } = req.params;
   const tenantId = req.tenantId!;

   const webhook = await webhookService.getWebhookById(webhookId, tenantId);
   
   if (!webhook) {
     throw new NotFoundError('Webhook');
   }

   // Enviar evento de prueba
   const testResult = await webhookService.sendTestWebhook(webhookId);

   res.json(createApiResponse(
     true,
     testResult,
     testResult.success 
       ? 'Webhook probado exitosamente' 
       : 'Fallo al probar webhook'
   ));
 } catch (error: any) {
   throw error;
 }
};

export const getApiKeys = async (
 req: AuthenticatedRequest,
 res: Response
): Promise<void> => {
 try {
   const tenantId = req.tenantId!;

   const apiKeys = await integrationService.getTenantApiKeys(tenantId);

   // No mostrar las keys completas
   const sanitizedKeys = apiKeys.map(key => ({
     ...key,
     key: `${key.key.substring(0, 8)}...${key.key.substring(key.key.length - 4)}`
   }));

   res.json(createApiResponse(
     true,
     sanitizedKeys,
     'API Keys obtenidas'
   ));
 } catch (error: any) {
   throw error;
 }
};

export const createApiKey = async (
 req: AuthenticatedRequest,
 res: Response
): Promise<void> => {
 try {
   const tenantId = req.tenantId!;
   const userId = req.userId!;
   const { name, appId, permissions = [], expiresAt } = req.body;

   const apiKey = await integrationService.createApiKey({
     tenant_id: tenantId,
     name,
     app_id: appId,
     permissions,
     expires_at: expiresAt,
     created_by: userId
   });

   res.status(201).json(createApiResponse(
     true,
     {
       id: apiKey.id,
       key: apiKey.key, // Solo mostrar completa al crear
       name: apiKey.name,
       created_at: apiKey.created_at
     },
     'API Key creada exitosamente',
     'Guarda esta key de forma segura, no podrás verla nuevamente'
   ));
 } catch (error: any) {
   throw error;
 }
};

export const revokeApiKey = async (
 req: AuthenticatedRequest,
 res: Response
): Promise<void> => {
 try {
   const { keyId } = req.params;
   const tenantId = req.tenantId!;

   const apiKey = await integrationService.getApiKeyById(keyId, tenantId);
   
   if (!apiKey) {
     throw new NotFoundError('API Key');
   }

   await integrationService.revokeApiKey(keyId);

   res.json(createApiResponse(
     true,
     null,
     'API Key revocada'
   ));
 } catch (error: any) {
   throw error;
 }
};
