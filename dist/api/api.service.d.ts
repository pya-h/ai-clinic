import { ConfigService } from '@nestjs/config';
import { AxiosResponse } from 'axios';
export declare enum CommonHttpMethods {
    GET = "get",
    POST = "post",
    PATCH = "patch",
    PUT = "put",
    DELETE = "delete"
}
export declare class ApiService {
    private readonly configService;
    private api;
    private jwtToken;
    private baseURL;
    private timeout;
    constructor(configService: ConfigService);
    updateInstance(): void;
    set BaseURL(value: string);
    set Timeout(value: number);
    static wrapResponse(response: AxiosResponse<any, any>): any;
    set JwtToken(token: string);
    request(method: CommonHttpMethods, url: string, { queries, body, headers, }?: {
        queries?: Record<string, unknown>;
        body?: Record<string, unknown>;
        headers?: Record<string, string>;
    }): Promise<any>;
    get(url: string, queries?: Record<string, unknown>, headers?: Record<string, string>): Promise<AxiosResponse<any, any>>;
    post(url: string, body?: Record<string, unknown>, { queries, headers, }?: {
        queries?: Record<string, unknown>;
        headers?: Record<string, string>;
    }): Promise<AxiosResponse<any, any>>;
    patch(url: string, body?: Record<string, unknown>, { queries, headers, }?: {
        queries?: Record<string, unknown>;
        headers?: Record<string, string>;
    }): Promise<AxiosResponse<any, any>>;
    put(url: string, body?: Record<string, unknown>, { queries, headers, }?: {
        queries?: Record<string, unknown>;
        headers?: Record<string, string>;
    }): Promise<AxiosResponse<any, any>>;
    delete(url: string, queries?: Record<string, unknown>, headers?: Record<string, string>): Promise<AxiosResponse<any, any>>;
    getHeader(jwtToken?: any): {
        Authorization?: string;
        'Content-Type': string;
    };
    queryToString(queryList: Record<string, unknown>): string;
}
