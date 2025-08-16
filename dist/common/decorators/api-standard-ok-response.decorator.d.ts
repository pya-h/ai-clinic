export declare function ApiStandardOkResponse<TModel>(model: TModel | [TModel], primitiveOptions?: {
    example?: unknown;
    default?: unknown;
    description?: string;
}): <TFunction extends Function, Y>(target: TFunction | object, propertyKey?: string | symbol, descriptor?: TypedPropertyDescriptor<Y>) => void;
