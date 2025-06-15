import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean } from 'class-validator';

export function IsBooleanValue() {
  return applyDecorators(
    Transform(({ value }) => {
      if (typeof value === 'string') {
        switch (value.toLowerCase()) {
          case '1':
          case 'true':
            return true;
          case '0':
          case 'false':
            return false;
        }
      }
      return value;
    }),
    IsBoolean(),
  );
}
