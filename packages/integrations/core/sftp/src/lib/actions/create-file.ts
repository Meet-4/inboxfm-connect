import { createAction, Property } from '@inboxfm-connect/pieces-framework';
import Client from 'ssh2-sftp-client';
import { Client as FTPClient, FTPError } from 'basic-ftp';
import { endClient, getClient, getProtocolBackwardCompatibility } from '../common';
import { sftpAuth } from '../auth';
import { Readable } from 'stream';
import { getSftpError } from './common';

async function createFileWithSFTP(client: Client, fileName: string, fileContent: string) {
    const remotePathExists = await client.exists(fileName);
    if (!remotePathExists) {
        // Extract the directory path from the fileName
        const remoteDirectory = fileName.substring(0, fileName.lastIndexOf('/'));
        // Create the directory if it doesn't exist
        await client.mkdir(remoteDirectory, true);
    }
    await client.put(Buffer.from(fileContent), fileName);
}

async function createFileWithFTP(client: FTPClient, fileName: string, fileContent: string) {
    // Extract the directory path from the fileName
    const remoteDirectory = fileName.substring(0, fileName.lastIndexOf('/'));
    // Create the directory if it doesn't exist
    await client.ensureDir(remoteDirectory);
    // Upload the file content
    const buffer = Buffer.from(fileContent);
    await client.uploadFrom(Readable.from(buffer), fileName);
}

export const createFile = createAction({
  audience: 'human',
    auth: sftpAuth,
    name: 'create_file',
    displayName: 'Create File from Text',
    description: 'Create a new file in the given path',
    props: {
        fileName: Property.ShortText({
            displayName: 'File Path',
            required: true,
        }),
        fileContent: Property.LongText({
            displayName: 'File content',
            required: true,
        }),
    },
    async run(context) {
        const fileName = context.propsValue['fileName'];
        const fileContent = context.propsValue['fileContent'];
        const protocolBackwardCompatibility = await getProtocolBackwardCompatibility(context.auth.props.protocol);    
        const client = await getClient(context.auth.props);

        try {
            switch (protocolBackwardCompatibility) {
                case 'ftps':
                case 'ftp':
                    await createFileWithFTP(client as FTPClient, fileName, fileContent);
                    break;
                default:
                case 'sftp':
                    await createFileWithSFTP(client as Client, fileName, fileContent);
                    break;
            }

            return {
                status: 'success',
            };
        } catch (err) {
          // Rethrow so failures fail the step instead of resolving with
          // an error payload as successful step output (same error-swallow
          // class fixed in the new-file trigger).
          if (err instanceof FTPError) {
              throw new Error(getSftpError(err.code).error);
          }
          throw err;
        } finally {
            await endClient(client, context.auth.props.protocol);
        }
    },
});
