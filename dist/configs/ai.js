"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = () => ({
    openai: {
        key: process.env.OPENAI_API_KEY,
        model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
    },
});
//# sourceMappingURL=ai.js.map