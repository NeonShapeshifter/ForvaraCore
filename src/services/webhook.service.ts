import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { getSupabase } from '../config/database';
import { getRedis } from '../config/redis';
import { logger } from '../config/logger';
import { NotFoundError, ValidationError } from '../types';
// Using native fetch instead of axios

interface Webhook {
  id: string;
  tenant_id: string;
  app_id?: string;
  url: string;
  events: string[];
  secret?: string;
  is_active: boolean;
  created_at: string;
  last_triggered_at?: string;
}

interface WebhookEvent {
  id: string;
  type: string;
  data: any;
  tenant_id: string;
  app_id?: string;
  timestamp: string;
}

interface WebhookDelivery {
  webhook_id: string;
  event_id: string;
  status: 'pending' | 'success' | 'failed';
  attempts: number;
  response_status?: number;
  response_body?: string;
  delivered_at?: string;
}

class WebhookService {
  private supabase = getSupabase();
  private redis = getRedis();

  async createWebhook(tenantId: string, webhook: Partial<Webhook>) {
    try {
      const id = uuidv4();
      const secret = webhook.secret || this.generateSecret();

      const { data, error } = await this.supabase
        .from('webhooks')
        .insert({
          id,
          tenant_id: tenantId,
          app_id: webhook.app_id,
          url: webhook.url,
          events: webhook.events || [],
          secret,
          is_active: webhook.is_active ?? true,
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;

      await this.redis.del(`webhooks:${tenantId}:*`);
      return data;
    } catch (error) {
      logger.error('Create webhook failed:', error);
      throw error;
    }
  }

  async getWebhooks(tenantId: string, appId?: string) {
    try {
      const cacheKey = `webhooks:${tenantId}:${appId || 'all'}`;
      const cached = await this.redis.get(cacheKey);
      if (cached) return JSON.parse(cached);

      let query = this.supabase
        .from('webhooks')
        .select('*')
        .eq('tenant_id', tenantId);

      if (appId) {
        query = query.eq('app_id', appId);
      }

      const { data, error } = await query;
      if (error) throw error;

      await this.redis.setex(cacheKey, 300, JSON.stringify(data));
      return data;
    } catch (error) {
      logger.error('Get webhooks failed:', error);
      throw error;
    }
  }

  async updateWebhook(webhookId: string, updates: Partial<Webhook>) {
    try {
      const { data, error } = await this.supabase
        .from('webhooks')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('id', webhookId)
        .select()
        .single();

      if (error) throw error;

      await this.redis.del(`webhooks:*`);
      return data;
    } catch (error) {
      logger.error('Update webhook failed:', error);
      throw error;
    }
  }

  async deleteWebhook(webhookId: string) {
    try {
      const { error } = await this.supabase
        .from('webhooks')
        .delete()
        .eq('id', webhookId);

      if (error) throw error;

      await this.redis.del(`webhooks:*`);
      return { success: true };
    } catch (error) {
      logger.error('Delete webhook failed:', error);
      throw error;
    }
  }

  async triggerWebhook(event: WebhookEvent) {
    try {
      // Get all active webhooks for this event type
      const { data: webhooks } = await this.supabase
        .from('webhooks')
        .select('*')
        .eq('tenant_id', event.tenant_id)
        .eq('is_active', true)
        .contains('events', [event.type]);

      if (!webhooks || webhooks.length === 0) {
        return { triggered: 0 };
      }

      // Queue webhook deliveries
      const deliveries = await Promise.all(
        webhooks.map(webhook => this.queueDelivery(webhook, event))
      );

      return { triggered: deliveries.length };
    } catch (error) {
      logger.error('Trigger webhook failed:', error);
      throw error;
    }
  }

  private async queueDelivery(webhook: Webhook, event: WebhookEvent) {
    try {
      const deliveryId = uuidv4();
      
      const { error } = await this.supabase
        .from('webhook_deliveries')
        .insert({
          id: deliveryId,
          webhook_id: webhook.id,
          event_id: event.id,
          status: 'pending',
          attempts: 0,
          created_at: new Date().toISOString()
        });

      if (error) throw error;

      // Process immediately (in production, use a queue)
      this.processDelivery(deliveryId, webhook, event);

      return deliveryId;
    } catch (error) {
      logger.error('Queue delivery failed:', error);
      throw error;
    }
  }

  private async processDelivery(deliveryId: string, webhook: Webhook, event: WebhookEvent) {
    try {
      const payload = {
        id: event.id,
        type: event.type,
        created: event.timestamp,
        data: event.data
      };

      const signature = this.generateSignature(JSON.stringify(payload), webhook.secret || '');

      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forvara-Signature': signature,
          'X-Forvara-Event': event.type
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000)
      });

      const success = response.status >= 200 && response.status < 300;
      const responseText = await response.text();

      await this.supabase
        .from('webhook_deliveries')
        .update({
          status: success ? 'success' : 'failed',
          attempts: 1,
          response_status: response.status,
          response_body: responseText.substring(0, 1000),
          delivered_at: new Date().toISOString()
        })
        .eq('id', deliveryId);

      await this.supabase
        .from('webhooks')
        .update({
          last_triggered_at: new Date().toISOString()
        })
        .eq('id', webhook.id);

    } catch (error) {
      logger.error('Process delivery failed:', error);
      
      await this.supabase
        .from('webhook_deliveries')
        .update({
          status: 'failed',
          attempts: 1,
          response_body: error.message
        })
        .eq('id', deliveryId);
    }
  }

  private generateSecret(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  private generateSignature(payload: string, secret: string): string {
    return crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
  }

  async verifySignature(payload: string, signature: string, secret: string): boolean {
    const expectedSignature = this.generateSignature(payload, secret);
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }
}

export const webhookService = new WebhookService();