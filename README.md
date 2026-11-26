# AI-Clinic — Backend Server

A telemedicine platform backend built with **NestJS 11** on **Fastify**, providing AI-powered patient triage, doctor consultations, doctor matching, real-time messaging, nurse teams, and appointment scheduling.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | NestJS 11 + Fastify 5 |
| Language | TypeScript 5.8 |
| Database | PostgreSQL + Prisma 6 ORM |
| Auth | Cookie-based sessions (`@fastify/secure-session`) + CSRF double-submit cookie |
| AI | Botpress Chat SDK (full), OpenAI (skeleton) |
| Real-time | Socket.IO via `@nestjs/websockets` |
| File Upload | `@fastify/multipart` (10 MB limit), local disk storage |
| Notifications | Email (`nodemailer`), Web Push (`web-push`) |
| Scheduling | Built-in availability/booking + Calendly API and webhook |
| Rate Limiting | `@nestjs/throttler` (enforced only when `APP_ENV=production`) |
| Docs | Swagger / OpenAPI (debug mode only) |
| Testing | Jest (unit + E2E) |

## Prerequisites

- **Node.js** >= 20
- **PostgreSQL** >= 15
- **pnpm** >= 11, which reads the build-script approvals (`allowBuilds`) in `pnpm-workspace.yaml`. `package.json` pins the version (`packageManager`); `corepack enable`, or pnpm 10 and later, switches to it automatically.

## Getting Started

### 1. Install dependencies

```bash
pnpm install
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
| `SESSION_SECRET` | Yes | Session encryption secret (use a long random string; startup warns below 16 chars) |
| `APP_NAME` | No | App name, used as the Swagger title (default: `AI-Clinic`) |
| `APP_PORT` | No | Server port (default: `8080`) |
| `APP_ENV` | No | `production` enables rate limiting; anything else disables it (falls back to `NODE_ENV`, default `development`) |
| `NODE_ENV` | No | `production` adds the `Secure` flag to the session and CSRF cookies |
| `CORS_ORIGIN` | No | Comma-separated allowed origins (default: `http://localhost:5173`) |
| `AUTH_SALT_ROUNDS` | No | bcrypt rounds (default: `12`) |
| `SESSION_COOKIE_NAME` | No | Cookie name (default: `sid`) |
| `DEBUG` | No | Enable Swagger docs and detailed validation messages (default: `false`) |
| `SUPERUSER_EMAIL`, `SUPERUSER_PASSWORD` | No | Superadmin created by the seed (defaults below) |
| `BOTAGENT_KEY` | No | Botpress webhook ID (AI triage chat) |
| `BOTPRESS_DELIVERY_MODE` | No | `sse` (default) or `poll` |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | No | OpenAI key and model (default model: `gpt-3.5-turbo`) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | No | Email notifications |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | No | Web push notifications |
| `CALENDLY_API_KEY`, `CALENDLY_ORGANIZATION_URI` | No | Calendly API access |
| `CALENDLY_WEBHOOK_SIGNING_KEY` | No | Verifies Calendly webhooks (all webhooks are rejected without it) |
| `STORAGE_TYPE` | No | `local` (default); `s3` is not implemented yet and falls back to local |
| `STORAGE_LOCAL_PATH` | No | Upload directory (default: `./uploads`) |

### 3. Set up the database

```bash
# Generate Prisma client
pnpm gen

# Run migrations
pnpm mg

# Seed superadmin user (admin@ai-clinic.com / SuperAdmin123! unless SUPERUSER_* are set)
pnpm exec prisma db seed
```

### 4. Start the server

```bash
# Development (watch mode)
pnpm start:dev

# Production
pnpm build
pnpm start:prod
```

The server starts on `http://localhost:8080` (or your configured `APP_PORT`). `GET /` returns a status message.

### Docker

The repository-root `Dockerfile` builds the client and server together. At startup it runs `prisma migrate deploy`, optionally runs `prisma db seed` when `SEED_DATABASE=true`, then starts the server behind Nginx. The standalone `server/Dockerfile` builds only the API and runs migrations before starting it. Set `SUPERUSER_EMAIL` and `SUPERUSER_PASSWORD` on the container before enabling the seed; the seed uses the defaults listed below when those variables are absent.

