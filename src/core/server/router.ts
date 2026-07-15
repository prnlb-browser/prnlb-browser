import type * as http from "node:http";
import type { AppContext } from "./context.js";

export interface RouteContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  method: string;
  app: AppContext;
}

export type RouteHandler = (context: RouteContext) => Promise<boolean>;
