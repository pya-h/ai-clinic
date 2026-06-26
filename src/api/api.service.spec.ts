import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ApiService, CommonHttpMethods } from './api.service';

jest.mock('axios', () => {
  const mockInstance = {
    request: jest.fn(),
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  };
  return {
    __esModule: true,
    default: {
      create: jest.fn(() => mockInstance),
    },
  };
});

import axios from 'axios';

describe('ApiService', () => {
  let service: ApiService;
  let mockAxios: any;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiService,
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    service = module.get<ApiService>(ApiService);
    mockAxios = (axios.create as jest.Mock).mock.results[0]?.value;
  });

  describe('BaseURL setter', () => {
    it('should recreate axios instance with baseURL', () => {
      service.BaseURL = 'https://api.example.com';
      expect(axios.create).toHaveBeenCalledWith(
        expect.objectContaining({ baseURL: 'https://api.example.com' }),
      );
    });
  });

  describe('Timeout setter', () => {
    it('should recreate axios instance with timeout', () => {
      service.Timeout = 5000;
      expect(axios.create).toHaveBeenCalledWith(
        expect.objectContaining({ timeout: 5000 }),
      );
    });
  });

  describe('JwtToken setter', () => {
    it('should set the token for auth headers', () => {
      service.JwtToken = 'my-token';
      const header = service.getHeader('my-token');
      expect(header.Authorization).toBe('Bearer my-token');
    });
  });

  describe('getHeader', () => {
    it('should return Content-Type header without token', () => {
      const header = service.getHeader(null);
      expect(header).toEqual({ 'Content-Type': 'application/json' });
      expect(header).not.toHaveProperty('Authorization');
    });

    it('should include Authorization when token is provided', () => {
      const header = service.getHeader('jwt-abc');
      expect(header).toEqual({
        'Content-Type': 'application/json',
        Authorization: 'Bearer jwt-abc',
      });
    });
  });

  describe('queryToString', () => {
    it('should convert query object to URL params', () => {
      const result = service.queryToString({ page: 1, limit: 10 });
      expect(result).toBe('?page=1&limit=10');
    });

    it('should return empty string for empty object', () => {
      const result = service.queryToString({});
      expect(result).toBe('');
    });

    it('should handle string values', () => {
      const result = service.queryToString({ name: 'test', active: true });
      expect(result).toBe('?name=test&active=true');
    });
  });

  describe('wrapResponse', () => {
    it('should add status to data', () => {
      const response = { data: { message: 'ok' }, status: 200 } as any;
      const result = ApiService.wrapResponse(response);
      expect(result).toEqual({ message: 'ok', status: 200 });
    });

    it('should return only status when data is null', () => {
      const response = { data: null, status: 204 } as any;
      const result = ApiService.wrapResponse(response);
      expect(result).toEqual({ status: 204 });
    });
  });

  describe('get', () => {
    it('should call axios.get with correct URL and headers', async () => {
      mockAxios.get.mockResolvedValue({ data: { items: [] } });

      await service.get('/users');

      expect(mockAxios.get).toHaveBeenCalledWith('/users', {
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      });
    });

    it('should append query params to URL', async () => {
      mockAxios.get.mockResolvedValue({ data: {} });

      await service.get('/users', { page: 1 });

      expect(mockAxios.get).toHaveBeenCalledWith('/users?page=1', expect.any(Object));
    });

    it('should include custom headers', async () => {
      mockAxios.get.mockResolvedValue({ data: {} });

      await service.get('/users', undefined, { 'X-Custom': 'value' });

      expect(mockAxios.get).toHaveBeenCalledWith('/users', {
        headers: expect.objectContaining({ 'X-Custom': 'value' }),
      });
    });
  });

  describe('post', () => {
    it('should call axios.post with body and headers', async () => {
      mockAxios.post.mockResolvedValue({ data: { id: 1 } });

      await service.post('/users', { name: 'John' });

      expect(mockAxios.post).toHaveBeenCalledWith(
        '/users',
        { name: 'John' },
        { headers: expect.objectContaining({ 'Content-Type': 'application/json' }) },
      );
    });

    it('should append query params when provided', async () => {
      mockAxios.post.mockResolvedValue({ data: {} });

      await service.post('/users', { name: 'John' }, { queries: { ref: 'abc' } });

      expect(mockAxios.post).toHaveBeenCalledWith(
        '/users?ref=abc',
        { name: 'John' },
        expect.any(Object),
      );
    });
  });

  describe('patch', () => {
    it('should call axios.patch with body', async () => {
      mockAxios.patch.mockResolvedValue({ data: {} });

      await service.patch('/users/1', { name: 'Jane' });

      expect(mockAxios.patch).toHaveBeenCalledWith(
        '/users/1',
        { name: 'Jane' },
        expect.any(Object),
      );
    });
  });

  describe('put', () => {
    it('should call axios.put with body', async () => {
      mockAxios.put.mockResolvedValue({ data: {} });

      await service.put('/users/1', { name: 'Jane' });

      expect(mockAxios.put).toHaveBeenCalledWith(
        '/users/1',
        { name: 'Jane' },
        expect.any(Object),
      );
    });
  });

  describe('delete', () => {
    it('should call axios.delete', async () => {
      mockAxios.delete.mockResolvedValue({ data: {} });

      await service.delete('/users/1');

      expect(mockAxios.delete).toHaveBeenCalledWith('/users/1', expect.any(Object));
    });

    it('should append query params', async () => {
      mockAxios.delete.mockResolvedValue({ data: {} });

      await service.delete('/users/1', { force: true });

      expect(mockAxios.delete).toHaveBeenCalledWith('/users/1?force=true', expect.any(Object));
    });
  });

  describe('request', () => {
    it('should call axios.request with correct config', async () => {
      mockAxios.request.mockResolvedValue({ data: { ok: true }, status: 200 });

      const result = await service.request(CommonHttpMethods.GET, '/health');

      expect(mockAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'get',
          url: '/health',
        }),
      );
      expect(result).toEqual({ ok: true, status: 200 });
    });

    it('should include body as data for POST', async () => {
      mockAxios.request.mockResolvedValue({ data: {}, status: 201 });

      await service.request(CommonHttpMethods.POST, '/items', {
        body: { name: 'item' },
      });

      expect(mockAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({ data: { name: 'item' } }),
      );
    });

    it('should include Authorization header when JWT is set', async () => {
      service.JwtToken = 'my-jwt';
      mockAxios.request.mockResolvedValue({ data: {}, status: 200 });

      await service.request(CommonHttpMethods.GET, '/protected');

      expect(mockAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer my-jwt',
          }),
        }),
      );
    });
  });
});
