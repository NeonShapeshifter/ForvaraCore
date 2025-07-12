import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import archiver from 'archiver';
import { getSupabase } from '../config/database';
import { getRedis } from '../config/redis';
import { logger } from '../config/logger';
import { 
  NotFoundError, 
  ValidationError,
  AuthorizationError,
  SharedFile,
  FileMetadata,
  FileShare,
  PaginatedResponse
} from '../types';
import { storageService } from './storage.service';
import { activityService } from './activity.service';
import { notificationService } from './notification.service';
import { tenantService } from './tenant.service';
import { addFileProcessingJob } from '../queues';
import { ACTIVITY_ACTIONS } from '../constants';
import { 
  sanitizeFilename, 
  getImageMetadata,
  generateThumbnail,
  formatBytes 
} from '../utils/helpers';

// const supabase = getSupabase(); // Moved to lazy loading
// const redis = getRedis(); // Moved to lazy loading

class FileService {
  /**
   * Subir archivo
   */
  async uploadFile(params: {
    file: Express.Multer.File;
    tenantId: string;
    userId: string;
    appId: string;
    folderId?: string;
    description?: string;
    tags?: string[];
    isPublic?: boolean;
  }): Promise<SharedFile> {
    try {
      const { file, tenantId, userId, appId, folderId, description, tags, isPublic } = params;

      // Verificar límite de almacenamiento
      const hasSpace = await this.checkStorageLimit(tenantId, file.size);
      if (!hasSpace) {
        throw new ValidationError('Límite de almacenamiento excedido');
      }

      // Sanitizar nombre de archivo
      const sanitizedName = sanitizeFilename(file.originalname);
      const fileId = uuidv4();
      const fileExtension = path.extname(sanitizedName);
      const storagePath = `tenants/${tenantId}/${appId}/${fileId}${fileExtension}`;

      // Subir a storage
      const uploadedUrl = await storageService.uploadFile(
        file.buffer,
        storagePath,
        {
          contentType: file.mimetype,
          metadata: {
            originalName: file.originalname,
            uploadedBy: userId,
            tenantId,
            appId
          }
        }
      );

      // Extraer metadata según tipo
      let metadata: FileMetadata = {
        original_name: file.originalname,
        size_formatted: formatBytes(file.size)
      };

      if (file.mimetype.startsWith('image/')) {
        const imageMetadata = await getImageMetadata(file.buffer);
        if (imageMetadata) {
          metadata = { ...metadata, ...imageMetadata };
        }
      }

      // Crear registro en BD
      const { data: sharedFile, error } = await supabase
        .from('shared_files')
        .insert({
          id: fileId,
          tenant_id: tenantId,
          app_id: appId,
          folder_id: folderId,
          name: sanitizedName,
          original_name: file.originalname,
          mime_type: file.mimetype,
          size_bytes: file.size,
          storage_path: storagePath,
          storage_url: uploadedUrl,
          uploaded_by: userId,
          description,
          tags: tags || [],
          metadata,
          is_public: isPublic || false,
          version: 1
        })
        .select()
        .single();

      if (error) throw error;

      // Actualizar uso de almacenamiento
      await tenantService.updateStorageUsage(tenantId, file.size);

      // Procesar archivo en background
      await addFileProcessingJob({
        fileId,
        operations: this.getProcessingOperations(file.mimetype),
        priority: file.size > 10 * 1024 * 1024 ? 2 : 1 // Menor prioridad para archivos grandes
      });

      // Registrar actividad
      await activityService.log({
        tenant_id: tenantId,
        user_id: userId,
        action: ACTIVITY_ACTIONS.FILE_UPLOADED,
        resource_type: 'file',
        resource_id: fileId,
        details: {
          file_name: sanitizedName,
          file_size: file.size,
          mime_type: file.mimetype,
          app_id: appId
        }
      });

      logger.info({ 
        fileId, 
        tenantId, 
        userId,
        fileName: sanitizedName,
        size: file.size 
      }, 'File uploaded');

      return sharedFile;
    } catch (error) {
      logger.error({ error, params }, 'Upload file failed');
      throw error;
    }
  }

