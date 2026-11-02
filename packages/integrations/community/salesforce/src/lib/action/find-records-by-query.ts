import { Property, createAction } from '@inboxfm-connect/pieces-framework';
import { HttpMethod } from '@inboxfm-connect/pieces-common';
import { salesforceAuth } from '../..';
import { querySalesforceApi, salesforcesCommon } from '../common';

export const findRecordsByQuery = createAction({
    auth: salesforceAuth,
    name: 'find_records_by_query',
    displayName: 'Find Records by Query (Advanced)',
    description:
        'Finds records in an object using a SOQL WHERE clause. Returns up to 1000 matching records with all fields (fetched in batches of 200 due to a Salesforce FIELDS(ALL) constraint).',
    audience: 'both',
    aiMetadata: { description: 'Search records of one Salesforce object by providing the object API name and a SOQL WHERE clause (no "WHERE" keyword); returns up to 1000 matching records with all fields, following pagination in batches of 200. Use this to look up or filter existing records by field conditions. Read-only and idempotent. Constraint: the WHERE clause is interpolated directly into the query, so it must be valid SOQL and properly escaped.', idempotent: true },
    props: {
        object: salesforcesCommon.object,
        where_clause: Property.ShortText({
            displayName: 'WHERE Clause',
            description: "Enter the WHERE clause for your SOQL query. For example: `Name = 'Acme' AND Industry = 'Technology'`. Do not include the 'WHERE' keyword.",
            required: true,
        })
    },
    async run(context) {
        const { object, where_clause } = context.propsValue;

        if (!object) {
            throw new Error('Object must be selected.');
        }

        // FIELDS(ALL) is only supported by the REST API when the result rows
        // are limited (LIMIT <= 200, or WHERE Id IN a list of up to 200 ids):
        // https://developer.salesforce.com/docs/atlas.en-us.soql_sosl.meta/soql_sosl/sforce_api_calls_soql_select_fields.htm
        // A single `SELECT FIELDS(ALL) ... LIMIT 200` request therefore
        // silently drops matches beyond the first 200. Instead, fetch the
        // matching record Ids first (no FIELDS(ALL) row limit applies), then
        // fetch the full records in doc-blessed Id-IN chunks and merge them.
        const MAX_RECORDS = 1000; // bounded walk
        const CHUNK_SIZE = 200; // FIELDS(ALL) allows WHERE Id IN up to 200 ids

        const idQuery = `SELECT Id FROM ${object} WHERE ${where_clause} LIMIT ${MAX_RECORDS}`;
        const idResponse = await querySalesforceApi<{
            records: { Id: string }[];
        }>(HttpMethod.GET, context.auth, idQuery);

        const ids = (idResponse.body?.records ?? []).map(
            (record) => record.Id
        );

        const records: Record<string, unknown>[] = [];

        for (let index = 0; index < ids.length; index += CHUNK_SIZE) {
            const chunk = ids
                .slice(index, index + CHUNK_SIZE)
                .map((id) => `'${id.replace(/'/g, "\\'")}'`)
                .join(',');

            const recordQuery = `SELECT FIELDS(ALL) FROM ${object} WHERE Id IN (${chunk})`;
            const response = await querySalesforceApi<{
                records: Record<string, unknown>[];
            }>(HttpMethod.GET, context.auth, recordQuery);

            records.push(...(response.body?.records ?? []));
        }

        return {
            totalSize: records.length,
            done: true,
            records,
        };
    },
});