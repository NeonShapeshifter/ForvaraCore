import { Router } from 'express'
import { success, error } from '../utils/responses.js'
import { safeAsync } from '../utils/safeAsync.js'
import { authenticate } from '../middleware/auth.js'
import { individualOrCompanyMode } from '../middleware/tenant.js'
import { AuthRequest } from '../types/index.js'
import { supabase } from '../config/database.js'

const router = Router()

// All analytics endpoints require auth
router.use(authenticate)
router.use(individualOrCompanyMode)

// GET /api/analytics - Get company analytics
router.get('/', safeAsync(async (req: AuthRequest, res) => {
  try {
    const { range = '7d' } = req.query

    if (req.user?.is_individual_mode) {
      // Individual mode analytics
      const analytics = {
        overview: {
          total_users: 1,
          active_users_7d: 1,
          total_apps: 0,
          active_subscriptions: 0,
          monthly_revenue: 0,
          storage_used_gb: 0.5
        },
        trends: {
          users_growth: 0,
          revenue_growth: 0,
          apps_growth: 0
        },
        activity: Array.from({ length: 7 }, (_, i) => {
          const date = new Date()
          date.setDate(date.getDate() - (6 - i))
          return {
            date: date.toISOString().split('T')[0],
            users: 1,
            revenue: 0,
            apps_used: 0
          }
        }),
        top_apps: []
      }

      // Get personal subscriptions
      const { data: personalSubs } = await supabase
        .from('subscriptions')
        .select('id, price_monthly')
        .eq('user_id', req.user.id)
        .eq('status', 'active')

      if (personalSubs) {
        analytics.overview.total_apps = personalSubs.length
        analytics.overview.active_subscriptions = personalSubs.length
        analytics.overview.monthly_revenue = personalSubs.reduce((sum, sub) => {
          return sum + (sub.price_monthly || 0)
        }, 0) * 100
      }

      return success(res, analytics)
    }

    const companyId = req.user?.company_id
    if (!companyId) {
      return error(res, 'Company ID required', 400)
    }

    // Mock analytics data for now (would be calculated from real data)
    const analytics = {
      overview: {
        total_users: 0,
        active_users_7d: 0,
        total_apps: 0,
        active_subscriptions: 0,
        monthly_revenue: 0,
        storage_used_gb: 0
      },
      trends: {
        users_growth: 0,
        revenue_growth: 0,
        apps_growth: 0
      },
      activity: [],
      top_apps: []
    }

    // Get total users
    const { data: members, error: membersError } = await supabase
      .from('company_members')
      .select('id')
      .eq('company_id', companyId)
      .eq('status', 'active')

    if (!membersError && members) {
      analytics.overview.total_users = members.length
    }

    // Get installed apps
    const { data: apps, error: appsError } = await supabase
      .from('app_installations')
      .select('id, app_id')
      .eq('company_id', companyId)
      .eq('status', 'active')

    if (!appsError && apps) {
      analytics.overview.total_apps = apps.length
    }

    // Get active subscriptions
    const { data: subscriptions, error: subsError } = await supabase
      .from('subscriptions')
      .select('id, price_monthly')
      .eq('company_id', companyId)
      .eq('status', 'active')

    if (!subsError && subscriptions) {
      analytics.overview.active_subscriptions = subscriptions.length
      analytics.overview.monthly_revenue = subscriptions.reduce((sum, sub) => {
        return sum + (sub.price_monthly || 0)
      }, 0) * 100 // Convert to cents
    }

    // Get company storage info
    const { data: company, error: companyError } = await supabase
      .from('companies')
      .select('storage_used_bytes')
      .eq('id', companyId)
      .single()

    if (!companyError && company) {
      analytics.overview.storage_used_gb = (company.storage_used_bytes || 0) / (1024 * 1024 * 1024)
    }

    // Calculate mock trends (in real app, compare with previous period)
    analytics.trends = {
      users_growth: 15.2,
      revenue_growth: 23.1,
      apps_growth: 8.7
    }

    // Mock activity data for the chart
    const days = range === '7d' ? 7 : range === '30d' ? 30 : 90
    const today = new Date()
    analytics.activity = Array.from({ length: Math.min(days, 7) }, (_, i) => {
      const date = new Date(today)
      date.setDate(date.getDate() - (6 - i))
      return {
        date: date.toISOString().split('T')[0],
        users: Math.floor(Math.random() * 5) + analytics.overview.total_users,
        revenue: i % 3 === 0 ? Math.floor(Math.random() * 200) * 100 : 0,
        apps_used: Math.floor(Math.random() * analytics.overview.total_apps) + 1
      }
    })

    // Mock top apps
    if (apps && apps.length > 0) {
      analytics.top_apps = [
        { app_name: 'Elaris ERP', usage_count: 87, revenue: 19800 },
        { app_name: 'ForvaraMail', usage_count: 56, revenue: 9900 },
        { app_name: 'Analytics Pro', usage_count: 23, revenue: 0 }
      ].slice(0, analytics.overview.total_apps)
    }

    return success(res, analytics)
  } catch (err: any) {
    console.error('Analytics error:', err)
    return error(res, err.message || 'Failed to get analytics', 500)
  }
}))

export { router as analyticsRoutes }