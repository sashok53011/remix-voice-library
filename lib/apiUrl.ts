/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * API URL helper: the deployed build runs under a sub-path
 * (`https://host/remix-voice-library/` behind the portal proxy), while local
 * dev serves the app from `/`. Vite injects the configured base at build time,
 * so all client fetches must go through here instead of hardcoding `/api/...`.
 */
const BASE: string =
  ((import.meta as any).env?.BASE_URL as string | undefined) || "/";

/** `/api/settings` → `/remix-voice-library/api/settings` (deployed) or `/api/settings` (dev). */
export function apiUrl(path: string): string {
  const normalizedBase = BASE.endsWith("/") ? BASE.slice(0, -1) : BASE;
  return normalizedBase + path;
}
