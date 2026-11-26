export const makeId = (n, prefix = '55555555-5555-4555-8555') =>
    `${prefix}-${String(n).padStart(12, '0')}`;

export const NOW = '2026-11-25T10:00:00.000Z';
export const CDN_ORIGIN = 'https://mock-cdn.bookaria.test';

export const TINY_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
    'base64',
);

export function createTinyWav(seconds = 2) {
    const sampleRate = 16000;
    const dataBytes = sampleRate * 2 * seconds;
    const buf = Buffer.alloc(44 + dataBytes);
    buf.write('RIFF', 0);
    buf.writeUInt32LE(36 + dataBytes, 4);
    buf.write('WAVEfmt ', 8);
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20);
    buf.writeUInt16LE(1, 22);
    buf.writeUInt32LE(sampleRate, 24);
    buf.writeUInt32LE(sampleRate * 2, 28);
    buf.writeUInt16LE(2, 32);
    buf.writeUInt16LE(16, 34);
    buf.write('data', 36);
    buf.writeUInt32LE(dataBytes, 40);
    return buf;
}

export function createTinyGlb() {
    const jsonText = JSON.stringify({
        asset: { version: '2.0', generator: 'bookaria-viewer-test' },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ name: 'MockCube' }],
    });
    const padLen = (4 - (Buffer.byteLength(jsonText) % 4)) % 4;
    const jsonBuffer = Buffer.from(jsonText + ' '.repeat(padLen), 'utf8');
    const totalLength = 12 + 8 + jsonBuffer.length;
    const header = Buffer.alloc(12);
    header.writeUInt32LE(0x46546c67, 0);
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(totalLength, 8);
    const chunkHeader = Buffer.alloc(8);
    chunkHeader.writeUInt32LE(jsonBuffer.length, 0);
    chunkHeader.writeUInt32LE(0x4e4f534a, 4);
    return Buffer.concat([header, chunkHeader, jsonBuffer]);
}

function corsHeaders(request, extra = {}) {
    const origin = request.headers().origin;
    return {
        'access-control-allow-origin': origin || '*',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'Content-Type',
        'access-control-expose-headers': 'Expires',
        ...extra,
    };
}

