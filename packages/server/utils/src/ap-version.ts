import { isNil } from '@inboxfm-connect/core-utils';
import fs from 'fs'
import path from 'path'
import { apLogger } from './ap-logger'
import { safeHttp } from './safe-http'

const logger = apLogger.create()

let cachedCurrentRelease: string | undefined

function readCurrentRelease(): string {
    if (cachedCurrentRelease !== undefined) {
        return cachedCurrentRelease
    }
    const packageJsonPath = path.resolve(process.cwd(), 'package.json')
    try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as PackageJson
        if (typeof packageJson.version !== 'string') {
            logger.warn({ packageJsonPath }, 'package.json has no string "version" field, defaulting current release to 0.0.0')
            cachedCurrentRelease = UNKNOWN_VERSION
        }
        else {
            cachedCurrentRelease = packageJson.version
        }
    }
    catch (e) {
        logger.warn({ error: e, packageJsonPath, cwd: process.cwd() }, 'failed to read package.json, defaulting current release to 0.0.0')
        cachedCurrentRelease = UNKNOWN_VERSION
    }
    return cachedCurrentRelease
}

export const apVersionUtil = {
    getCurrentRelease(): string {
        return readCurrentRelease()
    },
    async getLatestRelease(): Promise<string> {
        try {
            const response = await safeHttp.createAxios({ validateStatus: () => true }).get(
                'https://raw.githubusercontent.com/activepieces/activepieces/main/package.json',
                {
                    timeout: 5000,
                },
            )
            // validateStatus: () => true means 404s/rate-limits resolve instead
            // of throwing, and the failure bodies are plain text with no
            // `.version` — return the read-failure sentinel so the health
            // payload's latestVersion stays a string.
            const data = response.data as PackageJson | undefined
            if (typeof data?.version !== 'string' || data.version.length === 0) {
                return UNKNOWN_VERSION
            }
            return data.version
        }
        catch (ex) {
            return UNKNOWN_VERSION
        }
    },
    //could be null if the other is running on something older than 0.85.0
    versionsAreCompatible({ versionA, versionB }: { versionA: string | undefined, versionB: string | undefined }): boolean {
        if (isNil(versionA) || isNil(versionB)) {
            return false
        }
        if (versionA === UNKNOWN_VERSION || versionB === UNKNOWN_VERSION) {
            return false
        }
        return versionA === versionB
    },
}

export const UNKNOWN_VERSION = '0.0.0'

type PackageJson = {
    version: string
}
