"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var ApiService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiService = exports.CommonHttpMethods = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const axios_1 = require("axios");
var CommonHttpMethods;
(function (CommonHttpMethods) {
    CommonHttpMethods["GET"] = "get";
    CommonHttpMethods["POST"] = "post";
    CommonHttpMethods["PATCH"] = "patch";
    CommonHttpMethods["PUT"] = "put";
    CommonHttpMethods["DELETE"] = "delete";
})(CommonHttpMethods || (exports.CommonHttpMethods = CommonHttpMethods = {}));
let ApiService = ApiService_1 = class ApiService {
    constructor(configService) {
        this.configService = configService;
        this.jwtToken = null;
        this.baseURL = null;
        this.timeout = null;
        this.api = axios_1.default.create({});
    }
    updateInstance() {
        this.api = axios_1.default.create({
            ...(this.baseURL?.length ? { baseURL: this.baseURL } : {}),
            ...(this.timeout ? { timeout: this.timeout } : {})
        });
    }
    set BaseURL(value) {
        this.baseURL = value;
        this.updateInstance();
    }
    set Timeout(value) {
        this.timeout = value;
        this.updateInstance();
    }
    static wrapResponse(response) {
        const { data, status } = response;
        if (!data) {
            return { status };
        }
        data.status = status;
        return data;
    }
    set JwtToken(token) {
        this.jwtToken = token;
    }
    async request(method, url, { queries = null, body = null, headers = {}, } = {}) {
        const fullPath = queries ? url + this.queryToString(queries) : url;
        const response = await this.api.request({
            method: method.toString(),
            url: fullPath,
            ...(body ? { data: body } : {}),
            headers: { ...this.getHeader(this.jwtToken), ...headers },
            validateStatus: (status) => status >= 200 && status < 500,
        });
        return ApiService_1.wrapResponse(response);
    }
    async get(url, queries, headers = {}) {
        const fullPath = queries ? url + this.queryToString(queries) : url;
        return this.api.get(fullPath, {
            headers: { ...this.getHeader(this.jwtToken), ...headers },
        });
    }
    async post(url, body, { queries = null, headers = {}, } = {}) {
        const fullPath = queries ? url + this.queryToString(queries) : url;
        return this.api.post(fullPath, body, {
            headers: { ...this.getHeader(this.jwtToken), ...headers },
        });
    }
    async patch(url, body, { queries = null, headers = {}, } = {}) {
        const fullPath = queries ? url + this.queryToString(queries) : url;
        return this.api.patch(fullPath, body, {
            headers: { ...this.getHeader(this.jwtToken), ...headers },
        });
    }
    async put(url, body, { queries = null, headers = {}, } = {}) {
        const fullPath = queries ? url + this.queryToString(queries) : url;
        return this.api.put(fullPath, body, {
            headers: { ...this.getHeader(this.jwtToken), ...headers },
        });
    }
    async delete(url, queries, headers = {}) {
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
    queryToString(queryList) {
        const params = Object.entries(queryList ?? {});
        if (!params.length) {
            return '';
        }
        return '?' + params.map(([field, value]) => `${field}=${value}`).join('&');
    }
};
exports.ApiService = ApiService;
exports.ApiService = ApiService = ApiService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], ApiService);
//# sourceMappingURL=api.service.js.map