export function createViewerFixtureData(options = {}) {
    const bookId = makeId(90);
    const versionId = makeId(91);
    const page1Id = makeId(1);
    const page2Id = makeId(2);
    const audioAssetId = makeId(50);
    const modelAssetId = makeId(51);

    const arEnabled = options.arEnabled !== false;
    const externalUrl =
        options.externalUrl || 'https://learn.example.com/bookaria/lesson-1?tab=overview';

    const pages = [
        {
            pageId: page1Id,
            title: 'Trang 1: Mở đầu',
            aspect: 1.4,
            imageUrl: `${CDN_ORIGIN}/media/page-1.png`,
            thumbnailUrl: `${CDN_ORIGIN}/media/page-1.png`,
            ...(arEnabled
                ? {
                      group: 0,
                      targetIndex: 0,
                      marker: { mode: 'CUSTOM_MARKER' },
                  }
                : { marker: { mode: 'NONE' } }),
            settings: options.withNarration ? { narrationAssetId: audioAssetId } : {},
            scene: {
                schemaVersion: 1,
                objects: [
                    {
                        id: 'title-text',
                        type: 'text',
                        name: 'Tiêu đề 3D',
                        text: 'Xin chào Bookaria',
                        transform: {
                            position: [0, 0.2, 0.05],
                            rotation: [0, 0, 0],
                            scale: [1, 1, 1],
                        },
                        visible: true,
                        billboard: false,
                        snapToPaper: false,
                        locked: false,
                        style: { color: '#111111', size: 0.08, font: 'sans', bold: true },
                    },
                    {
                        id: 'model-1',
                        type: 'model',
                        name: 'Khối 3D',
                        assetId: modelAssetId,
                        transform: {
                            position: [0, 0, 0.1],
                            rotation: [90, 0, 0],
                            scale: [1, 1, 1],
                        },
                        visible: true,
                        billboard: false,
                        snapToPaper: false,
                        locked: false,
                    },
                    {
                        id: 'hotspot-1',
                        type: 'hotspot',
                        name: 'Vùng chạm Khám phá',
                        transform: {
                            position: [0, -0.2, 0.02],
                            rotation: [0, 0, 0],
                            scale: [1, 1, 1],
                        },
                        visible: true,
                        billboard: false,
                        snapToPaper: false,
                        locked: false,
                        size: [0.3, 0.3],
                        showHint: true,
                    },
                ],
                interactions: options.withExternalLinkOnEnter
                    ? [
                          {
                              id: 'open-external',
                              name: 'Mở tài liệu',
                              enabled: true,
                              trigger: { type: 'onPageEnter' },
                              actions: [{ type: 'openUrl', delayMs: 0, url: externalUrl }],
                          },
                      ]
                    : [
                          {
                              id: 'tap-rule',
                              name: 'Chạm ẩn tiêu đề',
                              enabled: true,
                              trigger: { type: 'onTap', objectId: 'hotspot-1' },
                              actions: [
                                  {
                                      type: 'toggleVisible',
                                      delayMs: 0,
                                      objectId: 'title-text',
                                  },
                              ],
                          },
                      ],
            },
        },
        {
            pageId: page2Id,
            title: 'Trang 2: Kết thúc',
            aspect: 1.4,
            imageUrl: `${CDN_ORIGIN}/media/page-2.png`,
            thumbnailUrl: `${CDN_ORIGIN}/media/page-2.png`,
            ...(arEnabled
                ? {
                      group: 0,
                      targetIndex: 1,
                      marker: { mode: 'CUSTOM_MARKER' },
                  }
                : { marker: { mode: 'NONE' } }),
            settings: options.withNarration ? { narrationAssetId: audioAssetId } : {},
            scene: {
                schemaVersion: 1,
                objects: [],
                interactions: [],
            },
        },
    ];

    const manifest = {
        schemaVersion: 1,
        bookId,
        version: 1,
        title: options.title || 'Sách Khám Phá Online',
        trackerEngine: 'mindar',
        generatedAt: NOW,
        targetGroups: arEnabled
            ? [
                  {
                      group: 0,
                      mindUrl: `${CDN_ORIGIN}/mind/group-0.mind`,
                      pageIds: [page1Id, page2Id],
                  },
              ]
            : [],
        pages,
        assets: {
            [modelAssetId]: {
                type: 'MODEL',
                url: `${CDN_ORIGIN}/media/model.glb`,
                size: 1024,
                meta: {},
            },
            ...(options.withNarration
                ? {
                      [audioAssetId]: {
                          type: 'AUDIO',
                          url: `${CDN_ORIGIN}/media/narration.wav`,
                          size: 64044,
                          meta: { durationSec: 2 },
                      },
                  }
                : {}),
        },
        credits: [
            {
                assetId: modelAssetId,
                name: 'Khối 3D',
                license: 'CC-BY-4.0',
                author: 'Bookaria Test',
            },
        ],
    };

    const publicInfo = {
        slug: options.slug || 'sach-kham-pha',
        title: manifest.title,
        description: 'Sách tương tác kiểm thử Viewer.',
        author: { id: makeId(95), displayName: 'Tác giả Bookaria' },
        coverUrl: `${CDN_ORIGIN}/media/cover.png`,
        language: 'vi',
        ageMin: 6,
        ageMax: 12,
        version: { id: versionId, versionNo: 1, publishedAt: NOW },
        manifestUrl: `${CDN_ORIGIN}/manifests/sach-kham-pha.json`,
        pageCount: pages.length,
        arPageCount: arEnabled ? pages.length : 0,
        downloadBytes: 65068,
        printPdfUrl: `${CDN_ORIGIN}/prints/sach-kham-pha.pdf`,
    };

    return { bookId, versionId, page1Id, page2Id, manifest, publicInfo };
}

