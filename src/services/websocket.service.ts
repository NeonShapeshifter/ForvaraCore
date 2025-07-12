import { Server as SocketServer, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';
import { getRedis } from '../config/redis';
import { config } from '../config';
import { logger } from '../config/logger';
import { getSupabase } from '../config/database';
import { SOCKET_EVENTS } from '../constants';

// Initialize these when needed, not at import time
let redis: any = null;
let supabase: any = null;

function ensureRedis() {
  if (!redis) {
    redis = getRedis();
  }
  return redis;
}

function ensureSupabase() {
  if (!supabase) {
    supabase = getSupabase();
  }
  return supabase;
}

interface AuthenticatedSocket extends Socket {
  userId?: string;
  tenantId?: string;
  userRole?: string;
}

class WebSocketService {
  private io: SocketServer | null = null;
  private userSockets: Map<string, Set<string>> = new Map(); // userId -> socketIds
  private socketUsers: Map<string, string> = new Map(); // socketId -> userId

  /**
   * Inicializar WebSocket server
   */
  initialize(server: HttpServer): void {
    this.io = new SocketServer(server, {
      cors: {
        origin: config.FRONTEND_URLS,
        credentials: true
      },
      transports: ['websocket', 'polling'],
      pingTimeout: 60000,
      pingInterval: 25000,
      maxHttpBufferSize: 1e6 // 1MB
    });

    // Middleware de autenticación
    this.io.use(async (socket: AuthenticatedSocket, next) => {
      try {
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];
        
        if (!token) {
          return next(new Error('Authentication required'));
        }

        // Verificar token
        const payload = jwt.verify(token, config.JWT_SECRET) as any;
        
        // Verificar sesión en Redis
        const session = await ensureRedis().get(`session:${token}`);
        if (!session) {
          return next(new Error('Invalid session'));
        }

        // Asignar datos al socket
        socket.userId = payload.userId;
        socket.tenantId = socket.handshake.query.tenantId as string;

        next();
      } catch (error) {
        logger.error({ error }, 'Socket authentication failed');
        next(new Error('Authentication failed'));
      }
    });

    // Manejar conexiones
    this.io.on('connection', (socket: AuthenticatedSocket) => {
      this.handleConnection(socket);
    });

    logger.info('WebSocket server initialized');
  }

  /**
   * Manejar nueva conexión
   */
  private handleConnection(socket: AuthenticatedSocket): void {
    const { userId, tenantId } = socket;
    
    if (!userId) return;

    // Registrar socket
    this.addUserSocket(userId, socket.id);

    // Unir a rooms
    socket.join(`user:${userId}`);
    if (tenantId) {
      socket.join(`tenant:${tenantId}`);
    }

    // Actualizar estado online
    this.updateUserOnlineStatus(userId, true);

    logger.info({ 
      socketId: socket.id, 
      userId, 
      tenantId 
    }, 'Socket connected');

    // Eventos del socket
    this.setupSocketEvents(socket);

    // Manejar desconexión
    socket.on('disconnect', () => {
      this.handleDisconnection(socket);
    });
  }

  /**
   * Configurar eventos del socket
   */
  private setupSocketEvents(socket: AuthenticatedSocket): void {
    // Unirse a canal
    socket.on(SOCKET_EVENTS.JOIN_CHANNEL, async (channelId: string) => {
      try {
        // Verificar acceso al canal
        const hasAccess = await this.verifyChannelAccess(socket.userId!, channelId);
        if (hasAccess) {
          socket.join(`channel:${channelId}`);
          socket.emit(SOCKET_EVENTS.JOINED_CHANNEL, { channelId });
        }
      } catch (error) {
        logger.error({ error, channelId }, 'Join channel failed');
      }
    });

    // Salir de canal
    socket.on(SOCKET_EVENTS.LEAVE_CHANNEL, (channelId: string) => {
      socket.leave(`channel:${channelId}`);
    });

    // Escribiendo
    socket.on(SOCKET_EVENTS.TYPING_START, (data: { channelId: string }) => {
      socket.to(`channel:${data.channelId}`).emit(SOCKET_EVENTS.USER_TYPING, {
        userId: socket.userId,
        channelId: data.channelId
      });
    });

    // Dejar de escribir
    socket.on(SOCKET_EVENTS.TYPING_STOP, (data: { channelId: string }) => {
      socket.to(`channel:${data.channelId}`).emit(SOCKET_EVENTS.USER_STOPPED_TYPING, {
        userId: socket.userId,
        channelId: data.channelId
      });
    });

    // Actualizar presencia
    socket.on(SOCKET_EVENTS.UPDATE_PRESENCE, async (status: string) => {
      await this.updateUserPresence(socket.userId!, status);
    });

    // Marcar como leído
    socket.on(SOCKET_EVENTS.MARK_AS_READ, async (data: { channelId: string; messageId: string }) => {
      socket.to(`channel:${data.channelId}`).emit(SOCKET_EVENTS.MESSAGE_READ, {
        userId: socket.userId,
        messageId: data.messageId
      });
    });

    // Ping para mantener conexión
    socket.on('ping', () => {
      socket.emit('pong');
    });
  }

  /**
   * Manejar desconexión
   */
  private handleDisconnection(socket: AuthenticatedSocket): void {
    const { userId } = socket;
    
    if (!userId) return;

    // Remover socket
    this.removeUserSocket(userId, socket.id);

    // Si no quedan sockets del usuario, marcar como offline
    const userSockets = this.userSockets.get(userId);
    if (!userSockets || userSockets.size === 0) {
      this.updateUserOnlineStatus(userId, false);
    }

    logger.info({ 
      socketId: socket.id, 
      userId 
    }, 'Socket disconnected');
  }

  /**
   * Enviar a usuario específico
   */
  sendToUser(userId: string, event: string, data: any): void {
    if (!this.io) return;

    this.io.to(`user:${userId}`).emit(event, data);
    
    logger.debug({ userId, event }, 'Event sent to user');
  }

  /**
   * Enviar a múltiples usuarios
   */
  sendToUsers(userIds: string[], event: string, data: any): void {
    if (!this.io) return;

    userIds.forEach(userId => {
      this.sendToUser(userId, event, data);
    });
  }

  /**
   * Enviar a tenant
   */
  sendToTenant(tenantId: string, event: string, data: any): void {
    if (!this.io) return;

    this.io.to(`tenant:${tenantId}`).emit(event, data);
    
    logger.debug({ tenantId, event }, 'Event sent to tenant');
  }

  /**
   * Enviar a canal
   */
  sendToChannel(channelId: string, event: string, data: any): void {
    if (!this.io) return;

    this.io.to(`channel:${channelId}`).emit(event, data);
    
    logger.debug({ channelId, event }, 'Event sent to channel');
  }

  /**
   * Broadcast global
   */
  broadcast(event: string, data: any): void {
    if (!this.io) return;

    this.io.emit(event, data);
    
    logger.debug({ event }, 'Event broadcasted');
  }

  /**
   * Obtener usuarios online
   */
  async getOnlineUsers(): Promise<string[]> {
    const users: string[] = [];
    
    for (const [userId, sockets] of this.userSockets.entries()) {
      if (sockets.size > 0) {
        users.push(userId);
      }
    }
    
    return users;
  }

  /**
   * Verificar si usuario está online
   */
  isUserOnline(userId: string): boolean {
    const sockets = this.userSockets.get(userId);
    return !!(sockets && sockets.size > 0);
  }

  /**
   * Obtener estadísticas
   */
  getStats(): {
    totalConnections: number;
    onlineUsers: number;
    rooms: number;
  } {
    if (!this.io) {
      return { totalConnections: 0, onlineUsers: 0, rooms: 0 };
    }

    return {
      totalConnections: this.io.sockets.sockets.size,
      onlineUsers: this.userSockets.size,
      rooms: this.io.sockets.adapter.rooms.size
    };
  }

  // Métodos privados
  private addUserSocket(userId: string, socketId: string): void {
    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, new Set());
    }
    
    this.userSockets.get(userId)!.add(socketId);
    this.socketUsers.set(socketId, userId);
  }

  private removeUserSocket(userId: string, socketId: string): void {
    const sockets = this.userSockets.get(userId);
    if (sockets) {
      sockets.delete(socketId);
      if (sockets.size === 0) {
        this.userSockets.delete(userId);
      }
    }
    
    this.socketUsers.delete(socketId);
  }

  private async updateUserOnlineStatus(userId: string, isOnline: boolean): Promise<void> {
    try {
      // Actualizar en BD
      await supabase
        .from('users')
        .update({
          is_online: isOnline,
          last_seen: new Date().toISOString()
        })
        .eq('id', userId);

      // Actualizar en Redis para acceso rápido
      if (isOnline) {
        await ensureRedis().sadd('online_users', userId);
      } else {
        await ensureRedis().srem('online_users', userId);
      }

      // Notificar a contactos
      const { data: contacts } = await supabase
        .from('user_contacts')
        .select('contact_id')
        .eq('user_id', userId);

      if (contacts) {
        const contactIds = contacts.map(c => c.contact_id);
        this.sendToUsers(contactIds, SOCKET_EVENTS.USER_STATUS_CHANGED, {
          userId,
          isOnline
        });
      }
    } catch (error) {
      logger.error({ error, userId }, 'Update online status failed');
    }
  }

  private async updateUserPresence(userId: string, status: string): Promise<void> {
    try {
      await supabase
        .from('users')
        .update({
          presence_status: status,
          presence_updated_at: new Date().toISOString()
        })
        .eq('id', userId);

      // Broadcast a contactos
      const { data: contacts } = await supabase
        .from('user_contacts')
        .select('contact_id')
        .eq('user_id', userId);

      if (contacts) {
        const contactIds = contacts.map(c => c.contact_id);
        this.sendToUsers(contactIds, SOCKET_EVENTS.USER_PRESENCE_CHANGED, {
          userId,
          status
        });
      }
    } catch (error) {
      logger.error({ error, userId }, 'Update presence failed');
    }
  }

  private async verifyChannelAccess(userId: string, channelId: string): Promise<boolean> {
    const { data } = await supabase
      .from('mail_channel_members')
      .select('id')
      .eq('channel_id', channelId)
      .eq('user_id', userId)
      .eq('is_active', true)
      .single();

    return !!data;
  }
}

export const websocketService = new WebSocketService();

export function setupWebSockets(server: HttpServer): void {
  websocketService.initialize(server);
}
