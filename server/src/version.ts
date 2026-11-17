import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * The one version of the app: the repository's VERSION file. The web app reads the same file at build
 * time (web/vite.config.ts). From server/src or server/dist it is two levels up; the Docker image keeps
 * that layout (/app/VERSION next to /app/server).
 */
export const VERSION_FILE = fileURLToPath(new URL('../../VERSION', import.meta.url))

export const APP_VERSION = readFileSync(VERSION_FILE, 'utf-8').trim()
