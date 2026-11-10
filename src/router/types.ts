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

export type NavigationGuard = (
    to: RouteMatch,
    from: RouteMatch | null,
) => Promise<boolean | string | undefined> | boolean | string | undefined;

export type AfterNavigationHook = (to: RouteMatch, from: RouteMatch | null) => void;

export interface NavigateOptions {
    replace?: boolean;
    state?: unknown;
    trigger?: boolean;
}
