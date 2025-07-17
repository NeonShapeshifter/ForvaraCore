import { supabase } from '@/config/database';
import { safeSupabaseQuery } from '@/utils/safeAsync';
import crypto from 'crypto';

interface WebhookEvent {
  id: string;
  event_type: string;
  source_app: string;
  company_id: string;
  user_id?: string;
  payload: Record<string, any>;
  metadata?: Record<string, any>;
  created_at: string;
}

interface WebhookSubscription {
  id: string;
  app_id: string;
  company_id: string;
  name: string;
  event_types: string[];
  endpoint_url: string;
  secret: string;
  status: 'active' | 'paused' | 'failed';
  retry_config: {
    max_retries: number;
    retry_delay: number;
    exponential_backoff: boolean;
  };
  filters?: Record<string, any>;
  failure_count: number;
}

export class WebhooksService {
  
  // =====================================================
  // EMIT EVENT - Apps emit events for webhook processing
  // =====================================================
  
  async emitEvent(params: {
    event_type: string;
    source_app: string;
    company_id: string;
    user_id?: string;
    payload: Record<string, any>;
    metadata?: Record<string, any>;
  }): Promise<WebhookEvent> {
    try {
      const { event_type, source_app, company_id, user_id, payload, metadata } = params;
      
      // Store event in database
      const { data: event, error } = await supabase
        .from('webhook_events')
        .insert({
          event_type,
          source_app,
          company_id,
          user_id,
          payload,
          metadata: metadata || {}
        })
        .select()
        .single();
      
      if (error) {
        throw new Error(`Failed to store webhook event: ${error.message}`);
      }
      
      // Process webhooks asynchronously (don't wait)
      this.processWebhooksAsync(event);
      
      return event;
    } catch (error: any) {
      console.error('❌ Emit webhook event error:', error);
      throw new Error(error.message || 'Failed to emit webhook event');
    }
  }
  
  // =====================================================
  // PROCESS WEBHOOKS - Send webhooks to subscribers
  // =====================================================
  
  private async processWebhooksAsync(event: WebhookEvent): Promise<void> {
    try {
      // Get subscriptions for this event type
      const subscriptions = await this.getSubscriptionsForEvent(event);
      
      // Send webhooks in parallel
      const promises = subscriptions.map(sub => this.sendWebhook(sub, event));
      await Promise.allSettled(promises);
      
    } catch (error) {
      console.error('❌ Process webhooks error:', error);
    }
  }
  
  private async getSubscriptionsForEvent(event: WebhookEvent): Promise<WebhookSubscription[]> {
    try {
      const { data: subscriptions } = await safeSupabaseQuery(
        supabase
          .from('webhook_subscriptions')
          .select('*')
          .eq('company_id', event.company_id)
          .eq('status', 'active')
          .contains('event_types', [event.event_type]),
        { data: [], error: null }
      );
      
      // Also check for wildcard subscriptions (e.g., "user.*" matches "user.created")
      const wildcardSubscriptions = await this.getWildcardSubscriptions(event);
      
      return [...(subscriptions || []), ...wildcardSubscriptions];
    } catch (error) {
      console.error('❌ Get subscriptions error:', error);
      return [];
    }
  }
  
  private async getWildcardSubscriptions(event: WebhookEvent): Promise<WebhookSubscription[]> {
    try {
      const eventPrefix = event.event_type.split('.')[0] + '.*';
      
      const { data: subscriptions } = await safeSupabaseQuery(
        supabase
          .from('webhook_subscriptions')
          .select('*')
          .eq('company_id', event.company_id)
          .eq('status', 'active')
          .contains('event_types', [eventPrefix]),
        { data: [], error: null }
      );
      
      return subscriptions || [];
    } catch (error) {
      console.error('❌ Get wildcard subscriptions error:', error);
      return [];
    }
  }
  
  private async sendWebhook(subscription: WebhookSubscription, event: WebhookEvent): Promise<void> {
    try {
      // Apply filters if any
      if (!this.passesFilters(subscription, event)) {
        return;
      }
      
      // Prepare payload
      const payload = {
        event_id: event.id,
        event_type: event.event_type,
        timestamp: event.created_at,
        source_app: event.source_app,
        data: event.payload
      };
      
      // Generate HMAC signature
      const signature = this.generateSignature(payload, subscription.secret);
      
      // Send webhook
      const response = await fetch(subscription.endpoint_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forvara-Signature': `sha256=${signature}`,
          'X-Forvara-Event': event.event_type,
          'X-Forvara-Delivery': crypto.randomUUID(),
          'User-Agent': 'Forvara-Webhooks/1.0'
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000) // 10 second timeout
      });
      
