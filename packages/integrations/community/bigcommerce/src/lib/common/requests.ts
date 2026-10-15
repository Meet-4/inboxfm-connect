import { HttpMethod, httpClient } from '@inboxfm-connect/pieces-common';
import { bigCommerceAuth, GET_BASE_URL } from './constants';

const PAGINATION_LIMIT = 250;

async function fireHttpRequest({
  method,
  path,
  body,
  auth,
  filter = false,
}: {
  method: HttpMethod;
  path: string;
  auth: bigCommerceAuth;
  body?: unknown;
  filter?: boolean;
}) {
  const BASE_URL = GET_BASE_URL(auth.storeHash);

  const cleanBody = filter && body ? (Array.isArray(body)
    ? body.map(item => filterNulls(item))
    : filterNulls(body)) : body;


  return await httpClient
    .sendRequest({
      method,
      url: `${BASE_URL}${path}`,
      headers: {
        'X-Auth-Token': auth.accessToken,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: cleanBody,
    })
    .then((res) => res.body)
    .catch((err) => {
      throw new Error(
        `Error in request to ${path}: ${err.message || JSON.stringify(err)}`
      );
    });
}

/**
 * Page through a v3 list endpoint ({ data, meta.pagination.links.next })
 * until the last page, preserving the envelope shape while merging `data`.
 * (Returns the same loose shape the unpaginated helper returned.)
 */
async function fetchAllV3Pages({
  auth,
  basePath,
  queryString,
}: {
  auth: bigCommerceAuth;
  basePath: string;
  queryString?: string;
}): Promise<any> {
  const params = new URLSearchParams(queryString ?? '');
  params.set('limit', String(PAGINATION_LIMIT));
  params.set('page', '1');

  const first = (await fireHttpRequest({
    auth,
    path: `${basePath}?${params.toString()}`,
    method: HttpMethod.GET,
  })) as {
    data?: unknown[];
    meta?: { pagination?: { links?: { next?: string | null } } };
  };

  const data = [...(first?.data ?? [])];
  let next = first?.meta?.pagination?.links?.next ?? null;

  while (next) {
    const nextPage = next.startsWith('?') ? `${basePath}${next}` : next;
    const batch = (await fireHttpRequest({
      auth,
      path: nextPage,
      method: HttpMethod.GET,
    })) as {
      data?: unknown[];
      meta?: { pagination?: { links?: { next?: string | null } } };
    };

    data.push(...(batch?.data ?? []));
    next = batch?.meta?.pagination?.links?.next ?? null;
  }

  return { ...first, data };
}

export const bigCommerceApiService = {
  async createWebhook({
    auth,
    payload,
  }: {
    auth: bigCommerceAuth;
    payload: {
      scope: string;
      destination: string;
      is_active: boolean;
    };
  }) {
    return await fireHttpRequest({
      auth,
      path: '/v3/hooks',
      method: HttpMethod.POST,
      body: payload,
    });
  },
  async createCustomer({
    auth,
    payload,
  }: {
    auth: bigCommerceAuth;
    payload: unknown;
  }) {
    return await fireHttpRequest({
      auth,
      path: '/v3/customers',
      method: HttpMethod.POST,
      body: payload,
    });
  },
  async fetchCustomers({
    auth,
    queryString,
  }: {
    auth: bigCommerceAuth;
    queryString?: string;
  }) {
    return await fetchAllV3Pages({
      auth,
      basePath: '/v3/customers',
      queryString,
    });
  },
  async fetchCustomerAddresses({
    auth,
    queryString,
  }: {
    auth: bigCommerceAuth;
    queryString?: string;
  }) {
    return await fetchAllV3Pages({
      auth,
      basePath: '/v3/customers/addresses',
      queryString,
    });
  },
  async fetchProducts({
    auth,
    queryString,
  }: {
    auth: bigCommerceAuth;
    queryString?: string;
  }) {
    return await fetchAllV3Pages({
      auth,
      basePath: '/v3/catalog/products',
      queryString,
    });
  },
  async createProduct({
    auth,
    payload,
  }: {
    auth: bigCommerceAuth;
    payload: unknown;
  }) {
    return await fireHttpRequest({
      auth,
      path: '/v3/catalog/products',
      method: HttpMethod.POST,
      body: payload,
      filter: true,
    });
  },
  async updateProduct({
    auth,
    productId,
    payload,
  }: {
    auth: bigCommerceAuth;
    productId: string | number;
    payload: unknown;
  }) {
    return await fireHttpRequest({
      auth,
      path: `/v3/catalog/products/${productId}`,
      method: HttpMethod.PUT,
      body: payload,
      filter: true,
    });
  },
  async deleteProduct({
    auth,
    productId,
  }: {
    auth: bigCommerceAuth;
    productId: string | number;
  }) {
    return await fireHttpRequest({
      auth,
      path: `/v3/catalog/products/${productId}`,
      method: HttpMethod.DELETE,
    });
  },
  async fetchOrders({
    auth,
    queryString,
  }: {
    auth: bigCommerceAuth;
    queryString?: string;
  }) {
    // v2 list endpoints answer with a bare array, so walk page numbers until
    // a short page (BigCommerce: "requests sent without parameters will only
    // return 50 orders").
    const orders: unknown[] = [];
    for (let page = 1; ; page++) {
      const params = new URLSearchParams(queryString ?? '');
      params.set('limit', String(PAGINATION_LIMIT));
      params.set('page', String(page));

      const batch = await fireHttpRequest({
        auth,
        path: `/v2/orders?${params.toString()}`,
        method: HttpMethod.GET,
      });

      if (!Array.isArray(batch)) {
        return batch;
      }

      orders.push(...batch);
      if (batch.length < PAGINATION_LIMIT) {
        break;
      }
    }
    return orders;
  },
  async fetchOrder({
    auth,
    orderId,
  }: {
    auth: bigCommerceAuth;
    orderId: string | number;
  }) {
    return await fireHttpRequest({
      auth,
      path: `/v2/orders/${orderId}`,
      method: HttpMethod.GET,
    });
  },
  async fetchCategories({
    auth,
    queryString,
  }: {
    auth: bigCommerceAuth;
    queryString?: string;
  }) {
    return await fetchAllV3Pages({
      auth,
      basePath: '/v3/catalog/categories',
      queryString,
    });
  },
  async createBlogPost({
    auth,
    payload,
  }: {
    auth: bigCommerceAuth;
    payload: unknown;
  }) {
    return await fireHttpRequest({
      auth,
      path: '/v2/blog/posts',
      method: HttpMethod.POST,
      body: payload,
    });
  },
  async createCustomerAddress({
    auth,
    payload,
  }: {
    auth: bigCommerceAuth;
    payload: unknown;
  }) {
    return await fireHttpRequest({
      auth,
      path: '/v3/customers/addresses',
      method: HttpMethod.POST,
      body: payload,
    });
  },
  async deleteWebhook({
    auth,
    webhookId,
  }: {
    auth: bigCommerceAuth;
    webhookId: string;
  }) {
    return await fireHttpRequest({
      auth,
      path: `/v3/hooks/${webhookId}`,
      method: HttpMethod.DELETE,
    });
  },
};

function filterNulls(obj: unknown): unknown {
  if (obj === null || obj === undefined) return undefined;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(filterNulls);

  return Object.fromEntries(
    Object.entries(obj as Record<string, unknown>)
      .filter(([_, v]) => v !== null && v !== undefined)
      .map(([k, v]) => [k, filterNulls(v)])
  );
}

