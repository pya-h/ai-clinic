import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsNumber } from 'class-validator';

export function IsNumberStringTransformed() {
  return applyDecorators(
    Transform(({ value }) => {
      if (!isNaN(value)) {
        return +value;
      }
      return value;
    }),
    IsNumber(),
  );
}
