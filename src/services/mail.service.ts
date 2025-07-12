import { v4 as uuidv4 } from 'uuid';
import { getSupabase } from '../config/database';
import { getRedis } from '../config/redis';
import { logger } from '../config/logger';
import { 
  NotFoundError, 
  ValidationError,
  AuthorizationError,
  ForvaraMail,
  MailChannel,
  MailMessage,
  MailAttachment,
  PaginatedResponse
} from '../types';
import { activityService } from './activity.service';
import { notificationService } from './notification.service';
import { fileService } from './file.service';
import { websocketService } from './websocket.service';
import { ACTIVITY_ACTIONS, SOCKET_EVENTS } from '../constants';
import { encrypt, decrypt } from '../utils/crypto';

// const supabase = getSupabase(); // Moved to lazy loading
const redis = getRedis();

class MailService {
  /**
   * Crear canal (similar a Discord)
   */
  async createChannel(params: {
    tenantId: string;
    name: string;
    description?: string;
    type: 'public' | 'private' | 'direct';
    createdBy: string;
    members?: string[];
    icon?: string;
  }): Promise<MailChannel> {
    try {
      const { tenantId, name, description, type, createdBy, members = [], icon } = params;

      // Para canales directos, verificar que solo haya 2 miembros
      if (type === 'direct' && members.length !== 2) {
        throw new ValidationError('Los canales directos deben tener exactamente 2 miembros');
      }

      // Para canales directos, verificar si ya existe
      if (type === 'direct') {
        const existingChannel = await this.findDirectChannel(members[0], members[1]);
        if (existingChannel) {
          return existingChannel;
        }
      }

      // Crear canal
      const { data: channel, error } = await supabase
        .from('mail_channels')
        .insert({
          id: uuidv4(),
          tenant_id: tenantId,
          name: type === 'direct' ? null : name, // Los directos no tienen nombre
          description,
          type,
          created_by: createdBy,
          icon,
          settings: {
            notifications: true,
            muted_until: null
          }
        })
        .select()
        .single();

      if (error) throw error;

      // Agregar miembros
      const channelMembers = [...new Set([createdBy, ...members])].map(userId => ({
        channel_id: channel.id,
        user_id: userId,
        role: userId === createdBy ? 'owner' : 'member',
        joined_at: new Date().toISOString()
      }));

      await supabase
        .from('mail_channel_members')
        .insert(channelMembers);

      // Notificar a los miembros (excepto al creador)
      const otherMembers = members.filter(m => m !== createdBy);
      if (otherMembers.length > 0 && type !== 'direct') {
        await notificationService.notifyUsers(otherMembers, {
          type: 'channel_invite',
          title: 'Agregado a canal',
          message: `Has sido agregado al canal #${name}`,
          data: { channelId: channel.id, channelName: name }
        });
      }

      logger.info({ 
        channelId: channel.id, 
        type, 
        memberCount: channelMembers.length 
      }, 'Channel created');

      return channel;
    } catch (error) {
      logger.error({ error, params }, 'Create channel failed');
      throw error;
    }
  }

  /**
   * Obtener canales del usuario
   */
  async getUserChannels(
    userId: string,
    tenantId?: string
  ): Promise<MailChannel[]> {
    let query = supabase
      .from('mail_channel_members')
      .select(`
        channel:mail_channels (
          *,
          last_message:mail_messages (
            id,
            content,
            created_at,
            sender:users!sender_id (
              nombre,
              apellido
            )
          ),
          members:mail_channel_members (
            user:users!user_id (
              id,
              nombre,
              apellido,
              avatar_url,
              last_seen
            )
          ),
          unread_count
        )
      `)
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('last_activity', { ascending: false });

    if (tenantId) {
      query = query.eq('channel.tenant_id', tenantId);
    }

    const { data, error } = await query;

    if (error) throw error;

    // Calcular contadores de no leídos
    const channels = await Promise.all(
      (data || []).map(async (item) => {
        const channel = item.channel;
        
        // Obtener último mensaje leído
        const { data: lastRead } = await supabase
          .from('mail_read_receipts')
          .select('message_id')
          .eq('channel_id', channel.id)
          .eq('user_id', userId)
          .order('read_at', { ascending: false })
          .limit(1)
          .single();

        // Contar mensajes no leídos
        let unreadQuery = supabase
          .from('mail_messages')
          .select('*', { count: 'exact', head: true })
          .eq('channel_id', channel.id)
          .neq('sender_id', userId);

        if (lastRead) {
          unreadQuery = unreadQuery.gt('created_at', lastRead.read_at);
        }

        const { count } = await unreadQuery;

        return {
          ...channel,
          unread_count: count || 0
        };
      })
    );

    return channels;
  }

