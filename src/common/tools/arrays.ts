export function fastFilter<T = Record<string, unknown>>(
  items: Array<T>,
  field: keyof T,
  criteria: (item: unknown) => boolean,
  skip?: number,
  take?: number,
) {
  const offset = +(skip ?? 0);
  const limit = +(take ?? 0);
  const result: T[] = [];
  let matched = 0;

  for (const item of items) {
    if (criteria(item[field]) && matched++ >= offset) {
      result.push(item);
      if (take && result.length >= limit) {
        break;
      }
    }
  }
  return result;
}

export function splitIn2<T>(
  items: Array<T> | Set<T>,
  condition: (item: T) => boolean,
) {
  let trues: T[] = [],
    falses: T[] = [];

  for (const item of items) {
    (condition(item) ? trues : falses).push(item);
  }
  return [trues, falses];
}

export function splitIn2Set<T>(
  items: Array<T> | Set<T>,
  condition: (item: T) => boolean,
) {
  let trues = new Set<T>(),
    falses = new Set<T>();

  for (const item of items) {
    (condition(item) ? trues : falses).add(item);
  }
  return [trues, falses];
}
