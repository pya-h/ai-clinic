import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosResponse } from 'axios';

export enum CommonHttpMethods {
  GET = 'get',
  POST = 'post',
  PATCH = 'patch',
  PUT = 'put',
  DELETE = 'delete',
}

@Injectable()
export class ApiService {
  private api: AxiosInstance;
  private jwtToken: string = null;
  private baseURL: string = null;
  private timeout: number = null;

  constructor(private readonly configService: ConfigService) {
    this.api = axios.create({
      // timeout: 10000,
    });
  }

  updateInstance() {
    this.api = axios.create({
      ...(this.baseURL?.length ? {baseURL: this.baseURL} : {}),
      ...(this.timeout ? {timeout: this.timeout} : {})
    })
  }

  set BaseURL(value: string) {
    this.baseURL = value;
    this.updateInstance();
  }


  set Timeout(value: number) {
    this.timeout = value;
    this.updateInstance();
  }

  static wrapResponse(response: AxiosResponse<any, any>) {
    const { data, status } = response;
    if (!data) {
      return { status };
    }
    data.status = status;
    return data;
  }

  set JwtToken(token: string) {
    this.jwtToken = token;
  }

  async request(
    method: CommonHttpMethods,
    url: string,
    {
      queries = null,
      body = null,
      headers = {},
    }: {
      queries?: Record<string, unknown>;
      body?: Record<string, unknown>;
      headers?: Record<string, string>;
    } = {},
  ) {
    const fullPath = queries ? url + this.queryToString(queries) : url;
    const response = await this.api.request({
      method: method.toString(),
      url: fullPath,
      ...(body ? { data: body } : {}),
      headers: { ...this.getHeader(this.jwtToken), ...headers },
      validateStatus: (status) => status >= 200 && status < 500,
    });

    return ApiService.wrapResponse(response);
  }

  async get(
    url: string,
    queries?: Record<string, unknown>,
    headers: Record<string, string> = {},
  ) {
    const fullPath = queries ? url + this.queryToString(queries) : url;
    return this.api.get(fullPath, {
      headers: { ...this.getHeader(this.jwtToken), ...headers },
    });
  }

  async post(
    url: string,
    body?: Record<string, unknown>,
    {
      queries = null,
      headers = {},
    }: {
      queries?: Record<string, unknown>;
      headers?: Record<string, string>;
    } = {},
  ) {
    const fullPath = queries ? url + this.queryToString(queries) : url;
    return this.api.post(fullPath, body, {
      headers: { ...this.getHeader(this.jwtToken), ...headers },
    });
  }

  async patch(
    url: string,
    body?: Record<string, unknown>,
    {
      queries = null,
      headers = {},
    }: {
      queries?: Record<string, unknown>;
      headers?: Record<string, string>;
    } = {},
  ) {
    const fullPath = queries ? url + this.queryToString(queries) : url;
    return this.api.patch(fullPath, body, {
      headers: { ...this.getHeader(this.jwtToken), ...headers },
    });
  }

  async put(
    url: string,
    body?: Record<string, unknown>,
    {
      queries = null,
      headers = {},
    }: {
      queries?: Record<string, unknown>;
      headers?: Record<string, string>;
    } = {},
  ) {
    const fullPath = queries ? url + this.queryToString(queries) : url;
    return this.api.put(fullPath, body, {
      headers: { ...this.getHeader(this.jwtToken), ...headers },
    });
  }

  async delete(
    url: string,
    queries?: Record<string, unknown>,
    headers: Record<string, string> = {},
  ) {
    const fullPath = queries ? url + this.queryToString(queries) : url;
    return this.api.delete(fullPath, {
      headers: { ...this.getHeader(this.jwtToken), ...headers },
    });
  }

  getHeader(jwtToken = null) {
    return {
      'Content-Type': 'application/json',
      ...(jwtToken ? { Authorization: `Bearer ${jwtToken}` } : {}),
    };
  }

  queryToString(queryList: Record<string, unknown>) {
    const params = Object.entries(queryList ?? {});
    if (!params.length) {
      return '';
    }
    return '?' + params.map(([field, value]) => `${field}=${value}`).join('&');
  }
}
