import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CameraAccess } from '../src/camera-access.ts';

function stream() {
    const track = {
        readyState: 'live',
        stops: 0,
        stop() {
            this.readyState = 'ended';
            this.stops++;
        },
    };
    return { track, getTracks: () => [track] };
}
test('entry permission and AR acquisition share one camera request and stream', async () => {
    const media = stream();
    let calls = 0;
    const access = new CameraAccess(async () => {
        calls++;
        return media;
    });
    await Promise.all([access.prepare(), access.prepare()]);
    assert.equal(calls, 1);
    assert.equal(await access.acquire(new AbortController().signal), media);
    access.clear();
    assert.equal(media.track.stops, 0, 'Tracker owns the transferred stream');
    media.track.stop();
    assert.equal(media.track.stops, 1);
});
test('choosing reading or leaving the page releases the prepared camera once', async () => {
    const media = stream(),
        access = new CameraAccess(async () => media);
    await access.prepare();
    access.clear();
    access.clear();
    assert.equal(media.track.stops, 1);
});
test('a camera granted after the user leaves is immediately stopped', async () => {
    const media = stream();
    let grant;
    const access = new CameraAccess(
        () =>
            new Promise((resolve) => {
                grant = resolve;
            }),
    );
    const request = access.prepare();
    access.clear();
    grant(media);
    await assert.rejects(request, { name: 'AbortError' });
    assert.equal(media.track.stops, 1);
});
test('cancelled AR acquisition does not hang while the permission prompt is unanswered', async () => {
    const media = stream();
    let grant;
    const access = new CameraAccess(
        () =>
            new Promise((resolve) => {
                grant = resolve;
            }),
    );
    const abort = new AbortController(),
        request = access.acquire(abort.signal);
    access.clear();
    abort.abort();
    await assert.rejects(request, { name: 'AbortError' });
    grant(media);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(media.track.stops, 1);
});
test('denial never loops automatically; an explicit retry may request again', async () => {
    const media = stream();
    let calls = 0;
    const access = new CameraAccess(async () => {
        if (++calls === 1) throw new DOMException('Denied', 'NotAllowedError');
        return media;
    });
    await assert.rejects(access.prepare(), { name: 'NotAllowedError' });
    assert.equal(calls, 1);
    assert.equal(await access.acquire(new AbortController().signal), media);
    assert.equal(calls, 2);
});
test('new acquisition waits for a cancelled old prompt instead of opening two cameras', async () => {
    const old = stream(),
        current = stream();
    let calls = 0,
        grant;
    const access = new CameraAccess(() => {
        calls++;
        return calls === 1
            ? new Promise((resolve) => {
                  grant = resolve;
              })
            : Promise.resolve(current);
    });
    const initial = access.prepare();
    access.clear();
    const acquire = access.acquire(new AbortController().signal);
    assert.equal(calls, 1);
    grant(old);
    await assert.rejects(initial, { name: 'AbortError' });
    assert.equal(await acquire, current);
    assert.equal(calls, 2);
    assert.equal(old.track.stops, 1);
});