## API Documentation

When `DEBUG=true`, Swagger docs are available at:

- **UI:** `http://localhost:8080/docs`
- **JSON:** `http://localhost:8080/docs-json`

## Project Structure

```
server/
├── prisma/
│   ├── schema.prisma        # 23 models, 22 enums
│   ├── seed.cjs             # Superadmin seeder (runs without dev dependencies)
│   └── migrations/          # 3 migrations
├── src/
│   ├── main.ts              # Bootstrap (Fastify, CORS, Helmet, session, CSRF, pipes, WS adapter)
│   ├── app.module.ts        # Root module (config, throttler, feature modules)
│   ├── admin/               # User moderation, doctor verification, platform stats
│   ├── ai-agents/           # AI chat — Botpress (full, SSE/poll) + OpenAI (skeleton)
│   ├── api/                 # HTTP client service (internal use)
│   ├── auth/                # Login, register, logout, session + socket session helpers
│   │   ├── guards/          # CookieAuth, Admin, Roles, SuperAdmin, OptionalAuth
│   │   └── dto/             # Login, Register, Response DTOs
│   ├── cache/               # In-memory cache with TTL + scheduled cleanup
│   ├── calendly/            # Calendly API client + signed webhook
│   ├── chat/                # Direct chats: HTTP API + /chat WebSocket gateway
│   ├── common/              # Shared infrastructure
│   │   ├── decorators/      # @Roles, @SkipCsrf, @IsEnumDetailed, @IsBooleanValue, etc.
│   │   ├── filters/         # ExceptionTemplateFilter (global error envelope)
│   │   ├── guards/          # CsrfGuard, FastifyThrottlerGuard
│   │   ├── interceptors/    # ResponseTemplateInterceptor (global envelope), request logging
│   │   └── tools/           # Array/string helpers, WebSocket rate limiter
│   ├── configs/             # Config loaders (general, auth, ai, notification, storage, calendly) + env validation
│   ├── consultation/        # Consultation state machine, CRUD, ownership
│   ├── doctor/              # Doctor profile, verification documents, public listing, stats
│   ├── file-upload/         # Upload validation, local storage provider, file serving
│   ├── matching/            # Patient-to-doctor matching: HTTP API + /matching WebSocket gateway
│   ├── notification/        # In-app notifications, email + web push channels
│   ├── nurse/               # Nurse invitations, assignments, permissions
│   ├── patient/             # Patient profile CRUD, consultations & SOAPs listing
│   ├── payment/             # Payment records (stub, no real provider)
│   ├── prisma/              # PrismaService (@Global)
│   ├── review/              # Doctor review CRUD, aggregate ratings (cached)
│   ├── scheduling/          # Availability, slot durations, exceptions, appointments
│   ├── soap/                # SOAP note parsing, detection, CRUD
│   ├── user/                # User profile, avatar, password, search
│   └── utils/               # bcrypt hashing, string/number helpers
└── test/
    ├── helpers/             # Mock factories (Prisma, session, test app, WS handshake)
    ├── *.e2e-spec.ts        # 18 E2E suites (one per module area)
    ├── jest-setup.ts        # Shared Jest setup
    └── jest-e2e.json        # E2E Jest config
```

## API Endpoints

Auth column: **—** = no login needed, **Optional** = works as guest or logged in, **Session** = any logged-in user, **ROLE** = logged in with that role. Admins and superadmins pass every role check. Deactivated or banned accounts are rejected on every Session/ROLE route and treated as guests on Optional ones.

### Auth (`/auth`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/auth/register` | — | Register a new user (`PATIENT` or `DOCTOR`) |
| POST | `/auth/login` | — | Login with email + password |
| POST | `/auth/logout` | Session | Logout and clear session |

### User (`/user`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/user` | Session | Get current user |
| GET | `/user/all` | Admin | List all users (paginated) |
| PATCH | `/user/profile` | Session | Update own profile |
| PATCH | `/user/change-password` | Session | Change password (requires current password) |
| POST | `/user/avatar` | Session | Upload avatar (multipart; JPEG, PNG or WebP) |
| GET | `/user/search?q=` | DOCTOR | Search non-doctor users by name or email (e.g. to invite a nurse) |
| GET | `/user/:id` | Session | Get user by ID (public fields only, unless self or admin) |

