"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = () => ({
    general: {
        debug: (process.env.DEBUG || 'false').toLowerCase() === 'true',
        appPort: +process.env.APP_PORT,
        appName: process.env.APP_NAME,
        slogan: process.env.SLOGAN,
    },
});
//# sourceMappingURL=general.js.map