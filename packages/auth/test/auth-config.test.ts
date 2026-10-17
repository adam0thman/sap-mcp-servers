import { homedir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadAuthConfigFromEnv } from '../src/auth-config.js';

const options = { defaultTokenCacheFile: join(homedir(), 'token-cache.json') };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('loadAuthConfigFromEnv: the shared SSO state path', () => {
  it('falls back to the home directory, not the working directory, when HOME is unset (Windows)', () => {
    vi.stubEnv('HOME', undefined);
    vi.stubEnv('SAP_SSO_STORAGE_STATE', undefined);
    expect(loadAuthConfigFromEnv(options).ssoStorageStateFile).toBe(
      join(homedir(), '.sap-mcp', 'sso-storage-state.json')
    );
  });

  it('keeps HOME first, and SAP_SSO_STORAGE_STATE over both', () => {
    const home = join(homedir(), 'sap-mcp-test-home');
    vi.stubEnv('HOME', home);
    vi.stubEnv('SAP_SSO_STORAGE_STATE', undefined);
    expect(loadAuthConfigFromEnv(options).ssoStorageStateFile).toBe(
      join(home, '.sap-mcp', 'sso-storage-state.json')
    );

    const explicit = join(homedir(), 'explicit-state.json');
    vi.stubEnv('SAP_SSO_STORAGE_STATE', explicit);
    expect(loadAuthConfigFromEnv(options).ssoStorageStateFile).toBe(explicit);
  });

  it('expands ~ to the home directory even when HOME and USERPROFILE are unset', () => {
    vi.stubEnv('HOME', undefined);
    vi.stubEnv('USERPROFILE', undefined);
    vi.stubEnv('SAP_SSO_STORAGE_STATE', '~/state.json');
    expect(loadAuthConfigFromEnv(options).ssoStorageStateFile).toBe(join(homedir(), 'state.json'));
  });
});