  /**
   * Obtener archivo por ID
   */
  async getFileById(fileId: string): Promise<SharedFile> {
    const { data: file, error } = await supabase
      .from('shared_files')
      .select(`
        *,
        uploaded_by_user:users!uploaded_by (
          id,
          nombre,
          apellido,
          avatar_url
        ),
        shares:file_shares (
          id,
          shared_with,
          permissions,
          expires_at
        )
      `)
      .eq('id', fileId)
      .single();

    if (error || !file) {
      throw new NotFoundError('Archivo');
    }

    return file;
  }

  /**
   * Buscar archivos
   */
  async searchFiles(params: {
    tenantId?: string;
    appId?: string;
    folderId?: string;
    userId?: string;
    query?: string;
    mimeTypes?: string[];
    tags?: string[];
    dateFrom?: Date;
    dateTo?: Date;
    page?: number;
    limit?: number;
    sortBy?: 'name' | 'size' | 'created_at' | 'modified_at';
    sortOrder?: 'asc' | 'desc';
  }): Promise<PaginatedResponse<SharedFile>> {
    try {
      const { 
        tenantId,
        appId,
        folderId,
        userId,
        query, 
        mimeTypes,
        tags,
        dateFrom,
        dateTo,
        page = 1, 
        limit = 20,
        sortBy = 'created_at',
        sortOrder = 'desc'
      } = params;

      let queryBuilder = supabase
        .from('shared_files')
        .select(`
          *,
          uploaded_by_user:users!uploaded_by (
            id,
            nombre,
            apellido,
            avatar_url
          )
        `, { count: 'exact' });

      // Filtros
      if (tenantId) {
        queryBuilder = queryBuilder.eq('tenant_id', tenantId);
      }

      if (appId) {
        queryBuilder = queryBuilder.eq('app_id', appId);
      }

      if (folderId !== undefined) {
        queryBuilder = queryBuilder.eq('folder_id', folderId);
      }

      if (userId) {
        queryBuilder = queryBuilder.eq('uploaded_by', userId);
      }

      if (query) {
        queryBuilder = queryBuilder.or(
          `name.ilike.%${query}%,original_name.ilike.%${query}%,description.ilike.%${query}%`
        );
      }

      if (mimeTypes && mimeTypes.length > 0) {
        queryBuilder = queryBuilder.in('mime_type', mimeTypes);
      }

      if (tags && tags.length > 0) {
        queryBuilder = queryBuilder.contains('tags', tags);
      }

      if (dateFrom) {
        queryBuilder = queryBuilder.gte('created_at', dateFrom.toISOString());
      }

      if (dateTo) {
        queryBuilder = queryBuilder.lte('created_at', dateTo.toISOString());
      }

      // Ordenamiento
      queryBuilder = queryBuilder.order(sortBy, { ascending: sortOrder === 'asc' });

      // Paginación
      const offset = (page - 1) * limit;
      queryBuilder = queryBuilder.range(offset, offset + limit - 1);

      const { data, error, count } = await queryBuilder;

      if (error) throw error;

      return {
        data: data || [],
        pagination: {
          page,
          limit,
          total: count || 0,
          totalPages: Math.ceil((count || 0) / limit)
        }
      };
    } catch (error) {
      logger.error({ error, params }, 'Search files failed');
      throw error;
    }
  }

