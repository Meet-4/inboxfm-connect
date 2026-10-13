import {
  AgentPieceTool,
  AppConnectionType,
  AppConnectionValue,
  ExecutionType,
  RespondResponse,
  ResumePayload,
  TriggerPayload,
  TriggerStrategy,
} from '@inboxfm-connect/core-piece-types';
import type { SeekPage } from '@inboxfm-connect/core-utils';
import type { FlowRunId, ProjectId } from '@inboxfm-connect/core-utils';
import { LanguageModel, Tool } from 'ai'

import {
  BasicAuthProperty,
  CustomAuthProperty,
  IntegrationPropertyMap,
  OIDCProperty,
  OAuth2Property,
  SecretTextProperty,
  StaticPropsValue,
} from '../property';
import { IntegrationAuthProperty } from '../property/authentication';
import type { PopulatedFlowSummary } from '@inboxfm-connect/core-piece-types';

export type BaseContext<
  IntegrationAuth extends IntegrationAuthProperty | IntegrationAuthProperty[] | undefined,
  Props extends IntegrationPropertyMap
> = {
  flows: FlowsContext;
  step: StepContext;
    auth: ConnectionValueForAuthProperty<IntegrationAuth>;
  propsValue: StaticPropsValue<Props>;
  store: Store;
  project: {
    id: ProjectId;
    externalId: () => Promise<string | undefined>;
  };
  connections: ConnectionsManager;
};


type ExtractCustomAuthProps<T> = T extends CustomAuthProperty<infer Props> ? Props : never;

type ExtractOIDCProps<T> = T extends OIDCProperty<infer Props> ? Props : never;

type ExtractOAuth2Props<T> = T extends OAuth2Property<infer Props> ? Props : never;


export type ConnectionValueForAuthProperty<T extends IntegrationAuthProperty | IntegrationAuthProperty[] | undefined> = 
  T extends IntegrationAuthProperty[] ? ConnectionValueForSingleAuthProperty<T[number]> :
  T extends IntegrationAuthProperty ? ConnectionValueForSingleAuthProperty<T> :
  T extends undefined ? undefined : never;

type ConnectionValueForSingleAuthProperty<T extends IntegrationAuthProperty | undefined> =
  T extends SecretTextProperty<boolean> ? AppConnectionValue<AppConnectionType.SECRET_TEXT> :
  T extends BasicAuthProperty ? AppConnectionValue<AppConnectionType.BASIC_AUTH> :
  T extends CustomAuthProperty<any> ? AppConnectionValue<AppConnectionType.CUSTOM_AUTH, StaticPropsValue<ExtractCustomAuthProps<T>>> :
  T extends OIDCProperty<any> ? AppConnectionValue<AppConnectionType.OIDC, StaticPropsValue<ExtractOIDCProps<T>>> :
  T extends OAuth2Property<any> ? AppConnectionValue<AppConnectionType.OAUTH2, StaticPropsValue<ExtractOAuth2Props<T>>> :
  T extends undefined ? undefined : never;
type AppWebhookTriggerHookContext<
  IntegrationAuth extends IntegrationAuthProperty | IntegrationAuthProperty[] | undefined,
  TriggerProps extends IntegrationPropertyMap
> = BaseContext<IntegrationAuth, TriggerProps> & {
  webhookUrl: string;
  payload: TriggerPayload;
  app: {
    createListeners({
      events,
      identifierValue,
    }: {
      events: string[];
      identifierValue: string;
    }): void;
  };
};

type PollingTriggerHookContext<
  IntegrationAuth extends IntegrationAuthProperty | IntegrationAuthProperty[] | undefined,
  TriggerProps extends IntegrationPropertyMap
> = BaseContext<IntegrationAuth, TriggerProps> & {
  server: ServerContext;
  setSchedule(schedule: { cronExpression: string; timezone?: string }): void;
};

type WebhookTriggerHookContext<
  IntegrationAuth extends IntegrationAuthProperty | IntegrationAuthProperty[] | undefined,
  TriggerProps extends IntegrationPropertyMap,
> = BaseContext<IntegrationAuth, TriggerProps> & {
  webhookUrl: string;
  payload: TriggerPayload;
  server: ServerContext;
};
export type TriggerHookContext<
  IntegrationAuth extends IntegrationAuthProperty | IntegrationAuthProperty[] | undefined,
  TriggerProps extends IntegrationPropertyMap,
  S extends TriggerStrategy,
> = S extends TriggerStrategy.APP_WEBHOOK
  ? AppWebhookTriggerHookContext<IntegrationAuth, TriggerProps>
  : S extends TriggerStrategy.POLLING
  ? PollingTriggerHookContext<IntegrationAuth, TriggerProps>
  : S extends TriggerStrategy.WEBHOOK
  ? WebhookTriggerHookContext<IntegrationAuth, TriggerProps> & {
    server: ServerContext;
  }
  : never;

export type TestOrRunHookContext<
  IntegrationAuth extends IntegrationAuthProperty | IntegrationAuthProperty[] | undefined,
  TriggerProps extends IntegrationPropertyMap,
  S extends TriggerStrategy
