import type { FastifyInstance } from 'fastify';
import type {} from '@fastify/cookie';
import type {} from '@fastify/secure-session';

/**
 * The session user behind a WebSocket handshake's cookies, decoded by the same
 * Fastify instance (and so the same key and cookie format) that serves HTTP.
 */
export function sessionUserFromCookieHeader(
  fastify: FastifyInstance,
  cookieHeader: string | undefined,
  cookieName: string,
): any | null {
  if (!cookieHeader) return null;

  const cookie = fastify.parseCookie(cookieHeader)[cookieName];
  if (!cookie) return null;

  return fastify.decodeSecureSession(cookie)?.get('user') ?? null;
}
