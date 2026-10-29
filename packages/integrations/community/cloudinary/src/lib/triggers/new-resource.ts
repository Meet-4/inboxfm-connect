
import {
  DedupeStrategy,
  HttpMethod,
  Polling,
  pollingHelper,
} from '@inboxfm-connect/pieces-common';
import {
  AppConnectionValueForAuthProperty,
  PiecePropValueSchema,
  Property,
  StaticPropsValue,
  TriggerStrategy,
  createTrigger,
} from '@inboxfm-connect/pieces-framework';
import { cloudinaryAuth } from '../common/auth';
import { makeRequest } from '../common/client';
import dayjs from 'dayjs';

const props = {
  resource_type: Property.StaticDropdown({
    displayName: 'Resource Type',
    description:
      'The kind of asset to watch. Cloudinary stores images, videos and raw files in separate collections, so a single poll can only list one of them unless "Any" is selected.',
    required: false,
    defaultValue: 'image',
    options: {
      options: [
        { label: 'Image', value: 'image' },
        { label: 'Video', value: 'video' },
        { label: 'Raw', value: 'raw' },
        { label: 'Any (image, video and raw)', value: 'any' },
      ],
    },
  }),
  asset_folder: Property.ShortText({
    displayName: 'Asset Folder',
    description: 'The Cloudinary folder to watch for new resources. Leave empty to watch the entire account.',
    required: false,
  }),
};

// Cloudinary returns 10 results when max_results is omitted (500 is the documented
// maximum), so a poll without paging silently loses every upload past the newest ten.
const PAGE_SIZE = 500;
const MAX_PAGES = 20;

async function listResources(
  auth: AppConnectionValueForAuthProperty<typeof cloudinaryAuth>,
  resourceType: string,
  folder: string | undefined
): Promise<any[]> {
  const endpoint = folder ? '/resources/by_asset_folder' : `/resources/${resourceType}`;
  const collected: any[] = [];
  let nextCursor: string | undefined = undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const queryParams: Record<string, string> = {
      max_results: String(PAGE_SIZE),
    };
    if (folder) {
      queryParams['asset_folder'] = folder;
    }
    if (nextCursor) {
      queryParams['next_cursor'] = nextCursor;
    }

    const response = await makeRequest(auth, HttpMethod.GET, endpoint, undefined, queryParams);
    const batch: any[] = response.resources ?? [];
    collected.push(...batch);

    nextCursor = response.next_cursor;
    if (!nextCursor || batch.length < PAGE_SIZE) {
      break;
    }
  }

  return collected;
}

const polling: Polling<AppConnectionValueForAuthProperty<typeof cloudinaryAuth>, StaticPropsValue<typeof props>> = {
  strategy: DedupeStrategy.TIMEBASED,
  items: async ({ auth, propsValue }) => {
    const folder = propsValue.asset_folder?.trim() || undefined;
    // /resources/by_asset_folder already returns every resource type in the folder,
    // so iterating types there would fetch (and emit) the same assets three times.
    const resourceTypes = folder
      ? ['image']
      : !propsValue.resource_type || propsValue.resource_type === 'any'
        ? ['image', 'video', 'raw']
        : [propsValue.resource_type];

    const resources: any[] = [];
    for (const resourceType of resourceTypes) {
      resources.push(...(await listResources(auth, resourceType, folder)));
    }

    return resources.map((item: any) => ({
      epochMilliSeconds: dayjs(item.created_at).valueOf(),
      data: item,
    }));
  },
};

export const newResourceInFolder = createTrigger({
  auth: cloudinaryAuth,
  name: 'new_resource',
  displayName: 'New Resource',
  description: 'Triggers when a new image, video, or file is uploaded to a specific folder or account in Cloudinary.',
  aiMetadata: {
    description: 'Fires when a new asset is uploaded to Cloudinary, scoped to a specific asset folder or the whole account when no folder is given. Each event represents one newly created asset and its metadata.',
  },
  props,
  sampleData: {
    "asset_id": "bcace221f5b11685dd6effb9d69d5ec3",
    "public_id": "signature_snc5z4",
    "format": "png",
    "version": 1752843735,
    "resource_type": "image",
    "type": "upload",
    "created_at": "2025-07-18T13:02:15Z",
    "bytes": 13685,
    "width": 667,
    "height": 276,
    "asset_folder": "Testr",
    "display_name": "signature_snc5z4",
    "url": "http://res.cloudinary.com/dndacs7ddse/image/upload/v1752843735/signature_snc5z4.png",
    "secure_url": "https://res.cloudinary.com/dndacs7sdde/image/upload/v1752843735/signature_snc5z4.png"
  },
  type: TriggerStrategy.POLLING,
  async onEnable(context) {
    await pollingHelper.onEnable(polling, {
      auth: context.auth,
      store: context.store,
      propsValue: context.propsValue,
    });
  },
  async onDisable(context) {
    await pollingHelper.onDisable(polling, {
      auth: context.auth,
      store: context.store,
      propsValue: context.propsValue,
    });
  },
  async test(context) {
    return await pollingHelper.test(polling, context);
  },
  async run(context) {
    return await pollingHelper.poll(polling, context);
  },
});