export async function installViewerMocks(page, options = {}) {
    const data = createViewerFixtureData(options);
    const wav = createTinyWav(2);
    const glb = createTinyGlb();

    const state = {
        publicInfo: structuredClone(data.publicInfo),
        manifest: structuredClone(data.manifest),
        previewExpiresInMs: options.previewExpiresInMs ?? 300_000,
        previewExpired: false,
        eventsBatches: [],
        reports: [],
        assetRequests: [],
        faults: [],
    };

    if (options.mockArRuntime) {
        await page.addInitScript((denyCamera) => {
            window.__mockArCameraCalls = 0;
            window.__mockArCameraStops = 0;
            window.__mockArTarget = null;
            window.__mockArDenyCamera = Boolean(denyCamera);
            window.__mockArHoldStaleMatrix = false;

            navigator.mediaDevices.getUserMedia = async () => {
                window.__mockArCameraCalls++;
                if (window.__mockArDenyCamera) {
                    throw new DOMException('Camera denied by test mock', 'NotAllowedError');
                }
                const canvas = document.createElement('canvas');
                canvas.width = 640;
                canvas.height = 480;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#e5e7eb';
                ctx.fillRect(0, 0, 640, 480);
                const stream = canvas.captureStream(15);
                for (const track of stream.getTracks()) {
                    const origStop = track.stop.bind(track);
                    track.stop = () => {
                        window.__mockArCameraStops++;
                        origStop();
                    };
                }
                return stream;
            };
        }, options.denyCamera);

        await page.route('**/tracker-loader.js', (route) =>
            route.fulfill({
                status: 200,
                contentType: 'text/javascript',
                body: `
window.__mockArDisposedCount = 0;
window.MINDAR = {
    IMAGE: {
        Controller: class MockMindController {
            constructor(opts) {
                this.onUpdate = opts.onUpdate;
                this.trackingStates = [];
                this.tracker = { featurePointsListT: [], imagePixelsListT: [], imagePropertiesListT: [] };
                this._timer = null;
                window.__mockArController = this;
            }
            addImageTargetsFromBuffer() {
                this.trackingStates = [{ isTracking: false }, { isTracking: false }];
                return { dimensions: [[100, 140], [100, 140]] };
            }
            async dummyRun() {}
            getProjectionMatrix() {
                return [1,0,0,0, 0,1,0,0, 0,0,-1,-1, 0,0,-0.2,0];
            }
            processVideo() {
                clearInterval(this._timer);
                this._timer = setInterval(() => {
                    const target = window.__mockArTarget;
                    if (typeof target === 'number') {
                        this.trackingStates.forEach((s, idx) => { s.isTracking = idx === target; });
                        this.onUpdate({
                            type: 'updateMatrix',
                            targetIndex: target,
                            worldMatrix: [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,-3,1],
                        });
                    } else {
                        this.trackingStates.forEach((s) => { s.isTracking = false; });
                        this.onUpdate({
                            type: 'updateMatrix',
                            targetIndex: 0,
                            worldMatrix: window.__mockArHoldStaleMatrix
                                ? [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,-3,1]
                                : null,
                        });
                    }
                    this.onUpdate({ type: 'processDone' });
                }, 40);
            }
            stopProcessVideo() {
                clearInterval(this._timer);
            }
            dispose() {
                clearInterval(this._timer);
                window.__mockArDisposedCount++;
            }
        }
    }
};`,
            }),
        );
    }

    await page.route(`${CDN_ORIGIN}/**`, async (route) => {
        const request = route.request();
        if (request.method() === 'OPTIONS') {
            return route.fulfill({ status: 204, headers: corsHeaders(request) });
        }
        const url = new URL(request.url());
        state.assetRequests.push(url.pathname);
        const headers = corsHeaders(request);
        if (url.pathname.endsWith('.json')) {
            return route.fulfill({ status: 200, headers, json: state.manifest });
        }
        if (url.pathname.endsWith('.glb')) {
            return route.fulfill({
                status: 200,
                contentType: 'model/gltf-binary',
                body: glb,
                headers,
            });
        }
        if (url.pathname.endsWith('.wav')) {
            return route.fulfill({
                status: 200,
                contentType: 'audio/wav',
                body: wav,
                headers,
            });
        }
        if (url.pathname.endsWith('.mind')) {
            return route.fulfill({
                status: 200,
                contentType: 'application/octet-stream',
                body: Buffer.from([1, 2, 3, 4]),
                headers,
            });
        }
        return route.fulfill({
            status: 200,
            contentType: 'image/png',
            body: TINY_PNG,
            headers,
        });
    });

    await page.route('**/api/v1/**', async (route) => {
        const request = route.request();
        const method = request.method();
        const headers = corsHeaders(request);
        if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });

        const url = new URL(request.url());
        const idx = url.pathname.indexOf('/api/v1');
        const path = idx >= 0 ? url.pathname.slice(idx + '/api/v1'.length) : url.pathname;

        const faultIdx = state.faults.findIndex(
            (f) => (!f.method || f.method === method) && f.match.test(path),
        );
        if (faultIdx >= 0) {
            const fault = state.faults.splice(faultIdx, 1)[0];
            return route.fulfill({
                status: fault.status || 500,
                headers,
                json: { error: { code: fault.code || 'INTERNAL_ERROR', message: fault.message } },
            });
        }

        if (method === 'GET' && path.startsWith('/public/books/')) {
            const slug = decodeURIComponent(path.split('/').at(-1));
            if (slug === 'not-found' || slug !== state.publicInfo.slug) {
                return route.fulfill({
                    status: 410,
                    headers,
                    json: { error: { code: 'BOOK_UNAVAILABLE', message: 'Sách không khả dụng.' } },
                });
            }
            return route.fulfill({ status: 200, headers, json: { data: state.publicInfo } });
        }

        if (method === 'GET' && /^\/public\/previews\/[^/]+$/.test(path)) {
            if (state.previewExpired) {
                return route.fulfill({
                    status: 404,
                    headers,
                    json: { error: { code: 'NOT_FOUND', message: 'Preview đã hết hạn.' } },
                });
            }
            return route.fulfill({
                status: 200,
                headers: {
                    ...headers,
                    Expires: new Date(Date.now() + state.previewExpiresInMs).toUTCString(),
                },
                json: { data: state.manifest },
            });
        }

        if (method === 'GET' && /^\/public\/previews\/[^/]+\/groups\/\d+$/.test(path)) {
            return route.fulfill({
                status: 200,
                contentType: 'application/octet-stream',
                headers,
                body: Buffer.from([1, 2, 3, 4]),
            });
        }

        if (method === 'POST' && path === '/public/events') {
            state.eventsBatches.push(request.postDataJSON());
            return route.fulfill({ status: 202, headers });
        }

        if (method === 'POST' && /^\/public\/books\/[^/]+\/reports$/.test(path)) {
            state.reports.push(request.postDataJSON());
            return route.fulfill({
                status: 201,
                headers,
                json: { data: { received: true } },
            });
        }

        return route.fulfill({ status: 404, headers, json: { error: { code: 'NOT_FOUND' } } });
    });

    return {
        data,
        state,
        bumpPublishedVersion(newVersionNo = 2) {
            state.publicInfo.version = {
                id: makeId(900 + newVersionNo),
                versionNo: newVersionNo,
                publishedAt: new Date().toISOString(),
            };
        },
        expirePreview() {
            state.previewExpired = true;
        },
        setPreviewExpiresInMs(ms) {
            state.previewExpiresInMs = ms;
        },
        injectFault(fault) {
            state.faults.push(fault);
        },
    };
}
