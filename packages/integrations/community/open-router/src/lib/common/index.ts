export interface promptResponse {
  choices: {
    message: {
      role: string;
      content: string;
    };
  }[];
  model: string;
  id: string;
}

export interface openRouterModels {
  data: {
    id: string;
  }[];
}
