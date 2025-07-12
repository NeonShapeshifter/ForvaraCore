import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { Application } from 'express';
import { config } from './index';

const swaggerOptions: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Forvara Core API',
      version: '2.0.0',
      description: `
# Forvara Core API

API central para el ecosistema empresarial Forvara.

## 🚀 Características principales:
- 🔐 Autenticación JWT con sesiones Redis
- 🏢 Arquitectura multi-tenant
- 📊 Sistema de suscripciones y DLCs
- 📁 Gestión de archivos compartidos
- 📧 Sistema de mail interno tipo Discord
- 🔗 Integración entre apps
- 📈 Métricas y analytics en tiempo real
- 🔄 WebSockets para real-time

## 🎮 Arquitectura tipo Epic Games:
- **Hub central**: Launcher + gestión de cuentas
- **Apps especializadas**: ERP, Mail, Analytics, etc.
- **Modelo DLC**: Features adicionales opcionales
- **Billing unificado**: Una factura para todo
      `,
      contact: {
        name: 'Forvara Support',
        email: 'support@forvara.com',
        url: 'https://forvara.com/support'
      },
      license: {
        name: 'Proprietary',
        url: 'https://forvara.com/terms'
      }
    },
    servers: [
      {
        url: `http://localhost:${config.PORT}`,
        description: 'Development server'
      },
      {
        url: 'https://api.forvara.com',
        description: 'Production server'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT token obtenido del endpoint /api/auth/login'
        },
        apiKey: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'API Key para acceso de aplicaciones'
        }
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            error: { type: 'string' },
            message: { type: 'string' },
            code: { type: 'string' },
            meta: { type: 'object' }
          }
        },
        ApiResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object' },
            message: { type: 'string' },
            meta: {
              type: 'object',
              properties: {
                pagination: {
                  type: 'object',
                  properties: {
                    page: { type: 'integer' },
                    limit: { type: 'integer' },
                    total: { type: 'integer' },
                    pages: { type: 'integer' }
                  }
                }
              }
            }
          }
        },
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            nombre: { type: 'string' },
            apellido: { type: 'string' },
            telefono: { type: 'string' },
            email: { type: 'string', format: 'email' },
            forvara_mail: { type: 'string', format: 'email' },
            avatar_url: { type: 'string', format: 'uri' },
            activo: { type: 'boolean' },
            settings: { type: 'object' },
            created_at: { type: 'string', format: 'date-time' }
          }
        },
        Tenant: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            nombre: { type: 'string' },
            ruc: { type: 'string' },
            direccion: { type: 'string' },
            telefono: { type: 'string' },
            email: { type: 'string', format: 'email' },
            logo_url: { type: 'string', format: 'uri' },
            activo: { type: 'boolean' },
            storage_used_gb: { type: 'number' },
            created_at: { type: 'string', format: 'date-time' }
          }
        },
        Subscription: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            tenant_id: { type: 'string', format: 'uuid' },
            app_id: { type: 'string' },
            plan: { type: 'string' },
            status: { 
              type: 'string', 
              enum: ['active', 'trialing', 'past_due', 'canceled', 'unpaid'] 
            },
            billing_cycle: { type: 'string', enum: ['monthly', 'yearly'] },
            price_monthly: { type: 'number' },
            current_period_end: { type: 'string', format: 'date-time' },
            features: { type: 'object' }
          }
        }
      },
      parameters: {
        TenantId: {
          name: 'X-Tenant-ID',
          in: 'header',
          required: false,
          description: 'ID del tenant activo',
          schema: {
            type: 'string',
            format: 'uuid'
          }
        },
        AppId: {
          name: 'X-App-ID',
          in: 'header',
          required: false,
          description: 'ID de la aplicación que hace la request',
          schema: {
            type: 'string'
          }
        },
        PageParam: {
          name: 'page',
          in: 'query',
          description: 'Número de página',
          schema: {
            type: 'integer',
            minimum: 1,
            default: 1
          }
        },
        LimitParam: {
          name: 'limit',
          in: 'query',
          description: 'Elementos por página',
          schema: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            default: 20
          }
        }
      },
      responses: {
        Unauthorized: {
          description: 'No autorizado',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
              example: {
                success: false,
                error: 'Token inválido o expirado',
                code: 'UNAUTHORIZED'
              }
            }
          }
        },
        Forbidden: {
          description: 'Prohibido',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
              example: {
                success: false,
                error: 'No tienes permisos para esta acción',
                code: 'FORBIDDEN'
              }
            }
          }
        },
        NotFound: {
          description: 'No encontrado',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
              example: {
                success: false,
                error: 'Recurso no encontrado',
                code: 'NOT_FOUND'
              }
            }
          }
        },
        ValidationError: {
          description: 'Error de validación',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
              example: {
                success: false,
                error: 'Datos inválidos',
                code: 'VALIDATION_ERROR',
                meta: {
                  errors: [
                    {
                      field: 'email',
                      message: 'Email inválido'
                    }
                  ]
                }
              }
            }
          }
        },
        ServerError: {
          description: 'Error interno del servidor',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
              example: {
                success: false,
                error: 'Error interno del servidor',
                code: 'INTERNAL_ERROR'
              }
            }
          }
        }
      }
    },
    security: [{
      bearerAuth: []
    }],
    tags: [
      { name: 'Auth', description: 'Autenticación y gestión de sesiones' },
      { name: 'Users', description: 'Gestión de usuarios' },
      { name: 'Tenants', description: 'Gestión de empresas/tenants' },
      { name: 'Team', description: 'Administración de equipos' },
      { name: 'Subscriptions', description: 'Suscripciones y billing' },
      { name: 'Files', description: 'Gestión de archivos' },
      { name: 'Mail', description: 'Sistema de correo interno' },
      { name: 'Notifications', description: 'Sistema de notificaciones' },
      { name: 'Activity', description: 'Logs de actividad' },
      { name: 'Metrics', description: 'Métricas y analytics' },
      { name: 'Integration', description: 'Integración entre apps' },
      { name: 'Health', description: 'Health checks y monitoring' },
      { name: 'Webhooks', description: 'Webhooks externos' }
    ]
  },
  apis: ['./src/routes/*.ts', './src/routes/*.js']
};

export const setupSwagger = (app: Application): void => {
  const swaggerSpec = swaggerJsdoc(swaggerOptions);
  
  // Configurar Swagger UI
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: `
      .swagger-ui .topbar { display: none }
      .swagger-ui { background: #0D0D0D; }
      body { background: #0D0D0D; }
    `,
    customSiteTitle: 'Forvara Core API Documentation',
    customfavIcon: '/favicon.ico'
  }));

  // Endpoint para obtener el spec JSON
  app.get('/api-docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });

  // Endpoint para Postman collection
  app.get('/api-docs/postman', (req, res) => {
    // TODO: Implementar conversión a Postman
    res.json({ message: 'Coming soon' });
  });
};
