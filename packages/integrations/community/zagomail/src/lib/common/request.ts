import { HttpMethod, httpClient, QueryParams } from '@inboxfm-connect/pieces-common';
import { API_ENDPOINTS, BASE_URL } from './constants';

async function fireHttpRequest({
  method,
  path,
  body,
  queryParams,
}: {
  method: HttpMethod;
  path: string;
  body?: unknown;
  queryParams?: QueryParams;
}) {
  return await httpClient.sendRequest({
    method,
    url: `${BASE_URL}${path}`,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body,
    queryParams,
  }).then(res => res.body)
}

export const zagoMailApiService = {
  createSubscriber: async (
    publicKey: string,
    listUid: string,
    body: any
  ) => {
    const response = await fireHttpRequest({
      method: HttpMethod.POST,
      path: `${API_ENDPOINTS.CREATE_SUBSCRIBER}?list_uid=${listUid}`,
      body: {
        ...body,
        publicKey,
      },
    });

    return response.data.record;
  },
  updateSubscriber: async (
    publicKey: string,
    listUid: string,
    subscriberUid: string,
    body: any
  ) => {
    const response = await fireHttpRequest({
      method: HttpMethod.POST,
      path: `${API_ENDPOINTS.UPDATE_SUBSCRIBER}?list_uid=${listUid}&subscriber_uid=${subscriberUid}`,
      body: {
        ...body,
        publicKey,
      },
    });

    return response.data.record;
  },
  unsubscribeSubscriber: async (
    publicKey: string,
    listUid: string,
    subscriberUid: string
  ) => {
    const response = await fireHttpRequest({
      method: HttpMethod.POST,
      path: `${API_ENDPOINTS.UNSUBSCRIBE_SUBSCRIBER}?list_uid=${listUid}&subscriber_uid=${subscriberUid}`,
      body: {
        publicKey,
      },
    });

    return response.data;
  },
  searchSubscriberByEmail: async (
    publicKey: string,
    listUid: string,
    body: {
      email: string;
    }
  ) => {
    const response = await fireHttpRequest({
      method: HttpMethod.POST,
      path: `${API_ENDPOINTS.SEARCH_SUBSCRIBER_BY_EMAIL}?list_uid=${listUid}`,
      body: {
        ...body,
        publicKey,
      },
    });

    return response;
  },
  getSubscriberDetails: async (
    publicKey: string,
    listUid: string,
    subscriberUid: string
  ) => {
    const response = await fireHttpRequest({
      method: HttpMethod.GET,
      path: `${API_ENDPOINTS.GET_SUBSCRIBER}?list_uid=${listUid}&subscriber_uid=${subscriberUid}`,
      queryParams: {
        publicKey,
      },
    });

    return response.data;
  },
  getCampaignDetails: async (
    publicKey: string,
    campaignUid: string,
  ) => {
    const response = await fireHttpRequest({
      method: HttpMethod.GET,
      path: `${API_ENDPOINTS.GET_CAMPAIGNS}?campaign_uid=${campaignUid}`,
      queryParams: {
        publicKey,
      },
    });

    return response.data;
  },
  addTagToSubscriber: async (
    publicKey: string,
    {
      listUid,
      tagId,
      subscriberUid,
    }: { listUid: string; subscriberUid: string; tagId: string }
  ) => {
    const response = await fireHttpRequest({
      method: HttpMethod.POST,
      path: `${API_ENDPOINTS.ADD_TAG_TO_SUBSCRIBER}?ztag_id=${tagId}&list_uid=${listUid}&subscriber_uid=${subscriberUid}`,
      body: {
        publicKey,
      },
    });

    return response;
  },
  createTag: async (publicKey: string, tagName: string) => {
    const response = await fireHttpRequest({
      method: HttpMethod.POST,
      path: `${API_ENDPOINTS.CREATE_TAG}?tag_name=${tagName}`,
      body: {
        publicKey,
      },
    });

    return response.tag;
  },
  getTags: async (publicKey: string) => {
    const response = await fireHttpRequest({
      method: HttpMethod.GET,
      path: API_ENDPOINTS.GET_TAGS,
      queryParams: {
        publicKey,
      },
    })

    return response.tags;
  },
  createWebhook: async (
    publicKey: string,
    webhookUrl: string,
    event_type: 'subscriber-activate' | 'subscriber-unsubscribe' | 'tag-added',
    extraParams?: {
      formID?: string;
      tagID?: string;
      linkUrl?: string;
    }
  ) => {
    const response = await fireHttpRequest({
      method: HttpMethod.POST,
      path: API_ENDPOINTS.CREATE_WEBHOOK,
      body: {
        publicKey,
        event_type,
        target_url: webhookUrl,
        ...extraParams,
      },
    });

    return response.webhook;
  },
  deleteWebhook: async (publicKey: string, webhookId: string) => {
    return fireHttpRequest({
      method: HttpMethod.POST,
      path: `${API_ENDPOINTS.DELETE_WEBHOOK}?id=${webhookId}`,
      body: {
        publicKey,
      },
    });
  },
  getAllLists:async (publicKey:string) =>{
    const response =  await fireHttpRequest({
      method:HttpMethod.GET,
      path:`${API_ENDPOINTS.LIST_ALL_LISTS}`,
      queryParams:{
        publicKey
      }
    })

    return response;
  },
  getListFields:async (publicKey:string,listUid:string)=>{
    const response =  await fireHttpRequest({
      method:HttpMethod.GET,
      path:`${API_ENDPOINTS.GET_LIST_FIELDS}?list_uid=${listUid}`,
      queryParams:{
        publicKey
      }
    })

    return response.data
  },
  getCampaigns:async (publicKey:string)=>{
    const response = await fireHttpRequest({
      method:HttpMethod.GET,
      path:`${API_ENDPOINTS.GET_CAMPAIGNS}`,
    queryParams:{
        publicKey
      }
    })

    return response.data
  }
};
