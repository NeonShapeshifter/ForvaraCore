import { Router } from 'express';
import { success, error } from '@/utils/responses';
import { safeAsync } from '@/utils/safeAsync';
import { requireAdmin } from '@/middleware/auth';
import { AuthRequest } from '@/types/index.js';
import { supabase } from '@/config/database';
import { safeSupabaseQuery } from '@/utils/safeAsync';

const router = Router();

// All security routes require admin authentication
router.use(requireAdmin);

// =====================================================
// SECURITY DASHBOARD
// =====================================================

router.get('/dashboard', safeAsync(async (req: AuthRequest, res: any) => {
  try {
    const { period = '7d' } = req.query;
    const days = period === '7d' ? 7 : period === '30d' ? 30 : 1;
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Get security events summary
    const { data: securityEvents } = await safeSupabaseQuery(
      supabase
        .from('security_logs')
        .select('event_type, created_at, details')
        .gte('created_at', startDate)
        .order('created_at', { ascending: false })
        .limit(100),
      { data: [], error: null }
    );

    // Count events by type
    const eventCounts = securityEvents?.reduce((acc: any, event: any) => {
      acc[event.event_type] = (acc[event.event_type] || 0) + 1;
      return acc;
    }, {}) || {};

    // Get failed login attempts
    const failedLogins = securityEvents?.filter((e: any) => 
      e.event_type.includes('login_failed') || 
      e.event_type.includes('invalid_password') ||
      e.event_type.includes('invalid_token')
    ).length || 0;

    // Get new device logins
    const newDeviceLogins = securityEvents?.filter((e: any) => 
      e.event_type === 'new_device_login'
    ).length || 0;

    // Get password reset attempts
    const passwordResets = securityEvents?.filter((e: any) => 
      e.event_type.includes('password_reset')
    ).length || 0;

    // Get suspicious IPs (more than 5 failed attempts)
    const ipAttempts: { [key: string]: number } = {};
    securityEvents?.forEach((event: any) => {
      if (event.details?.ip && (
        event.event_type.includes('login_failed') || 
        event.event_type.includes('invalid')
      )) {
        ipAttempts[event.details.ip] = (ipAttempts[event.details.ip] || 0) + 1;
      }
    });

    const suspiciousIPs = Object.entries(ipAttempts)
      .filter(([ip, count]) => count >= 5)
      .map(([ip, count]) => ({ ip, attempts: count }));

    // Get active devices summary
    const { data: activeDevices } = await safeSupabaseQuery(
      supabase
        .from('user_devices')
        .select('device_name, browser, os, location, last_seen, user_id, users(first_name, last_name, email)')
        .gte('last_seen', startDate)
        .order('last_seen', { ascending: false }),
      { data: [], error: null }
    );

    return success(res, {
      overview: {
        total_events: securityEvents?.length || 0,
        failed_logins: failedLogins,
        new_device_logins: newDeviceLogins,
        password_resets: passwordResets,
        suspicious_ips: suspiciousIPs.length
      },
      event_counts: eventCounts,
      suspicious_ips: suspiciousIPs,
      recent_events: securityEvents?.slice(0, 20) || [],
      active_devices: activeDevices?.slice(0, 50) || [],
      period
    });
  } catch (err: any) {
    return error(res, err.message, 500);
  }
}));

// =====================================================
// SECURITY EVENTS
// =====================================================

router.get('/events', safeAsync(async (req: AuthRequest, res: any) => {
  try {
    const { page = 1, limit = 50, event_type, user_id, ip } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let query = supabase
      .from('security_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1);

    if (event_type) {
      query = query.eq('event_type', event_type);
    }

    if (user_id) {
      query = query.eq('details->user_id', user_id);
    }

    if (ip) {
      query = query.eq('details->ip', ip);
    }

    const { data: events } = await safeSupabaseQuery(query, { data: [], error: null });

    const { data: totalCount } = await safeSupabaseQuery(
      supabase.from('security_logs').select('id', { count: 'exact' }),
      { data: [], error: null }
    );

    return success(res, {
      events: events || [],
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: totalCount?.length || 0,
        pages: Math.ceil((totalCount?.length || 0) / Number(limit))
      }
    });
  } catch (err: any) {
    return error(res, err.message, 500);
  }
}));

// =====================================================
// USER DEVICES
// =====================================================

router.get('/devices', safeAsync(async (req: AuthRequest, res: any) => {
  try {
    const { page = 1, limit = 50, user_id } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let query = supabase
      .from('user_devices')
      .select(`
        *, 
        users(first_name, last_name, email)
      `)
      .order('last_seen', { ascending: false })
      .range(offset, offset + Number(limit) - 1);

    if (user_id) {
      query = query.eq('user_id', user_id);
    }

    const { data: devices } = await safeSupabaseQuery(query, { data: [], error: null });

    return success(res, {
      devices: devices || []
    });
  } catch (err: any) {
    return error(res, err.message, 500);
  }
}));

// =====================================================
// DEVICE ACTIONS
// =====================================================

router.post('/devices/:id/trust', safeAsync(async (req: AuthRequest, res: any) => {
  try {
    const { id } = req.params;
    const { trusted } = req.body;

    const { data: device, error: updateError } = await supabase
      .from('user_devices')
      .update({ is_trusted: trusted })
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      return error(res, `Failed to update device trust: ${updateError.message}`, 500);
    }

    return success(res, {
      device,
      message: `Device ${trusted ? 'trusted' : 'untrusted'} successfully`
    });
  } catch (err: any) {
    return error(res, err.message, 500);
  }
}));

router.delete('/devices/:id', safeAsync(async (req: AuthRequest, res: any) => {
  try {
    const { id } = req.params;

    const { error: deleteError } = await supabase
      .from('user_devices')
      .delete()
      .eq('id', id);

    if (deleteError) {
      return error(res, `Failed to delete device: ${deleteError.message}`, 500);
    }

    return success(res, { message: 'Device deleted successfully' });
  } catch (err: any) {
    return error(res, err.message, 500);
  }
}));

// =====================================================
// IP BLOCKING
// =====================================================

router.post('/block-ip', safeAsync(async (req: AuthRequest, res: any) => {
  try {
    const { ip, reason, duration_hours = 24 } = req.body;

    if (!ip) {
      return error(res, 'IP address is required', 400);
    }

    const expiresAt = new Date(Date.now() + duration_hours * 60 * 60 * 1000);

    const { data: blockedIp, error: insertError } = await supabase
      .from('blocked_ips')
      .insert({
        ip_address: ip,
        reason: reason || 'Suspicious activity',
        blocked_by: req.user!.id,
        expires_at: expiresAt.toISOString(),
        is_active: true
      })
      .select()
      .single();

    if (insertError) {
      return error(res, `Failed to block IP: ${insertError.message}`, 500);
    }

    return success(res, {
      blocked_ip: blockedIp,
      message: 'IP blocked successfully'
    });
  } catch (err: any) {
    return error(res, err.message, 500);
  }
}));

router.get('/blocked-ips', safeAsync(async (req: AuthRequest, res: any) => {
  try {
    const { data: blockedIps } = await safeSupabaseQuery(
      supabase
        .from('blocked_ips')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false }),
      { data: [], error: null }
    );

    return success(res, { blocked_ips: blockedIps || [] });
  } catch (err: any) {
    return error(res, err.message, 500);
  }
}));

export { router as securityRoutes };