### Patient (`/patient`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/patient/profile` | PATIENT | Create patient profile |
| PATCH | `/patient/profile` | PATIENT | Update patient profile |
| GET | `/patient/profile` | PATIENT | Get own patient profile |
| GET | `/patient/consultations` | PATIENT | List own consultations (paginated, filterable) |
| GET | `/patient/soaps` | PATIENT | List own SOAP notes (paginated) |

### Doctor (`/doctor`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/doctor` | DOCTOR | Create doctor profile |
| PATCH | `/doctor/profile` | DOCTOR | Update own doctor profile |
| POST | `/doctor/profile/resubmit` | DOCTOR | Resubmit a rejected profile for verification |
| GET | `/doctor/me` | DOCTOR | Own profile (including unverified) |
| GET | `/doctor/stats` | DOCTOR | Own dashboard stats |
| POST | `/doctor/documents` | DOCTOR | Upload a verification document (multipart; JPEG, PNG, WebP or PDF) |
| GET | `/doctor/documents` | DOCTOR | List own verification documents |
| GET | `/doctor` | — | List verified doctors (filtered, paginated) |
| GET | `/doctor/:id` | — | Single verified doctor with aggregate rating |
| GET | `/doctor/:id/rating` | — | Aggregate rating for doctor (cached 10 min) |

### Uploads (`/uploads`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/uploads/avatars/:fileName` | — | Serve an avatar image |
| GET | `/uploads/doctor-documents/:fileName` | Session | Serve a verification document (owning doctor and admins only) |

### Nurse (`/nurse`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/nurse/assign` | DOCTOR | Invite a user to the doctor's team (verified doctors only); creates a pending invitation. After a decline, the same doctor can invite that user again only after 7 days (409 until then) |
| PATCH | `/nurse/assignment/:id/permissions` | DOCTOR | Update an assignment's permissions |
| DELETE | `/nurse/assignment/:id` | DOCTOR | Cancel a pending invitation or deactivate an assignment |
| GET | `/nurse/invitations` | PATIENT, NURSE, NONE | List pending invitations sent to me |
| POST | `/nurse/invitations/:id/accept` | PATIENT, NURSE, NONE | Accept: join the team, becoming a `NURSE` if needed |
| POST | `/nurse/invitations/:id/decline` | PATIENT, NURSE, NONE | Decline an invitation |
| GET | `/nurse/dashboard` | NURSE | Nurse dashboard (assignments + stats) |
| GET | `/nurse/assignments` | DOCTOR, NURSE | My assignments (doctor: their nurses; nurse: their doctors) |
| GET | `/nurse/assignment/:id` | DOCTOR, NURSE | Single assignment |

### Consultation (`/consultation`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/consultation` | PATIENT | Create consultation |
| GET | `/consultation` | Session | List consultations (patient: own, doctor: assigned, admin: all) |
| GET | `/consultation/:id` | Session | Single consultation (ownership check) |
| PATCH | `/consultation/:id/decide` | DOCTOR | Doctor decides mode + visit method |
| PATCH | `/consultation/:id/advance-payment` | PATIENT, DOCTOR | `DOCTOR_DECIDED` → `PENDING_PAYMENT` |
| PATCH | `/consultation/:id/confirm-payment` | PATIENT, DOCTOR | `PENDING_PAYMENT` → `PAYMENT_CONFIRMED` |
| PATCH | `/consultation/:id/start` | DOCTOR | `PAYMENT_CONFIRMED` → `IN_PROGRESS` |
| PATCH | `/consultation/:id/complete` | DOCTOR | Doctor completes consultation |
| PATCH | `/consultation/:id/cancel` | PATIENT, DOCTOR | Cancel consultation |

### Matching (`/matching`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/matching/request` | PATIENT | Create a match request (optional `soapId` for auto-specialty) |
| GET | `/matching/status/:id` | PATIENT, DOCTOR | Status of a match request |
| GET | `/matching/active` | PATIENT | My active match request |
| GET | `/matching/pending` | DOCTOR | Match requests waiting on me |
| PATCH | `/matching/:id/cancel` | PATIENT | Cancel an active match request |
| PATCH | `/matching/:id/browse` | PATIENT | Turn a timed-out match into manual browsing |

