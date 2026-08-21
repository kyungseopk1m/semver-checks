export interface ClassDictionary {
  [key: string]: string;
}
export type ClassArray = ClassValue[];
export type ClassValue = ClassArray | ClassDictionary | string | number | null | undefined;
