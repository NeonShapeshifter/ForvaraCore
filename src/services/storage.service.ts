import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, CopyObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'stream';
import crypto from 'crypto';
import { config } from '../config';
import { logger } from '../config/logger';
import { getSupabase } from '../config/database';

let supabase: any = null;

function ensureSupabase() {
  if (!supabase) {
    supabase = getSupabase();
  }
  return supabase;
}

class StorageService {
  private s3Client: S3Client;
  private bucket: string;

  constructor() {
    // Configurar cliente S3 (compatible con Supabase Storage)
    this.s3Client = new S3Client({
      endpoint: config.STORAGE_ENDPOINT,
      region: config.STORAGE_REGION || 'us-east-1',
      credentials: {
        accessKeyId: config.STORAGE_ACCESS_KEY!,
        secretAccessKey: config.STORAGE_SECRET_KEY!
      },
      forcePathStyle: true
    });

    this.bucket = config.STORAGE_BUCKET || 'forvara-files';
  }

  /**
   * Subir archivo
   */
  async uploadFile(
    fileBuffer: Buffer | Readable,
    path: string,
    options: {
      contentType?: string;
      metadata?: Record<string, string>;
      tags?: Record<string, string>;
      cacheControl?: string;
      contentDisposition?: string;
    } = {}
  ): Promise<string> {
    try {
      const {
        contentType = 'application/octet-stream',
        metadata = {},
        tags = {},
        cacheControl = 'max-age=31536000',
        contentDisposition
      } = options;

      // Generar ETag
      const etag = crypto
        .createHash('md5')
        .update(fileBuffer instanceof Buffer ? fileBuffer : '')
        .digest('hex');

      // Configurar upload
      const uploadParams = {
        Bucket: this.bucket,
        Key: path,
        Body: fileBuffer,
        ContentType: contentType,
        CacheControl: cacheControl,
        ContentDisposition: contentDisposition,
        Metadata: {
          ...metadata,
          uploadedAt: new Date().toISOString(),
          etag
        }
      };

      // Si el archivo es grande, usar multipart upload
      if (fileBuffer instanceof Buffer && fileBuffer.length > 5 * 1024 * 1024) {
        const upload = new Upload({
          client: this.s3Client,
          params: uploadParams,
          queueSize: 4,
          partSize: 5 * 1024 * 1024,
          leavePartsOnError: false
        });

        upload.on('httpUploadProgress', (progress) => {
          logger.debug({ 
            path, 
            loaded: progress.loaded, 
            total: progress.total 
          }, 'Upload progress');
        });

        await upload.done();
      } else {
        await this.s3Client.send(new PutObjectCommand(uploadParams));
      }

      // Generar URL pública
      const publicUrl = `${config.STORAGE_PUBLIC_URL}/${this.bucket}/${path}`;

      logger.info({ path, size: fileBuffer.length, etag }, 'File uploaded');

      return publicUrl;
    } catch (error) {
      logger.error({ error, path }, 'Upload file failed');
      throw error;
    }
  }

