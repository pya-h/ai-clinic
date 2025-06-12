"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = () => ({
    auth: {
        jwtSecret: process.env.JWT_SECRET,
        jwtExpiry: process.env.JWT_EXPIRY,
        jwtIssuer: process.env.JWT_ISSUER,
    },
});
//# sourceMappingURL=auth.js.map