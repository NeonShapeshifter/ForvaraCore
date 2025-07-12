import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { subscriptionService } from '../services/subscription.service';
import { tenantService } from '../services/tenant.service';
import { billingService } from '../services/billing.service';
import { notificationService } from '../services/notification.service';
import { activityService } from '../services/activity.service';
import { createApiResponse } from '../utils/responses';
import { logger } from '../config/logger';
import { ACTIVITY_ACTIONS, SubscriptionStatus } from '../constants';
import { 
  NotFoundError, 
  ValidationError, 
  AuthorizationError,
  ConflictError 
} from '../types';

export const getAvailablePlans = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { appId, includeAddons = true } = req.query;

    const plans = await subscriptionService.getAvailablePlans({
      appId: appId as string,
      includeAddons: includeAddons === 'true'
    });

    res.json(createApiResponse(
      true,
      plans,
      'Planes disponibles obtenidos'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const getCurrentSubscriptions = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const tenantId = req.tenantId!;

    const subscriptions = await subscriptionService.getTenantSubscriptions(tenantId);

    // Enriquecer con información adicional
    const enrichedSubscriptions = await Promise.all(
      subscriptions.map(async (sub) => {
        const usage = await subscriptionService.getSubscriptionUsage(sub.id);
        const nextBilling = await billingService.getNextBillingInfo(sub.id);

        return {
          ...sub,
          usage,
          next_billing: nextBilling,
          can_cancel: sub.status === SubscriptionStatus.ACTIVE,
          can_upgrade: sub.status === SubscriptionStatus.ACTIVE || 
                      sub.status === SubscriptionStatus.TRIALING
        };
      })
    );

    res.json(createApiResponse(
      true,
      enrichedSubscriptions,
      'Suscripciones actuales obtenidas'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const getUsageInfo = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const tenantId = req.tenantId!;
    const { appId } = req.query;

    const usage = await tenantService.getTenantUsage(tenantId, appId as string);
    const limits = await subscriptionService.calculateTenantLimits(
      tenantId, 
      appId as string
    );
    const analysis = subscriptionService.analyzeUsage(usage, limits);

    // Si hay alertas críticas, crear notificaciones
    const criticalAlerts = analysis.alerts.filter(a => a.type === 'critical');
    if (criticalAlerts.length > 0) {
      for (const alert of criticalAlerts) {
        await notificationService.createNotification({
          user_id: req.userId!,
          type: 'warning',
          title: 'Límite de uso excedido',
          message: alert.message,
          data: {
            resource: alert.resource,
            percentage: alert.percentage,
            action: alert.action
          }
        });
      }
    }

    res.json(createApiResponse(
      true,
      {
        usage,
        limits,
        analysis,
        recommendations: analysis.recommendations
      },
      'Información de uso obtenida'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const subscribe = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const tenantId = req.tenantId!;
    const userId = req.userId!;
    const { 
      planId, 
      billingCycle = 'monthly', 
      addons = [], 
      coupon,
      paymentMethodId 
    } = req.body;

    // Verificar que el plan existe
    const plan = await subscriptionService.getPlanById(planId);
    if (!plan) {
      throw new NotFoundError('Plan');
    }

    // Verificar si ya tiene suscripción activa para esta app
    const existingSubscription = await subscriptionService.getActiveSubscription(
      tenantId,
      plan.app_id
    );

    if (existingSubscription) {
      throw new ConflictError(
        'Ya tienes una suscripción activa para esta aplicación. Usa el endpoint de actualización.'
      );
    }

    // Verificar método de pago si no es trial
    if (plan.price_monthly > 0 && !paymentMethodId) {
      throw new ValidationError('Se requiere un método de pago');
    }

    // Crear suscripción
    const subscription = await billingService.createSubscription({
      tenant_id: tenantId,
      plan_id: planId,
      billing_cycle: billingCycle,
      addons,
      coupon,
      payment_method_id: paymentMethodId,
      created_by: userId
    });

    // Enviar email de confirmación
    const tenant = await tenantService.getTenantById(tenantId);
    const user = await userService.findById(userId);
    
    await emailService.sendSubscriptionConfirmation({
      user,
      tenant,
      subscription,
      plan
    });

    // Notificar a admins
    const admins = await tenantService.getTenantAdmins(tenantId);
    for (const admin of admins) {
      if (admin.usuario_id !== userId) {
        await notificationService.createNotification({
          user_id: admin.usuario_id,
          type: 'subscription_update',
          title: 'Nueva suscripción',
          message: `Se ha suscrito a ${plan.display_name}`,
          data: {
            subscription_id: subscription.id,
            plan_name: plan.display_name,
            app_id: plan.app_id
          }
        });
      }
    }

    // Log actividad
    await activityService.log({
      user_id: userId,
      tenant_id: tenantId,
      action: ACTIVITY_ACTIONS.SUBSCRIPTION_CREATED,
      resource_type: 'subscription',
      resource_id: subscription.id,
      details: {
        plan_id: planId,
        plan_name: plan.display_name,
        billing_cycle: billingCycle,
        price: subscription.price_monthly,
        addons_count: addons.length
      },
      ip_address: req.ip,
      user_agent: req.headers['user-agent'],
      success: true
    });

    res.status(201).json(createApiResponse(
      true,
      {
        subscription,
        plan,
        activation_url: `/apps/${plan.app_id}/activate`
      },
      'Suscripción creada exitosamente',
      `Bienvenido a ${plan.display_name}!`
    ));
  } catch (error: any) {
    throw error;
  }
};

export const getSubscriptionById = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { subscriptionId } = req.params;
    const tenantId = req.tenantId!;

    const subscription = await subscriptionService.getSubscriptionById(
      subscriptionId,
      tenantId
    );

    if (!subscription) {
      throw new NotFoundError('Suscripción');
    }

    // Obtener información adicional
    const [plan, usage, billingHistory, nextBilling] = await Promise.all([
      subscriptionService.getPlanById(subscription.plan_id!),
      subscriptionService.getSubscriptionUsage(subscriptionId),
      billingService.getBillingHistory(subscriptionId, 5),
      billingService.getNextBillingInfo(subscriptionId)
    ]);

    res.json(createApiResponse(
      true,
      {
        subscription,
        plan,
        usage,
        billing: {
          history: billingHistory,
          next_billing: nextBilling
        }
      },
      'Suscripción obtenida exitosamente'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const updateSubscription = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { subscriptionId } = req.params;
    const tenantId = req.tenantId!;
    const userId = req.userId!;
    const { planId, billingCycle, immediate = false } = req.body;

    const subscription = await subscriptionService.getSubscriptionById(
      subscriptionId,
      tenantId
    );

    if (!subscription) {
      throw new NotFoundError('Suscripción');
    }

    // Verificar que la suscripción está activa
    if (!['active', 'trialing'].includes(subscription.status)) {
      throw new ValidationError('Solo puedes actualizar suscripciones activas');
    }

    // Verificar que el nuevo plan existe
    const newPlan = await subscriptionService.getPlanById(planId);
    if (!newPlan) {
      throw new NotFoundError('Plan');
    }

    // Verificar que es para la misma app
    if (newPlan.app_id !== subscription.app_id) {
      throw new ValidationError('No puedes cambiar a un plan de otra aplicación');
    }

    // Calcular cambios y prorrateo
    const changePreview = await billingService.previewPlanChange(
      subscriptionId,
      planId,
      billingCycle || subscription.billing_cycle,
      immediate
    );

    // Si hay costo adicional, verificar método de pago
    if (changePreview.amount_due > 0) {
      const hasPaymentMethod = await billingService.hasValidPaymentMethod(tenantId);
      if (!hasPaymentMethod) {
        throw new ValidationError('Se requiere un método de pago para este cambio');
      }
    }

    // Actualizar suscripción
    const updatedSubscription = await billingService.updateSubscription(
      subscriptionId,
      {
        plan_id: planId,
        billing_cycle: billingCycle,
        immediate
      }
    );

    // Notificar al equipo
    await notificationService.createTenantNotification(
      tenantId,
      {
        type: 'subscription_update',
        title: 'Cambio de plan',
        message: `El plan de ${subscription.app_id} ha sido actualizado`,
        data: {
          subscription_id: subscriptionId,
          old_plan: subscription.plan,
          new_plan: newPlan.name,
          effective_date: immediate ? 'immediately' : 'next_billing_cycle'
        }
      }
    );

    // Log actividad
    await activityService.log({
      user_id: userId,
      tenant_id: tenantId,
      action: ACTIVITY_ACTIONS.SUBSCRIPTION_UPDATED,
      resource_type: 'subscription',
      resource_id: subscriptionId,
      details: {
        old_plan: subscription.plan,
        new_plan: newPlan.name,
        billing_cycle: billingCycle,
        immediate,
        proration_amount: changePreview.proration_amount
      },
      ip_address: req.ip,
      user_agent: req.headers['user-agent'],
      success: true
    });

    res.json(createApiResponse(
      true,
      {
        subscription: updatedSubscription,
        change_summary: changePreview
      },
      'Suscripción actualizada exitosamente'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const cancelSubscription = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { subscriptionId } = req.params;
    const tenantId = req.tenantId!;
    const userId = req.userId!;
    const { immediate = false, reason, feedback } = req.body;

    const subscription = await subscriptionService.getSubscriptionById(
      subscriptionId,
      tenantId
    );

    if (!subscription) {
      throw new NotFoundError('Suscripción');
    }

    // Verificar estado
    if (subscription.status === SubscriptionStatus.CANCELED) {
      throw new ValidationError('La suscripción ya está cancelada');
    }

    // Cancelar suscripción
    const canceledSubscription = await billingService.cancelSubscription(
      subscriptionId,
      {
        immediate,
        reason,
        feedback,
        canceled_by: userId
      }
    );

    // Guardar feedback para análisis
    if (reason || feedback) {
      await subscriptionService.saveCancellationFeedback({
        subscription_id: subscriptionId,
        tenant_id: tenantId,
        reason,
        feedback,
        canceled_at: new Date()
      });
    }

    // Notificar al equipo
    await notificationService.createTenantNotification(
      tenantId,
      {
        type: 'subscription_update',
        title: 'Suscripción cancelada',
        message: `La suscripción a ${subscription.app_id} ha sido cancelada`,
        data: {
          subscription_id: subscriptionId,
          effective_date: immediate ? 'immediately' : canceledSubscription.ends_at
        }
      }
    );

    // Log actividad
    await activityService.log({
      user_id: userId,
      tenant_id: tenantId,
      action: ACTIVITY_ACTIONS.SUBSCRIPTION_CANCELED,
      resource_type: 'subscription',
      resource_id: subscriptionId,
      details: {
        app_id: subscription.app_id,
        immediate,
        reason,
        ends_at: canceledSubscription.ends_at
      },
      ip_address: req.ip,
      user_agent: req.headers['user-agent'],
      success: true
    });

    res.json(createApiResponse(
      true,
      {
        subscription: canceledSubscription,
        ends_at: canceledSubscription.ends_at
      },
      'Suscripción cancelada exitosamente',
      immediate 
        ? 'La suscripción ha sido cancelada inmediatamente'
        : `La suscripción permanecerá activa hasta ${new Date(canceledSubscription.ends_at!).toLocaleDateString()}`
    ));
  } catch (error: any) {
    throw error;
  }
};

export const reactivateSubscription = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { subscriptionId } = req.params;
    const tenantId = req.tenantId!;
    const userId = req.userId!;

    const subscription = await subscriptionService.getSubscriptionById(
      subscriptionId,
      tenantId
    );

    if (!subscription) {
      throw new NotFoundError('Suscripción');
    }

    // Verificar que está cancelada pero aún activa
    if (subscription.status !== SubscriptionStatus.CANCELED) {
      throw new ValidationError('Solo puedes reactivar suscripciones canceladas');
    }

    if (!subscription.ends_at || new Date(subscription.ends_at) < new Date()) {
      throw new ValidationError(
        'La suscripción ya expiró. Crea una nueva suscripción.'
      );
    }

    // Reactivar
    const reactivatedSubscription = await billingService.reactivateSubscription(
      subscriptionId
    );

    // Log actividad
    await activityService.log({
      user_id: userId,
      tenant_id: tenantId,
      action: 'SUBSCRIPTION_REACTIVATED',
      resource_type: 'subscription',
      resource_id: subscriptionId,
      ip_address: req.ip,
      user_agent: req.headers['user-agent'],
      success: true
    });

    res.json(createApiResponse(
      true,
      reactivatedSubscription,
      'Suscripción reactivada exitosamente'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const addAddon = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { subscriptionId } = req.params;
    const tenantId = req.tenantId!;
    const userId = req.userId!;
    const { addonId, quantity = 1 } = req.body;

    const subscription = await subscriptionService.getSubscriptionById(
      subscriptionId,
      tenantId
    );

    if (!subscription) {
      throw new NotFoundError('Suscripción');
    }

    // Verificar addon
    const addon = await subscriptionService.getAddonById(addonId);
    if (!addon || addon.app_id !== subscription.app_id) {
      throw new NotFoundError('Addon');
    }

    // Agregar addon
    const updatedSubscription = await billingService.addSubscriptionAddon(
      subscriptionId,
      addonId,
      quantity
    );

    // Log actividad
    await activityService.log({
      user_id: userId,
      tenant_id: tenantId,
      action: ACTIVITY_ACTIONS.ADDON_ADDED,
      resource_type: 'subscription',
      resource_id: subscriptionId,
      details: {
        addon_id: addonId,
        addon_name: addon.display_name,
        quantity,
        price: addon.price_monthly * quantity
      },
      ip_address: req.ip,
      user_agent: req.headers['user-agent'],
      success: true
    });

    res.json(createApiResponse(
      true,
      updatedSubscription,
      'Addon agregado exitosamente'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const removeAddon = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { subscriptionId, addonId } = req.params;
    const tenantId = req.tenantId!;
    const userId = req.userId!;

    const subscription = await subscriptionService.getSubscriptionById(
      subscriptionId,
      tenantId
    );

    if (!subscription) {
      throw new NotFoundError('Suscripción');
    }

    // Remover addon
    const updatedSubscription = await billingService.removeSubscriptionAddon(
      subscriptionId,
      addonId
    );

    // Log actividad
    await activityService.log({
      user_id: userId,
      tenant_id: tenantId,
      action: ACTIVITY_ACTIONS.ADDON_REMOVED,
      resource_type: 'subscription',
      resource_id: subscriptionId,
      details: {
        addon_id: addonId
      },
      ip_address: req.ip,
      user_agent: req.headers['user-agent'],
      success: true
    });

    res.json(createApiResponse(
      true,
      updatedSubscription,
      'Addon removido exitosamente'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const getSubscriptionHistory = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const tenantId = req.tenantId!;
    const { page = 1, limit = 20 } = req.query;

    const result = await subscriptionService.getSubscriptionHistory(tenantId, {
      page: Number(page),
      limit: Number(limit)
    });

    res.json(createApiResponse(
      true,
      result.history,
      'Historial obtenido',
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

export const previewPlanChange = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const tenantId = req.tenantId!;
    const { currentSubscriptionId, newPlanId, billingCycle } = req.body;

    const preview = await billingService.previewPlanChange(
      currentSubscriptionId,
      newPlanId,
      billingCycle
    );

    res.json(createApiResponse(
      true,
      preview,
      'Preview generado exitosamente'
    ));
  } catch (error: any) {
    throw error;
  }
};
