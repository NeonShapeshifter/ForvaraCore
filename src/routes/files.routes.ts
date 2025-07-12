import { Router } from 'express';
import * as fileController from '../controllers/files.controller';
import { authenticateToken } from '../middleware/auth';
import { injectTenant, requireTenant } from '../middleware/tenant';
import { uploadLimiter } from '../middleware/rateLimiter';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { 
  uploadFileValidator,
  updateFileValidator,
  shareFileValidator 
} from '../validators/file.validator';
import { commonValidators } from '../middleware/validation';
import { z } from 'zod';
import multer from 'multer';
import { config } from '../config';

const router = Router();

// Configuración de multer
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.MAX_FILE_SIZE,
    files: 10
  },
  fileFilter: (req, file, cb) => {
    if (!config.ALLOWED_FILE_TYPES.includes(file.mimetype)) {
      return cb(new Error(`Tipo de archivo no permitido: ${file.mimetype}`));
    }
    cb(null, true);
  }
});

// Todas las rutas requieren autenticación y tenant
router.use(authenticateToken);
router.use(requireTenant);

/**
 * @swagger
 * /api/files:
 *   get:
 *     summary: Listar archivos del tenant
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/TenantId'
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - in: query
 *         name: appId
 *         schema:
 *           type: string
 *         description: Filtrar por aplicación
 *       - in: query
 *         name: tags
 *         schema:
 *           type: array
 *           items:
 *             type: string
 *         description: Filtrar por tags
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Buscar en nombre de archivo
 *       - in: query
 *         name: mimeType
 *         schema:
 *           type: string
 *         description: Filtrar por tipo MIME
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [created_at, name, size]
 *           default: created_at
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *     responses:
 *       200:
 *         description: Lista de archivos
 */
router.get('/',
  validateQuery(z.object({
    ...commonValidators.pagination.shape,
    appId: z.string().optional(),
    tags: z.array(z.string()).optional(),
    search: z.string().optional(),
    mimeType: z.string().optional(),
    sortBy: z.enum(['created_at', 'name', 'size']).optional().default('created_at'),
    sortOrder: z.enum(['asc', 'desc']).optional().default('desc')
  })),
  fileController.getFiles
);

/**
 * @swagger
 * /api/files/upload:
 *   post:
 *     summary: Subir archivos
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/TenantId'
 *       - $ref: '#/components/parameters/AppId'
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [files]
 *             properties:
 *               files:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 *               isPublic:
 *                 type: boolean
 *                 default: false
 *     responses:
 *       201:
 *         description: Archivos subidos exitosamente
 */
router.post('/upload',
  uploadLimiter,
  upload.array('files', 10),
  validateBody(uploadFileValidator),
  fileController.uploadFiles
);

/**
 * @swagger
 * /api/files/{fileId}:
 *   get:
 *     summary: Obtener información de un archivo
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: fileId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - $ref: '#/components/parameters/TenantId'
 *     responses:
 *       200:
 *         description: Información del archivo
 */
router.get('/:fileId',
  validateParams(z.object({ fileId: commonValidators.uuid })),
  fileController.getFileById
);

/**
 * @swagger
 * /api/files/{fileId}:
 *   put:
 *     summary: Actualizar información del archivo
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: fileId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - $ref: '#/components/parameters/TenantId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 *               isPublic:
 *                 type: boolean
 *               metadata:
 *                 type: object
 *     responses:
 *       200:
 *         description: Archivo actualizado
 */
router.put('/:fileId',
  validateParams(z.object({ fileId: commonValidators.uuid })),
  validateBody(updateFileValidator),
  fileController.updateFile
);

/**
 * @swagger
 * /api/files/{fileId}:
 *   delete:
 *     summary: Eliminar archivo
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: fileId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - $ref: '#/components/parameters/TenantId'
 *     responses:
 *       200:
 *         description: Archivo eliminado
 */
router.delete('/:fileId',
  validateParams(z.object({ fileId: commonValidators.uuid })),
  fileController.deleteFile
);

/**
 * @swagger
 * /api/files/{fileId}/download:
 *   get:
 *     summary: Descargar archivo
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: fileId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - $ref: '#/components/parameters/TenantId'
 *     responses:
 *       200:
 *         description: Archivo descargado
 *         content:
 *           application/octet-stream:
 *             schema:
 *               type: string
 *               format: binary
 */
router.get('/:fileId/download',
  validateParams(z.object({ fileId: commonValidators.uuid })),
  fileController.downloadFile
);

/**
 * @swagger
 * /api/files/{fileId}/preview:
 *   get:
 *     summary: Obtener preview del archivo
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: fileId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - $ref: '#/components/parameters/TenantId'
 *       - in: query
 *         name: width
 *         schema:
 *           type: integer
 *           default: 200
 *       - in: query
 *         name: height
 *         schema:
 *           type: integer
 *           default: 200
 *     responses:
 *       200:
 *         description: Preview del archivo
 */
router.get('/:fileId/preview',
  validateParams(z.object({ fileId: commonValidators.uuid })),
  fileController.getFilePreview
);

/**
 * @swagger
 * /api/files/{fileId}/share:
 *   post:
 *     summary: Compartir archivo entre apps
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: fileId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - $ref: '#/components/parameters/TenantId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sharedWithApp]
 *             properties:
 *               sharedWithApp:
 *                 type: string
 *                 description: ID de la app con la que compartir
 *               permissions:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum: [read, write, delete]
 *                 default: [read]
 *               expiresIn:
 *                 type: integer
 *                 description: Tiempo de expiración en segundos
 *     responses:
 *       201:
 *         description: Archivo compartido exitosamente
 */
router.post('/:fileId/share',
  validateParams(z.object({ fileId: commonValidators.uuid })),
  validateBody(shareFileValidator),
  fileController.shareFile
);

/**
 * @swagger
 * /api/files/shared:
 *   get:
 *     summary: Obtener archivos compartidos conmigo
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/TenantId'
 *       - $ref: '#/components/parameters/AppId'
 *     responses:
 *       200:
 *         description: Lista de archivos compartidos
 */
router.get('/shared',
  fileController.getSharedFiles
);

/**
 * @swagger
 * /api/files/bulk-delete:
 *   post:
 *     summary: Eliminar múltiples archivos
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/TenantId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fileIds]
 *             properties:
 *               fileIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *     responses:
 *       200:
 *         description: Archivos eliminados
 */
router.post('/bulk-delete',
  fileController.bulkDeleteFiles
);

export default router;
