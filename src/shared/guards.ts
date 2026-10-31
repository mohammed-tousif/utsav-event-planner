/** Narrows a string to one of a fixed list of values, for example a <select> value to its option type. */
export function isOneOf<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value);
}