  /**
   * Enviar mensaje
   */
  async sendMessage(params: {
    channelId: string;
    senderId: string;
    content: string;
    attachments?: string[];
    replyToId?: string;
    mentions?: string[];
    metadata?: Record<string, any>;
  }): Promise<MailMessage> {
    try {
      const { 
        channelId, 
        senderId, 
        content, 
        attachments = [], 
        replyToId, 
        mentions = [],
        metadata 
      } = params;

      // Verificar que el usuario es miembro del canal
      const isMember = await this.checkChannelMembership(channelId, senderId);
      if (!isMember) {
        throw new AuthorizationError('No eres miembro de este canal');
      }

      // Encriptar contenido si el canal es privado
      const channel = await this.getChannelById(channelId);
      const isPrivate = channel.type === 'private' || channel.type === 'direct';
      const encryptedContent = isPrivate ? encrypt(content) : content;

      // Crear mensaje
      const { data: message, error } = await supabase
        .from('mail_messages')
        .insert({
          id: uuidv4(),
          channel_id: channelId,
          sender_id: senderId,
          content: encryptedContent,
          original_content: content, // Para búsquedas
          is_encrypted: isPrivate,
          attachments,
          reply_to_id: replyToId,
          mentions,
          metadata,
          status: 'sent'
        })
        .select(`
          *,
          sender:users!sender_id (
            id,
            nombre,
            apellido,
            avatar_url
          ),
          reply_to:mail_messages!reply_to_id (
            id,
            content,
            sender:users!sender_id (
              nombre,
              apellido
            )
          )
        `)
        .single();

      if (error) throw error;

      // Actualizar última actividad del canal
      await supabase
        .from('mail_channels')
        .update({
          last_message_id: message.id,
          last_activity: new Date().toISOString()
        })
        .eq('id', channelId);

      // Marcar como leído para el remitente
      await this.markAsRead(channelId, message.id, senderId);

      // Notificar a otros miembros
      const members = await this.getChannelMembers(channelId);
      const otherMembers = members
        .filter(m => m.user_id !== senderId && m.is_active)
        .map(m => m.user_id);

      if (otherMembers.length > 0) {
        // WebSocket para tiempo real
        websocketService.sendToUsers(otherMembers, SOCKET_EVENTS.NEW_MESSAGE, {
          channelId,
          message: {
            ...message,
            content: isPrivate ? decrypt(message.content) : message.content
          }
        });

        // Notificaciones push/email para usuarios offline
        const onlineUsers = await websocketService.getOnlineUsers();
        const offlineMembers = otherMembers.filter(id => !onlineUsers.includes(id));

        if (offlineMembers.length > 0) {
          await notificationService.notifyUsers(offlineMembers, {
            type: 'new_message',
            title: channel.name || 'Mensaje directo',
            message: `${message.sender.nombre}: ${content.substring(0, 50)}...`,
            data: { 
              channelId, 
              messageId: message.id,
              senderId,
              senderName: message.sender.nombre
            }
          });
        }
      }

      // Procesar menciones
      if (mentions.length > 0) {
        await this.processMentions(message, mentions);
      }

      // Registrar actividad
      await activityService.log({
        user_id: senderId,
        action: ACTIVITY_ACTIONS.MESSAGE_SENT,
        resource_type: 'message',
        resource_id: message.id,
        details: {
          channel_id: channelId,
          message_length: content.length,
          has_attachments: attachments.length > 0
        }
      });

      logger.info({ 
        messageId: message.id, 
        channelId, 
        senderId 
      }, 'Message sent');

      // Desencriptar antes de devolver
      if (isPrivate && message.content) {
        message.content = decrypt(message.content);
      }

      return message;
    } catch (error) {
      logger.error({ error, params }, 'Send message failed');
      throw error;
    }
  }

