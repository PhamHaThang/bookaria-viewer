import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode, encode } from '@msgpack/msgpack';

const defaultDirectory = fileURLToPath(
    new URL('../../../bookaria-backend/assets/bookaria-markers/', import.meta.url),
);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Reuse the approved backend seed assets; do not copy six MiB of binaries into Viewer. */
export async function markerFixture() {
    const directory = process.env.BOOKARIA_MARKERS_DIR || defaultDirectory;
    let manifest;
    try {
        manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
    } catch {
        throw new Error(
            'Missing Bookaria marker seed assets. Set BOOKARIA_MARKERS_DIR to the folder containing manifest.json, png/ and mind/. See docs/AR-TESTING.md.',
        );
    }
    const markers = manifest.markers.slice().sort((a, b) => a.number - b.number);
    if (markers.length !== 20)
        throw new Error('This regression suite requires the approved 20 markers.');
    const targets = [];
    const images = [];
    for (const marker of markers) {
        const safeFile = (relative) => {
            const absolute = path.resolve(directory, relative);
            if (!absolute.startsWith(`${path.resolve(directory)}${path.sep}`))
                throw new Error('Marker fixture path escapes its directory.');
            return absolute;
        };
        const image = await readFile(safeFile(marker.image));
        const mind = await readFile(safeFile(marker.mind));
        if (
            (marker.sha256 && digest(image) !== marker.sha256) ||
            (marker.mindSha256 && digest(mind) !== marker.mindSha256)
        )
            throw new Error(`Marker ${marker.id} does not match its approved checksum.`);
        const decoded = decode(mind);
        if (decoded.v !== 2 || decoded.dataList?.length !== 1)
            throw new Error(`Marker ${marker.id} must contain one MindAR v2 target.`);
        images.push(image);
        targets.push(decoded.dataList[0]);
    }
    const groups = [0, 1].map((group) =>
        Buffer.from(encode({ v: 2, dataList: targets.slice(group * 10, group * 10 + 10) })),
    );
    return { images, groups: [...groups, Buffer.from(encode({ v: 2, dataList: targets }))] };
}

export async function installMarkerRoutes(page, fixture) {
    await page.route('**/ar-test/marker/*.png', async (route) => {
        const number = Number(
            new URL(route.request().url()).pathname.split('/').at(-1).slice(0, -4),
        );
        const body = fixture.images[number - 1];
        if (!body) return route.fulfill({ status: 404 });
        await route.fulfill({ contentType: 'image/png', body });
    });
    await page.route('**/ar-test/group/*.mind', async (route) => {
        const group = Number(
            new URL(route.request().url()).pathname.split('/').at(-1).slice(0, -5),
        );
        const body = fixture.groups[group];
        if (!body) return route.fulfill({ status: 404 });
        await route.fulfill({ contentType: 'application/octet-stream', body });
    });
    await page.route('**/tracker-loader.js', async (route) => {
        const response = await route.fetch();
        await route.fulfill({
            response,
            body: `${await response.text()}
const Base = window.MINDAR.IMAGE.Controller;
window.__arControllers = [];
window.MINDAR.IMAGE.Controller = class extends Base {
    constructor(options) {
        super({ ...options, ...window.__arTrackingOverrides });
        window.__arControllers.push(this);
        this.__arTargets = [];
    }
    addImageTargetsFromBuffer(bytes) {
        const result = super.addImageTargetsFromBuffer(bytes);
        this.__arTargets.push(this.tracker);
        return result;
    }
};`,
        });
    });
    await page.addInitScript(() => {
        window.__arCameraCalls = 0;
        window.__arCameraStops = 0;
        window.__arMarker = 0;
        window.__arScale = 1;
        window.__arAngle = 0;
        navigator.mediaDevices.getUserMedia = async () => {
            window.__arCameraCalls++;
            if (window.__arDenyCamera) throw new DOMException('Denied', 'NotAllowedError');
            const images = await Promise.all(
                Array.from({ length: 20 }, async (_, index) => {
                    const image = new Image();
                    image.src = `/ar-test/marker/${index + 1}.png`;
                    await image.decode();
                    return image;
                }),
            );
            const canvas = document.createElement('canvas');
            canvas.width = 640;
            canvas.height = 480;
            const context = canvas.getContext('2d');
            const draw = () => {
                window.__arDrawFrame?.();
                context.fillStyle = 'white';
                context.fillRect(0, 0, 640, 480);
                if (!window.__arMarker) return;
                const side = 400 * window.__arScale;
                context.save();
                context.translate(320 + (window.__arOffsetX || 0), 240 + (window.__arOffsetY || 0));
                context.rotate((window.__arAngle * Math.PI) / 180);
                context.drawImage(images[window.__arMarker - 1], -side / 2, -side / 2, side, side);
                context.restore();
            };
            draw();
            const interval = setInterval(draw, 50);
            const stream = canvas.captureStream(20);
            for (const track of stream.getTracks()) {
                const stop = track.stop.bind(track);
                track.stop = () => {
                    window.__arCameraStops++;
                    clearInterval(interval);
                    stop();
                };
            }
            return stream;
        };
    });
}
