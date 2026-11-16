  import { sftpAuth } from '../auth';
import { endClient, getClient, getProtocolBackwardCompatibility } from '../../index';
import { Property, createAction } from '@inboxfm-connect/pieces-framework';
import Client from 'ssh2-sftp-client';
import { Client as FTPClient, FTPError } from 'basic-ftp';
import { getSftpError } from './common';

export const createFolderAction = createAction({
  audience: 'human',
  auth: sftpAuth,
  name: 'createFolder',
  displayName: 'Create Folder',
  description: 'Creates a folder at given path.',
  props: {
    folderPath: Property.ShortText({
      displayName: 'Folder Path',
      required: true,
      description: 'The new folder path e.g. `./myfolder`. For FTP/FTPS, it will create nested folders if necessary.',
    }),
    recursive: Property.Checkbox({
      displayName: 'Recursive',
      defaultValue: false,
      required: false,
      description: 'For SFTP only: Create parent directories if they do not exist',
    }),
  },
  async run(context) {
    const client = await getClient(context.auth.props);
    const directoryPath = context.propsValue.folderPath;
    const recursive = context.propsValue.recursive ?? false;
    const protocolBackwardCompatibility = await getProtocolBackwardCompatibility(context.auth.props.protocol);
    try {
      switch (protocolBackwardCompatibility) {
        case 'ftps':
        case 'ftp':
          await (client as FTPClient).ensureDir(directoryPath);
          break;
        default:
        case 'sftp':
          await (client as Client).mkdir(directoryPath, recursive);
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
