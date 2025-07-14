import nodemailer from 'nodemailer'

interface EmailOptions {
  to: string
  subject: string
  html: string
  text?: string
}

interface InvitationEmailData {
  inviterName: string
  companyName: string
  role: string
  inviteLink: string
  expiresAt: string
}

export class EmailService {
  private transporter: nodemailer.Transporter | null = null

  constructor() {
    this.initializeTransporter()
  }

  private initializeTransporter() {
    const {
      SMTP_HOST,
      SMTP_PORT,
      SMTP_USER,
      SMTP_PASS,
      SMTP_FROM,
      ENABLE_EMAIL
    } = process.env

    if (ENABLE_EMAIL !== 'true') {
      console.log('📧 Email service disabled (ENABLE_EMAIL=false)')
      return
    }

    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
      console.log('⚠️  Email service not configured (missing SMTP credentials)')
      return
    }

    try {
      this.transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: parseInt(SMTP_PORT || '587'),
        secure: parseInt(SMTP_PORT || '587') === 465,
        auth: {
          user: SMTP_USER,
          pass: SMTP_PASS,
        },
        from: SMTP_FROM || SMTP_USER,
      })

      console.log('✅ Email service initialized successfully')
    } catch (error) {
      console.error('❌ Failed to initialize email service:', error)
    }
  }

  async sendEmail(options: EmailOptions): Promise<boolean> {
    if (!this.transporter) {
      console.log('📧 Email service not available - email would be sent to:', options.to)
      return false
    }

    try {
      const info = await this.transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      })

      console.log('✅ Email sent successfully:', info.messageId)
      return true
    } catch (error) {
      console.error('❌ Failed to send email:', error)
      return false
    }
  }

  async sendInvitationEmail(
    email: string,
    data: InvitationEmailData
  ): Promise<boolean> {
    const { inviterName, companyName, role, inviteLink, expiresAt } = data

    const subject = `Invitación a ${companyName} en Forvara`
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Invitación a ${companyName}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { text-align: center; margin-bottom: 30px; }
          .logo { font-size: 24px; font-weight: bold; color: #2563eb; }
          .card { background: #f8fafc; border-radius: 8px; padding: 20px; margin: 20px 0; }
          .button { display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 500; }
          .footer { text-align: center; margin-top: 30px; color: #64748b; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">🚀 Forvara</div>
            <h1>Invitación a ${companyName}</h1>
          </div>

          <p>Hola,</p>
          
          <p><strong>${inviterName}</strong> te ha invitado a unirte a <strong>${companyName}</strong> en Forvara como <strong>${role}</strong>.</p>

          <div class="card">
            <h3>¿Qué es Forvara?</h3>
            <p>Forvara es una plataforma empresarial completa diseñada para PyMEs de LATAM. Gestiona tu equipo, aplicaciones y procesos desde un solo lugar.</p>
          </div>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${inviteLink}" class="button">Aceptar Invitación</a>
          </div>

          <p style="color: #ef4444; font-size: 14px;">
            ⏰ Esta invitación expira el ${new Date(expiresAt).toLocaleDateString('es-PA', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })}
          </p>

          <div class="footer">
            <p>Si no esperabas esta invitación, puedes ignorar este email.</p>
            <p>© 2025 Forvara - Hecho con ❤️ para LATAM</p>
          </div>
        </div>
      </body>
      </html>
    `

    const text = `
      Invitación a ${companyName} en Forvara
      
      Hola,
      
      ${inviterName} te ha invitado a unirte a ${companyName} en Forvara como ${role}.
      
      Acepta tu invitación aquí: ${inviteLink}
      
      Esta invitación expira el ${new Date(expiresAt).toLocaleDateString('es-PA')}.
      
      Si no esperabas esta invitación, puedes ignorar este email.
      
      © 2025 Forvara
    `

    return this.sendEmail({
      to: email,
      subject,
      html,
      text,
    })
  }

  async sendWelcomeEmail(email: string, name: string, companyName: string): Promise<boolean> {
    const subject = `¡Bienvenido a ${companyName} en Forvara! 🚀`
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Bienvenido a Forvara</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { text-align: center; margin-bottom: 30px; }
          .logo { font-size: 24px; font-weight: bold; color: #2563eb; }
          .card { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 20px; margin: 20px 0; }
          .button { display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 500; }
          .footer { text-align: center; margin-top: 30px; color: #64748b; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">🚀 Forvara</div>
            <h1>¡Bienvenido, ${name}! 👋</h1>
          </div>

          <p>Nos complace darte la bienvenida a <strong>${companyName}</strong> en Forvara.</p>

          <div class="card">
            <h3>🎉 Ya eres parte del equipo</h3>
            <p>Ahora puedes acceder a todas las aplicaciones y herramientas de tu empresa desde un solo lugar.</p>
          </div>

          <h3>Próximos pasos:</h3>
          <ul>
            <li>🏪 Explora el marketplace de aplicaciones</li>
            <li>👥 Conoce a tu equipo en la sección de usuarios</li>
            <li>⚙️ Configura tu perfil y preferencias</li>
            <li>📊 Revisa el dashboard de tu empresa</li>
          </ul>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${process.env.FRONTEND_URL || 'https://forvara.com'}/dashboard" class="button">Ir a Mi Dashboard</a>
          </div>

          <div class="footer">
            <p>¿Necesitas ayuda? Responde a este email o visita nuestro centro de soporte.</p>
            <p>© 2025 Forvara - Hecho con ❤️ para LATAM</p>
          </div>
        </div>
      </body>
      </html>
    `

    return this.sendEmail({
      to: email,
      subject,
      html,
    })
  }

  async sendPasswordResetEmail(email: string, firstName: string, resetToken: string): Promise<boolean> {
    const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:5174'}/reset-password?token=${resetToken}`;
    const subject = 'Restablecer tu contraseña de Forvara'
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Restablecer Contraseña</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { text-align: center; margin-bottom: 30px; }
          .logo { font-size: 24px; font-weight: bold; color: #2563eb; }
          .card { background: #fef3c7; border: 1px solid #fbbf24; border-radius: 8px; padding: 20px; margin: 20px 0; }
          .button { display: inline-block; background: #dc2626; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 500; }
          .footer { text-align: center; margin-top: 30px; color: #64748b; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">🚀 Forvara</div>
            <h1>Restablecer Contraseña 🔑</h1>
          </div>

          <p>Hemos recibido una solicitud para restablecer la contraseña de tu cuenta.</p>

          <div class="card">
            <h3>⚠️ Importante</h3>
            <p>Este enlace expira en <strong>1 hora</strong> por motivos de seguridad.</p>
          </div>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetLink}" class="button">Restablecer Contraseña</a>
          </div>

          <p>Si no solicitaste este cambio, puedes ignorar este email. Tu contraseña seguirá siendo la misma.</p>

          <div class="footer">
            <p>Por tu seguridad, nunca compartas este enlace con nadie.</p>
            <p>© 2025 Forvara - Hecho con ❤️ para LATAM</p>
          </div>
        </div>
      </body>
      </html>
    `

    return this.sendEmail({
      to: email,
      subject,
      html,
    })
  }

  async sendEmailChangeVerification(newEmail: string, oldEmail: string, verificationToken: string): Promise<boolean> {
    const verifyLink = `${process.env.FRONTEND_URL || 'http://localhost:5174'}/verify-email-change?token=${verificationToken}`;
    const subject = '📧 Verificar Nueva Dirección de Email'
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Verificar Nuevo Email</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { text-align: center; margin-bottom: 30px; }
          .logo { font-size: 24px; font-weight: bold; color: #2563eb; }
          .card { background: #f0f9ff; border: 1px solid #7dd3fc; border-radius: 8px; padding: 20px; margin: 20px 0; }
          .button { display: inline-block; background: #0ea5e9; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 500; }
          .footer { text-align: center; margin-top: 30px; color: #64748b; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">🚀 Forvara</div>
            <h1>Verificar Nuevo Email 📧</h1>
          </div>

          <p>Has solicitado cambiar tu dirección de email de <strong>${oldEmail}</strong> a <strong>${newEmail}</strong>.</p>

          <div class="card">
            <h3>🔐 Verificación Requerida</h3>
            <p>Para completar el cambio, debes verificar tu nueva dirección de email.</p>
          </div>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${verifyLink}" class="button">Verificar Nuevo Email</a>
          </div>

          <p><strong>⏰ Este enlace expira en 24 horas.</strong></p>
          
          <p>Si no solicitaste este cambio, puedes ignorar este email y considera asegurar tu cuenta.</p>

          <div class="footer">
            <p>Por tu seguridad, nunca compartas este enlace con nadie.</p>
            <p>© 2025 Forvara - Hecho con ❤️ para LATAM</p>
          </div>
        </div>
      </body>
      </html>
    `

    return this.sendEmail({
      to: newEmail,
      subject,
      html,
    })
  }

  async sendSecurityAlert(email: string, firstName: string, eventType: string, details: any): Promise<boolean> {
    const eventMessages = {
      'new_device_login': `Un nuevo dispositivo accedió a tu cuenta desde ${details.location || 'Ubicación Desconocida'}`,
      'password_changed': 'Tu contraseña ha sido cambiada',
      'email_changed': `Tu email ha sido cambiado a ${details.new_email}`,
      'suspicious_activity': 'Actividad sospechosa detectada en tu cuenta'
    };

    const message = eventMessages[eventType as keyof typeof eventMessages] || 'Evento de seguridad detectado';
    const subject = '🛡️ Alerta de Seguridad - Forvara'
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Alerta de Seguridad</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { text-align: center; margin-bottom: 30px; }
          .logo { font-size: 24px; font-weight: bold; color: #2563eb; }
          .alert { background: #fef2f2; border: 1px solid #fca5a5; border-radius: 8px; padding: 20px; margin: 20px 0; }
          .button { display: inline-block; background: #dc2626; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 500; }
          .footer { text-align: center; margin-top: 30px; color: #64748b; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">🚀 Forvara</div>
            <h1>Alerta de Seguridad 🛡️</h1>
          </div>

          <p>Hola <strong>${firstName}</strong>,</p>

          <div class="alert">
            <h3>🚨 ${message}</h3>
            <p><strong>Detalles del Evento:</strong></p>
            <ul>
              <li><strong>Hora:</strong> ${new Date().toLocaleString('es-PA')}</li>
              <li><strong>IP:</strong> ${details.ip || 'Desconocida'}</li>
              <li><strong>Dispositivo:</strong> ${details.device_info?.browser || 'Desconocido'} en ${details.device_info?.os || 'Desconocido'}</li>
              <li><strong>Ubicación:</strong> ${details.location || 'Ubicación Desconocida'}</li>
            </ul>
          </div>

          <p>Si fuiste tú, no necesitas hacer nada. Si no reconoces esta actividad, por favor:</p>

          <ol>
            <li>Cambia tu contraseña inmediatamente</li>
            <li>Revisa la configuración de tu cuenta</li>
            <li>Contacta a nuestro equipo de soporte</li>
          </ol>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${process.env.FRONTEND_URL || 'http://localhost:5174'}/settings" class="button">Asegurar Mi Cuenta</a>
          </div>

          <div class="footer">
            <p>Este email fue enviado desde el Sistema de Seguridad de Forvara</p>
            <p>Si necesitas ayuda, contáctanos en support@forvara.com</p>
            <p>© 2025 Forvara - Hecho con ❤️ para LATAM</p>
          </div>
        </div>
      </body>
      </html>
    `

    return this.sendEmail({
      to: email,
      subject,
      html,
    })
  }

  async send2FACode(email: string, firstName: string, code: string): Promise<boolean> {
    const subject = '🔐 Tu Código de Verificación - Forvara'
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Código de Verificación</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { text-align: center; margin-bottom: 30px; }
          .logo { font-size: 24px; font-weight: bold; color: #2563eb; }
          .code-box { background: #f0f9ff; border: 2px solid #0ea5e9; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center; }
          .code { font-size: 32px; font-weight: bold; color: #0ea5e9; letter-spacing: 8px; font-family: monospace; }
          .footer { text-align: center; margin-top: 30px; color: #64748b; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">🚀 Forvara</div>
            <h1>Código de Verificación 🔐</h1>
          </div>

          <p>Hola <strong>${firstName}</strong>,</p>
          
          <p>Tu código de verificación de seguridad es:</p>

          <div class="code-box">
            <div class="code">${code}</div>
          </div>

          <p><strong>⏰ Este código expira en 10 minutos.</strong></p>
          
          <p>Si no solicitaste este código, puedes ignorar este email y considera asegurar tu cuenta.</p>

          <div class="footer">
            <p>Por tu seguridad, nunca compartas este código con nadie.</p>
            <p>© 2025 Forvara - Hecho con ❤️ para LATAM</p>
          </div>
        </div>
      </body>
      </html>
    `

    return this.sendEmail({
      to: email,
      subject,
      html,
    })
  }
}