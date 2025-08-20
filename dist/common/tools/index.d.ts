export declare const generateRandomString: ({ length, prefix, }: {
    length?: number;
    prefix?: string;
}) => string;
type ApproximationMethods = 'floor' | 'round' | 'ceil';
export declare const approximate: (num: number, method?: ApproximationMethods, precision?: number) => number;
export {};