  /**
   * Descargar archivo
   */
  async downloadFile(path: string): Promise<Buffer> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: path
      });

      const response = await this.s3Client.send(command);
      
      // Convertir stream a buffer
      const chunks: Uint8Array[] = [];
      for await (const chunk of response.Body as Readable) {
        chunks.push(chunk);
      }

      const buffer = Buffer.concat(chunks);

      logger.debug({ path, size: buffer.length }, 'File downloaded');

      return buffer;
    } catch (error) {
      logger.error({ error, path }, 'Download file failed');
      throw error;
    }
  }

  /**
   * Eliminar archivo
   */
  async deleteFile(path: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: path
      });

      await this.s3Client.send(command);

      logger.info({ path }, 'File deleted');
    } catch (error) {
      logger.error({ error, path }, 'Delete file failed');
      throw error;
    }
  }

  /**
   * Copiar archivo
   */
  async copyFile(sourcePath: string, destinationPath: string): Promise<void> {
    try {
      const command = new CopyObjectCommand({
        Bucket: this.bucket,
        CopySource: `${this.bucket}/${sourcePath}`,
        Key: destinationPath
      });

      await this.s3Client.send(command);

      logger.info({ sourcePath, destinationPath }, 'File copied');
    } catch (error) {
      logger.error({ error, sourcePath, destinationPath }, 'Copy file failed');
      throw error;
    }
  }

  /**
   * Mover archivo
   */
  async moveFile(sourcePath: string, destinationPath: string): Promise<void> {
    try {
      // Copiar archivo
      await this.copyFile(sourcePath, destinationPath);
      
      // Eliminar original
      await this.deleteFile(sourcePath);

      logger.info({ sourcePath, destinationPath }, 'File moved');
    } catch (error) {
      logger.error({ error, sourcePath, destinationPath }, 'Move file failed');
      throw error;
    }
  }

  /**
   * Verificar si archivo existe
   */
  async fileExists(path: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: path
      });

      await this.s3Client.send(command);
      return true;
    } catch (error: any) {
      if (error.name === 'NotFound') {
        return false;
      }
      throw error;
    }
  }

  /**
   * Obtener metadata de archivo
   */
  async getFileMetadata(path: string): Promise<{
    size: number;
    contentType: string;
    lastModified: Date;
    etag: string;
    metadata: Record<string, string>;
  }> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: path
      });

      const response = await this.s3Client.send(command);

      return {
        size: response.ContentLength || 0,
        contentType: response.ContentType || 'application/octet-stream',
        lastModified: response.LastModified || new Date(),
        etag: response.ETag || '',
        metadata: response.Metadata || {}
      };
    } catch (error) {
      logger.error({ error, path }, 'Get file metadata failed');
      throw error;
    }
  }

  /**
   * Generar URL firmada
   */
  async generateSignedUrl(
    path: string,
    expiresIn: number = 3600,
    options: {
      responseContentDisposition?: string;
      responseContentType?: string;
    } = {}
  ): Promise<string> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: path,
        ResponseContentDisposition: options.responseContentDisposition,
        ResponseContentType: options.responseContentType
      });

      const signedUrl = await getSignedUrl(this.s3Client, command, {
        expiresIn
      });

      logger.debug({ path, expiresIn }, 'Signed URL generated');

      return signedUrl;
    } catch (error) {
      logger.error({ error, path }, 'Generate signed URL failed');
      throw error;
    }
  }

  /**
   * Generar URL de upload firmada
   */
  async generateUploadUrl(
    path: string,
    contentType: string,
    maxSize: number,
    expiresIn: number = 3600
  ): Promise<{
    uploadUrl: string;
    publicUrl: string;
  }> {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: path,
        ContentType: contentType,
        ContentLength: maxSize
      });

      const uploadUrl = await getSignedUrl(this.s3Client, command, {
        expiresIn
      });

      const publicUrl = `${config.STORAGE_PUBLIC_URL}/${this.bucket}/${path}`;

      logger.debug({ path, contentType, maxSize }, 'Upload URL generated');

      return { uploadUrl, publicUrl };
    } catch (error) {
      logger.error({ error, path }, 'Generate upload URL failed');
      throw error;
    }
  }

  /**
   * Crear stream de upload
   */
  async createUploadStream(path: string, options?: any): Promise<NodeJS.WritableStream> {
    // Implementar stream de upload para archivos grandes
    // Por ahora, retornar un PassThrough stream
    const { PassThrough } = require('stream');
    const passThrough = new PassThrough();

    const chunks: Buffer[] = [];
    
    passThrough.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    passThrough.on('end', async () => {
      const buffer = Buffer.concat(chunks);
      await this.uploadFile(buffer, path, options);
    });

    return passThrough;
  }

  /**
   * Listar archivos
   */
  async listFiles(
    prefix: string,
    options: {
      maxKeys?: number;
      continuationToken?: string;
    } = {}
  ): Promise<{
    files: Array<{
      key: string;
      size: number;
      lastModified: Date;
    }>;
    continuationToken?: string;
  }> {
    try {
      // Usar Supabase Storage API para listar
      const { data, error } = await ensureSupabase()
        .storage
        .from(this.bucket)
        .list(prefix, {
          limit: options.maxKeys || 100,
          offset: options.continuationToken ? parseInt(options.continuationToken) : 0
        });

      if (error) throw error;

      const files = data?.map(file => ({
        key: file.name,
        size: file.metadata?.size || 0,
        lastModified: new Date(file.updated_at)
      })) || [];

      return {
        files,
        continuationToken: data && data.length === (options.maxKeys || 100) 
          ? String((parseInt(options.continuationToken || '0') + data.length))
          : undefined
      };
    } catch (error) {
      logger.error({ error, prefix }, 'List files failed');
      throw error;
    }
  }

  /**
   * Calcular uso de almacenamiento
   */
  async calculateStorageUsage(prefix: string): Promise<{
    totalSize: number;
    fileCount: number;
  }> {
    try {
      let totalSize = 0;
      let fileCount = 0;
      let continuationToken: string | undefined;

      do {
        const { files, continuationToken: nextToken } = await this.listFiles(prefix, {
          maxKeys: 1000,
          continuationToken
        });

        files.forEach(file => {
          totalSize += file.size;
          fileCount++;
        });

        continuationToken = nextToken;
      } while (continuationToken);

      logger.info({ prefix, totalSize, fileCount }, 'Storage usage calculated');

      return { totalSize, fileCount };
    } catch (error) {
      logger.error({ error, prefix }, 'Calculate storage usage failed');
      throw error;
    }
  }

  /**
   * Limpiar archivos temporales
   */
  async cleanupTempFiles(olderThanHours: number = 24): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setHours(cutoffDate.getHours() - olderThanHours);

      const { files } = await this.listFiles('temp/', { maxKeys: 1000 });
      
      let deletedCount = 0;

      for (const file of files) {
        if (file.lastModified < cutoffDate) {
          await this.deleteFile(file.key);
          deletedCount++;
        }
      }

      logger.info({ deletedCount, olderThanHours }, 'Temp files cleaned up');

      return deletedCount;
    } catch (error) {
      logger.error({ error }, 'Cleanup temp files failed');
      throw error;
    }
  }
}

export const storageService = new StorageService();
