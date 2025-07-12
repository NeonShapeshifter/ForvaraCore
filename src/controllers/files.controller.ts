import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { fileService } from '../services/file.service';
import { storageService } from '../services/storage.service';
import { activityService } from '../services/activity.service';
import { createApiResponse } from '../utils/responses';
import { logger } from '../config/logger';
import { ACTIVITY_ACTIONS } from '../constants';
import { 
  NotFoundError, 
  ValidationError, 
  AuthorizationError 
} from '../types';
import sharp from 'sharp';

export const getFiles = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const tenantId = req.tenantId!;
    const { 
      page = 1, 
      limit = 20, 
      appId, 
      tags, 
      search, 
      mimeType,
      sortBy = 'created_at',
      sortOrder = 'desc' 
    } = req.query;

    const result = await fileService.getFiles(tenantId, {
      page: Number(page),
      limit: Number(limit),
      appId: appId as string,
      tags: tags as string[],
      search: search as string,
      mimeType: mimeType as string,
      sortBy: sortBy as string,
      sortOrder: sortOrder as 'asc' | 'desc'
    });

    res.json(createApiResponse(
      true,
      result.files,
      'Archivos obtenidos',
      undefined,
      undefined,
      {
        pagination: result.pagination
      }
    ));
  } catch (error: any) {
    throw error;
  }
};

export const uploadFiles = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const tenantId = req.tenantId!;
    const userId = req.userId!;
    const appId = req.headers['x-app-id'] as string || 'forvara-hub';
    const files = req.files as Express.Multer.File[];
    const { tags = [], isPublic = false } = req.body;

    if (!files || files.length === 0) {
      throw new ValidationError('No se proporcionaron archivos');
    }

    // Verificar límite de almacenamiento
    const usage = await tenantService.getTenantUsage(tenantId);
    const limits = await subscriptionService.calculateTenantLimits(tenantId);
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    const newTotal = usage.storage_gb + (totalSize / 1024 / 1024 / 1024);

    if (limits.storage_gb && newTotal > limits.storage_gb) {
      throw new ValidationError(
        `Subir estos archivos excedería tu límite de ${limits.storage_gb}GB`
      );
    }

    // Subir archivos
    const uploadedFiles = await Promise.all(
      files.map(file => 
        fileService.uploadFile({
          tenantId,
          userId,
          appId,
          file,
          tags: Array.isArray(tags) ? tags : [tags],
          isPublic: isPublic === 'true'
        })
      )
    );

    // Actualizar uso de storage
    await tenantService.updateStorageUsage(tenantId, totalSize);

    // Log actividad
    await activityService.log({
      user_id: userId,
      tenant_id: tenantId,
      app_id: appId,
      action: ACTIVITY_ACTIONS.FILE_UPLOADED,
      details: {
        files_count: files.length,
        total_size: totalSize,
        file_ids: uploadedFiles.map(f => f.id)
      },
      ip_address: req.ip,
      user_agent: req.headers['user-agent'],
      success: true
    });

    res.status(201).json(createApiResponse(
      true,
      uploadedFiles,
      `${uploadedFiles.length} archivo(s) subido(s) exitosamente`
    ));
  } catch (error: any) {
    throw error;
  }
};