  /**
   * Obtener mensajes de un canal
   */
  async getChannelMessages(
    channelId: string,
    userId: string,
    options: {
      limit?: number;
      before?: string;
      after?: string;
      search?: string;
    } = {}
  ): Promise<PaginatedResponse<MailMessage>> {
    try {
      const { limit = 50, before, after, search } = options;

      // Verificar acceso
      const isMember = await this.checkChannelMembership(channelId, userId);
      if (!isMember) {
        throw new AuthorizationError('No tienes acceso a este canal');
      }

      // Obtener si el canal es privado
      const channel = await this.getChannelById(channelId);
      const isPrivate = channel.type === 'private' || channel.type === 'direct';

      let query = supabase
        .from('mail_messages')
        .select(`
          *,
          sender:users!sender_id (
            id,
            nombre,
            apellido,
            avatar_url
          ),
          reply_to:mail_messages!reply_to_id (
            id,
            content,
            sender:users!sender_id (
              nombre,
              apellido
            )
          ),
          reactions:mail_reactions (
            emoji,
            user:users!user_id (
              id,
              nombre,
              apellido
            )
          ),
          read_by:mail_read_receipts (
            user_id,
            read_at
          )
        `, { count: 'exact' })
        .eq('channel_id', channelId)
        .order('created_at', { ascending: false })
        .limit(limit);

      // Paginación
      if (before) {
        query = query.lt('created_at', before);
      }
      if (after) {
        query = query.gt('created_at', after);
      }

      // Búsqueda
      if (search) {
        query = query.ilike('original_content', `%${search}%`);
      }

      const { data: messages, error, count } = await query;

      if (error) throw error;

      // Desencriptar mensajes si es necesario
      const decryptedMessages = (messages || []).map(msg => {
        if (isPrivate && msg.is_encrypted && msg.content) {
          msg.content = decrypt(msg.content);
        }
        return msg;
      });

      // Marcar mensajes como leídos
      if (messages && messages.length > 0) {
        const messageIds = messages.map(m => m.id);
        await this.markMessagesAsRead(channelId, messageIds, userId);
      }

      return {
        data: decryptedMessages,
        pagination: {
          total: count || 0,
          hasMore: messages ? messages.length === limit : false,
          cursor: messages && messages.length > 0 
            ? messages[messages.length - 1].created_at 
            : null
        }
      };
    } catch (error) {
      logger.error({ error, channelId, userId }, 'Get messages failed');
      throw error;
    }
  }

  /**
   * Editar mensaje
   */
  async editMessage(
    messageId: string,
    userId: string,
    newContent: string
  ): Promise<MailMessage> {
    try {
      // Verificar que el usuario es el autor
      const { data: message } = await supabase
        .from('mail_messages')
        .select('*, mail_channels!channel_id(*)')
        .eq('id', messageId)
        .single();

      if (!message) {
        throw new NotFoundError('Mensaje');
      }

      if (message.sender_id !== userId) {
        throw new AuthorizationError('Solo puedes editar tus propios mensajes');
      }

      // Verificar tiempo límite (15 minutos)
      const timeDiff = Date.now() - new Date(message.created_at).getTime();
      if (timeDiff > 15 * 60 * 1000) {
        throw new ValidationError('No puedes editar mensajes después de 15 minutos');
      }

      // Encriptar si es necesario
      const isPrivate = message.mail_channels.type === 'private' || 
                       message.mail_channels.type === 'direct';
      const encryptedContent = isPrivate ? encrypt(newContent) : newContent;

      // Actualizar mensaje
      const { data: updatedMessage, error } = await supabase
        .from('mail_messages')
        .update({
          content: encryptedContent,
          original_content: newContent,
          edited_at: new Date().toISOString(),
          edit_history: supabase.sql`array_append(edit_history, ${JSON.stringify({
            content: message.original_content,
            edited_at: new Date().toISOString()
          })}::jsonb)`
        })
        .eq('id', messageId)
        .select()
        .single();

      if (error) throw error;

      // Notificar a otros miembros
      const members = await this.getChannelMembers(message.channel_id);
      const otherMembers = members
        .filter(m => m.user_id !== userId)
        .map(m => m.user_id);

      websocketService.sendToUsers(otherMembers, SOCKET_EVENTS.MESSAGE_EDITED, {
        channelId: message.channel_id,
        messageId,
        newContent: isPrivate ? decrypt(encryptedContent) : newContent
      });

      logger.info({ messageId, userId }, 'Message edited');

      // Desencriptar antes de devolver
      if (isPrivate) {
        updatedMessage.content = decrypt(updatedMessage.content);
      }

      return updatedMessage;
    } catch (error) {
      logger.error({ error, messageId }, 'Edit message failed');
      throw error;
    }
  }

  /**
   * Eliminar mensaje
   */
  async deleteMessage(
    messageId: string,
    userId: string
  ): Promise<void> {
    try {
      // Verificar que el usuario es el autor o admin del canal
      const { data: message } = await supabase
        .from('mail_messages')
        .select('*')
        .eq('id', messageId)
        .single();

      if (!message) {
        throw new NotFoundError('Mensaje');
      }

      const canDelete = message.sender_id === userId || 
                       await this.isChannelAdmin(message.channel_id, userId);

      if (!canDelete) {
        throw new AuthorizationError('No tienes permisos para eliminar este mensaje');
      }

      // Soft delete
      await supabase
        .from('mail_messages')
        .update({
          deleted_at: new Date().toISOString(),
          deleted_by: userId,
          content: '[Mensaje eliminado]',
          original_content: null
        })
        .eq('id', messageId);

      // Notificar a otros miembros
      const members = await this.getChannelMembers(message.channel_id);
      const otherMembers = members
        .filter(m => m.user_id !== userId)
        .map(m => m.user_id);

      websocketService.sendToUsers(otherMembers, SOCKET_EVENTS.MESSAGE_DELETED, {
        channelId: message.channel_id,
        messageId
      });

      logger.info({ messageId, userId }, 'Message deleted');
    } catch (error) {
      logger.error({ error, messageId }, 'Delete message failed');
      throw error;
    }
  }

