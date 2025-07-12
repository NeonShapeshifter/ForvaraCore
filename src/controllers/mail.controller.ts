import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { mailService } from '../services/mail.service';
import { fileService } from '../services/file.service';
import { notificationService } from '../services/notification.service';
import { activityService } from '../services/activity.service';
import { websocketService } from '../services/websocket.service';
import { createApiResponse } from '../utils/responses';
import { logger } from '../config/logger';
import { ACTIVITY_ACTIONS, SOCKET_EVENTS } from '../constants';
import { 
  NotFoundError, 
  ValidationError, 
  AuthorizationError 
} from '../types';

export const getChannels = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const tenantId = req.tenantId!;
    const userId = req.userId!;
    const { type, includePrivate = true, search } = req.query;

    const channels = await mailService.getUserChannels(userId, tenantId, {
      type: type as string,
      includePrivate: includePrivate === 'true',
      search: search as string
    });

    // Enriquecer con información adicional
    const enrichedChannels = await Promise.all(
      channels.map(async (channel) => {
        const [memberCount, unreadCount, lastMessage] = await Promise.all([
          mailService.getChannelMemberCount(channel.id),
          mailService.getUnreadCount(channel.id, userId),
          mailService.getLastMessage(channel.id)
        ]);

        return {
          ...channel,
          member_count: memberCount,
          unread_count: unreadCount,
          last_message: lastMessage
        };
      })
    );

    res.json(createApiResponse(
      true,
      enrichedChannels,
      'Canales obtenidos'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const createChannel = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const tenantId = req.tenantId!;
    const userId = req.userId!;
    const { name, description, type, is_private, members = [] } = req.body;

    // Verificar límite de canales
    const channelCount = await mailService.getTenantChannelCount(tenantId);
    const limits = await subscriptionService.calculateTenantLimits(tenantId);

    if (limits.mail_channels && channelCount >= limits.mail_channels) {
      throw new ValidationError(
        `Has alcanzado el límite de ${limits.mail_channels} canales`
      );
    }

    // Crear canal
    const channel = await mailService.createChannel({
      tenant_id: tenantId,
      name,
      description,
      type,
      is_private,
      created_by: userId
    });

    // Agregar creador como miembro
    await mailService.addChannelMember(channel.id, userId, 'admin');

    // Agregar otros miembros
    if (members.length > 0) {
      await mailService.addChannelMembers(channel.id, members, userId);
    }

    // Enviar mensaje de bienvenida
    await mailService.sendSystemMessage(channel.id, {
      content: `${req.user!.nombre} creó el canal #${name}`,
      type: 'channel_created'
    });

    // Notificar a miembros agregados
    for (const memberId of members) {
      if (memberId !== userId) {
        await notificationService.createNotification({
          user_id: memberId,
          type: 'info',
          title: 'Agregado a canal',
          message: `Has sido agregado al canal #${name}`,
          data: {
            channel_id: channel.id,
            channel_name: name
          }
        });
      }
    }

    // Log actividad
    await activityService.log({
      user_id: userId,
      tenant_id: tenantId,
      action: ACTIVITY_ACTIONS.MAIL_CHANNEL_CREATED,
      resource_type: 'channel',
      resource_id: channel.id,
      details: {
        channel_name: name,
        type,
        is_private,
        members_count: members.length + 1
      },
      ip_address: req.ip,
      user_agent: req.headers['user-agent'],
      success: true
    });

    res.status(201).json(createApiResponse(
      true,
      channel,
      'Canal creado exitosamente'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const getChannelById = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { channelId } = req.params;
    const userId = req.userId!;

    const channel = await mailService.getChannelById(channelId);
    
    if (!channel) {
      throw new NotFoundError('Canal');
    }

    // Verificar acceso
    const isMember = await mailService.isChannelMember(channelId, userId);
    if (!isMember && channel.is_private) {
      throw new AuthorizationError('No tienes acceso a este canal');
    }

    // Obtener información adicional
    const [members, pinnedMessages, settings] = await Promise.all([
      mailService.getChannelMembers(channelId),
      mailService.getPinnedMessages(channelId),
      mailService.getChannelSettings(channelId, userId)
    ]);

    res.json(createApiResponse(
      true,
      {
        ...channel,
        members,
        pinned_messages: pinnedMessages,
        user_settings: settings
      },
      'Canal obtenido'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const updateChannel = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { channelId } = req.params;
    const userId = req.userId!;
    const updates = req.body;

    // Verificar que es admin del canal
    const memberRole = await mailService.getChannelMemberRole(channelId, userId);
    if (memberRole !== 'admin') {
      throw new AuthorizationError('Solo administradores pueden editar el canal');
    }

    const updatedChannel = await mailService.updateChannel(channelId, updates);

    // Notificar cambios a miembros
    await mailService.sendSystemMessage(channelId, {
      content: `${req.user!.nombre} actualizó la información del canal`,
      type: 'channel_updated',
      data: { changes: Object.keys(updates) }
    });

    res.json(createApiResponse(
      true,
      updatedChannel,
      'Canal actualizado'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const deleteChannel = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { channelId } = req.params;
    const userId = req.userId!;

    const channel = await mailService.getChannelById(channelId);
    if (!channel) {
      throw new NotFoundError('Canal');
    }

    // Solo el creador o admin del tenant puede eliminar
    if (channel.created_by !== userId && req.userRole !== 'admin') {
      throw new AuthorizationError('No tienes permisos para eliminar este canal');
    }

    // No permitir eliminar canal general
    if (channel.type === 'general' && channel.name === 'general') {
      throw new ValidationError('No se puede eliminar el canal general');
    }

    await mailService.deleteChannel(channelId);

    // Log actividad
    await activityService.log({
      user_id: userId,
      tenant_id: req.tenantId!,
      action: ACTIVITY_ACTIONS.MAIL_CHANNEL_DELETED,
      resource_type: 'channel',
      resource_id: channelId,
      details: {
        channel_name: channel.name
      },
      ip_address: req.ip,
      user_agent: req.headers['user-agent'],
      success: true
    });

    res.json(createApiResponse(
      true,
      null,
      'Canal eliminado'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const getChannelMessages = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { channelId } = req.params;
    const userId = req.userId!;
    const { limit = 50, before, after } = req.query;

    // Verificar acceso
    const isMember = await mailService.isChannelMember(channelId, userId);
    if (!isMember) {
      const channel = await mailService.getChannelById(channelId);
      if (!channel || channel.is_private) {
        throw new AuthorizationError('No tienes acceso a este canal');
      }
    }

    const messages = await mailService.getChannelMessages(channelId, {
      limit: Number(limit),
      before: before as string,
      after: after as string
    });

    // Marcar como leídos
    await mailService.markChannelAsRead(channelId, userId);

    res.json(createApiResponse(
      true,
      messages,
      'Mensajes obtenidos'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const sendMessage = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { channelId } = req.params;
    const userId = req.userId!;
    const tenantId = req.tenantId!;
    const { content, mentions = [] } = req.body;
    const attachments = req.files as Express.Multer.File[];

    // Verificar acceso
    const isMember = await mailService.isChannelMember(channelId, userId);
    if (!isMember) {
      throw new AuthorizationError('No eres miembro de este canal');
    }

    // Verificar límite de mensajes
    const usage = await tenantService.getTenantUsage(tenantId);
    const limits = await subscriptionService.calculateTenantLimits(tenantId);

    if (limits.mail_messages_per_day && 
        usage.mail_messages_today >= limits.mail_messages_per_day) {
      throw new ValidationError(
        `Has alcanzado el límite de ${limits.mail_messages_per_day} mensajes por día`
      );
    }

    // Procesar attachments si hay
    let attachmentData = [];
    if (attachments && attachments.length > 0) {
      attachmentData = await Promise.all(
        attachments.map(file => 
          fileService.uploadFile({
            tenantId,
            userId,
            appId: 'forvara-mail',
            file,
            tags: ['mail-attachment'],
            isPublic: false
          })
        )
      );
    }

    // Crear mensaje
    const message = await mailService.sendMessage({
      channel_id: channelId,
      sender_id: userId,
      content,
      mentions,
      attachments: attachmentData.map(a => ({
        file_id: a.id,
        filename: a.original_name,
        size: a.size_bytes,
        mime_type: a.mime_type
      }))
    });

    // Notificar menciones
    for (const mentionedUserId of mentions) {
      if (mentionedUserId !== userId) {
        await notificationService.createNotification({
          user_id: mentionedUserId,
          type: 'mention',
          title: 'Nueva mención',
          message: `${req.user!.nombre} te mencionó en #${message.channel_name}`,
          data: {
            channel_id: channelId,
            message_id: message.id
          }
        });
      }
    }

    // Emitir por WebSocket
    websocketService.emitToChannel(channelId, SOCKET_EVENTS.MAIL_MESSAGE, {
      message,
      sender: {
        id: req.user!.id,
        nombre: req.user!.nombre,
        apellido: req.user!.apellido,
        avatar_url: req.user!.avatar_url
      }
    });

    // Log actividad
    await activityService.log({
      user_id: userId,
      tenant_id: tenantId,
      action: ACTIVITY_ACTIONS.MAIL_MESSAGE_SENT,
      resource_type: 'message',
      resource_id: message.id,
      details: {
        channel_id: channelId,
        has_attachments: attachmentData.length > 0,
        mentions_count: mentions.length
      },
      ip_address: req.ip,
      user_agent: req.headers['user-agent'],
      success: true
    });

    res.status(201).json(createApiResponse(
      true,
      message,
      'Mensaje enviado'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const updateMessage = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { messageId } = req.params;
    const userId = req.userId!;
    const { content } = req.body;

    const message = await mailService.getMessageById(messageId);
    
    if (!message) {
      throw new NotFoundError('Mensaje');
    }

    // Solo el autor puede editar
    if (message.sender_id !== userId) {
      throw new AuthorizationError('Solo puedes editar tus propios mensajes');
    }

    // No permitir editar después de 24 horas
    const messageAge = Date.now() - new Date(message.created_at).getTime();
    if (messageAge > 24 * 60 * 60 * 1000) {
      throw new ValidationError('No puedes editar mensajes después de 24 horas');
    }

    const updatedMessage = await mailService.updateMessage(messageId, content);

    // Emitir actualización
    websocketService.emitToChannel(
      message.channel_id, 
      'mail:message:updated',
      updatedMessage
    );

    res.json(createApiResponse(
      true,
      updatedMessage,
      'Mensaje actualizado'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const deleteMessage = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { messageId } = req.params;
    const userId = req.userId!;

    const message = await mailService.getMessageById(messageId);
    
    if (!message) {
      throw new NotFoundError('Mensaje');
    }

    // Solo el autor o admin puede eliminar
    const memberRole = await mailService.getChannelMemberRole(
      message.channel_id,
      userId
    );
    
    if (message.sender_id !== userId && memberRole !== 'admin') {
      throw new AuthorizationError('No puedes eliminar este mensaje');
    }

    await mailService.deleteMessage(messageId);

    // Emitir eliminación
    websocketService.emitToChannel(
      message.channel_id,
      'mail:message:deleted',
      { message_id: messageId }
    );

    res.json(createApiResponse(
      true,
      null,
      'Mensaje eliminado'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const getChannelMembers = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { channelId } = req.params;
    const userId = req.userId!;

    // Verificar acceso
    const isMember = await mailService.isChannelMember(channelId, userId);
    if (!isMember) {
      throw new AuthorizationError('No tienes acceso a este canal');
    }

    const members = await mailService.getChannelMembersWithDetails(channelId);

    res.json(createApiResponse(
      true,
      members,
      'Miembros obtenidos'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const addChannelMembers = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { channelId } = req.params;
    const userId = req.userId!;
    const { userIds } = req.body;

    // Verificar que es admin
    const memberRole = await mailService.getChannelMemberRole(channelId, userId);
    if (memberRole !== 'admin') {
      throw new AuthorizationError('Solo administradores pueden agregar miembros');
    }

    const channel = await mailService.getChannelById(channelId);
    if (!channel) {
      throw new NotFoundError('Canal');
    }

    // Agregar miembros
    const results = await mailService.addChannelMembers(channelId, userIds, userId);

    // Notificar a nuevos miembros
    for (const newMemberId of results.added) {
      await notificationService.createNotification({
        user_id: newMemberId,
        type: 'info',
        title: 'Agregado a canal',
        message: `Has sido agregado al canal #${channel.name}`,
        data: {
          channel_id: channelId,
          added_by: userId
        }
      });
    }

    // Mensaje en el canal
    if (results.added.length > 0) {
      await mailService.sendSystemMessage(channelId, {
        content: `${req.user!.nombre} agregó ${results.added.length} miembro(s) al canal`,
        type: 'members_added'
      });
    }

    res.json(createApiResponse(
      true,
      results,
      `${results.added.length} miembros agregados`
    ));
  } catch (error: any) {
    throw error;
  }
};

export const removeChannelMember = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { channelId, userId: targetUserId } = req.params;
    const userId = req.userId!;

    // Verificar permisos
    const memberRole = await mailService.getChannelMemberRole(channelId, userId);
    const targetRole = await mailService.getChannelMemberRole(channelId, targetUserId);

    // Solo admin puede remover, o el usuario puede salirse
    if (memberRole !== 'admin' && userId !== targetUserId) {
      throw new AuthorizationError('No tienes permisos para remover miembros');
    }

    // No se puede remover al último admin
    if (targetRole === 'admin') {
      const adminCount = await mailService.getChannelAdminCount(channelId);
      if (adminCount === 1) {
        throw new ValidationError('No se puede remover al último administrador');
      }
    }

    await mailService.removeChannelMember(channelId, targetUserId);

    const channel = await mailService.getChannelById(channelId);

    // Notificar al usuario removido
    if (userId !== targetUserId) {
      await notificationService.createNotification({
        user_id: targetUserId,
        type: 'info',
        title: 'Removido de canal',
        message: `Has sido removido del canal #${channel!.name}`,
        data: { channel_id: channelId }
      });
    }

    res.json(createApiResponse(
      true,
      null,
      userId === targetUserId ? 'Has salido del canal' : 'Miembro removido'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const setTypingStatus = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { channelId } = req.params;
    const userId = req.userId!;
    const { isTyping } = req.body;

    // Emitir estado de escritura
    websocketService.emitToChannelExcept(
      channelId,
      userId,
      SOCKET_EVENTS.MAIL_TYPING,
      {
        user_id: userId,
        user_name: `${req.user!.nombre} ${req.user!.apellido}`,
        is_typing: isTyping,
        channel_id: channelId
      }
    );

    res.json(createApiResponse(
      true,
      null,
      'Estado actualizado'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const getDirectMessages = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { userId: otherUserId } = req.params;
    const userId = req.userId!;
    const tenantId = req.tenantId!;
    const { limit = 50, before } = req.query;

    // Verificar que ambos usuarios pertenecen al tenant
    const otherUserAccess = await userService.getUserTenantAccess(
      otherUserId,
      tenantId
    );

    if (!otherUserAccess) {
      throw new NotFoundError('Usuario');
    }

    const messages = await mailService.getDirectMessages(
      userId,
      otherUserId,
      {
        limit: Number(limit),
        before: before as string
      }
    );

    // Marcar como leídos
    await mailService.markDirectMessagesAsRead(userId, otherUserId);

    res.json(createApiResponse(
      true,
      messages,
      'Mensajes obtenidos'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const searchMessages = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const tenantId = req.tenantId!;
    const userId = req.userId!;
    const { q, channelId, userId: searchUserId, dateFrom, dateTo } = req.query;

    const results = await mailService.searchMessages(tenantId, userId, {
      query: q as string,
      channelId: channelId as string,
      userId: searchUserId as string,
      dateFrom: dateFrom as string,
      dateTo: dateTo as string
    });

    res.json(createApiResponse(
      true,
      results,
      `${results.length} resultados encontrados`
    ));
  } catch (error: any) {
    throw error;
  }
};
