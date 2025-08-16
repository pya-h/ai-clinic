"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IsNumberStringTransformed = IsNumberStringTransformed;
const common_1 = require("@nestjs/common");
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
function IsNumberStringTransformed() {
    return (0, common_1.applyDecorators)((0, class_transformer_1.Transform)(({ value }) => {
        if (!isNaN(value)) {
            return +value;
        }
        return value;
    }), (0, class_validator_1.IsNumber)());
}
//# sourceMappingURL=is-number-string-transformed.decorator.js.map