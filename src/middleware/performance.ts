import { Request, Response, NextFunction } from 'express';
import { logger, logPerformance } from '../config/logger';
import { AuthenticatedRequest } from '../types';

interface PerformanceMetrics {
  startTime: number;
  startMemory: NodeJS.MemoryUsage;
  queries: number;
  cacheHits: number;
  cacheMisses: number;
}

// Store para métricas por request
const metricsStore = new WeakMap<Request, PerformanceMetrics>();

export const performanceMiddleware = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  // Inicializar métricas
  const metrics: PerformanceMetrics = {
    startTime: performance.now(),
    startMemory: process.memoryUsage(),
    queries: 0,
    cacheHits: 0,
    cacheMisses: 0
  };

  req.startTime = metrics.startTime;
  metricsStore.set(req, metrics);

  // Interceptar el método send para capturar cuando termina la respuesta
  const originalSend = res.send;
  let responseSize = 0;

  res.send = function(body: any) {
    if (body) {
      responseSize = Buffer.byteLength(
        typeof body === 'string' ? body : JSON.stringify(body)
      );
    }
    return originalSend.call(this, body);
  };

  // Listener para cuando termina la respuesta
  res.on('finish', () => {
    const duration = performance.now() - metrics.startTime;
    const currentMemory = process.memoryUsage();
    const memoryDelta = {
      heapUsed: currentMemory.heapUsed - metrics.startMemory.heapUsed,
      external: currentMemory.external - metrics.startMemory.external
    };

    // Log de performance
    const performanceData = {
      requestId: req.requestId,
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      duration: Math.round(duration),
      responseSize,
      userId: req.userId,
      tenantId: req.tenantId,
      userAgent: req.headers['user-agent'],
      ip: req.ip,
      metrics: {
        queries: metrics.queries,
        cacheHits: metrics.cacheHits,
        cacheMisses: metrics.cacheMisses,
        memoryDelta: {
          heapUsedMB: (memoryDelta.heapUsed / 1024 / 1024).toFixed(2),
          externalMB: (memoryDelta.external / 1024 / 1024).toFixed(2)
        }
      }
    };

    // Determinar si es una request lenta
    const isSlowRequest = duration > 5000; // 5 segundos
    const isVerySlowRequest = duration > 10000; // 10 segundos

    if (isVerySlowRequest) {
      logger.error(performanceData, 'Very slow request detected');
    } else if (isSlowRequest) {
      logger.warn(performanceData, 'Slow request detected');
    } else if (res.statusCode >= 500) {
      logger.error(performanceData, 'Request completed with error');
    } else if (res.statusCode >= 400) {
      logger.info(performanceData, 'Request completed with client error');
    } else {
      logger.info(performanceData, 'Request completed successfully');
    }

    // Log específico de performance
    logPerformance(
      `${req.method} ${req.path}`,
      duration,
      {
        statusCode: res.statusCode,
        responseSize,
        queries: metrics.queries
      }
    );

    // Limpiar métricas
    metricsStore.delete(req);
  });

  next();
};

// Helper para incrementar contador de queries
export const incrementQueryCount = (req: Request): void => {
  const metrics = metricsStore.get(req);
  if (metrics) {
    metrics.queries++;
  }
};

// Helper para registrar cache hits/misses
export const recordCacheMetric = (req: Request, hit: boolean): void => {
  const metrics = metricsStore.get(req);
  if (metrics) {
    if (hit) {
      metrics.cacheHits++;
    } else {
      metrics.cacheMisses++;
    }
  }
};

// Middleware para monitorear memoria
export const memoryMonitor = (threshold: number = 500) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const memUsage = process.memoryUsage();
    const heapUsedMB = memUsage.heapUsed / 1024 / 1024;

    if (heapUsedMB > threshold) {
      logger.warn({
        heapUsedMB: heapUsedMB.toFixed(2),
        heapTotalMB: (memUsage.heapTotal / 1024 / 1024).toFixed(2),
        rssMB: (memUsage.rss / 1024 / 1024).toFixed(2),
        externalMB: (memUsage.external / 1024 / 1024).toFixed(2),
        arrayBuffersMB: (memUsage.arrayBuffers / 1024 / 1024).toFixed(2),
        requestId: (req as any).requestId
      }, 'High memory usage detected');

      // Opcional: Forzar garbage collection si está disponible
      if (global.gc) {
        logger.info('Forcing garbage collection');
        global.gc();
      }
    }

    next();
  };
};

// Middleware para timeout de requests
export const requestTimeout = (timeoutMs: number = 30000) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const timer = setTimeout(() => {
      logger.error({
        method: req.method,
        url: req.url,
        timeoutMs,
        requestId: (req as any).requestId
      }, 'Request timeout');

      if (!res.headersSent) {
        res.status(503).json({
          success: false,
          error: 'Request timeout',
          message: 'La solicitud tardó demasiado tiempo en procesarse',
          code: 'REQUEST_TIMEOUT'
        });
      }
    }, timeoutMs);

    res.on('finish', () => {
      clearTimeout(timer);
    });

    res.on('close', () => {
      clearTimeout(timer);
    });

    next();
  };
};