  /**
   * Actualizar archivo
   */
  async updateFile(
    fileId: string,
    updates: {
      name?: string;
      description?: string;
      tags?: string[];
      folderId?: string | null;
    },
    userId: string
  ): Promise<SharedFile> {
    try {
      // Verificar que el archivo existe
      const file = await this.getFileById(fileId);

      // Sanitizar nombre si se actualiza
      if (updates.name) {
        updates.name = sanitizeFilename(updates.name);
        
        // Mantener la extensión original
        const originalExt = path.extname(file.original_name);
        const newExt = path.extname(updates.name);
        if (!newExt) {
          updates.name += originalExt;
        }
      }

      // Actualizar
      const { data: updatedFile, error } = await supabase
        .from('shared_files')
        .update({
          ...updates,
          modified_at: new Date().toISOString(),
          modified_by: userId
        })
        .eq('id', fileId)
        .select()
        .single();

      if (error) throw error;

      // Registrar actividad
      await activityService.log({
        tenant_id: file.tenant_id,
        user_id: userId,
        action: ACTIVITY_ACTIONS.FILE_UPDATED,
        resource_type: 'file',
        resource_id: fileId,
        details: {
          file_name: file.name,
          updates: Object.keys(updates)
        }
      });

      logger.info({ fileId, updates, userId }, 'File updated');

      return updatedFile;
    } catch (error) {
      logger.error({ error, fileId }, 'Update file failed');
      throw error;
    }
  }

  /**
   * Eliminar archivo
   */
  async deleteFile(fileId: string, userId: string): Promise<void> {
    try {
      const file = await this.getFileById(fileId);

      // Eliminar de storage
      await storageService.deleteFile(file.storage_path);

      // Eliminar thumbnails si existen
      if (file.thumbnail_url) {
        try {
          await storageService.deleteFile(file.thumbnail_url);
        } catch (error) {
          logger.warn({ error, thumbnail: file.thumbnail_url }, 'Failed to delete thumbnail');
        }
      }

      // Eliminar de BD
      await supabase
        .from('shared_files')
        .delete()
        .eq('id', fileId);

      // Actualizar uso de almacenamiento
      await tenantService.updateStorageUsage(file.tenant_id, -file.size_bytes);

      // Registrar actividad
      await activityService.log({
        tenant_id: file.tenant_id,
        user_id: userId,
        action: ACTIVITY_ACTIONS.FILE_DELETED,
        resource_type: 'file',
        resource_id: fileId,
        details: {
          file_name: file.name,
          file_size: file.size_bytes
        }
      });

      logger.info({ fileId, userId }, 'File deleted');
    } catch (error) {
      logger.error({ error, fileId }, 'Delete file failed');
      throw error;
    }
  }

  /**
   * Compartir archivo
   */
  async shareFile(params: {
    fileId: string;
    sharedBy: string;
    shareWith: {
      userId?: string;
      email?: string;
      tenantId?: string;
    };
    permissions: string[];
    expiresAt?: Date;
    message?: string;
  }): Promise<FileShare> {
    try {
      const { fileId, sharedBy, shareWith, permissions, expiresAt, message } = params;

      // Verificar que el archivo existe
      const file = await this.getFileById(fileId);

      // Verificar permisos para compartir
      if (file.uploaded_by !== sharedBy) {
        const canShare = await this.checkFilePermission(fileId, sharedBy, 'share');
        if (!canShare) {
          throw new AuthorizationError('No tienes permisos para compartir este archivo');
        }
      }

      // Generar token de acceso
      const shareToken = crypto.randomBytes(32).toString('hex');

      // Crear share
      const { data: share, error } = await supabase
        .from('file_shares')
        .insert({
          file_id: fileId,
          shared_by: sharedBy,
          shared_with_user: shareWith.userId,
          shared_with_email: shareWith.email,
          shared_with_tenant: shareWith.tenantId,
          permissions,
          share_token: shareToken,
          expires_at: expiresAt?.toISOString(),
          message
        })
        .select()
        .single();

      if (error) throw error;

      // Notificar al destinatario
      if (shareWith.userId) {
        await notificationService.create({
          user_id: shareWith.userId,
          type: 'file_shared',
          title: 'Archivo compartido',
          message: `${file.name} ha sido compartido contigo`,
          data: {
            fileId,
            fileName: file.name,
            sharedBy
          }
        });
      }

      // Si se comparte por email, enviar correo
      if (shareWith.email) {
        await addEmailJob({
          to: shareWith.email,
          subject: 'Archivo compartido en Forvara',
          template: 'file-shared',
          data: {
            fileName: file.name,
            sharedByName: sharedBy,
            message,
            downloadLink: `${config.FRONTEND_URL}/shared/${shareToken}`
          }
        });
      }

      logger.info({ 
        fileId, 
        sharedBy, 
        shareWith,
        shareId: share.id 
      }, 'File shared');

      return share;
    } catch (error) {
      logger.error({ error, params }, 'Share file failed');
      throw error;
    }
  }

