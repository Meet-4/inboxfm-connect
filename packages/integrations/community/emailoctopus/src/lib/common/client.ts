import { httpClient, HttpMethod, HttpRequest } from "@inboxfm-connect/pieces-common";

export const emailOctopusApiUrl = 'https://api.emailoctopus.com';


export interface EmailOctopusListDetails extends EmailOctopusList {
    fields: {
        tag: string;
        type: 'text' | 'number' | 'date'|'choice_single'|'choice_multiple'
        label: string;
        choices:string[]
    }[];
}

export class EmailOctopusClient {
    constructor(private apiKey: string) {}

    async makeRequest<T>(method: HttpMethod, url: string, body?: object): Promise<T> {
        const request: HttpRequest<object> = {
            method,
            url: `${emailOctopusApiUrl}${url}`,
            body: body,
            headers: {
                "Accept": "application/json",
                "Content-Type": "application/json",
                "Authorization":`Bearer ${this.apiKey}`
            },
        };

        const { body: responseBody } = await httpClient.sendRequest<T>(request);
        return responseBody;
    }

    // EmailOctopus paginates collections with `limit` (1-100) and a cursor
    // from the response's `paging.next.cursor`; the cursor-less default call
    // returned only the first page (10 records). Walk the documented pages
    // under a bounded budget.
    // https://emailoctopus.com/api-documentation/lists/
    async getPaged<T>(path: string): Promise<{ items: T[]; truncated: boolean }> {
        const items: T[] = [];
        const PAGE_SIZE = 100;
        const MAX_PAGES = 10;
        let cursor: string | undefined = undefined;

        for (let page = 0; page < MAX_PAGES; page++) {
            const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
            if (cursor) {
                query.set('page[cursor]', cursor);
            }
            const response = await this.makeRequest<{
                data: T[];
                paging?: { next?: { cursor?: string } };
            }>(HttpMethod.GET, `${path}?${query.toString()}`);
            items.push(...(response.data ?? []));
            const nextCursor = response.paging?.next?.cursor;
            if (!nextCursor) {
                return { items, truncated: false };
            }
            cursor = nextCursor;
        }
        return { items, truncated: true };
    }

    async getLists(): Promise<{ items: EmailOctopusList[]; truncated: boolean }> {
        return this.getPaged<EmailOctopusList>('/lists');
    }
    

    async getList(listId: string): Promise<EmailOctopusListDetails> {
        return await this.makeRequest<EmailOctopusListDetails>(
            HttpMethod.GET,
            `/lists/${listId}`
        );
    }

    async getCampaigns(): Promise<{ items: EmailOctopusCampaign[]; truncated: boolean }> {
        return this.getPaged<EmailOctopusCampaign>('/campaigns');
    }
}

export interface EmailOctopusList {
    id: string;
    name: string;
    created_at: string;
}

export interface EmailOctopusCampaign {
    id: string;
    name: string;
    status: string;
    created_at: string;
}
