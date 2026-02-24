import { applyDecorators, Type } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger';
import { StandardResponse } from '../classes/standard-response';

function getPrimitiveType(typeName: string) {
  switch (typeName) {
    case 'string':
      return typeof 's';
    case 'number':
      return typeof 0;
    case 'bigint':
      return typeof 0n;
    case 'bool':
    case 'boolean':
      return typeof true;
    case 'object':
      return typeof {};
  }
  return null;
}

export function ApiStandardOkResponse<TModel>(
  model: TModel | [TModel],
  primitiveOptions?: {
    example?: unknown;
    default?: unknown;
    description?: string;
  },
) {
  const isArray = Array.isArray(model);
  const actualModel = isArray ? model[0] : model;
  const possiblePrimitiveType = getPrimitiveType(actualModel as string);

  return applyDecorators(
    ApiExtraModels(StandardResponse, actualModel as Type<unknown>),
    ApiOkResponse({
      schema: {
        allOf: [
          { $ref: getSchemaPath(StandardResponse) },
          {
            properties: {
              ...(actualModel !== 'void'
                ? {
                    contents: possiblePrimitiveType
                      ? {
                          type: isArray ? 'array' : possiblePrimitiveType,
                          ...(isArray
                            ? { items: { type: possiblePrimitiveType } }
                            : {}),
                          ...(primitiveOptions || {}),
                        }
                      : isArray
                        ? {
                            type: 'array',
                            items: {
                              $ref: getSchemaPath(actualModel as Type<unknown>),
                            },
                          }
                        : { $ref: getSchemaPath(actualModel as Type<unknown>) },
                  }
                : { contents: null }),
            },
          },
        ],
      },
    }),
  );
}