  /**
   * Revocar acceso compartido
   */
  async revokeShare(shareId: string, revokedBy: string): Promise<void> {
    try {
      const { data: share } = await supabase
        .from('file_shares')
        .select('*, shared_files(*)')
        .eq('id', shareId)
        .single();

      if (!share) {
        throw new NotFoundError('Share');
      }

      // Verificar permisos
      if (share.shared_by !== revokedBy && share.shared_files.uploaded_by !== revokedBy) {
        throw new AuthorizationError('No tienes permisos para revocar este acceso');
      }

      // Eliminar share
      await supabase
        .from('file_shares')
        .delete()
        .eq('id', shareId);

      // Notificar si había un usuario
      if (share.shared_with_user) {
        await notificationService.create({
          user_id: share.shared_with_user,
          type: 'file_share_revoked',
          title: 'Acceso revocado',
          message: `Tu acceso a ${share.shared_files.name} ha sido revocado`,
          data: {
            fileId: share.file_id,
            fileName: share.shared_files.name
          }
        });
      }

      logger.info({ shareId, revokedBy }, 'File share revoked');
    } catch (error) {
      logger.error({ error, shareId }, 'Revoke share failed');
      throw error;
    }
  }

  /**
   * Mover archivo a carpeta
   */
  async moveFile(
    fileId: string,
    targetFolderId: string | null,
    userId: string
  ): Promise<SharedFile> {
    try {
      const file = await this.getFileById(fileId);

      // Si se mueve a una carpeta, verificar que existe
      if (targetFolderId) {
        const { data: folder } = await supabase
          .from('folders')
          .select('id, tenant_id')
          .eq('id', targetFolderId)
          .single();

        if (!folder) {
          throw new NotFoundError('Carpeta destino');
        }

        // Verificar que la carpeta es del mismo tenant
        if (folder.tenant_id !== file.tenant_id) {
          throw new ValidationError('No puedes mover archivos entre empresas');
        }
      }

      // Actualizar
      const { data: movedFile, error } = await supabase
        .from('shared_files')
        .update({
          folder_id: targetFolderId,
          modified_at: new Date().toISOString(),
          modified_by: userId
        })
        .eq('id', fileId)
        .select()
        .single();

      if (error) throw error;

      // Registrar actividad
      await activityService.log({
        tenant_id: file.tenant_id,
        user_id: userId,
        action: ACTIVITY_ACTIONS.FILE_MOVED,
        resource_type: 'file',
        resource_id: fileId,
        details: {
          file_name: file.name,
          from_folder: file.folder_id,
          to_folder: targetFolderId
        }
      });

      logger.info({ fileId, targetFolderId, userId }, 'File moved');

      return movedFile;
    } catch (error) {
      logger.error({ error, fileId }, 'Move file failed');
      throw error;
    }
  }

