import { applyDecorators } from '@nestjs/common';
import { IsEnum } from 'class-validator';

export function IsEnumDetailed(enumModel: object, title: string = '') {
  if (title?.length) {
    title = `'${title}'`;
  }
  return applyDecorators(
    IsEnum(enumModel, {
      message:
        `${title} Supported options are: ` +
        Object.values(enumModel)
          .map((x) => `'${x}'`)
          .join(', '),
    }),
  );
}