### Scheduling (`/scheduling`)

Doctor/nurse endpoints act on the doctor's own schedule; nurses pass `?doctorId=` to manage a doctor they are assigned to.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/scheduling/availability` | DOCTOR, NURSE | Create a weekly availability slot |
| GET | `/scheduling/availability` | DOCTOR, NURSE | List weekly availability |
| PATCH | `/scheduling/availability/:id` | DOCTOR, NURSE | Update an availability slot |
| DELETE | `/scheduling/availability/:id` | DOCTOR, NURSE | Delete an availability slot |
| POST | `/scheduling/slot-durations` | DOCTOR, NURSE | Create a slot duration preset |
| GET | `/scheduling/slot-durations` | DOCTOR, NURSE | List slot duration presets |
| POST | `/scheduling/exceptions` | DOCTOR, NURSE | Add an availability exception (vacation/day off) |
| GET | `/scheduling/exceptions` | DOCTOR, NURSE | List availability exceptions |
| DELETE | `/scheduling/exceptions/:id` | DOCTOR, NURSE | Delete an availability exception |
| GET | `/scheduling/doctor/:doctorId/slots` | — | Available slots for a doctor in a date range |
| GET | `/scheduling/doctor/:doctorId/durations` | — | A doctor's active slot durations |
| POST | `/scheduling/book` | PATIENT | Book an appointment |
| GET | `/scheduling/appointments` | Session | List appointments (patient: own, doctor: assigned, admin: all) |
| GET | `/scheduling/appointments/:id` | Session | Single appointment |
| PATCH | `/scheduling/appointments/:id/cancel` | Session | Cancel an appointment |

### Calendly (`/calendly`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/calendly/webhook` | Signature | `invitee.created` / `invitee.canceled` events (no CSRF, no rate limit; see below) |
| GET | `/calendly/event-types` | Session | List cached Calendly event types |
| GET | `/calendly/appointment/:id/event` | Session | Calendly event details for an appointment |

### Chat (`/chat`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/chat` | Session | Create or reopen a chat with another user (role rules apply; admins exempt) |
| GET | `/chat` | Session | List my chats |
| GET | `/chat/:id` | Session | Chat details (participants only) |
| GET | `/chat/:id/messages` | Session | Paginated messages |
| POST | `/chat/:id/message` | Session | Send a message (HTTP fallback; broadcast like a WebSocket message) |

### Notifications (`/notification`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/notification` | Session | My notifications (paginated) |
| GET | `/notification/unread-count` | Session | Unread count |
| PATCH | `/notification/:id/read` | Session | Mark one as read |
| PATCH | `/notification/read-all` | Session | Mark all as read |
| POST | `/notification/subscribe` | Session | Register a web push subscription |
| DELETE | `/notification/unsubscribe` | Session | Remove a web push subscription |

### Payment (`/payment`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/payment` | Session | Create a payment record (stub, no real provider) |
| GET | `/payment` | Session | List my payments (paginated, optional status filter) |
| GET | `/payment/:id` | Session | Single payment |
| POST | `/payment/:id/confirm` | Session | Mark a payment completed (stub) |

### Reviews (`/review`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/review` | PATIENT | Create review (requires completed consultation) |
| PATCH | `/review/:id` | PATIENT | Update own review |
| DELETE | `/review/:id` | Session | Delete own or admin delete any |
| GET | `/review/admin/all` | Admin | List all reviews (paginated) |
| GET | `/review/doctor/:doctorId` | — | List reviews for doctor (paginated) |
| GET | `/review/doctor/:doctorId/rating` | — | Aggregate rating (cached 10 min) |

### SOAP (`/soap`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/soap` | Session | List SOAP notes (patients: own; nurses: delegated) (paginated) |
| GET | `/soap/:id` | Session | Single SOAP note (owner, admins, linked doctors and their nurses with `VIEW_SOAPS`) |

### Admin (`/admin`)

