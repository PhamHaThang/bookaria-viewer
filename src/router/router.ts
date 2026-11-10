import type {
    AfterNavigationHook,
    NavigateOptions,
    NavigationGuard,
    RouteDefinition,
    RouteMatch,
} from './types';

interface CompiledRoute {
    definition: RouteDefinition;
    regex: RegExp;
    paramNames: string[];
}

function compilePattern(pattern: string): { regex: RegExp; paramNames: string[] } {
    const paramNames: string[] = [];
    const escaped = pattern
        .replace(/([.+*?=^!:${}()[\]|/\\])/g, (char) => (char === ':' ? ':' : `\\${char}`))
        .replace(/:([a-zA-Z0-9_]+)/g, (_, name) => {
            paramNames.push(name);
            return `(?<${name}>[^/]+)`;
        });

    return {
        regex: new RegExp(`^${escaped}(?:/)?$`),
        paramNames,
    };
}

export class Router {
    private routes: CompiledRoute[] = [];
    private activeAbort: AbortController | null = null;
    private currentMatch: RouteMatch | null = null;
    private currentRouteId: string | null = null;
    private notFoundHandler:
        | ((match: RouteMatch, signal: AbortSignal) => Promise<void> | void)
        | null = null;
    private beforeGuards: NavigationGuard[] = [];
    private afterHooks: AfterNavigationHook[] = [];
    private popstateListener: (() => void) | null = null;
    private clickListener: ((event: MouseEvent) => void) | null = null;
    private navigationId = 0;

    register(route: RouteDefinition): this {
        const { regex, paramNames } = compilePattern(route.pattern);
        this.routes.push({
            definition: route,
            regex,
            paramNames,
        });
        return this;
    }

    beforeEach(guard: NavigationGuard): this {
        this.beforeGuards.push(guard);
        return this;
    }

    afterEach(hook: AfterNavigationHook): this {
        this.afterHooks.push(hook);
        return this;
    }

    setNotFound(handler: (match: RouteMatch, signal: AbortSignal) => Promise<void> | void): this {
        this.notFoundHandler = handler;
        return this;
    }

    match(pathname: string): { route: RouteDefinition; match: RouteMatch } | null {
        for (const item of this.routes) {
            const result = item.regex.exec(pathname);
            if (!result) continue;

            const params: Record<string, string> = {};
            if (result.groups) {
                for (const key of Object.keys(result.groups)) {
                    try {
                        params[key] = decodeURIComponent(result.groups[key] || '');
                    } catch {
                        return null;
                    }
                }
            }

            return {
                route: item.definition,
                match: {
                    path: pathname,
                    pathname,
                    params,
                    query: new URLSearchParams(),
                    hash: '',
                },
            };
        }
        return null;
    }

    getCurrentRouteId(): string | null {
        return this.currentRouteId;
    }

    getCurrentMatch(): RouteMatch | null {
        return this.currentMatch;
    }

    async navigate(to: string, options?: NavigateOptions): Promise<void> {
        const parsed = this.parseUrl(to);
        const commit = () => {
            if (options?.replace) window.history.replaceState(options?.state ?? null, '', to);
            else window.history.pushState(options?.state ?? null, '', to);
        };
        if (options?.trigger === false) commit();
        else await this.handleUrl(parsed, commit);
    }

    async replace(to: string, options?: Omit<NavigateOptions, 'replace'>): Promise<void> {
        return this.navigate(to, options ? { ...options, replace: true } : { replace: true });
    }

    back(): void {
        window.history.back();
    }

    forward(): void {
        window.history.forward();
    }

    async start(): Promise<void> {
        this.popstateListener = () => {
            const parsed = this.parseUrl(window.location.href);
            void this.handleUrl(parsed);
        };
        window.addEventListener('popstate', this.popstateListener);

        this.clickListener = (event: MouseEvent) => {
            if (
                event.defaultPrevented ||
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
            ) {
                return;
            }

            const target = event.target as HTMLElement | null;
            const link = target?.closest('a');
            if (!link) return;

            if (link.target && link.target !== '_self') {
                return;
            }
            if (link.hasAttribute('download') || link.rel.split(/\s+/).includes('external')) return;

            const href = link.getAttribute('href');
            if (!href || href.startsWith('#')) return;
            const url = new URL(href, window.location.href);
            // Downloads and application/API endpoints must retain native navigation.
            if (url.origin !== window.location.origin || !this.match(url.pathname)) return;

            event.preventDefault();
            void this.navigate(url.pathname + url.search + url.hash);
        };
        document.addEventListener('click', this.clickListener);

        const initial = this.parseUrl(window.location.href);
        await this.handleUrl(initial);
    }

    destroy(): void {
        this.navigationId++;
        if (this.popstateListener) {
            window.removeEventListener('popstate', this.popstateListener);
            this.popstateListener = null;
        }
        if (this.clickListener) {
            document.removeEventListener('click', this.clickListener);
            this.clickListener = null;
        }
        this.activeAbort?.abort();
        this.activeAbort = null;
        this.currentMatch = null;
        this.currentRouteId = null;
    }

    private parseUrl(urlOrPath: string): {
        pathname: string;
        query: URLSearchParams;
        hash: string;
        full: string;
    } {
        const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
        const parsed = new URL(urlOrPath, base);
        return {
            pathname: parsed.pathname,
            query: parsed.searchParams,
            hash: parsed.hash,
            full: parsed.pathname + parsed.search + parsed.hash,
        };
    }

    private async handleUrl(
        parsed: {
            pathname: string;
            query: URLSearchParams;
            hash: string;
            full: string;
        },
        commit?: () => void,
    ): Promise<void> {
        const navigationId = ++this.navigationId;
        const abort = new AbortController();

        const from = this.currentMatch;
        const found = this.match(parsed.pathname);
        if (found) {
            const match: RouteMatch = {
                path: parsed.full,
                pathname: parsed.pathname,
                params: found.match.params,
                query: parsed.query,
                hash: parsed.hash,
            };

            for (const guard of this.beforeGuards) {
                const redirectOrAllow = await guard(match, from);
                if (redirectOrAllow === false || navigationId !== this.navigationId) return;
                if (typeof redirectOrAllow === 'string') {
                    await this.navigate(redirectOrAllow, { replace: true });
                    return;
                }
            }

            this.activeAbort?.abort();
            this.activeAbort = abort;
            commit?.();
            this.currentMatch = match;
            this.currentRouteId = found.route.id;

            try {
                await found.route.handler(match, abort.signal);
                if (!abort.signal.aborted) {
                    for (const hook of this.afterHooks) {
                        try {
                            hook(match, from);
                        } catch (hookError) {
                            console.error('afterEach hook error:', hookError);
                        }
                    }
                }
            } catch (error) {
                if (!abort.signal.aborted) {
                    console.error(`Route handler failed for ${found.route.id}:`, error);
                }
            }
            return;
        }

        if (this.notFoundHandler) {
            this.activeAbort?.abort();
            this.activeAbort = abort;
            commit?.();
            const fallbackMatch: RouteMatch = {
                path: parsed.full,
                pathname: parsed.pathname,
                params: {},
                query: parsed.query,
                hash: parsed.hash,
            };
            this.currentMatch = fallbackMatch;
            this.currentRouteId = '404';

            try {
                await this.notFoundHandler(fallbackMatch, abort.signal);
            } catch (error) {
                if (!abort.signal.aborted) {
                    console.error('Not found handler failed:', error);
                }
            }
        }
    }
}
