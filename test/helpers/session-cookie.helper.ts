import Fastify, { FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifySecureSession from '@fastify/secure-session';
import { createHash } from 'crypto';

/**
 * A Fastify app with the cookie and secure-session plugins configured like main.ts,
 * plus a `POST /login` route that stores the posted body as the session user.
 */
export async function createSessionApp(
  cookieName: string,
  secret: string,
): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(fastifyCookie);
  await app.register(fastifySecureSession, {
    key: createHash('sha256').update(secret).digest(),
    cookieName,
    cookie: { path: '/', httpOnly: true },
  });
  app.post('/login', async (request) => {
    (request as any).session.set('user', request.body);
    return { ok: true };
  });
  await app.ready();
  return app;
}

/** The `name=value` pair of the session cookie that a login on `app` sets. */
export async function loginCookie(
  app: FastifyInstance,
  cookieName: string,
  user: Record<string, unknown>,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/login',
    payload: user,
  });
  const setCookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const session = setCookie.find((cookie) =>
    cookie.startsWith(`${cookieName}=`),
  );
  if (!session) throw new Error('login did not set the session cookie');
  return session.split(';')[0];
}