  /**
   * Duplicar archivo
   */
  async duplicateFile(
    fileId: string,
    userId: string,
    newName?: string
  ): Promise<SharedFile> {
    try {
      const originalFile = await this.getFileById(fileId);

      // Generar nuevo nombre
      const duplicateName = newName || `${path.basename(originalFile.name, path.extname(originalFile.name))}_copy${path.extname(originalFile.name)}`;

      // Copiar archivo en storage
      const newFileId = uuidv4();
      const newStoragePath = originalFile.storage_path.replace(originalFile.id, newFileId);
      
      await storageService.copyFile(originalFile.storage_path, newStoragePath);

      // Crear nuevo registro
      const { data: duplicatedFile, error } = await supabase
        .from('shared_files')
        .insert({
          ...originalFile,
          id: newFileId,
          name: duplicateName,
          storage_path: newStoragePath,
          storage_url: originalFile.storage_url.replace(originalFile.id, newFileId),
          uploaded_by: userId,
          created_at: new Date().toISOString(),
          modified_at: null,
          modified_by: null,
          version: 1,
          shares: undefined // No copiar shares
        })
        .select()
        .single();

      if (error) throw error;

      // Actualizar uso de almacenamiento
      await tenantService.updateStorageUsage(originalFile.tenant_id, originalFile.size_bytes);

      // Registrar actividad
      await activityService.log({
        tenant_id: originalFile.tenant_id,
        user_id: userId,
        action: ACTIVITY_ACTIONS.FILE_DUPLICATED,
        resource_type: 'file',
        resource_id: newFileId,
        details: {
          original_file_id: fileId,
          original_file_name: originalFile.name,
          new_file_name: duplicateName
        }
      });

      logger.info({ 
        originalFileId: fileId, 
        newFileId, 
        userId 
      }, 'File duplicated');

      return duplicatedFile;
    } catch (error) {
      logger.error({ error, fileId }, 'Duplicate file failed');
      throw error;
    }
  }

  /**
   * Generar URL de descarga temporal
   */
  async generateDownloadUrl(
    fileId: string,
    userId: string,
    expiresIn: number = 3600 // 1 hora por defecto
  ): Promise<string> {
    try {
      const file = await this.getFileById(fileId);

      // Verificar permisos
      const hasAccess = await this.checkFileAccess(fileId, userId);
      if (!hasAccess) {
        throw new AuthorizationError('No tienes acceso a este archivo');
      }

      // Generar URL firmada
      const signedUrl = await storageService.generateSignedUrl(
        file.storage_path,
        expiresIn,
        {
          responseContentDisposition: `attachment; filename="${file.original_name}"`
        }
      );

      // Registrar descarga
      await activityService.log({
        tenant_id: file.tenant_id,
        user_id: userId,
        action: ACTIVITY_ACTIONS.FILE_DOWNLOADED,
        resource_type: 'file',
        resource_id: fileId,
        details: {
          file_name: file.name,
          file_size: file.size_bytes
        }
      });

      return signedUrl;
    } catch (error) {
      logger.error({ error, fileId, userId }, 'Generate download URL failed');
      throw error;
    }
  }

  /**
   * Obtener versiones de un archivo
   */
  async getFileVersions(fileId: string): Promise<any[]> {
    const { data: versions, error } = await supabase
      .from('file_versions')
      .select(`
        *,
        created_by_user:users!created_by (
          id,
          nombre,
          apellido
        )
      `)
      .eq('file_id', fileId)
      .order('version', { ascending: false });

    if (error) throw error;

    return versions || [];
  }

  /**
   * Crear nueva versión de archivo
   */
  async createFileVersion(
    fileId: string,
    file: Express.Multer.File,
    userId: string,
    comment?: string
  ): Promise<SharedFile> {
    try {
      const originalFile = await this.getFileById(fileId);

      // Guardar versión actual
      await supabase
        .from('file_versions')
        .insert({
          file_id: fileId,
          version: originalFile.version,
          storage_path: originalFile.storage_path,
          size_bytes: originalFile.size_bytes,
          created_by: userId,
          comment: comment || `Versión ${originalFile.version}`,
          metadata: originalFile.metadata
        });

      // Subir nueva versión
      const newStoragePath = `tenants/${originalFile.tenant_id}/${originalFile.app_id}/${fileId}_v${originalFile.version + 1}${path.extname(file.originalname)}`;
      
      const newUrl = await storageService.uploadFile(
        file.buffer,
        newStoragePath,
        {
          contentType: file.mimetype,
          metadata: {
            version: originalFile.version + 1,
            previousVersion: originalFile.version
          }
        }
      );

      // Actualizar archivo principal
      const { data: updatedFile, error } = await supabase
        .from('shared_files')
        .update({
          storage_path: newStoragePath,
          storage_url: newUrl,
          size_bytes: file.size,
          version: originalFile.version + 1,
          modified_at: new Date().toISOString(),
          modified_by: userId
        })
        .eq('id', fileId)
        .select()
        .single();

      if (error) throw error;

      // Actualizar uso de almacenamiento (diferencia)
      const sizeDiff = file.size - originalFile.size_bytes;
      if (sizeDiff !== 0) {
        await tenantService.updateStorageUsage(originalFile.tenant_id, sizeDiff);
      }

      logger.info({ 
        fileId, 
        version: updatedFile.version,
        userId 
      }, 'File version created');

      return updatedFile;
    } catch (error) {
      logger.error({ error, fileId }, 'Create file version failed');
      throw error;
    }
  }

