import { SetMetadata } from '@nestjs/common';

export const SKIP_CSRF_KEY = 'skipCsrf';

/**
 * Exempts one route from CsrfGuard. Only for routes whose caller proves itself
 * another way (e.g. a signed webhook), never for cookie-authenticated ones.
 */
export const SkipCsrf = (): MethodDecorator => SetMetadata(SKIP_CSRF_KEY, true);
