import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { User } from '@prisma/client';

export const CurrentUser = createParamDecorator(
  (data: never, context: ExecutionContext) =>
    context.switchToHttp().getRequest().user as User,
);