  /**
   * Restaurar versión anterior
   */
  async restoreFileVersion(
    fileId: string,
    versionNumber: number,
    userId: string
  ): Promise<SharedFile> {
    try {
      const { data: version } = await supabase
        .from('file_versions')
        .select('*')
        .eq('file_id', fileId)
        .eq('version', versionNumber)
        .single();

      if (!version) {
        throw new NotFoundError('Versión de archivo');
      }

      // Crear nueva versión con el contenido de la versión anterior
      const fileBuffer = await storageService.downloadFile(version.storage_path);
      
      return await this.createFileVersion(
        fileId,
        {
          buffer: fileBuffer,
          originalname: `restored_v${versionNumber}`,
          mimetype: 'application/octet-stream',
          size: version.size_bytes
        } as Express.Multer.File,
        userId,
        `Restaurado desde versión ${versionNumber}`
      );
    } catch (error) {
      logger.error({ error, fileId, versionNumber }, 'Restore file version failed');
      throw error;
    }
  }

  /**
   * Obtener archivos compartidos entre apps
   */
  async getSharedFiles(tenantId: string, appId: string): Promise<SharedFile[]> {
    const { data: files, error } = await supabase
      .from('shared_files')
      .select('*')
      .eq('tenant_id', tenantId)
      .contains('shared_with_apps', [appId])
      .order('created_at', { ascending: false });

    if (error) throw error;

    return files || [];
  }

  /**
   * Eliminar archivos antiguos
   */
  async deleteOldFiles(daysOld: number): Promise<SharedFile[]> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    // Buscar archivos antiguos
    const { data: oldFiles, error } = await supabase
      .from('shared_files')
      .select('*')
      .lt('created_at', cutoffDate.toISOString())
      .eq('is_archived', true);

    if (error) throw error;

    const deletedFiles: SharedFile[] = [];

    // Eliminar cada archivo
    for (const file of oldFiles || []) {
      try {
        await this.deleteFile(file.id, 'system');
        deletedFiles.push(file);
      } catch (error) {
        logger.error({ error, fileId: file.id }, 'Failed to delete old file');
      }
    }

    logger.info({ 
      deletedCount: deletedFiles.length,
      daysOld 
    }, 'Old files deleted');

