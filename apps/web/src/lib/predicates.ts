export const isString = <Value>(value: Value): value is Value & string => typeof value === "string";

export const isNumber = <Value>(value: Value): value is Value & number => typeof value === "number";

export const isObject = <Value>(value: Value): value is Value & object =>
  typeof value === "object" && value !== null;
