// Consumer re-declares the accepted class input in its own public prop type.
import type { ClassValue, ClassArray, ClassDictionary } from 'clsx';

export type ClassNameProp =
  | ClassArray
  | ClassDictionary
  | string
  | number
  | null
  | boolean
  | undefined;

export function toProp(value: ClassValue): ClassNameProp {
  return value;
}
