// Fallback used by TypeScript and tests. Metro picks openBackend.native.ts or
// openBackend.web.ts at build time.
import { memoryBackend, type DocBackend } from './backend';

export async function openBackend(_user?: unknown, _vault?: unknown): Promise<DocBackend> {
  return memoryBackend();
}
