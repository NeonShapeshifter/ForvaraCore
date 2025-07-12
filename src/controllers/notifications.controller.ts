import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { notificationService } from '../services/notification.service';
import { websocketService } from '../services/websocket.service';
import { createApiResponse } from '../utils/responses';
import { logger } from '../config/logger';
import { SOCKET_EVENTS } from '../constants';
import { NotFoundError, ValidationError } from '../types';

export const getNotifications = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId!;
    const { 
      page = 1, 
      limit = 20, 
      type, 
      isRead, 
      from, 
      to 
    } = req.query;

    const result = await notificationService.getUserNotifications(userId, {
      page: Number(page),
      limit: Number(limit),
      type: type as string,
      isRead: isRead === 'true' ? true : isRead === 'false' ? false : undefined,
      from: from as string,
      to: to as string
    });

    res.json(createApiResponse(
      true,
      result.notifications,
      'Notificaciones obtenidas',
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

export const getUnreadCount = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId!;

    const counts = await notificationService.getUnreadCounts(userId);

    res.json(createApiResponse(
      true,
      counts,
      'Contadores obtenidos'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const getNotificationById = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { notificationId } = req.params;
    const userId = req.userId!;

    const notification = await notificationService.getNotificationById(
      notificationId,
      userId
    );

    if (!notification) {
      throw new NotFoundError('Notificación');
    }

    // Marcar como leída automáticamente al verla
    if (!notification.is_read) {
      await notificationService.markAsRead(userId, [notificationId]);
    }

    res.json(createApiResponse(
      true,
      notification,
      'Notificación obtenida'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const markAsRead = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId!;
    const { notificationIds } = req.body;

    if (!Array.isArray(notificationIds) || notificationIds.length === 0) {
      throw new ValidationError('Se requiere array de notificationIds');
    }

    const updatedCount = await notificationService.markAsRead(
      userId,
      notificationIds
    );

    // Emitir actualización de contador
    const newCounts = await notificationService.getUnreadCounts(userId);
    websocketService.emitToUser(
      userId,
      SOCKET_EVENTS.NOTIFICATION_READ,
      {
        updated_ids: notificationIds,
        new_counts: newCounts
      }
    );

    res.json(createApiResponse(
      true,
      {
        updated_count: updatedCount,
        new_unread_count: newCounts.total
      },
      `${updatedCount} notificaciones marcadas como leídas`
    ));
  } catch (error: any) {
    throw error;
  }
};

export const markAllAsRead = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId!;
    const { type } = req.body;

    const updatedCount = await notificationService.markAllAsRead(userId, type);

    // Emitir actualización
    websocketService.emitToUser(
      userId,
      SOCKET_EVENTS.NOTIFICATION_CLEAR,
      {
        type,
        cleared_count: updatedCount
      }
    );

    res.json(createApiResponse(
      true,
      {
        updated_count: updatedCount
      },
      'Todas las notificaciones marcadas como leídas'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const deleteNotification = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { notificationId } = req.params;
    const userId = req.userId!;

    const notification = await notificationService.getNotificationById(
      notificationId,
      userId
    );

    if (!notification) {
      throw new NotFoundError('Notificación');
    }

    await notificationService.deleteNotification(notificationId, userId);

    res.json(createApiResponse(
      true,
      null,
      'Notificación eliminada'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const bulkDelete = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId!;
    const { notificationIds } = req.body;

    if (!Array.isArray(notificationIds) || notificationIds.length === 0) {
      throw new ValidationError('Se requiere array de notificationIds');
    }

    const deletedCount = await notificationService.bulkDelete(
      userId,
      notificationIds
    );

    res.json(createApiResponse(
      true,
      {
        deleted_count: deletedCount
      },
      `${deletedCount} notificaciones eliminadas`
    ));
  } catch (error: any) {
    throw error;
  }
};

export const getPreferences = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId!;

    const preferences = await notificationService.getUserPreferences(userId);

    res.json(createApiResponse(
      true,
      preferences,
      'Preferencias obtenidas'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const updatePreferences = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId!;
    const preferences = req.body;

    const updatedPreferences = await notificationService.updateUserPreferences(
      userId,
      preferences
    );

    res.json(createApiResponse(
      true,
      updatedPreferences,
      'Preferencias actualizadas'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const sendTestNotification = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId!;
    const { type, channel } = req.body;

    // Crear notificación de prueba
    const testNotification = {
      user_id: userId,
      type: type as any,
      title: 'Notificación de prueba',
      message: `Esta es una notificación de prueba tipo ${type} por ${channel}`,
      data: {
        test: true,
        channel,
        timestamp: new Date()
      }
    };

    // Enviar según el canal
    switch (channel) {
      case 'inApp':
        await notificationService.createNotification(testNotification);
        break;
      
      case 'email':
        await emailService.sendNotificationEmail(
          req.user!,
          testNotification.title,
          testNotification.message
        );
        break;
      
      case 'push':
        await notificationService.sendPushNotification(
          userId,
          testNotification
        );
        break;
      
      case 'sms':
        // TODO: Implementar SMS
        logger.info({ userId, phone: req.user!.telefono }, 'SMS test not implemented');
        break;
    }

    res.json(createApiResponse(
      true,
      null,
      'Notificación de prueba enviada'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const subscribeToPush = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId!;
    const { subscription, deviceInfo } = req.body;

    await notificationService.savePushSubscription(userId, {
      endpoint: subscription.endpoint,
      keys: subscription.keys,
      device_info: deviceInfo
    });

    res.status(201).json(createApiResponse(
      true,
      null,
      'Suscripción push creada'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const unsubscribeFromPush = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId!;
    const { endpoint } = req.body;

    await notificationService.removePushSubscription(userId, endpoint);

    res.json(createApiResponse(
      true,
      null,
      'Suscripción push eliminada'
    ));
  } catch (error: any) {
    throw error;
  }
};
