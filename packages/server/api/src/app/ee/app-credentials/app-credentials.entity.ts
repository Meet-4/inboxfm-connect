import { AppCredential, Project } from '@inboxfm-connect/shared'
import { EntitySchema } from 'typeorm'
import {
    ApIdSchema,
    BaseColumnSchemaPart,
} from '../../database/database-common'

export type AppCredentialSchema = {
    project: Project[]
} & AppCredential

export const AppCredentialEntity = new EntitySchema<AppCredentialSchema>({
    name: 'app_credential',
    columns: {
        ...BaseColumnSchemaPart,
        appName: {
            type: String,
        },
        projectId: ApIdSchema,
        settings: {
            type: 'jsonb',
        },
    },
    indices: [
        {
            name: 'idx_app_credential_project_id_app_name',
            columns: ['projectId', 'appName'],
            unique: true,
        },
    ],
    relations: {
        project: {
            type: 'many-to-one',
            target: 'project',
            onDelete: 'CASCADE',
            joinColumn: true,
            inverseSide: 'appCredentials',
        },
    },
})
