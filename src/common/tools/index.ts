export const generateRandomString = ({
  length = 10,
  prefix = '',
}: {
  length?: number;
  prefix?: string;
}) => {
  const sourceChars = '0123456789abcdefghijklmnopqrstuvwxyz';
  return (
    prefix +
    Array(length)
      .fill(null)
      .map(() => sourceChars[(Math.random() * sourceChars.length) | 0])
      .join('')
  );
};

type ApproximationMethods = 'floor' | 'round' | 'ceil';

export const approximate = (
  num: number,
  method: ApproximationMethods = 'floor',
  precision: number = 2,
) => {
  const precisionTenth = 10 ** precision;
  return Math[method](num * precisionTenth) / precisionTenth;
};

export const toCapitalCase = (word: string) => {
  return word.replace(/\b\w/g, (char) => char.toUpperCase());
};

export const truncateString = (str: string, maxLength: number = 20) =>
  str.substring(0, maxLength) + (str.length > maxLength ? '...' : '');
