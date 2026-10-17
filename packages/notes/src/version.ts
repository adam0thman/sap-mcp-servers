import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

/** The version in this package's package.json, as MCP clients and /health report it. */
function readVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const manifest = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));
    if (typeof manifest.version === 'string' && manifest.version.length > 0) {
      return manifest.version;
    }
  } catch {
    // Stay silent: stdout belongs to the stdio transport.
  }
  return '0.0.0-unknown';
}

export const SERVER_VERSION = readVersion();
