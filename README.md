# AI-Clinic — Backend Server

A telemedicine platform backend built with **NestJS 11** on **Fastify**, providing AI-powered patient triage, doctor consultations, real-time messaging, and appointment scheduling.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | NestJS 11 + Fastify 5 |
| Language | TypeScript 5.8 |
| Database | PostgreSQL + Prisma 6 ORM |
| Auth | Cookie-based sessions (`@fastify/secure-session`) |
| AI | Botpress Chat SDK (full), OpenAI (skeleton) |
| Real-time | Socket.IO via `@nestjs/websockets` |
| File Upload | `@fastify/multipart` (10 MB limit) |
| Rate Limiting | `@nestjs/throttler` |
| Docs | Swagger / OpenAPI (debug mode only) |
| Testing | Jest (unit + E2E) |

## Prerequisites

- **Node.js** >= 20
- **PostgreSQL** >= 15
- **npm** >= 10

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your actual values
```

Key environment variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `APP_PORT` | Yes | Server port (default: `8080`) |
| `SESSION_SECRET` | Yes | Session encryption key (min 32 chars) |
| `AUTH_SALT_ROUNDS` | No | bcrypt rounds (default: `12`) |
| `SESSION_COOKIE_NAME` | No | Cookie name (default: `sid`) |
| `DEBUG` | No | Enable Swagger docs (default: `false`) |
| `OPENAI_API_KEY` | No | OpenAI API key for AI features |
| `BOTAGENT_KEY` | No | Botpress webhook ID |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | No | Email notifications |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | No | Web push notifications |
| `STORAGE_TYPE` | No | `local` or `s3` (default: `local`) |

### 3. Set up the database

```bash
# Generate Prisma client
npm run gen

# Run migrations
npm run mg

# Seed superadmin user (admin@ai-clinic.com / SuperAdmin123!)
npx prisma db seed
```

### 4. Start the server

```bash
# Development (watch mode)
npm run start:dev

# Production
npm run build
npm run start:prod
```

The server starts on `http://localhost:8080` (or your configured `APP_PORT`).

## API Documentation

When `DEBUG=true`, Swagger docs are available at:

- **UI:** `http://localhost:8080/docs`
- **JSON:** `http://localhost:8080/docs-json`

## Project Structure

```
server/
├── prisma/
│   ├── schema.prisma        # 21 models, 16+ enums
│   ├── seed.ts              # Superadmin seeder
│   └── migrations/          # 10 migrations
├── src/
│   ├── main.ts              # Bootstrap (Fastify, CORS, session, pipes, WS adapter)
│   ├── app.module.ts        # Root module
│   ├── ai-agents/           # AI chat — Botpress (full) + OpenAI (skeleton)
│   ├── api/                 # HTTP client service (internal use)
│   ├── auth/                # Login, register, logout, session management
│   │   ├── guards/          # CookieAuth, Admin, Roles, SuperAdmin, OptionalAuth
│   │   └── dto/             # Login, Register, Response DTOs
│   ├── cache/               # In-memory cache with TTL + scheduled cleanup
│   ├── common/              # Shared infrastructure
│   │   ├── decorators/      # @Roles, @IsEnumDetailed, @IsBooleanValue, etc.
│   │   ├── filters/         # ExceptionTemplateFilter (global error envelope)
│   │   ├── interceptors/    # ResponseTemplateInterceptor (global response envelope)
│   │   └── tools/           # Utility functions (toCapitalCase, truncateString)
│   ├── configs/             # Config loaders (general, auth, ai, notification, storage)
│   ├── doctor/              # Doctor profile creation
│   ├── patient/             # Patient profile CRUD
│   ├── prisma/              # PrismaService (@Global)
│   ├── user/                # User CRUD, admin listing
│   └── utils/               # bcrypt hashing, string helpers, enum validation
└── test/
    ├── helpers/             # Mock factories (Prisma, session, test app)
    ├── *.e2e-spec.ts        # E2E tests (auth, user, doctor, patient, app)
    └── jest-e2e.json        # E2E Jest config
```

## API Endpoints

### Auth (`/auth`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/auth/register` | — | Register a new user |
| POST | `/auth/login` | — | Login with email + password |
| POST | `/auth/logout` | Session | Logout and clear session |

