"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IsBooleanValue = IsBooleanValue;
const common_1 = require("@nestjs/common");
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
function IsBooleanValue() {
    return (0, common_1.applyDecorators)((0, class_transformer_1.Transform)(({ value }) => {
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
    }), (0, class_validator_1.IsBoolean)());
}
//# sourceMappingURL=is-boolean-value.decorator.js.map