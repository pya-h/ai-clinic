"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiStandardOkResponse = ApiStandardOkResponse;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const standard_response_1 = require("../classes/standard-response");
function getPrimitiveType(typeName) {
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
function ApiStandardOkResponse(model, primitiveOptions) {
    const isArray = Array.isArray(model);
    const actualModel = isArray ? model[0] : model;
    const possiblePrimitiveType = getPrimitiveType(actualModel);
    return (0, common_1.applyDecorators)((0, swagger_1.ApiExtraModels)(standard_response_1.StandardResponse, actualModel), (0, swagger_1.ApiOkResponse)({
        schema: {
            allOf: [
                { $ref: (0, swagger_1.getSchemaPath)(standard_response_1.StandardResponse) },
                {
                    properties: {
                        ...(actualModel !== 'void'
                            ? {
                                data: possiblePrimitiveType
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
                                                $ref: (0, swagger_1.getSchemaPath)(actualModel),
                                            },
                                        }
                                        : { $ref: (0, swagger_1.getSchemaPath)(actualModel) },
                            }
                            : { data: null }),
                    },
                },
            ],
        },
    }));
}
//# sourceMappingURL=api-standard-ok-response.decorator.js.map