import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GroupSearch } from '../src/tracker/group-search.ts';
import { releaseTargets } from '../src/tracker/mindar.ts';

function fixture(groups, select) {
    const pending = new Map();
    const calls = [],
        errors = [];
    let id = 0;
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
    );
    const flush = async () => {
        for (let n = 0; n < 12; n++) await Promise.resolve();
    };
    const tick = async () => {
        const item = pending.entries().next().value;
        assert.ok(item, 'A scan is scheduled');
        pending.delete(item[0]);
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
    assert.equal([...f.pending.values()][0].ms, 6500);
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