All routes require an admin; promote/demote require the superadmin.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/admin/users` | Admin | List users (paginated, filterable) |
| PATCH | `/admin/users/:id` | Admin | Update a user |
| PATCH | `/admin/users/:id/deactivate` | Admin | Deactivate a user |
| PATCH | `/admin/users/:id/ban` | Admin | Ban a user |
| PATCH | `/admin/users/:id/unban` | Admin | Unban a user |
| PATCH | `/admin/users/:id/promote` | Superadmin | Promote a user to admin |
| PATCH | `/admin/users/:id/demote` | Superadmin | Demote an admin |
| GET | `/admin/doctors/pending` | Admin | Doctors awaiting verification, with documents |
| GET | `/admin/doctors/:id/documents` | Admin | A doctor's documents |
| PATCH | `/admin/doctors/:id/verify` | Admin | Verify or reject a doctor |
| DELETE | `/admin/reviews/:id` | Admin | Delete any review |
| GET | `/admin/stats` | Admin | Platform statistics |

### AI Agents (`/ai-agents`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/ai-agents/start` | Optional | Start/resume AI conversation (guest if unauthenticated) |
| POST | `/ai-agents/start/new` | Session | Force-start a brand-new conversation |
| POST | `/ai-agents/start/:conversationId` | Session | Resume a specific conversation |
| POST | `/ai-agents/message` | Optional | Send message to AI (guests must pass `conversationId`) |
| GET | `/ai-agents/messages/:conversationId` | Session | Poll for new bot messages |
| GET | `/ai-agents/guest/messages/:conversationId` | — | Poll guest conversation messages |
| GET | `/ai-agents/history/:conversationId` | Session | Full conversation history (user + bot) |
| GET | `/ai-agents/conversations` | Session | List all AI conversations (paginated) |
| PATCH | `/ai-agents/conversations/:conversationId/rename` | Session | Rename a conversation |
| GET | `/ai-agents/stream/:conversationId` | Session | SSE stream for real-time AI responses |
| POST | `/ai-agents/openai` | Session | Send message to OpenAI (skeleton, in-memory history) |

## WebSockets

Socket.IO namespaces on the same port. The handshake must carry the session cookie; banned or deactivated accounts are refused and disconnected when their status changes.

### `/chat`

| Direction | Events |
|-----------|--------|
| Client → server | `chat:message`, `chat:typing`, `chat:read`, `chat:edit`, `chat:delete`, `chat:join`, `chat:leave` |
| Server → client | `chat:message`, `chat:typing`, `chat:read`, `chat:edited`, `chat:deleted`, `user:online`, `chat:error` |

