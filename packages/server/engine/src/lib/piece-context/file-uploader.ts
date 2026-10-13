import { apId } from '@inboxfm-connect/core-utils'
import { FilesService } from '@inboxfm-connect/pieces-framework'
import { FileSizeError, FileType } from '@inboxfm-connect/shared'
import { engineFileApi } from '../api/engine-file-api'

export function createFileUploader({ engineToken, apiUrl }: CreateFileUploaderParams): FilesService {
    // Number of an unset/non-numeric AP_MAX_FILE_SIZE_MB is NaN, and
    // `data.length > NaN` is always false — which would fail the size guard
    // open exactly when its configuration is wrong. Fall back to the platform
    // default (mirrors the API's MAX_FILE_SIZE_MB default) instead.
    const parsedMaxFileSizeMb = Number(process.env.AP_MAX_FILE_SIZE_MB)
    const maxFileSizeMb = Number.isFinite(parsedMaxFileSizeMb) ? parsedMaxFileSizeMb : DEFAULT_MAX_FILE_SIZE_MB
    return {
        write: async ({ fileName, data }: { fileName: string, data: Buffer }): Promise<string> => {
            if (!Buffer.isBuffer(data)) {
                throw new Error(
                    `Expected file data to be a Buffer, but received ${typeof data === 'object' ? Object.prototype.toString.call(data) : typeof data}`,
                )
            }
            validateFileSize(data, maxFileSizeMb)
            const { readUrl } = await engineFileApi.upload({
                engineToken,
                apiUrl,
                fileId: apId(),
                type: FileType.FLOW_STEP_FILE,
                fileName,
                data,
            })
            return readUrl
        },
    }
}

function validateFileSize(data: Buffer, maxFileSizeMb: number): void {
    const maximumFileSizeInBytes = maxFileSizeMb * 1024 * 1024
    if (data.length > maximumFileSizeInBytes) {
        throw new FileSizeError(data.length / 1024 / 1024, maxFileSizeMb)
    }
}

const DEFAULT_MAX_FILE_SIZE_MB = 25

type CreateFileUploaderParams = {
    apiUrl: string
    engineToken: string
}
