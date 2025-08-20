"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = () => ({
    auth: {
        jwtSecret: process.env.JWT_SECRET,
        jwtExpiry: process.env.JWT_EXPIRY,
        jwtIssuer: process.env.JWT_ISSUER,
        saltRounds: process.env.AUTH_SALT_ROUNDS,
    },
});
//# sourceMappingURL=auth.js.map