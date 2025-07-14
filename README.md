# 🚀 ForvaraCore - Enterprise Backend API

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-43853D?style=flat&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express.js](https://img.shields.io/badge/Express.js-404D59?style=flat&logo=express)](https://expressjs.com/)
[![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?style=flat&logo=supabase&logoColor=white)](https://supabase.com/)
[![Stripe](https://img.shields.io/badge/Stripe-626CD9?style=flat&logo=stripe&logoColor=white)](https://stripe.com/)

Enterprise-grade backend API for the Forvara business ecosystem. Built with TypeScript, Express.js, and Supabase for multi-tenant SaaS applications targeting LATAM markets.

## 🏗️ Architecture

**Multi-Tenant SaaS Backend** with Row Level Security (RLS), JWT authentication, Stripe billing integration, and comprehensive business management APIs.

### Core Features

- ✅ **Multi-Tenant Architecture** - Complete tenant isolation with RLS
- ✅ **Dual Authentication** - Email and phone login support for LATAM markets
- ✅ **Team Management** - Role-based access control with invitation system
- ✅ **Stripe Billing** - Complete subscription and payment processing
- ✅ **Security System** - Device tracking, 2FA, audit logging
- ✅ **Admin APIs** - Company management, analytics, user administration
- ✅ **Email Service** - Professional templates for invitations and notifications

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Supabase account and project
- Stripe account (for billing features)
- SMTP email service (Gmail, SendGrid, etc.)

### Installation

```bash
# Clone and install
git clone <repository>
cd ForvaraCore
npm install

# Environment setup
cp .env.example .env
# Edit .env with your credentials

# Development
npm run dev

# Production build
npm run build
npm start
```

### Environment Variables

```env
# Database
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-key

# Authentication
JWT_SECRET=your-secret-key-min-32-chars
JWT_EXPIRES_IN=7d

# Stripe (optional)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Email (optional)
ENABLE_EMAIL=true
SMTP_HOST=smtp.gmail.com
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=noreply@yourcompany.com

# App
NODE_ENV=development
PORT=4000
FRONTEND_URL=http://localhost:5173
ALLOWED_ORIGINS=http://localhost:5173
```

## 📡 API Documentation

### Core Endpoints

#### Authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login (email or phone)
- `POST /api/auth/forgot-password` - Password reset request
- `POST /api/auth/reset-password` - Password reset with token

#### Multi-Tenant Management
- `GET /api/tenants/companies` - Get user companies
- `POST /api/tenants/companies` - Create new company
- `POST /api/tenants/invite` - Invite team member
- `GET /api/tenants/members` - Get company members
- `PATCH /api/tenants/members/:id/role` - Change member role

#### Billing & Subscriptions
- `POST /api/billing/checkout` - Create Stripe checkout session
- `GET /api/billing/info` - Get billing information
- `POST /api/billing/portal` - Access customer portal
- `POST /api/billing/webhooks` - Stripe webhook handler

#### User Management
- `GET /api/users/profile` - Get user profile
- `PATCH /api/users/profile` - Update user profile
- `POST /api/users/change-password` - Change password

#### Analytics & Admin
- `GET /api/analytics` - Get usage analytics
- `GET /api/admin/dashboard` - Admin dashboard data
- `GET /api/hub/dashboard` - Hub dashboard data

### Response Format

```json
// Success
{
  "data": {
    // Response data
  }
}

// Error
{
  "error": {
    "message": "Error description",
    "code": "ERROR_CODE"
  }
}
```

## 🔧 Development

### Available Scripts

```bash
npm run dev              # Development server with hot reload
npm run build           # Production build
npm start               # Production server
npm run lint            # ESLint code linting
npm run typecheck       # TypeScript type checking
```

### Project Structure

```
src/
├── app.ts              # Express app configuration
├── server.ts           # Server startup
├── config/             # Configuration files
│   ├── database.ts     # Supabase client
│   └── stripe.ts       # Stripe configuration
├── routes/             # API route definitions
│   ├── auth.ts         # Authentication routes
│   ├── tenants.ts      # Multi-tenant management
│   ├── billing.ts      # Stripe billing
│   ├── users.ts        # User management
│   └── analytics.ts    # Analytics endpoints
├── services/           # Business logic
│   ├── auth.service.ts # Authentication logic
│   ├── tenant.service.ts # Multi-tenant operations
│   ├── billing.service.ts # Stripe integration
│   └── email.service.ts # Email notifications
├── middleware/         # Express middleware
│   ├── auth.ts         # JWT validation
│   └── tenant.ts       # Tenant context injection
├── types/              # TypeScript definitions
└── utils/              # Helper functions
```

## 🏢 Multi-Tenant Architecture

### Tenant Isolation
- **Row Level Security**: Database-level tenant isolation
- **Automatic Context**: Middleware injects tenant context
- **Role-Based Access**: Granular permissions per company
- **Data Separation**: Complete data isolation between tenants

### Role Hierarchy
1. **Owner** - Full company control, billing management
2. **Admin** - User management, app configuration  
3. **Member** - Basic app access, limited configuration
4. **Viewer** - Read-only access

## 💳 Billing & Payments

### Stripe Integration
- **Multi-Currency Support** - USD, MXN, COP, CLP, PEN for LATAM
- **Subscription Management** - Monthly/yearly billing cycles
- **Customer Portal** - Self-service billing management
- **Webhook Processing** - Real-time subscription updates
- **Trial Management** - 30-day free trials with conversion

### LATAM Payment Methods
- Credit/debit cards (Visa, MasterCard, Amex)
- Local payment methods (OXXO, PSE, PagoEfectivo)
- Bank transfers and local banking

## 🔒 Security Features

### Authentication & Authorization
- **JWT Tokens** - Stateless authentication with refresh
- **Password Security** - bcrypt hashing with salt rounds
- **Device Tracking** - Login device fingerprinting
- **2FA Support** - Time-based OTP authentication
- **Session Management** - Secure session handling

### Security Monitoring
- **Audit Logging** - Comprehensive activity tracking
- **Security Events** - Failed login attempts, suspicious activity
- **Email Notifications** - Security alerts and notifications
- **Rate Limiting** - API protection and abuse prevention

## 📱 LATAM Market Features

### Regional Adaptations
- **Phone Authentication** - Support for LATAM phone formats
- **Spanish Interface** - Native Spanish language support
- **Local Business Patterns** - RUC, Razón Social support
- **Currency Support** - Local currencies with USD fallback

### Business Compliance
- **Tax ID Support** - Panama RUC and regional tax IDs
- **Invoice Generation** - Compliant billing documentation
- **Data Residency** - Configurable data location preferences

## 🚀 Deployment

### Railway (Recommended)
```bash
# Connect GitHub repo and deploy
railway login
railway init
railway up
```

### Vercel
```bash
# Install Vercel CLI and deploy
npm i -g vercel
vercel --prod
```

### Docker
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
EXPOSE 4000
CMD ["npm", "start"]
```

## 🧪 Testing

### Health Check
```bash
curl http://localhost:4000/api/health
```

### Authentication Test
```bash
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'
```

## 📊 Monitoring

### Application Metrics
- API response times and error rates
- Database query performance
- Authentication success/failure rates
- Billing and subscription metrics

### Business Metrics
- User registration and activation
- Trial conversion rates
- Revenue and subscription growth
- Feature adoption and usage

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

Proprietary - Forvara Enterprise License

## 🆘 Support

For technical support or questions:
- Create an issue in the repository
- Check the documentation
- Contact the development team

---

**Forvara** - Empowering LATAM businesses with enterprise-grade SaaS solutions.