### User (`/user`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/user` | Session | Get current user |
| GET | `/user/all` | Admin | List all users |
| PATCH | `/user/profile` | Session | Update own profile |
| GET | `/user/:id` | Session | Get user by ID |

### Patient (`/patient`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/patient/profile` | PATIENT role | Create patient profile |
| PATCH | `/patient/profile` | PATIENT role | Update patient profile |
| GET | `/patient/profile` | PATIENT role | Get own patient profile |

### Doctor (`/doctor`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/doctor` | DOCTOR role | Create doctor profile |

### AI Agents (`/ai-agents`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/ai-agents/start` | Session | Start a new AI conversation |
| POST | `/ai-agents/message` | Session | Send message to AI |
| GET | `/ai-agents/messages/:conversationId` | Session | Get conversation messages |
| GET | `/ai-agents/stream/:conversationId` | Session | SSE stream for real-time AI responses |

### OpenAI (`/openai`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/openai` | — | Send message to OpenAI (skeleton) |

## Response Format

All responses are wrapped in a standard envelope:

**Success:**
```json
{
  "status": 200,
  "message": "OK",
  "contents": { ... }
}
```

**Error:**
```json
{
  "status": 400,
  "message": "Validation failed",
  "contents": null,
  "timestamp": "2026-02-24T09:00:00.000Z",
  "path": "/auth/register"
}
```

## Authentication

The server uses **cookie-based sessions** via `@fastify/secure-session`:

- Session data is encrypted and stored in a signed HTTP-only cookie
- The session cookie name is configurable (`SESSION_COOKIE_NAME`, default: `sid`)
- `CookieAuthGuard` reads `session.get('user')` and populates `request.user`
- Frontend must send `credentials: 'include'` with every request

### Role System

| Role | Field | Access |
|------|-------|--------|
| `PATIENT` | `user.role` | Patient endpoints |
| `DOCTOR` | `user.role` | Doctor endpoints |
| `NURSE` | `user.role` | Nurse endpoints (planned) |
| `NONE` | `user.role` | Admin/superadmin accounts |
| Admin | `user.isAdmin` | Admin endpoints, bypasses role checks |
| Superadmin | `user.isSuperAdmin` | Promote/demote admins |

## Database

**21 Prisma models:** User, Chat, Message, ChatParticipant, AiConversation, PatientSOAP, DoctorProfile, DoctorReview, PatientProfile, Consultation, Appointment, DoctorAvailability, SlotDuration, AvailabilityException, DoctorDocument, DoctorNurseAssignment, Call, Payment, Subscription, Notification, PushSubscription.

### Common Commands

```bash
# Generate Prisma client after schema changes
npm run gen

# Create a new migration
npm run mg:dev

# Deploy migrations (production)
npm run mg

# Open Prisma Studio (visual DB browser)
npx prisma studio

# Reset database (development only!)
npx prisma migrate reset
```

## Testing

### Run unit tests
```bash
npm test
```

### Run E2E tests
```bash
npm run test:e2e
```

### Run with coverage
```bash
npm run test:cov
```

### Current test coverage

| Type | Suites | Tests |
|------|--------|-------|
| Unit | 7 | 68 |
| E2E | 5 | 48 |
| **Total** | **12** | **116** |

Tests use:
- Mocked `PrismaService` (no real DB needed)
- Simulated Fastify sessions via `preHandler` hooks
- Trimmed `@Module` definitions per E2E spec (avoids importing full `AppModule`)

## Scripts

| Script | Description |
|--------|-------------|
| `npm run start:dev` | Start in watch mode |
| `npm run start:debug` | Start with debugger |
| `npm run build` | Build for production |
| `npm run start:prod` | Run production build |
| `npm run lint` | Lint and auto-fix |
| `npm run format` | Format with Prettier |
| `npm test` | Run unit tests |
| `npm run test:e2e` | Run E2E tests |
| `npm run test:cov` | Test with coverage |
| `npm run gen` | Generate Prisma client |
| `npm run mg:dev` | Create dev migration |
| `npm run mg` | Deploy migrations |

## Seeded Accounts

After running `npx prisma db seed`:

| Email | Password | Role |
|-------|----------|------|
| `admin@ai-clinic.com` | `SuperAdmin123!` | Superadmin |

## License

UNLICENSED — Private project.