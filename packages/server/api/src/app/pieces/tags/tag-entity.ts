import { Platform, Tag } from '@inboxfm-connect/shared'
import { EntitySchema } from 'typeorm'
import {
    BaseColumnSchemaPart,
} from '../../database/database-common'

export type TagEntitySchema = Tag & {
    platform: Platform
}
export const TagEntity = new EntitySchema<TagEntitySchema>({
    name: 'tag',
    columns: {
        ...BaseColumnSchemaPart,
        platformId: {
            type: String,
        },
        name: {
            type: String,
        },
    },    
    uniques: [
        {
            columns: ['platformId', 'name'],
        },
    ],
    relations: {
        platform: {
            target: 'platform',
            type: 'many-to-one',
            cascade: true,
            // Platform-scoped like every table around it (execution, api_key, oauth_app,
            // ...): hardDeletePlatformHandler (platform-jobs.ts) deletes the platform row
            // relying on ON DELETE CASCADE and has no tag-specific cleanup — the TypeORM
            // default (NO ACTION) made that delete fail with an FK violation for any
            // platform that ever saved a piece tag.
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'platformId',
            },
        },
    },
})