> = TriggerHookContext<IntegrationAuth, TriggerProps, S> & {
  files: FilesService;
};

export type StopHookParams = {
  response: RespondResponse;
};

export type RespondHookParams = {
  response: RespondResponse;
};

export type StopHook = (params?: StopHookParams) => void;

export type RespondHook = (params?: RespondHookParams) => void;

export type FlowsContext = {
  list(params?: ListFlowsContextParams): Promise<SeekPage<PopulatedFlowSummary>>
  current: {
    id: string;
    version: {
      id: string;
    };
  };
}

export type StepContext = {
  name: string;
}

export type ListFlowsContextParams = {
  externalIds?: string[]
}


export type PropertyContext = {
  server: ServerContext;
  project: {
    id: ProjectId;
    externalId: () => Promise<string | undefined>;
  };
  searchValue?: string;
  flows: FlowsContext;
  connections: ConnectionsManager;
};

export type ServerContext = {
  apiUrl: string;
  publicUrl: string;
  token: string;
};

export type CreateWaitpointParams = {
  type: 'DELAY' | 'WEBHOOK';
  version?: 'V0' | 'V1';
  resumeDateTime?: string;
  responseToSend?: RespondResponse;
};

export type CreateWaitpointResult = {
  id: string;
  resumeUrl: string;
  buildResumeUrl: (params: { queryParams: Record<string, string>, sync?: boolean }) => string;
};

export type CreateWaitpointHook = (params: CreateWaitpointParams) => Promise<CreateWaitpointResult>;
export type WaitForWaitpointHook = (waitpointId: string) => void;

export type RunContext = {
  id: FlowRunId;
  stop: StopHook;
  respond: RespondHook;
  createWaitpoint: CreateWaitpointHook;
  waitForWaitpoint: WaitForWaitpointHook;
}

export type OnStartContext<
  IntegrationAuth extends IntegrationAuthProperty | IntegrationAuthProperty[] | undefined,
  TriggerProps extends IntegrationPropertyMap
> = Omit<BaseContext<IntegrationAuth, TriggerProps>, 'flows'> & {
  run: Pick<RunContext, 'id'>;
  payload: unknown;
}


export type OutputContext = {
  update: (params: {
    data: {
      [key: string]: unknown;
    };
  }) => Promise<void>;
}

type BaseToolContext<
  ET extends ExecutionType,
  IntegrationAuth extends IntegrationAuthProperty | IntegrationAuthProperty[] | undefined,
  ToolProps extends IntegrationPropertyMap
> = BaseContext<IntegrationAuth, ToolProps> & {
  executionType: ET;
  tags: TagsManager;
  server: ServerContext;
  files: FilesService;
  output: OutputContext;
  agent: AgentContext;
  run: RunContext;
  /** @deprecated Use waitpoint.buildResumeUrl() from createWaitpoint result instead */
  generateResumeUrl?: (params: {
    queryParams: Record<string, string>,
    sync?: boolean
  }) => string;
};

type BeginExecutionToolContext<
  IntegrationAuth extends IntegrationAuthProperty | IntegrationAuthProperty[] | undefined = undefined,
  ToolProps extends IntegrationPropertyMap = IntegrationPropertyMap
> = BaseToolContext<ExecutionType.BEGIN, IntegrationAuth, ToolProps>;

type ResumeExecutionToolContext<
  IntegrationAuth extends IntegrationAuthProperty | IntegrationAuthProperty[] | undefined = undefined,
  ToolProps extends IntegrationPropertyMap = IntegrationPropertyMap
> = BaseToolContext<ExecutionType.RESUME, IntegrationAuth, ToolProps> & {
  resumePayload: ResumePayload;
};

export type ToolContext<
  IntegrationAuth extends IntegrationAuthProperty | IntegrationAuthProperty[] | undefined = undefined,
  ToolProps extends IntegrationPropertyMap = IntegrationPropertyMap
> =
  | BeginExecutionToolContext<IntegrationAuth, ToolProps>
  | ResumeExecutionToolContext<IntegrationAuth, ToolProps>;




export type ConstructToolParams = {
  tools: AgentPieceTool[]
  model: LanguageModel,
}

export interface AgentContext {
  tools: (params: ConstructToolParams) => Promise<Record<string, Tool>>;
}

export interface FilesService {
  write({
    fileName,
    data,
  }: {
    fileName: string;
    data: Buffer;
  }): Promise<string>;
}

export interface ConnectionsManager {
  get(
    key: string
  ): Promise<AppConnectionValue | Record<string, unknown> | string | null>;
}

export interface TagsManager {
  add(params: { name: string }): Promise<void>;
}

export interface Store {
  put<T>(key: string, value: T, scope?: StoreScope): Promise<T>;
  get<T>(key: string, scope?: StoreScope): Promise<T | null>;
  delete(key: string, scope?: StoreScope): Promise<void>;
}

export enum StoreScope {
  // Collection were deprecated in favor of project
  PROJECT = 'COLLECTION',
  FLOW = 'FLOW',
}
