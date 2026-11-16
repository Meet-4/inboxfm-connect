import { createAction, Property } from '@inboxfm-connect/pieces-framework';
import { endClient, getClient, getProtocolBackwardCompatibility } from '../common';
import { sftpAuth } from '../auth';
import { Client as FTPClient, FTPError } from 'basic-ftp';
import Client from 'ssh2-sftp-client';
import { getSftpError } from './common';

async function deleteFileFromFTP(client: FTPClient, filePath: string) {
  await client.remove(filePath);
}

async function deleteFileFromSFTP(client: Client, filePath: string) {
  await client.delete(filePath);
}

export const deleteFileAction = createAction({
  audience: 'human',
  auth: sftpAuth,
  name: 'deleteFile',
  displayName: 'Delete file',
  description: 'Deletes a file at given path.',
  props: {
    filePath: Property.ShortText({
      displayName: 'File Path',
      required: true,
      description: 'The path of the file to delete e.g. `./myfolder/test.mp3`',
    }),
  },
  async run(context) {
    const client = await getClient(context.auth.props);
    const filePath = context.propsValue.filePath;
    const protocolBackwardCompatibility = await getProtocolBackwardCompatibility(context.auth.props.protocol);
    try {
      switch (protocolBackwardCompatibility) {
        case 'ftps':
        case 'ftp':
          await deleteFileFromFTP(client as FTPClient, filePath);
          break;
        default:
        case 'sftp':
          await deleteFileFromSFTP(client as Client, filePath);
          break;
      }
      
      return {
        status: 'success',
      };
    }
    catch (err) {
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
