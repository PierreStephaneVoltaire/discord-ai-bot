import { v4 as uuidv4 } from 'uuid';

export function generateExecutionId(): string {
  return uuidv4();
}

export function generateShortId(): string {
  return uuidv4().split('-')[0];
}
