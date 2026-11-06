export const ROUTE_IDS = {
    HOME: 'home',
    EMBED: 'embed',
    PUBLISHED_OVERVIEW: 'published.overview',
    PUBLISHED_READ: 'published.read',
    PUBLISHED_PAGE: 'published.page',
    PUBLISHED_CAMERA: 'published.camera',
    PUBLISHED_AR: 'published.ar',
    PUBLISHED_AR_PAGE: 'published.ar.page',
    PREVIEW_OVERVIEW: 'preview.overview',
    PREVIEW_READ: 'preview.read',
    PREVIEW_PAGE: 'preview.page',
    PREVIEW_CAMERA: 'preview.camera',
    PREVIEW_AR: 'preview.ar',
    PREVIEW_AR_PAGE: 'preview.ar.page',
} as const;

export const routePaths = {
    home: () => '/',
    embed: () => '/embed',
    published: (slug: string) => `/b/${encodeURIComponent(slug)}`,
    publishedRead: (slug: string) => `/b/${encodeURIComponent(slug)}/read`,
    publishedPage: (slug: string, page: number) => `/b/${encodeURIComponent(slug)}/p/${page}`,
    publishedCamera: (slug: string) => `/b/${encodeURIComponent(slug)}/camera`,
    publishedAr: (slug: string, page?: number) =>
        page !== undefined
            ? `/b/${encodeURIComponent(slug)}/ar/p/${page}`
            : `/b/${encodeURIComponent(slug)}/ar`,
    preview: (token: string) => `/preview/${encodeURIComponent(token)}`,
    previewRead: (token: string) => `/preview/${encodeURIComponent(token)}/read`,
    previewPage: (token: string, page: number) => `/preview/${encodeURIComponent(token)}/p/${page}`,
    previewCamera: (token: string) => `/preview/${encodeURIComponent(token)}/camera`,
    previewAr: (token: string, page?: number) =>
        page !== undefined
            ? `/preview/${encodeURIComponent(token)}/ar/p/${page}`
            : `/preview/${encodeURIComponent(token)}/ar`,
};

