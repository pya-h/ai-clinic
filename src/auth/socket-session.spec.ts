import { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { sessionUserFromCookieHeader } from './socket-session';
import {
  createSessionApp,
  loginCookie as login,
} from '../../test/helpers/session-cookie.helper';

describe('sessionUserFromCookieHeader', () => {
  const cookieName = `sid_${randomUUID().slice(0, 8)}`;
  let app: FastifyInstance;

  const loginCookie = (
    instance: FastifyInstance,
    user: Record<string, unknown>,
  ) => login(instance, cookieName, user);
  const buildApp = (secret: string) => createSessionApp(cookieName, secret);
  const randomUser = () => ({
    id: randomUUID(),
    role: 'PATIENT',
    email: `${randomUUID()}@test.local`,
  });

  beforeAll(async () => {
    app = await buildApp(`secret-${randomUUID()}`);
  });

  afterAll(async () => {
    await app.close();
  });

  it('should return the user stored by an HTTP login', async () => {
    const user = randomUser();
    const cookie = await loginCookie(app, user);

    expect(sessionUserFromCookieHeader(app, cookie, cookieName)).toEqual(user);
  });

  it('should find the session cookie among other cookies', async () => {
    const user = randomUser();
    const cookie = await loginCookie(app, user);

    expect(
      sessionUserFromCookieHeader(
        app,
        `csrf-token=abc123; ${cookie}; theme=dark`,
        cookieName,
      ),
    ).toEqual(user);
  });

  it.each([
    ['no cookie header', undefined],
    ['an empty cookie header', ''],
    ['no session cookie', 'csrf-token=abc123; theme=dark'],
  ])('should return null for %s', (_case, header) => {
    expect(sessionUserFromCookieHeader(app, header, cookieName)).toBeNull();
  });

  it('should only read the configured cookie name', async () => {
    const cookie = await loginCookie(app, randomUser());

    expect(sessionUserFromCookieHeader(app, cookie, 'other_sid')).toBeNull();
  });

  it('should return null for a tampered session cookie', async () => {
    const cookie = await loginCookie(app, randomUser());
    const [name, value] = cookie.split('=');
    const tampered = `${name}=${value.slice(0, 10)}${value[10] === 'A' ? 'B' : 'A'}${value.slice(11)}`;

    expect(sessionUserFromCookieHeader(app, tampered, cookieName)).toBeNull();
  });

  it('should return null for a session issued with another key', async () => {
    const other = await buildApp(`other-secret-${randomUUID()}`);
    try {
      const cookie = await loginCookie(other, randomUser());

      expect(sessionUserFromCookieHeader(app, cookie, cookieName)).toBeNull();
    } finally {
      await other.close();
    }
  });

  it('should return null for a valid session without a user', async () => {
    const empty = app.encodeSecureSession(
      app.createSecureSession({ theme: 'dark' }),
    );

    expect(
      sessionUserFromCookieHeader(
        app,
        `${cookieName}=${encodeURIComponent(empty)}`,
        cookieName,
      ),
    ).toBeNull();
  });
});