- On connect a socket joins the rooms of all its user's chats.
- `chat:join` marks the chat as open for that socket and marks its message notifications read; `chat:leave` closes it (the socket keeps receiving the chat's live events).
- Participants who don't have the chat open on any socket get one grouped `NEW_CHAT_MESSAGE` notification per chat, updated as messages arrive. Messages sent over HTTP are delivered the same way.

### `/matching`

| Direction | Events |
|-----------|--------|
| Client → server | `match:request` (patient), `match:accept` / `match:reject` (doctor), `match:cancel` (patient) |
| Server → client | `match:searching`, `match:request`, `match:accepted`, `match:rejected`, `match:timeout`, `match:cancelled`, `match:error` |

- A request times out 5 minutes after it is created; the patient and the doctor holding the offer get `match:timeout`. A sweep at startup and every minute times out requests whose timers were lost (e.g. on restart), and an expired request can't be accepted or declined.

## Response Format

All JSON responses are wrapped in a standard envelope (file downloads, the SSE stream and `204` responses are not):

**Success:**
```json
{
  "status": 200,
  "message": "Success!",
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

- Session data is encrypted and stored in an HTTP-only cookie (7-day lifetime, `SameSite=Lax`)
- The session cookie name is configurable (`SESSION_COOKIE_NAME`, default: `sid`)
- `CookieAuthGuard` reads `session.get('user')`, re-checks ban/deactivation, role and admin flags against the database (cached up to 60 s), and populates `request.user`
- Frontend must send `credentials: 'include'` with every request

### CSRF

A global guard enforces a double-submit cookie. The server sets a JS-readable `csrf-token` cookie; every non-`GET`/`HEAD`/`OPTIONS` request must send the same value in the `X-CSRF-Token` header, or it gets `403`. The only exemption is `POST /calendly/webhook`, which is instead verified with the HMAC signature in `Calendly-Webhook-Signature` (`CALENDLY_WEBHOOK_SIGNING_KEY`), and refused if the signed timestamp is more than 3 minutes off.

### Role System

| Role | Field | Access |
|------|-------|--------|
| `PATIENT` | `user.role` | Patient endpoints (self-registration) |
| `DOCTOR` | `user.role` | Doctor endpoints (self-registration; listed publicly and available for consultations and matching once an admin verifies the profile) |
| `NURSE` | `user.role` | Nurse endpoints; set when a user accepts a nurse invitation |
| `NONE` | `user.role` | No clinical role (e.g. the seeded superadmin) |
| Admin | `user.isAdmin` | Admin endpoints, bypasses role checks |
| Superadmin | `user.isSuperAdmin` | Everything an admin can do, plus promote/demote admins |

### Operational Notes

- HTTP rate limiting runs only when `APP_ENV=production` (global 100 req/min per client; login/register 5/min; AI start and OpenAI 10/min; AI message and guest poll 20/min). WebSocket events have their own per-user limits that are always on.
- Fastify's `trustProxy` is not enabled, so behind a reverse proxy every client is counted under the proxy's IP and shares one rate-limit bucket.
- Run a single instance: online presence, socket rooms, matching timeouts, the user-status and rating caches, and rate-limit counters are kept in process memory.

## Database

**23 Prisma models:** User, Chat, Message, ChatParticipant, AiConversation, PatientSOAP, DoctorProfile, DoctorReview, PatientProfile, Consultation, Appointment, DoctorAvailability, SlotDuration, AvailabilityException, DoctorDocument, DoctorNurseAssignment, MatchRequest, MatchRejection, Call, Payment, Subscription, Notification, PushSubscription.

**3 migrations:** `20260722205635_init`, `20260729151841_add_doctor_document_indexes`, `20261009120000_nurse_invitations`.

### Common Commands

```bash
# Generate Prisma client after schema changes
pnpm gen

# Create a new migration
pnpm mg:dev

# Deploy migrations (production)
pnpm mg

# Open Prisma Studio (visual DB browser)
pnpm exec prisma studio

# Reset database (development only!)
pnpm exec prisma migrate reset
```

## Testing

### Run unit tests
```bash
pnpm test
```

### Run E2E tests
```bash
pnpm test:e2e
```

### Run with coverage
```bash
pnpm test:cov
```

### Current test counts

| Type | Suites | Tests |
|------|--------|-------|
| Unit | 34 | 1183 |
| E2E | 18 | 482 |
| **Total** | **52** | **1665** |

Tests use:
- Mocked `PrismaService` (no real DB needed)
- Simulated Fastify sessions via `preHandler` hooks
- Trimmed `@Module` definitions per E2E spec (avoids importing full `AppModule`)

## Scripts

| Script | Description |
|--------|-------------|
| `pnpm start` | Start once (no watch) |
| `pnpm start:dev` | Start in watch mode |
| `pnpm start:debug` | Start with debugger |
| `pnpm build` | Build for production |
| `pnpm start:prod` | Run production build |
| `pnpm lint` | Lint and auto-fix, including Prettier formatting (config: `eslint.config.mjs`) |
| `pnpm format` | Format with Prettier |
| `pnpm test` | Run unit tests |
| `pnpm test:watch` | Unit tests in watch mode |
| `pnpm test:debug` | Unit tests with debugger, in band |
| `pnpm test:e2e` | Run E2E tests |
| `pnpm test:cov` | Test with coverage |
| `pnpm gen` | Generate Prisma client |
| `pnpm mg:dev` | Create dev migration |
| `pnpm mg` | Deploy migrations |

## Seeded Accounts

After running `pnpm exec prisma db seed`:

| Email | Password | Role |
|-------|----------|------|
| `admin@ai-clinic.com` | `SuperAdmin123!` | Superadmin |

Set `SUPERUSER_EMAIL` / `SUPERUSER_PASSWORD` before seeding to use other credentials. The seed never changes an existing user.

## License

UNLICENSED — Private project.