  /**
   * Agregar reacción a mensaje
   */
  async addReaction(
    messageId: string,
    userId: string,
    emoji: string
  ): Promise<void> {
    try {
      // Verificar que el mensaje existe y el usuario tiene acceso
      const { data: message } = await supabase
        .from('mail_messages')
        .select('channel_id')
        .eq('id', messageId)
        .single();

      if (!message) {
        throw new NotFoundError('Mensaje');
      }

      const isMember = await this.checkChannelMembership(message.channel_id, userId);
      if (!isMember) {
        throw new AuthorizationError('No tienes acceso a este canal');
      }

      // Agregar reacción
      await supabase
        .from('mail_reactions')
        .upsert({
          message_id: messageId,
          user_id: userId,
          emoji
        }, {
          onConflict: 'message_id,user_id,emoji'
        });

      // Notificar
      websocketService.sendToChannel(message.channel_id, SOCKET_EVENTS.REACTION_ADDED, {
        messageId,
        userId,
        emoji
      });

      logger.info({ messageId, userId, emoji }, 'Reaction added');
    } catch (error) {
      logger.error({ error, messageId }, 'Add reaction failed');
      throw error;
    }
  }

  /**
   * Marcar mensajes como leídos
   */
  async markMessagesAsRead(
    channelId: string,
    messageIds: string[],
    userId: string
  ): Promise<void> {
    try {
      const readReceipts = messageIds.map(messageId => ({
        channel_id: channelId,
        message_id: messageId,
        user_id: userId,
        read_at: new Date().toISOString()
      }));

      await supabase
        .from('mail_read_receipts')
        .upsert(readReceipts, {
          onConflict: 'message_id,user_id'
        });

      // Actualizar última lectura en Redis para optimización
      await redis.set(
        `last_read:${channelId}:${userId}`,
        new Date().toISOString(),
        'EX',
        86400 // 24 horas
      );

      // Notificar al remitente si está online
      websocketService.sendToChannel(channelId, SOCKET_EVENTS.MESSAGES_READ, {
        channelId,
        messageIds,
        readBy: userId
      });
    } catch (error) {
      logger.error({ error, channelId, messageIds }, 'Mark as read failed');
    }
  }

  // Métodos auxiliares privados
  private async findDirectChannel(userId1: string, userId2: string): Promise<MailChannel | null> {
    const { data } = await supabase
      .from('mail_channels')
      .select(`
        *,
        members:mail_channel_members(user_id)
      `)
      .eq('type', 'direct')
      .contains('member_ids', [userId1, userId2]);

    return data?.[0] || null;
  }

  private async getChannelById(channelId: string): Promise<MailChannel> {
    const { data, error } = await supabase
      .from('mail_channels')
      .select('*')
      .eq('id', channelId)
      .single();

    if (error || !data) {
      throw new NotFoundError('Canal');
    }

    return data;
  }

  private async checkChannelMembership(channelId: string, userId: string): Promise<boolean> {
    const { data } = await supabase
      .from('mail_channel_members')
      .select('id')
      .eq('channel_id', channelId)
      .eq('user_id', userId)
      .eq('is_active', true)
      .single();

    return !!data;
  }

  private async getChannelMembers(channelId: string): Promise<any[]> {
    const { data } = await supabase
      .from('mail_channel_members')
      .select('*')
      .eq('channel_id', channelId);

    return data || [];
  }

  private async isChannelAdmin(channelId: string, userId: string): Promise<boolean> {
    const { data } = await supabase
      .from('mail_channel_members')
      .select('role')
      .eq('channel_id', channelId)
      .eq('user_id', userId)
      .single();

    return data?.role === 'owner' || data?.role === 'admin';
  }

  private async processMentions(message: MailMessage, mentionedUserIds: string[]): Promise<void> {
    await notificationService.notifyUsers(mentionedUserIds, {
      type: 'mention',
      title: 'Te han mencionado',
      message: `${message.sender.nombre} te mencionó en un mensaje`,
      data: {
        messageId: message.id,
        channelId: message.channel_id,
        senderId: message.sender_id
      }
    });
  }

  private async markAsRead(channelId: string, messageId: string, userId: string): Promise<void> {
    await this.markMessagesAsRead(channelId, [messageId], userId);
  }
}

export const mailService = new MailService();
