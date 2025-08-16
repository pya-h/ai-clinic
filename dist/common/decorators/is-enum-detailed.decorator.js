"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IsEnumDetailed = IsEnumDetailed;
const common_1 = require("@nestjs/common");
const class_validator_1 = require("class-validator");
function IsEnumDetailed(enumModel, title = '') {
    if (title?.length) {
        title = `'${title}'`;
    }
    return (0, common_1.applyDecorators)((0, class_validator_1.IsEnum)(enumModel, {
        message: `${title} Supported options are: ` +
            Object.values(enumModel)
                .map((x) => `'${x}'`)
                .join(', '),
    }));
}
//# sourceMappingURL=is-enum-detailed.decorator.js.map