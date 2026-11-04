import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GroupSearch, SEARCH_TIMING } from '../src/tracker/group-search.ts';
import { releaseTargets } from '../src/tracker/mindar.ts';

function fixture(groups, select) {
    const pending = new Map();
    const calls = [],
        errors = [];
    let id = 0;
    let clock = 0;
    const search = new GroupSearch(
        groups,
        async (group) => {
            calls.push(group);
            await select?.(group);
        },
        (error) => errors.push(error),
        (fn, ms) => {
            pending.set(++id, { fn, ms });
            return id;
        },
        (key) => pending.delete(key),
        () => clock,
    );
    const flush = async () => {
        for (let n = 0; n < 12; n++) await Promise.resolve();
    };
    const tick = async (frames = 12, candidate = false) => {
        const item = pending.entries().next().value;
        assert.ok(item, 'A scan is scheduled');
        pending.delete(item[0]);
        clock += item[1].ms;
        for (let n = 0; n < frames; n++) search.frame(calls.at(-1), candidate);
        item[1].fn();
        await flush();
    };
    return { search, calls, errors, pending, tick, flush };
}
test('search visits every group, keeps a recognized page locked, then resumes after tracking loss', async () => {
    const f = fixture([10, 20, 30]);
    await f.search.start(20);
    assert.deepEqual(f.calls, [20]);
    await f.tick();
    assert.deepEqual(f.calls, [20, 30]);
    f.search.recognized(30);
    assert.equal(f.pending.size, 0);
    f.search.lost(20);
    assert.equal(f.pending.size, 0, 'Stale group events cannot unlock a visible page');
    f.search.lost(30);
    assert.equal([...f.pending.values()][0].ms, 1800);
    f.search.recognized(30);
    assert.equal(f.pending.size, 0, 'Brief loss is cancelled on reacquisition');
    f.search.lost(30);
    await f.tick();
    assert.deepEqual(f.calls, [20, 30, 20]);
    await f.tick();
    assert.deepEqual(f.calls, [20, 30, 20, 10]);
    f.search.stop();
    assert.equal(f.pending.size, 0);
});
test('manual page preference serializes switches and stop discards pending selections', async () => {
    let finish;
    const f = fixture([0, 1, 2], (group) =>
        group === 0
            ? new Promise((resolve) => {
                  finish = resolve;
              })
            : undefined,
    );
    const starting = f.search.start();
    f.search.prefer(1);
    f.search.prefer(2);
    assert.deepEqual(f.calls, [0]);
    finish();
    await starting;
    await f.flush();
    assert.deepEqual(f.calls, [0, 2]);
    f.search.prefer(2);
    assert.equal([...f.pending.values()][0].ms, SEARCH_TIMING.preferredMs);
    f.search.stop();
    f.search.prefer(1);
    await f.flush();
    assert.deepEqual(f.calls, [0, 2]);
});
test('one broken group does not block recognition in other groups', async () => {
    const f = fixture([0, 1], (group) => {
        if (group === 0) throw Error('download failed');
    });
    await f.search.start();
    assert.equal(f.errors.length, 1);
    await f.tick();
    assert.deepEqual(f.calls, [0, 1]);
    f.search.recognized(1);
    assert.equal(f.pending.size, 0);
    f.search.stop();
});
test('one group is not repeatedly reloaded while searching or after loss', async () => {
    const f = fixture([0, 0]);
    await f.search.start();
    assert.equal(f.pending.size, 0);
    f.search.recognized(0);
    f.search.lost(0);
    assert.equal(f.pending.size, 0);
    assert.deepEqual(f.calls, [0]);
    f.search.stop();
});
test('target cleanup releases each owned tensor once and leaves unrelated detector state alone', () => {
    let releases = 0;
    const tensor = {
        dispose() {
            releases++;
        },
    };
    releaseTargets({
        featurePointsListT: [tensor],
        imagePixelsListT: [
            tensor,
            {
                dispose() {
                    releases++;
                },
            },
        ],
        imagePropertiesListT: [],
    });
    assert.equal(releases, 2);
    releaseTargets(undefined);
});

test('empty groups advance after enough frames instead of a fixed 3.5 second delay', async () => {
    const f = fixture([0, 1]);
    await f.search.start();
    assert.equal([...f.pending.values()][0].ms, SEARCH_TIMING.minScanMs);
    await f.tick();
    assert.deepEqual(f.calls, [0, 1]);
    f.search.stop();
});

test('slow tracking gets enough completed frames and stuck tracking eventually advances', async () => {
    const f = fixture([0, 1]);
    await f.search.start();
    await f.tick(2);
    assert.deepEqual(f.calls, [0]);
    await f.tick(9);
    assert.deepEqual(f.calls, [0]);
    await f.tick(1);
    assert.deepEqual(f.calls, [0, 1]);
    for (let i = 0; i < 40 && f.calls.length === 2; i++) await f.tick(0);
    assert.deepEqual(f.calls, [0, 1, 0]);
    f.search.stop();
});

test('candidate warmup is protected, stale frame events are ignored, and same-group preference keeps the lock', async () => {
    const f = fixture([0, 1]);
    await f.search.start();
    await f.tick(12, true);
    assert.deepEqual(f.calls, [0], 'Do not leave while MindAR is warming up a candidate');
    f.search.frame(1, false);
    await f.tick(1, true);
    assert.deepEqual(f.calls, [0]);
    f.search.recognized(0);
    f.search.prefer(0);
    assert.equal(f.pending.size, 0, 'Selecting a page in a visible group must keep tracking');
    assert.equal(f.search.nextGroup(), 1);
    f.search.stop();
});

test('a failed switch cannot accept late poses from the previous group', async () => {
    const f = fixture([0, 1, 2], (group) => {
        if (group === 1) throw Error('invalid group');
    });
    await f.search.start();
    await f.tick();
    f.search.recognized(0);
    assert.equal(f.pending.size, 1);
    await f.tick();
    assert.deepEqual(f.calls, [0, 1, 2]);
    f.search.stop();
});
