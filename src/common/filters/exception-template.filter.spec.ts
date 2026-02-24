/**
 * ExceptionTemplateFilter Unit Tests
 *
 * Tests:
 *   - HttpException with string message
 *   - HttpException with array message (validation errors, joined with '; ')
 *   - Non-HttpException (generic error) returns 500
 *   - Response body format: { status, message, contents: null, timestamp, path }
 */
import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { ExceptionTemplateFilter } from './exception-template.filter';

// ─── Helpers ────────────────────────────────────────────────────────────────────

function createMockHost(url = '/test-path'): {
  host: ArgumentsHost;
  sendFn: jest.Mock;
  statusFn: jest.Mock;
} {
  const sendFn = jest.fn();
  const statusFn = jest.fn().mockReturnValue({ send: sendFn });

  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ url }),
      getResponse: () => ({ status: statusFn }),
    }),
  } as unknown as ArgumentsHost;

  return { host, sendFn, statusFn };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('ExceptionTemplateFilter', () => {
  let filter: ExceptionTemplateFilter;

  beforeEach(() => {
    filter = new ExceptionTemplateFilter();
  });

  it('should handle HttpException with string response (no .message property)', () => {
    const { host, sendFn, statusFn } = createMockHost('/api/test');
    // When HttpException gets a plain string, getResponse() returns that string,
    // so responseBody['message'] is undefined → falls back to 'Unknown Error'
    const exception = new HttpException('Something went wrong', HttpStatus.BAD_REQUEST);

    filter.catch(exception, host);

    expect(statusFn).toHaveBeenCalledWith(400);
    const body = sendFn.mock.calls[0][0];
    expect(body).toMatchObject({
      status: 400,
      message: 'Unknown Error',
      contents: null,
      path: '/api/test',
    });
    expect(body.timestamp).toBeDefined();
  });

  it('should handle HttpException with object response containing message string', () => {
    const { host, sendFn, statusFn } = createMockHost('/api/test');
    const exception = new HttpException(
      { statusCode: 400, message: 'Something went wrong' },
      HttpStatus.BAD_REQUEST,
    );

    filter.catch(exception, host);

    expect(statusFn).toHaveBeenCalledWith(400);
    const body = sendFn.mock.calls[0][0];
    expect(body).toMatchObject({
      status: 400,
      message: 'Something went wrong',
      contents: null,
      path: '/api/test',
    });
  });

  it('should handle HttpException with object response containing string message', () => {
    const { host, sendFn, statusFn } = createMockHost('/api/resource');
    const exception = new HttpException(
      { statusCode: 422, message: 'Validation failed' },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );

    filter.catch(exception, host);

    expect(statusFn).toHaveBeenCalledWith(422);
    const body = sendFn.mock.calls[0][0];
    expect(body.message).toBe('Validation failed');
    expect(body.contents).toBeNull();
  });

  it('should join array messages with "; " (class-validator style)', () => {
    const { host, sendFn, statusFn } = createMockHost('/api/users');
    const exception = new HttpException(
      { statusCode: 400, message: ['email must be valid', 'name is required'] },
      HttpStatus.BAD_REQUEST,
    );

    filter.catch(exception, host);

    expect(statusFn).toHaveBeenCalledWith(400);
    const body = sendFn.mock.calls[0][0];
    expect(body.message).toBe('email must be valid; name is required');
  });

  it('should return 500 for non-HttpException errors', () => {
    const { host, sendFn, statusFn } = createMockHost('/api/crash');
    const exception = new Error('Unexpected failure');

    filter.catch(exception, host);

    expect(statusFn).toHaveBeenCalledWith(500);
    const body = sendFn.mock.calls[0][0];
    expect(body).toMatchObject({
      status: 500,
      message: 'Internal Server Error',
      contents: null,
      path: '/api/crash',
    });
  });

  it('should return 500 for non-Error throwables', () => {
    const { host, sendFn, statusFn } = createMockHost('/api/unexpected');

    filter.catch('string thrown', host);

    expect(statusFn).toHaveBeenCalledWith(500);
    const body = sendFn.mock.calls[0][0];
    expect(body.status).toBe(500);
    expect(body.message).toBe('Internal Server Error');
  });

  it('should include an ISO timestamp in every response', () => {
    const { host, sendFn } = createMockHost();
    filter.catch(new HttpException('test', 200), host);

    const body = sendFn.mock.calls[0][0];
    // ISO 8601 format check
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });

  it('should always return the correct response shape', () => {
    const { host, sendFn } = createMockHost('/path');
    filter.catch(new HttpException('msg', 403), host);

    const body = sendFn.mock.calls[0][0];
    expect(Object.keys(body).sort()).toEqual(
      ['contents', 'message', 'path', 'status', 'timestamp'].sort(),
    );
  });
});