      // Log delivery
      await this.logDelivery(subscription.id, event.id, {
        status: response.ok ? 'success' : 'failed',
        response_code: response.status,
        response_body: response.ok ? 'OK' : await response.text().catch(() => 'Unknown error'),
        response_headers: Object.fromEntries(response.headers.entries())
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      // Update success stats
      await this.updateSubscriptionSuccess(subscription.id);
      
    } catch (error: any) {
      console.error(`❌ Webhook delivery failed for subscription ${subscription.id}:`, error);
      await this.handleWebhookFailure(subscription, event, error);
    }
  }
  
  private async handleWebhookFailure(
    subscription: WebhookSubscription, 
    event: WebhookEvent, 
    error: any
  ): Promise<void> {
    try {
      const newFailureCount = subscription.failure_count + 1;
      
      // Log failed delivery
      await this.logDelivery(subscription.id, event.id, {
        status: 'failed',
        error_message: error.message,
        attempts: newFailureCount
      });
      
      // Check if we should retry
      if (newFailureCount <= subscription.retry_config.max_retries) {
        // Calculate retry delay
        const baseDelay = subscription.retry_config.retry_delay;
        const delay = subscription.retry_config.exponential_backoff 
          ? Math.pow(2, newFailureCount - 1) * baseDelay
          : baseDelay;
        
        // Schedule retry
        await this.scheduleRetry(subscription.id, event.id, delay);
      } else {
        // Max retries reached, pause subscription
        await this.pauseSubscription(subscription.id);
      }
      
      // Update failure count
      await this.updateSubscriptionFailure(subscription.id, newFailureCount);
      
    } catch (retryError) {
      console.error('❌ Failed to handle webhook failure:', retryError);
    }
  }
  
