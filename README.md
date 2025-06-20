# 🧭 Forvara Core

[![TypeScript](https://img.shields.io/badge/Language-TypeScript-blue.svg)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-ForvaraSoft-informational)](https://forvara.com)
[![Supabase](https://img.shields.io/badge/backend-Supabase-green)](https://supabase.com)

**Forvara Core** is the central identity and subscription management hub for all Forvara-connected apps, such as [Elaris ERP](https://elariis.com). It handles:

- User registration via phone or email
- Multi-tenant company management
- Per-app subscriptions and usage limits
- Role-based access control
- Offline access validation (with signed JWT)
- Stripe support for monetization (optional)

---

## 🧱 Tech Stack

- **Node.js + Express** – Backend API
- **TypeScript** – Static typing
- **Supabase** – Auth + PostgreSQL + RLS
- **Drizzle ORM** – Lightweight ORM
- **Stripe** (optional) – Subscription payments
- **JWT** – Offline access tokens
- **Zod** – Input validation
- **SDK** – TypeScript SDK for external apps

---

## ⚙️ Getting Started

### 1. Clone the project

```bash
git clone https://github.com/NeonShapeshifter/ForvaraCore.git
cd ForvaraCore
npm install
```

### 2. Configure your environment

Create a `.env` file based on `.env.example`:

```bash
cp .env.example .env
```

Fill in your Supabase and JWT keys. Stripe is optional.

---

## 🚀 Run the server

```bash
npm run dev
```

API runs at: [http://localhost:4000](http://localhost:4000)

---

## 🧪 Environment Variables

| Key                       | Description                              |
|---------------------------|------------------------------------------|
| `SUPABASE_URL`            | Your Supabase project URL                |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side secret key from Supabase |
| `SUPABASE_ANON_KEY`       | Public client key                        |
| `JWT_SECRET`              | Secret used to sign offline tokens       |
| `PORT`                    | Server port (default: 4000)              |
| `STRIPE_SECRET_KEY`       | (Optional) Stripe secret key             |
| `STRIPE_WEBHOOK_SECRET`   | (Optional) Stripe webhook secret         |

---

## 📦 Main API Endpoints

| Method | Route                        | Description                           |
|--------|------------------------------|---------------------------------------|
| `GET`  | `/health`                    | Server check                          |
| `POST` | `/api/auth/register`        | Register user via phone/email         |
| `GET`  | `/api/users/me`             | Get authenticated user info           |
| `POST` | `/api/tenants`              | Create a company (tenant)             |
| `GET`  | `/api/tenants`              | List your companies                   |
| `GET`  | `/api/subscription/status`  | Get current subscription info         |
| `POST` | `/api/subscription/upgrade` | Upgrade tenant subscription           |

---

## 🧰 SDK for Apps

Apps like `Elaris` can use the TypeScript SDK:

```ts
import { ForvaraClient } from '@forvara/sdk'

const client = new ForvaraClient({
  apiUrl: 'https://forvara-api.vercel.app',
  supabaseUrl: 'https://xyz.supabase.co',
  supabaseKey: 'anon-key'
})

const status = await client.verifySubscription({
  tenantId: 'tenant-uuid',
  app: 'elaris'
})
```

Includes:
- Subscription validation
- Offline mode with cache
- JWT signature storage
- Access control helpers

---

## 🛠 Planned Features

- Admin dashboard (web UI)
- Usage analytics per tenant
- Addon support (per-feature payments)
- SDK publishing to npm as `@forvara/sdk`
- Auth provider integration (OAuth, BankID)

---

## 📈 Admin Route (protected)

`GET /api/admin/stats` → shows global stats:
- Total users
- Total companies
- Active subscriptions

---

## 🛡 License

© 2025 ForvaraSoft – All rights reserved.  
Private project. Not licensed for redistribution.
