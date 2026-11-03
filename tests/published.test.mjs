import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BookUnavailableError, loadPublicInfo, loadPublished } from '../src/shared/api.ts';

const id = '11111111-1111-4111-8111-111111111111';
const versionId = '22222222-2222-4222-8222-222222222222';
const time = '2026-10-22T10:00:00.000Z';
const info = {
    slug: 'test-book',
    title: 'Live draft title',
    description: null,
    author: { id, displayName: 'Synthetic' },
    coverUrl: null,
    language: 'vi',
    ageMin: null,
    ageMax: null,
    version: { id: versionId, versionNo: 1, publishedAt: time },
    manifestUrl: 'https://example.com/manifest.json',
    pageCount: 1,
    arPageCount: 0,
    downloadBytes: 0,
    printPdfUrl: null,
};
const manifest = {
    schemaVersion: 1,
    bookId: id,
    version: 1,
    title: 'Frozen title',
    trackerEngine: 'mindar',
    generatedAt: time,
    targetGroups: [],
    assets: {},
    credits: [],
    pages: [
        {
            pageId: id,
            title: 'Page',
            aspect: 1.4,
            imageUrl: 'https://example.com/page.png',
            thumbnailUrl: 'https://example.com/thumb.png',
            marker: { mode: 'NONE' },
            scene: { schemaVersion: 1, objects: [], interactions: [] },
        },
    ],
};
test('published reader loads frozen manifest, omits credentials and rechecks availability after file fetch', async () => {
    const previous = globalThis.fetch,
        calls = [];
    try {
        globalThis.fetch = async (url, options) => {
            calls.push({ url, options });
            return new Response(
                JSON.stringify(url === info.manifestUrl ? manifest : { data: info }),
            );
        };
        const loaded = await loadPublished(info.slug, new AbortController().signal);
        assert.equal(loaded.manifest.title, 'Frozen title');
        assert.equal(calls.length, 3);
        assert.equal(calls[1].url, info.manifestUrl);
        for (const { options } of calls) {
            assert.equal(options.credentials, 'omit');
            assert.equal(options.cache, 'no-store');
            assert.equal(options.referrerPolicy, 'no-referrer');
        }
    } finally {
        globalThis.fetch = previous;
    }
});
test('unpublished, missing and replaced versions never enable the reader', async () => {
    const previous = globalThis.fetch;
    try {
        for (const status of [404, 410]) {
            globalThis.fetch = async () => new Response('{}', { status });
            await assert.rejects(
                loadPublished(info.slug, new AbortController().signal),
                BookUnavailableError,
            );
        }
        let count = 0;
        globalThis.fetch = async (url) => {
            if (url === info.manifestUrl) return new Response(JSON.stringify(manifest));
            count++;
            return new Response(
                JSON.stringify({
                    data: count === 1 ? info : { ...info, version: { ...info.version, id } },
                }),
            );
        };
        await assert.rejects(
            loadPublished(info.slug, new AbortController().signal),
            /phiên bản mới/,
        );
        globalThis.fetch = async (url) =>
            new Response(
                JSON.stringify(
                    url === info.manifestUrl ? { ...manifest, version: 2 } : { data: info },
                ),
            );
        await assert.rejects(loadPublished(info.slug, new AbortController().signal), /chưa khớp/);
        globalThis.fetch = async () =>
            new Response(JSON.stringify({ data: { ...info, slug: 'other-book' } }));
        await assert.rejects(loadPublicInfo(info.slug, new AbortController().signal), /không khớp/);
        await assert.rejects(loadPublicInfo('../bad', new AbortController().signal));
    } finally {
        globalThis.fetch = previous;
    }
});
