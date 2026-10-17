/**
 * Whether the login browser may open a window.
 *
 * HEADFUL=true asks for one, which an interactive or MFA login needs. Only an
 * environment that cannot show a window overrides it: a container, CI, or a
 * Linux host with neither DISPLAY nor WAYLAND_DISPLAY. The transport is not a
 * signal: an MCP client always starts this server with stdin as a pipe, and
 * Windows and macOS have no DISPLAY.
 */
export function resolveHeadful(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): { headful: boolean; overridden?: string } {
  if (env.HEADFUL !== 'true') return { headful: false };
  if (env.DOCKER_ENV === 'true') return { headful: false, overridden: 'DOCKER_ENV=true' };
  if (env.CI === 'true') return { headful: false, overridden: 'CI=true' };
  if (platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY) {
    return { headful: false, overridden: 'no DISPLAY or WAYLAND_DISPLAY on Linux' };
  }
  return { headful: true };
}
