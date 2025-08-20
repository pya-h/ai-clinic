export declare enum StandardResponseStatusEnum {
    SUCCESS = "success",
    ERROR = "error"
}
export declare class StandardResponse<T> {
    status: StandardResponseStatusEnum;
    data?: T;
    message?: string;
    fields?: object;
    constructor(status: StandardResponseStatusEnum, data?: T, message?: string, fields?: object);
}
