export type RouteParams = Record<string, string>;

export interface RouteMatch {
    path: string;
    pathname: string;
    params: RouteParams;
    query: URLSearchParams;
    hash: string;
}

export type RouteHandler = (match: RouteMatch, signal: AbortSignal) => Promise<void> | void;

export interface RouteDefinition {
    id: string;
    pattern: string;
    handler: RouteHandler;
}

export interface NavigateOptions {
    replace?: boolean;
    state?: unknown;
    trigger?: boolean;
}

