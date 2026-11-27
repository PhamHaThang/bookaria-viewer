import { PublicBookSchema } from '../src/shared/contracts/dto.schema.ts';

export function publicBookSchemaCheck() {
    const bad = PublicBookSchema.safeParse({
        slug: 'demo',
        title: 'Demo',
        description: null,
        author: { id: '11111111-1111-4111-8111-111111111111', displayName: 'An' },
        coverUrl: null,
        language: 'vi',
        ageMin: null,
        ageMax: null,
        version: {
            id: '22222222-2222-4222-8222-222222222222',
            versionNo: 1,
            publishedAt: '2026-11-26T00:00:00Z',
        },
        manifestUrl: 'javascript:void(0)',
        pageCount: 1,
        arPageCount: 0,
        downloadBytes: 100,
        printPdfUrl: null,
    });
    return bad.success === false;
}
