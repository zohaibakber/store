export const isString = <Value>(value: Value): value is Value & string => typeof value === "string";

export const isNumber = <Value>(value: Value): value is Value & number => typeof value === "number";
