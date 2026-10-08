# --- Build stage ---
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY prisma ./prisma
RUN pnpm exec prisma generate

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN pnpm run build

# --- Production stage ---
# Not Alpine: sodium-native (used by @fastify/secure-session) ships no musl prebuilds.
FROM node:22-slim AS production

# openssl: Prisma's query engine needs libssl, which the slim image lacks.
RUN apt-get update \
  && apt-get install -y --no-install-recommends dumb-init openssl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --prod

COPY prisma ./prisma
RUN pnpm exec prisma generate

COPY --from=build /app/dist ./dist

RUN mkdir -p uploads && chown -R node:node /app

USER node

EXPOSE 8080

ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
