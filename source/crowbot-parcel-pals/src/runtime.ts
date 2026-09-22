/** Module-defined runtime messages, NOT the host's unchanged b/m upload protocol.
 * Compact ASCII keeps every action in 19 bytes without assuming a negotiated MTU.
 * Program tag/run nonce are stale-command routing guards, never an authentication proof.
 */
export const RUNTIME_PREFIX = 'p2';
export type RuntimeOperation = 'a' | 's' | 't';
export function runtimeCommand(tag: string, operation: RuntimeOperation, nonce: string, index = 0): string {
  if (!/^[a-f0-9]{8,16}$/.test(tag) || !/^[a-f0-9]{6}$/.test(nonce)) throw new Error('Invalid runtime routing identifier.');
  if (!['a','s','t'].includes(operation) || !Number.isInteger(index) || index < 0 || index > 255) throw new Error('Invalid runtime action.');
  return RUNTIME_PREFIX + tag.slice(0,8) + operation + nonce + index.toString(16).padStart(2,'0');
}