export const getFileById = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { fileId } = req.params;
    const tenantId = req.tenantId!;
    const userId = req.userId!;

    const file = await fileService.getFileById(fileId);
    
    if (!file) {
      throw new NotFoundError('Archivo');
    }

    // Verificar acceso
    if (!file.is_public && file.tenant_id !== tenantId) {
      // Verificar si está compartido
      const hasAccess = await fileService.checkFileAccess(fileId, tenantId);
      if (!hasAccess) {
        throw new AuthorizationError('No tienes acceso a este archivo');
      }
    }

    res.json(createApiResponse(
      true,
      file,
      'Archivo obtenido'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const updateFile = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { fileId } = req.params;
    const tenantId = req.tenantId!;
    const userId = req.userId!;
    const updates = req.body;

    const file = await fileService.getFileById(fileId);
    
    if (!file) {
      throw new NotFoundError('Archivo');
    }

    // Verificar propiedad
    if (file.tenant_id !== tenantId) {
      throw new AuthorizationError('No puedes editar este archivo');
    }

    const updatedFile = await fileService.updateFile(fileId, updates);

    // Log actividad
    await activityService.log({
      user_id: userId,
      tenant_id: tenantId,
      action: 'FILE_UPDATED',
      resource_type: 'file',
      resource_id: fileId,
      details: {
        updates: Object.keys(updates)
      },
      ip_address: req.ip,
      user_agent: req.headers['user-agent'],
      success: true
    });

    res.json(createApiResponse(
      true,
      updatedFile,
      'Archivo actualizado'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const deleteFile = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { fileId } = req.params;
    const tenantId = req.tenantId!;
    const userId = req.userId!;

    const file = await fileService.getFileById(fileId);
    
    if (!file) {
      throw new NotFoundError('Archivo');
    }

    // Verificar propiedad
    if (file.tenant_id !== tenantId) {
      throw new AuthorizationError('No puedes eliminar este archivo');
    }

    // Eliminar de storage
    await storageService.deleteFile(file.storage_path);

    // Eliminar registro
    await fileService.deleteFile(fileId);

    // Actualizar uso de storage
    await tenantService.updateStorageUsage(tenantId, -file.size_bytes);

    // Log actividad
    await activityService.log({
      user_id: userId,
      tenant_id: tenantId,
      action: ACTIVITY_ACTIONS.FILE_DELETED,
      resource_type: 'file',
      resource_id: fileId,
      details: {
        filename: file.filename,
        size: file.size_bytes
      },
      ip_address: req.ip,
      user_agent: req.headers['user-agent'],
      success: true
    });

    res.json(createApiResponse(
      true,
      null,
      'Archivo eliminado'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const downloadFile = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { fileId } = req.params;
    const tenantId = req.tenantId!;
    const userId = req.userId!;

    const file = await fileService.getFileById(fileId);
    
    if (!file) {
      throw new NotFoundError('Archivo');
    }

    // Verificar acceso
    if (!file.is_public && file.tenant_id !== tenantId) {
      const hasAccess = await fileService.checkFileAccess(fileId, tenantId);
      if (!hasAccess) {
        throw new AuthorizationError('No tienes acceso a este archivo');
      }
    }

    // Obtener archivo de storage
    const fileStream = await storageService.getFileStream(file.storage_path);

    // Log actividad
    await activityService.log({
      user_id: userId,
      tenant_id: tenantId,
      action: ACTIVITY_ACTIONS.FILE_DOWNLOADED,
      resource_type: 'file',
      resource_id: fileId,
      details: {
        filename: file.filename,
        size: file.size_bytes
      },
      ip_address: req.ip,
      user_agent: req.headers['user-agent'],
      success: true
    });

    // Enviar archivo
    res.setHeader('Content-Type', file.mime_type);
    res.setHeader('Content-Length', file.size_bytes.toString());
    res.setHeader(
      'Content-Disposition', 
      `attachment; filename="${file.original_name}"`
    );
    
    fileStream.pipe(res);
  } catch (error: any) {
    throw error;
  }
};

export const getFilePreview = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { fileId } = req.params;
    const { width = 200, height = 200 } = req.query;
    const tenantId = req.tenantId!;

    const file = await fileService.getFileById(fileId);
    
    if (!file) {
      throw new NotFoundError('Archivo');
    }

    // Verificar acceso
    if (!file.is_public && file.tenant_id !== tenantId) {
      const hasAccess = await fileService.checkFileAccess(fileId, tenantId);
     if (!hasAccess) {
       throw new AuthorizationError('No tienes acceso a este archivo');
     }
   }

   // Solo generar preview para imágenes
   if (!file.mime_type.startsWith('image/')) {
     throw new ValidationError('Preview solo disponible para imágenes');
   }

   // Verificar si ya existe el thumbnail en caché
   const cacheKey = `thumb:${fileId}:${width}x${height}`;
   const cachedThumb = await cacheService.get(cacheKey);
   
   if (cachedThumb) {
     res.setHeader('Content-Type', file.mime_type);
     res.setHeader('Cache-Control', 'public, max-age=86400'); // 24 horas
     res.send(Buffer.from(cachedThumb, 'base64'));
     return;
   }

   // Obtener archivo original
   const fileBuffer = await storageService.getFileBuffer(file.storage_path);

   // Generar thumbnail
   const thumbnail = await sharp(fileBuffer)
     .resize(Number(width), Number(height), {
       fit: 'cover',
       position: 'center'
     })
     .toBuffer();

   // Guardar en caché
   await cacheService.set(cacheKey, thumbnail.toString('base64'), 86400);

   res.setHeader('Content-Type', file.mime_type);
   res.setHeader('Cache-Control', 'public, max-age=86400');
   res.send(thumbnail);
 } catch (error: any) {
   throw error;
 }
};

export const shareFile = async (
 req: AuthenticatedRequest,
 res: Response
): Promise<void> => {
 try {
   const { fileId } = req.params;
   const tenantId = req.tenantId!;
   const userId = req.userId!;
   const { sharedWithApp, permissions = ['read'], expiresIn } = req.body;

   const file = await fileService.getFileById(fileId);
   
   if (!file) {
     throw new NotFoundError('Archivo');
   }

   // Verificar propiedad
   if (file.tenant_id !== tenantId) {
     throw new AuthorizationError('No puedes compartir este archivo');
   }

   // Verificar que la app destino tiene acceso
   const hasAppAccess = await subscriptionService.checkAppAccess(
     tenantId,
     sharedWithApp
   );

   if (!hasAppAccess) {
     throw new ValidationError(
       'No tienes acceso a la aplicación con la que quieres compartir'
     );
   }

   // Crear share
   const share = await fileService.shareFile({
     file_id: fileId,
     shared_by: userId,
     shared_with_app: sharedWithApp,
     permissions,
     expires_at: expiresIn 
       ? new Date(Date.now() + expiresIn * 1000)
       : undefined
   });

   // Log actividad
   await activityService.log({
     user_id: userId,
     tenant_id: tenantId,
     action: ACTIVITY_ACTIONS.FILE_SHARED,
     resource_type: 'file',
     resource_id: fileId,
     details: {
       shared_with_app: sharedWithApp,
       permissions,
       expires_in: expiresIn
     },
     ip_address: req.ip,
     user_agent: req.headers['user-agent'],
     success: true
   });

   res.status(201).json(createApiResponse(
     true,
     share,
     'Archivo compartido exitosamente'
   ));
 } catch (error: any) {
   throw error;
 }
};

export const getSharedFiles = async (
 req: AuthenticatedRequest,
 res: Response
): Promise<void> => {
 try {
   const tenantId = req.tenantId!;
   const appId = req.headers['x-app-id'] as string;

   if (!appId) {
     throw new ValidationError('Se requiere X-App-ID header');
   }

   const sharedFiles = await fileService.getSharedFiles(tenantId, appId);

   res.json(createApiResponse(
     true,
     sharedFiles,
     'Archivos compartidos obtenidos'
   ));
 } catch (error: any) {
   throw error;
 }
};

export const bulkDeleteFiles = async (
 req: AuthenticatedRequest,
 res: Response
): Promise<void> => {
 try {
   const tenantId = req.tenantId!;
   const userId = req.userId!;
   const { fileIds } = req.body;

   if (!Array.isArray(fileIds) || fileIds.length === 0) {
     throw new ValidationError('Se requiere array de fileIds');
   }

   // Verificar propiedad de todos los archivos
   const files = await fileService.getFilesByIds(fileIds);
   const unauthorizedFiles = files.filter(f => f.tenant_id !== tenantId);

   if (unauthorizedFiles.length > 0) {
     throw new AuthorizationError(
       'No tienes permisos para eliminar algunos archivos'
     );
   }

   // Eliminar archivos
   const results = await fileService.bulkDeleteFiles(fileIds, tenantId);

   // Actualizar uso de storage
   const totalSize = files.reduce((sum, file) => sum + file.size_bytes, 0);
   await tenantService.updateStorageUsage(tenantId, -totalSize);

   // Log actividad
   await activityService.log({
     user_id: userId,
     tenant_id: tenantId,
     action: 'BULK_FILES_DELETED',
     details: {
       files_count: results.deleted.length,
       failed_count: results.failed.length,
       total_size: totalSize
     },
     ip_address: req.ip,
     user_agent: req.headers['user-agent'],
     success: true
   });

   res.json(createApiResponse(
     true,
     results,
     `${results.deleted.length} archivos eliminados`
   ));
 } catch (error: any) {
   throw error;
 }
};