    return deletedFiles;
  }

  /**
   * Generar archivo ZIP
   */
  async generateZipArchive(
    fileIds: string[],
    userId: string
  ): Promise<string> {
    try {
      const archive = archiver('zip', {
        zlib: { level: 9 }
      });

      const zipFileName = `download_${Date.now()}.zip`;
      const zipPath = `temp/${userId}/${zipFileName}`;

      // Stream para subir directamente a storage
      const uploadStream = await storageService.createUploadStream(zipPath);

      archive.pipe(uploadStream);

      // Agregar archivos al ZIP
      for (const fileId of fileIds) {
        try {
          const file = await this.getFileById(fileId);
          const fileBuffer = await storageService.downloadFile(file.storage_path);
          
          archive.append(fileBuffer, { name: file.original_name });
        } catch (error) {
          logger.warn({ error, fileId }, 'Failed to add file to ZIP');
        }
      }

      await archive.finalize();

      // Generar URL temporal
      const downloadUrl = await storageService.generateSignedUrl(zipPath, 3600);

      logger.info({ 
        fileCount: fileIds.length,
        userId 
      }, 'ZIP archive generated');

      return downloadUrl;
    } catch (error) {
      logger.error({ error, fileIds }, 'Generate ZIP failed');
      throw error;
    }
  }

  // Métodos auxiliares privados
  private async checkStorageLimit(tenantId: string, fileSize: number): Promise<boolean> {
    const { data: tenant } = await supabase
      .from('tenants')
      .select('storage_used_bytes, storage_limit_bytes')
      .eq('id', tenantId)
      .single();

    if (!tenant) return false;

    return (tenant.storage_used_bytes + fileSize) <= tenant.storage_limit_bytes;
  }

  private async checkFileAccess(fileId: string, userId: string): Promise<boolean> {
    // Verificar si es el propietario
    const { data: file } = await supabase
      .from('shared_files')
      .select('uploaded_by, tenant_id, is_public')
      .eq('id', fileId)
      .single();

    if (!file) return false;

    // Archivo público
    if (file.is_public) return true;

    // Es el propietario
    if (file.uploaded_by === userId) return true;

    // Verificar si es miembro del tenant
    const { data: membership } = await supabase
      .from('user_tenants')
      .select('id')
      .eq('tenant_id', file.tenant_id)
      .eq('usuario_id', userId)
      .eq('activo', true)
      .single();

    if (membership) return true;

    // Verificar si tiene un share activo
    const { data: share } = await supabase
      .from('file_shares')
      .select('id')
      .eq('file_id', fileId)
      .eq('shared_with_user', userId)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .single();

    return !!share;
  }

  private async checkFilePermission(
    fileId: string,
    userId: string,
    permission: string
  ): Promise<boolean> {
    // Implementar lógica de permisos específicos
    const hasAccess = await this.checkFileAccess(fileId, userId);
if (!hasAccess) return false;

   // Por ahora, si tiene acceso puede hacer la acción
   // TODO: Implementar permisos granulares
   return true;
 }

 private getProcessingOperations(mimeType: string): string[] {
   const operations: string[] = ['virus-scan'];

   if (mimeType.startsWith('image/')) {
     operations.push('thumbnail', 'extract-metadata');
     
     // Solo comprimir imágenes grandes
     if (!mimeType.includes('svg')) {
       operations.push('compress');
     }
   }

   return operations;
 }

 /**
  * Actualizar metadata del archivo
  */
 async updateFileMetadata(fileId: string, metadata: any): Promise<void> {
   await supabase
     .from('shared_files')
     .update({
       metadata: supabase.sql`metadata || ${JSON.stringify(metadata)}::jsonb`,
       updated_at: new Date().toISOString()
     })
     .eq('id', fileId);
 }

 /**
  * Actualizar estado de procesamiento
  */
 async updateFileProcessingStatus(
   fileId: string,
   status: 'processing' | 'completed' | 'failed',
   results?: any
 ): Promise<void> {
   const updates: any = {
     processing_status: status,
     processing_completed_at: status === 'completed' ? new Date().toISOString() : null
   };

   if (results) {
     updates.processing_results = results;
     
     // Si se generó thumbnail, actualizar URL
     if (results.thumbnail) {
       updates.thumbnail_url = results.thumbnail;
     }
   }

   await supabase
     .from('shared_files')
     .update(updates)
     .eq('id', fileId);
 }

 /**
  * Obtener archivos por IDs
  */
 async getFilesByIds(fileIds: string[]): Promise<SharedFile[]> {
   const { data: files, error } = await supabase
     .from('shared_files')
     .select('*')
     .in('id', fileIds);

   if (error) throw error;

   return files || [];
 }

 /**
  * Eliminar múltiples archivos
  */
 async bulkDeleteFiles(
   fileIds: string[],
   tenantId: string
 ): Promise<{ deleted: string[]; failed: string[] }> {
   const results = {
     deleted: [] as string[],
     failed: [] as string[]
   };

   for (const fileId of fileIds) {
     try {
       await this.deleteFile(fileId, 'bulk_operation');
       results.deleted.push(fileId);
     } catch (error) {
       logger.error({ error, fileId }, 'Failed to delete file in bulk operation');
       results.failed.push(fileId);
     }
   }

   return results;
 }
}

export const fileService = new FileService();
