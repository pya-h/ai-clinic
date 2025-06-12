"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResponseTemplateInterceptor = void 0;
const common_1 = require("@nestjs/common");
const rxjs_1 = require("rxjs");
class ResponseTemplateInterceptor {
    intercept(context, next) {
        return next.handle().pipe((0, rxjs_1.map)((data) => {
            const response = context.switchToHttp().getResponse();
            try {
                if (data) {
                    if (data['statusCode'])
                        response.statusCode = data['statusCode'];
                    if (data['message']) {
                        response.message = data['message'];
                        delete data['message'];
                    }
                    else
                        response.message = 'Success!';
                }
                return {
                    message: response.message,
                    data,
                    status: response.statusCode,
                };
            }
            catch (ex) {
                console.error('Could not transform response:', ex);
            }
            return {
                message: 'Unknown Error',
                data: null,
                status: common_1.HttpStatus.INTERNAL_SERVER_ERROR,
            };
        }));
    }
}
exports.ResponseTemplateInterceptor = ResponseTemplateInterceptor;
//# sourceMappingURL=response-template.interceptor.js.map