import { randomUUID } from 'node:crypto';

export type IdPrefix = 'msg' | 'step' | 'sess' | 'sbx' | 'run' | 'usr';

export function generateId(prefix: IdPrefix): string {
  const uuidShort = randomUUID().slice(0, 8);
  return `${prefix}_${Date.now().toString(36)}_${uuidShort}`;
}
