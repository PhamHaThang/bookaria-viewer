import type { NavigateOptions, RouteDefinition, RouteMatch } from './types';

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
    private popstateListener: (() => void) | null = null;
    private clickListener: ((event: MouseEvent) => void) | null = null;

    register(route: RouteDefinition): this {
        const { regex, paramNames } = compilePattern(route.pattern);
        this.routes.push({
            definition: route,
            regex,
            paramNames,
        });
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
                    params[key] = decodeURIComponent(result.groups[key] || '');
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
        if (options?.replace) {
            window.history.replaceState(options?.state ?? null, '', to);
        } else {
            window.history.pushState(options?.state ?? null, '', to);
        }

        if (options?.trigger !== false) {
            await this.handleUrl(parsed);
        }
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
            if (link.hasAttribute('download') || link.rel === 'external') return;

            const href = link.getAttribute('href');
            if (!href || href.startsWith('#')) return;
            if (
                /^[a-zA-Z]+:\/\//.test(href) ||
                href.startsWith('//') ||
                href.startsWith('mailto:') ||
                href.startsWith('tel:')
            ) {
                return;
            }

            event.preventDefault();
            void this.navigate(href);
        };
        document.addEventListener('click', this.clickListener);

        const initial = this.parseUrl(window.location.href);
        await this.handleUrl(initial);
    }

    destroy(): void {
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

    private async handleUrl(parsed: {
        pathname: string;
        query: URLSearchParams;
        hash: string;
        full: string;
    }): Promise<void> {
        this.activeAbort?.abort();
        const abort = new AbortController();
        this.activeAbort = abort;

        const found = this.match(parsed.pathname);
        if (found) {
            const match: RouteMatch = {
                path: parsed.full,
                pathname: parsed.pathname,
                params: found.match.params,
                query: parsed.query,
                hash: parsed.hash,
            };
            this.currentMatch = match;
            this.currentRouteId = found.route.id;

            try {
                await found.route.handler(match, abort.signal);
            } catch (error) {
                if (!abort.signal.aborted) {
                    console.error(`Route handler failed for ${found.route.id}:`, error);
                }
            }
            return;
        }

        if (this.notFoundHandler) {
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
