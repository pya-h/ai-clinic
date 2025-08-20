"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.approximate = exports.generateRandomString = void 0;
const generateRandomString = ({ length = 10, prefix = '', }) => {
    const sourceChars = '0123456789abcdefghijklmnopqrstudvwxyz0123456789';
    return (prefix +
        Array(length)
            .fill(null)
            .map(() => sourceChars[(Math.random() * sourceChars.length) | 0])
            .join(''));
};
exports.generateRandomString = generateRandomString;
const approximate = (num, method = 'floor', precision = 2) => {
    const precisionTenth = 10 ** precision;
    return Math[method](num * precisionTenth) / precisionTenth;
};
exports.approximate = approximate;
//# sourceMappingURL=index.js.map