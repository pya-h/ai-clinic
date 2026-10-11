/**
 * Captures the auth middleware a gateway registers in afterInit, so it can be run
 * against a fake socket. Call the returned function once per connection attempt.
 */
export function captureHandshake(gateway: { afterInit(server: any): void }) {
  const server = { use: jest.fn() };
  gateway.afterInit(server);
  const middleware = server.use.mock.calls[0][0];

  return async (headers: Record<string, string> = {}) => {
    const socket: {
      data: Record<string, any>;
      handshake: { headers: Record<string, string> };
    } = {
      data: {},
      handshake: { headers },
    };
    const next = jest.fn();
    await middleware(socket, next);
    return { socket, next };
  };
}

export const flushPromises = () =>
  new Promise((resolve) => setImmediate(resolve));
