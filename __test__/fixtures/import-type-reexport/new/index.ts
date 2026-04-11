import type { User } from './types';
export type { User } from './types';

export function getUser(id: number): User {
  return { id, name: 'Alice' };
}
