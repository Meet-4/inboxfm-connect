import { PieceTag, Platform, Tag } from '@inboxfm-connect/shared'
import { EntitySchema } from 'typeorm'
import { BaseColumnSchemaPart } from '../../../database/database-common'

export type PieceTagSchema = PieceTag & {
    tag: Tag
    platform: Platform
}
export const PieceTagEntity = new EntitySchema<PieceTagSchema>({
    name: 'piece_tag',
    columns: {
        ...BaseColumnSchemaPart,
        platformId: {
            type: String,
        },
        pieceName: {
            type: String,
        },
        tagId: {
            type: String,
        },
    },
    uniques: [
        {
            columns: ['tagId', 'pieceName'],
        },
    ],
    indices: [
        {
            name: 'tag_platformId',
            columns: ['platformId'],
        },
    ],
    relations: {
        tag: {
            target: 'tag',
            type: 'many-to-one',
            cascade: true,
            // Piece tags die with their tag: tagService.delete already removes them
            // explicitly, but the database-level cascade is what hardDeletePlatformHandler
            // relies on when it deletes the platform (and then the tag rows) in one
            // statement. See tag-entity.ts for the matching platformId rationale.
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'tagId',
            },
        },
        platform: {
            target: 'platform',
            type: 'many-to-one',
            cascade: true,
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'platformId',
            },
        },
    },
})
