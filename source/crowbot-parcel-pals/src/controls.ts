import type {Action} from './model.js';

/** Route controls follow the uploaded program; they are not absolute map coordinates. */
export type DriveInput = Action | 'next' | 'stop';
export function keyInput(key: string): DriveInput | null {
  if (key === 'ArrowUp') return 'forward';
  if (key === 'ArrowLeft') return 'left';
  if (key === 'ArrowRight') return 'right';
  if (key === 'ArrowDown' || key === 'Escape') return 'stop';
  if (key === ' ' || key === 'Enter') return 'next';
  return null;
}
export const keyLabel = (action?: Action): string => action === 'forward' ? '↑ or Space' : action === 'left' ? '← or Space' : action === 'right' ? '→ or Space' : 'Space or Enter';
export function acceptsInput(input: DriveInput, next?: Action): boolean {
  return !!next && (input === 'next' || input === next);
}