  private passesFilters(subscription: WebhookSubscription, event: WebhookEvent): boolean {
    if (!subscription.filters || Object.keys(subscription.filters).length === 0) {
      return true;
    }
    
    // Simple filter implementation
    for (const [filterKey, filterValue] of Object.entries(subscription.filters)) {
      const eventValue = this.getNestedValue(event.payload, filterKey);
      
      if (Array.isArray(filterValue)) {
        if (!filterValue.includes(eventValue)) {
          return false;
        }
      } else if (eventValue !== filterValue) {
        return false;
      }
    }
    
    return true;
  }
  
  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }
  
  private generateSignature(payload: any, secret: string): string {
    const data = JSON.stringify(payload);
    return crypto.createHmac('sha256', secret).update(data).digest('hex');
  }
  
  // =====================================================
  // SUBSCRIPTION MANAGEMENT
  // =====================================================
  
  async createSubscription(params: {
    app_id: string;
    company_id: string;
    name: string;
    event_types: string[];
    endpoint_url: string;
    filters?: Record<string, any>;
    created_by: string;
  }): Promise<WebhookSubscription> {
    try {
      const { app_id, company_id, name, event_types, endpoint_url, filters, created_by } = params;
      
      // Generate secret for signature verification
      const secret = crypto.randomBytes(32).toString('hex');
      
      const { data: subscription, error } = await supabase
        .from('webhook_subscriptions')
        .insert({
          app_id,
          company_id,
          name,
          event_types,
          endpoint_url,
          secret,
          filters: filters || {},
          created_by
        })
        .select()
        .single();
      
      if (error) {
        throw new Error(`Failed to create subscription: ${error.message}`);
      }
      
      return subscription;
    } catch (error: any) {
      console.error('❌ Create subscription error:', error);
      throw new Error(error.message || 'Failed to create webhook subscription');
    }
  }
  
  async getSubscriptions(params: {
    company_id: string;
    app_id?: string;
  }): Promise<WebhookSubscription[]> {
    try {
      let query = supabase
        .from('webhook_subscriptions')
        .select('*')
        .eq('company_id', params.company_id)
        .order('created_at', { ascending: false });
      
      if (params.app_id) {
        query = query.eq('app_id', params.app_id);
      }
      
      const { data: subscriptions } = await safeSupabaseQuery(
        query,
        { data: [], error: null }
      );
      
      return subscriptions || [];
    } catch (error: any) {
      console.error('❌ Get subscriptions error:', error);
      throw new Error(error.message || 'Failed to get webhook subscriptions');
    }
  }
  
  async updateSubscription(
    subscriptionId: string, 
    updates: Partial<WebhookSubscription>
  ): Promise<WebhookSubscription> {
    try {
      const { data: subscription, error } = await supabase
        .from('webhook_subscriptions')
        .update(updates)
        .eq('id', subscriptionId)
        .select()
        .single();
      
      if (error) {
        throw new Error(`Failed to update subscription: ${error.message}`);
      }
      
      return subscription;
    } catch (error: any) {
      console.error('❌ Update subscription error:', error);
      throw new Error(error.message || 'Failed to update webhook subscription');
    }
  }
  
  async deleteSubscription(subscriptionId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('webhook_subscriptions')
        .delete()
        .eq('id', subscriptionId);
      
      if (error) {
        throw new Error(`Failed to delete subscription: ${error.message}`);
      }
    } catch (error: any) {
      console.error('❌ Delete subscription error:', error);
      throw new Error(error.message || 'Failed to delete webhook subscription');
    }
  }
  
  // =====================================================
  // DELIVERY TRACKING
  // =====================================================
  
  private async logDelivery(
    subscriptionId: string, 
    eventId: string, 
    deliveryData: any
  ): Promise<void> {
    try {
      await supabase
        .from('webhook_deliveries')
        .insert({
          subscription_id: subscriptionId,
          event_id: eventId,
          ...deliveryData
        });
    } catch (error) {
      console.error('❌ Failed to log webhook delivery:', error);
    }
  }
  
  async getDeliveries(params: {
    subscription_id?: string;
    company_id: string;
    limit?: number;
  }): Promise<any[]> {
    try {
      let query = supabase
        .from('webhook_deliveries')
        .select(`
          *,
          webhook_subscriptions!inner(company_id, name),
          webhook_events(event_type, source_app)
        `)
        .eq('webhook_subscriptions.company_id', params.company_id)
        .order('delivered_at', { ascending: false });
      
      if (params.subscription_id) {
        query = query.eq('subscription_id', params.subscription_id);
      }
      
      if (params.limit) {
        query = query.limit(params.limit);
      }
      
      const { data: deliveries } = await safeSupabaseQuery(
        query,
        { data: [], error: null }
      );
      
      return deliveries || [];
    } catch (error: any) {
      console.error('❌ Get deliveries error:', error);
      throw new Error(error.message || 'Failed to get webhook deliveries');
    }
  }
  
  // =====================================================
  // UTILITY METHODS
  // =====================================================
  
  private async updateSubscriptionSuccess(subscriptionId: string): Promise<void> {
    try {
      await supabase
        .from('webhook_subscriptions')
        .update({ 
          last_triggered: new Date().toISOString(),
          failure_count: 0 // Reset failure count on success
        })
        .eq('id', subscriptionId);
    } catch (error) {
      console.error('❌ Failed to update subscription success:', error);
    }
  }
  
  private async updateSubscriptionFailure(subscriptionId: string, failureCount: number): Promise<void> {
    try {
      await supabase
        .from('webhook_subscriptions')
        .update({ failure_count: failureCount })
        .eq('id', subscriptionId);
    } catch (error) {
      console.error('❌ Failed to update subscription failure:', error);
    }
  }
  
  private async pauseSubscription(subscriptionId: string): Promise<void> {
    try {
      await supabase
        .from('webhook_subscriptions')
        .update({ status: 'failed' })
        .eq('id', subscriptionId);
    } catch (error) {
      console.error('❌ Failed to pause subscription:', error);
    }
  }
  
  private async scheduleRetry(subscriptionId: string, eventId: string, delaySeconds: number): Promise<void> {
    try {
      const nextRetryAt = new Date(Date.now() + (delaySeconds * 1000));
      
      await supabase
        .from('webhook_deliveries')
        .update({ 
          status: 'retrying',
          next_retry_at: nextRetryAt.toISOString()
        })
        .eq('subscription_id', subscriptionId)
        .eq('event_id', eventId);
      
      // In a real implementation, you'd use a job queue here
      // For now, we'll rely on a background job to process retries
    } catch (error) {
      console.error('❌ Failed to schedule retry:', error);
    }
  }
}