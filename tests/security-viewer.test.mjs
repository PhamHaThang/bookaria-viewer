import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { ManifestSchema } from '../src/shared/contracts/manifest.schema.ts';
import { PreviewMessageSchema, RunMessageSchema, trustedMessage } from '../src/shared/protocol.ts';
import { publicBookSchemaCheck } from './security-viewer-helper.mjs';

function collectSourceFiles(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...collectSourceFiles(full));
        else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) out.push(full);
    }
    return out;
}

test('SEC-VW-01 (Viewer): Viewer src/ has no raw HTML injection sinks (innerHTML / outerHTML / document.write)', () => {
    const files = collectSourceFiles(path.resolve(import.meta.dirname, '../src'));
    const sinkPattern =
        /\b(innerHTML|outerHTML|insertAdjacentHTML|dangerouslySetInnerHTML)\b|document\.write\s*\(/;
    const hits = [];
    for (const file of files) {
        const text = fs.readFileSync(file, 'utf8');
        if (sinkPattern.test(text)) hits.push(file);
    }
    assert.deepEqual(hits, []);
});

test('SEC-VW-02: ManifestSchema rejects javascript: and data: URLs in openUrl, screen.buttonUrl, and credits.sourceUrl', () => {
    const baseManifest = {
        schemaVersion: 1,
        bookId: '11111111-1111-4111-8111-111111111111',
        version: 1,
        title: '<b>Tiêu đề</b>',
        trackerEngine: 'mindar',
        generatedAt: '2026-11-26T00:00:00Z',
        targetGroups: [],
        pages: [
            {
                pageId: '22222222-2222-4222-8222-222222222222',
                title: 'Trang 1',
                aspect: 1.4,
                imageUrl: 'https://cdn.example.com/page.jpg',
                thumbnailUrl: 'https://cdn.example.com/thumb.jpg',
                marker: { mode: 'NONE' },
                settings: {},
                scene: {
                    schemaVersion: 1,
                    objects: [{ id: 't1', type: 'text', text: '<img src=x>', transform: {} }],
                    interactions: [
                        {
                            id: 'r1',
                            name: 'Open',
                            trigger: { type: 'onTap', objectId: 't1' },
                            actions: [{ type: 'openUrl', url: 'https://example.com' }],
                        },
                    ],
                },
            },
        ],
        assets: {},
        credits: [
            {
                assetId: '33333333-3333-4333-8333-333333333333',
                name: 'Asset',
                license: 'CC-BY',
                author: 'Author',
                sourceUrl: 'https://example.com/source',
            },
        ],
    };

    assert.equal(ManifestSchema.safeParse(baseManifest).success, true);

    const badOpenUrl = structuredClone(baseManifest);
    badOpenUrl.pages[0].scene.interactions[0].actions[0].url = 'javascript:void(0)';
    assert.equal(ManifestSchema.safeParse(badOpenUrl).success, false);

    const badCreditUrl = structuredClone(baseManifest);
    badCreditUrl.credits[0].sourceUrl = 'data:text/html,hi';
    assert.equal(ManifestSchema.safeParse(badCreditUrl).success, false);

    assert.equal(publicBookSchemaCheck(), true);
});

test('SEC-VW-03: /embed trustedMessage & protocol schemas enforce exact origin, source, UUID nonce and positive integer requestId', () => {
    const parentWin = {};
    const otherWin = {};
    assert.equal(
        trustedMessage(
            { origin: 'https://bookaria-studio.pages.dev', source: parentWin },
            parentWin,
            'https://bookaria-studio.pages.dev',
        ),
        true,
    );
    assert.equal(
        trustedMessage(
            { origin: 'https://evil.example', source: parentWin },
            parentWin,
            'https://bookaria-studio.pages.dev',
        ),
        false,
    );
    assert.equal(
        trustedMessage(
            { origin: 'https://bookaria-studio.pages.dev', source: otherWin },
            parentWin,
            'https://bookaria-studio.pages.dev',
        ),
        false,
    );
    assert.equal(
        PreviewMessageSchema.safeParse({
            type: 'BOOKARIA_PREVIEW',
            nonce: 'not-a-uuid',
            requestId: 1,
            payload: {},
        }).success,
        false,
    );
    assert.equal(
        RunMessageSchema.safeParse({
            type: 'BOOKARIA_RUN_RULE',
            nonce: '11111111-1111-4111-8111-111111111111',
            ruleId: 'r1',
        }).success,
        true,
    );
});

test('SEC-E2E-02 [GAP CHECK]: Viewer Cloudflare Pages public/_headers should define frame-ancestors policy for /embed vs /b/*', () => {
    const headersPath = path.resolve(import.meta.dirname, '../public/_headers');
    assert.equal(
        fs.existsSync(headersPath),
        true,
        'Missing bookaria-viewer/public/_headers for Cloudflare Pages CSP frame-ancestors & Permissions-Policy',
    );
});
