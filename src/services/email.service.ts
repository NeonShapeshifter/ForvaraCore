import nodemailer from 'nodemailer';
import handlebars from 'handlebars';
import path from 'path';
import fs from 'fs/promises';
import { config } from '../config';
import { logger } from '../config/logger';
import { getSupabase } from '../config/database';
import { EmailTemplate, EmailAttachment } from '../types';

let supabase: any = null;

function ensureSupabase() {
  if (!supabase) {
    supabase = getSupabase();
  }
  return supabase;
}

class EmailService {
  private transporter: nodemailer.Transporter;
  private templates: Map<string, handlebars.TemplateDelegate> = new Map();
  private readonly templatesDir = path.join(__dirname, '../../templates/emails');

  constructor() {
    // Configurar transporter
    this.transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      auth: {
        user: config.SMTP_USER,
        pass: config.SMTP_PASS
      },
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      rateDelta: 1000,
      rateLimit: 5
    });

    // Verificar conexión
    this.verifyConnection();

    // Cargar templates
    this.loadTemplates();

    // Registrar helpers de Handlebars
    this.registerHelpers();
  }

  /**
   * Enviar email
   */
  async sendEmail(params: {
    to: string | string[];
    subject: string;
    html?: string;
    text?: string;
    template?: string;
    data?: any;
    from?: string;
    replyTo?: string;
    cc?: string | string[];
    bcc?: string | string[];
    attachments?: EmailAttachment[];
    headers?: Record<string, string>;
  }): Promise<any> {
    try {
      const {
        to,
        subject,
        html,
        text,
        template,
        data = {},
        from = config.EMAIL_FROM,
        replyTo,
        cc,
        bcc,
        attachments,
        headers
      } = params;

      // Generar HTML si se usa template
      let htmlContent = html;
      if (template && !html) {
        htmlContent = await this.renderTemplate(template, data);
      }

      // Generar texto plano si no se proporciona
      let textContent = text;
      if (!text && htmlContent) {
        textContent = this.htmlToText(htmlContent);
      }

      // Preparar opciones de email
      const mailOptions: nodemailer.SendMailOptions = {
        from: from || `Forvara <${config.EMAIL_FROM}>`,
        to: Array.isArray(to) ? to.join(', ') : to,
        subject,
        html: htmlContent,
        text: textContent,
        replyTo,
        cc,
        bcc,
        attachments: attachments?.map(att => ({
          filename: att.filename,
          content: att.content,
          contentType: att.contentType,
          encoding: att.encoding || 'base64',
          cid: att.cid
        })),
        headers: {
          'X-Mailer': 'Forvara Mailer',
          'X-Priority': '3',
          ...headers
        }
      };

      // Enviar email
      const result = await this.transporter.sendMail(mailOptions);

      // Registrar envío
      await this.logEmailSent({
        to: Array.isArray(to) ? to : [to],
        subject,
        template,
        messageId: result.messageId,
        response: result.response
      });

      logger.info({ 
        messageId: result.messageId,
        to,
        subject,
        template 
      }, 'Email sent successfully');

      return result;
    } catch (error) {
      logger.error({ error, params }, 'Send email failed');
      
      // Registrar fallo
      await this.logEmailFailed({
        to: Array.isArray(params.to) ? params.to : [params.to],
        subject: params.subject,
        template: params.template,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      throw error;
    }
  }

  /**
   * Enviar email de bienvenida
   */
  async sendWelcomeEmail(user: {
    id: string;
    email: string;
    nombre: string;
    forvara_mail: string;
  }): Promise<void> {
    await this.sendEmail({
      to: user.email,
      subject: 'Bienvenido a Forvara',
      template: 'welcome',
      data: {
        userName: user.nombre,
        forvaraMail: user.forvara_mail,
        loginUrl: `${config.FRONTEND_URL}/login`,
        supportEmail: config.SUPPORT_EMAIL
      }
    });
  }

  /**
   * Enviar email de verificación
   */
  async sendVerificationEmail(
    email: string,
    code: string,
    userName: string
  ): Promise<void> {
    await this.sendEmail({
      to: email,
      subject: 'Verifica tu email - Forvara',
      template: 'email-verification',
      data: {
        userName,
        verificationCode: code,
        verificationUrl: `${config.FRONTEND_URL}/verify-email?code=${code}`,
        expiresIn: '24 horas'
      }
    });
  }

  /**
   * Enviar email de restablecimiento de contraseña
   */
  async sendPasswordResetEmail(
    email: string,
    resetToken: string,
    userName: string
  ): Promise<void> {
    await this.sendEmail({
      to: email,
      subject: 'Restablecer contraseña - Forvara',
      template: 'password-reset',
      data: {
        userName,
        resetUrl: `${config.FRONTEND_URL}/reset-password?token=${resetToken}`,
        expiresIn: '1 hora',
        supportEmail: config.SUPPORT_EMAIL
      }
    });
  }

  /**
   * Enviar email de notificación
   */
  async sendNotificationEmail(
    userId: string,
    type: string,
    data: any
  ): Promise<void> {
    // Obtener usuario y preferencias
    const { data: user } = await ensureSupabase()
      .from('users')
      .select('email, nombre, notification_preferences')
      .eq('id', userId)
      .single();

    if (!user?.email) return;

    // Verificar si el usuario quiere recibir este tipo de notificación
    const preferences = user.notification_preferences || {};
    if (!preferences[type]) return;

    // Mapear tipo de notificación a template
    const templateMap: Record<string, string> = {
      'new_message': 'notification-message',
      'file_shared': 'notification-file',
      'mention': 'notification-mention',
      'subscription_expiring': 'notification-subscription',
      'team_invite': 'notification-invite'
    };

    const template = templateMap[type] || 'notification-generic';

    await this.sendEmail({
      to: user.email,
      subject: this.getNotificationSubject(type, data),
      template,
      data: {
        userName: user.nombre,
        ...data,
        actionUrl: `${config.FRONTEND_URL}/notifications`,
        unsubscribeUrl: `${config.FRONTEND_URL}/settings/notifications`
      }
    });
  }

  /**
   * Enviar email de factura
   */
  async sendInvoiceEmail(
    tenantId: string,
    invoice: {
      number: string;
      amount: number;
      currency: string;
      date: Date;
      pdfUrl: string;
    }
  ): Promise<void> {
    // Obtener datos del tenant
    const { data: tenant } = await ensureSupabase()
      .from('tenants')
      .select('email, razon_social, owner_id')
      .eq('id', tenantId)
      .single();

    if (!tenant?.email) return;

    await this.sendEmail({
      to: tenant.email,
      subject: `Factura ${invoice.number} - Forvara`,
      template: 'invoice',
      data: {
        companyName: tenant.razon_social,
        invoiceNumber: invoice.number,
        amount: this.formatCurrency(invoice.amount, invoice.currency),
        date: invoice.date.toLocaleDateString(),
        downloadUrl: invoice.pdfUrl,
        billingUrl: `${config.FRONTEND_URL}/billing`
      }
    });
  }

  /**
   * Enviar resumen diario
   */
  async sendDailySummary(
    userId: string,
    summary: {
      notifications: number;
      messages: number;
      tasks: number;
      highlights: string[];
    }
  ): Promise<void> {
    const { data: user } = await ensureSupabase()
      .from('users')
      .select('email, nombre')
      .eq('id', userId)
      .single();

    if (!user?.email) return;

    await this.sendEmail({
      to: user.email,
      subject: 'Tu resumen diario - Forvara',
      template: 'daily-summary',
      data: {
        userName: user.nombre,
        date: new Date().toLocaleDateString(),
        ...summary,
        dashboardUrl: `${config.FRONTEND_URL}/dashboard`
      }
    });
  }

  /**
   * Renderizar template
   */
  private async renderTemplate(
    templateName: string,
    data: any
  ): Promise<string> {
    try {
      // Obtener template compilado
      let template = this.templates.get(templateName);

      if (!template) {
        // Cargar y compilar si no está en cache
        const templatePath = path.join(this.templatesDir, `${templateName}.hbs`);
        const templateContent = await fs.readFile(templatePath, 'utf-8');
        template = handlebars.compile(templateContent);
        this.templates.set(templateName, template);
      }

      // Datos globales para todos los templates
      const globalData = {
        appName: 'Forvara',
        appUrl: config.FRONTEND_URL,
        logoUrl: `${config.FRONTEND_URL}/logo.png`,
        currentYear: new Date().getFullYear(),
        supportEmail: config.SUPPORT_EMAIL,
        ...data
      };

      return template(globalData);
    } catch (error) {
      logger.error({ error, templateName }, 'Render template failed');
      throw new Error(`Failed to render template: ${templateName}`);
    }
  }

  /**
   * Cargar todos los templates
   */
  private async loadTemplates(): Promise<void> {
    try {
      // Cargar layout base
      const layoutPath = path.join(this.templatesDir, 'layout.hbs');
      const layoutContent = await fs.readFile(layoutPath, 'utf-8');
      handlebars.registerPartial('layout', layoutContent);

      // Cargar partials
      const partialsDir = path.join(this.templatesDir, 'partials');
      const partialFiles = await fs.readdir(partialsDir);
      
      for (const file of partialFiles) {
        if (file.endsWith('.hbs')) {
          const name = path.basename(file, '.hbs');
          const content = await fs.readFile(
            path.join(partialsDir, file),
            'utf-8'
          );
          handlebars.registerPartial(name, content);
        }
      }

      logger.info('Email templates loaded successfully');
    } catch (error) {
      logger.error({ error }, 'Load templates failed');
    }
  }

  /**
   * Registrar helpers de Handlebars
   */
  private registerHelpers(): void {
    // Helper para formatear fechas
    handlebars.registerHelper('formatDate', (date: Date | string) => {
      return new Date(date).toLocaleDateString('es-ES', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    });

    // Helper para formatear moneda
    handlebars.registerHelper('formatCurrency', (amount: number, currency: string = 'USD') => {
      return new Intl.NumberFormat('es-ES', {
        style: 'currency',
        currency
      }).format(amount);
    });

    // Helper para condicionales
    handlebars.registerHelper('ifEquals', function(arg1: any, arg2: any, options: any) {
      return arg1 === arg2 ? options.fn(this) : options.inverse(this);
    });

    // Helper para URLs
    handlebars.registerHelper('url', (path: string) => {
      return `${config.FRONTEND_URL}${path}`;
    });
  }

  /**
   * Convertir HTML a texto plano
   */
  private htmlToText(html: string): string {
    return html
      .replace(/<style[^>]*>.*?<\/style>/gi, '')
      .replace(/<script[^>]*>.*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Verificar conexión SMTP
   */
  private async verifyConnection(): Promise<void> {
    try {
      await this.transporter.verify();
      logger.info('SMTP connection verified');
    } catch (error) {
logger.error({ error }, 'SMTP connection failed');
   }
 }

 /**
  * Registrar email enviado
  */
 private async logEmailSent(data: {
   to: string[];
   subject: string;
   template?: string;
   messageId: string;
   response: string;
 }): Promise<void> {
   try {
     await ensureSupabase()
       .from('email_logs')
       .insert({
         to: data.to,
         subject: data.subject,
         template: data.template,
         message_id: data.messageId,
         status: 'sent',
         response: data.response,
         sent_at: new Date().toISOString()
       });
   } catch (error) {
     logger.error({ error, data }, 'Log email sent failed');
   }
 }

 /**
  * Registrar email fallido
  */
 private async logEmailFailed(data: {
   to: string[];
   subject: string;
   template?: string;
   error: string;
 }): Promise<void> {
   try {
     await ensureSupabase()
       .from('email_logs')
       .insert({
         to: data.to,
         subject: data.subject,
         template: data.template,
         status: 'failed',
         error: data.error,
         failed_at: new Date().toISOString()
       });
   } catch (error) {
     logger.error({ error, data }, 'Log email failed failed');
   }
 }

 /**
  * Obtener subject de notificación
  */
 private getNotificationSubject(type: string, data: any): string {
   const subjects: Record<string, string> = {
     'new_message': `Nuevo mensaje de ${data.senderName}`,
     'file_shared': `${data.fileName} compartido contigo`,
     'mention': `${data.senderName} te mencionó`,
     'subscription_expiring': 'Tu suscripción está por expirar',
     'team_invite': `Invitación a ${data.teamName}`
   };

   return subjects[type] || 'Nueva notificación - Forvara';
 }

 /**
  * Formatear moneda
  */
 private formatCurrency(amount: number, currency: string): string {
   return new Intl.NumberFormat('es-ES', {
     style: 'currency',
     currency
   }).format(amount);
 }

 /**
  * Enviar email de prueba
  */
 async sendTestEmail(to: string): Promise<void> {
   await this.sendEmail({
     to,
     subject: 'Email de prueba - Forvara',
     template: 'test',
     data: {
       timestamp: new Date().toISOString(),
       environment: config.NODE_ENV
     }
   });
 }

 /**
  * Obtener estadísticas de emails
  */
 async getEmailStats(days: number = 30): Promise<{
   sent: number;
   failed: number;
   opened: number;
   clicked: number;
   bounced: number;
 }> {
   const startDate = new Date();
   startDate.setDate(startDate.getDate() - days);

   const { data } = await ensureSupabase()
     .from('email_logs')
     .select('status, opened_at, clicked_at, bounced_at')
     .gte('created_at', startDate.toISOString());

   const stats = {
     sent: 0,
     failed: 0,
     opened: 0,
     clicked: 0,
     bounced: 0
   };

   data?.forEach(log => {
     if (log.status === 'sent') stats.sent++;
     if (log.status === 'failed') stats.failed++;
     if (log.opened_at) stats.opened++;
     if (log.clicked_at) stats.clicked++;
     if (log.bounced_at) stats.bounced++;
   });

   return stats;
 }
}

export const emailService = new EmailService();
