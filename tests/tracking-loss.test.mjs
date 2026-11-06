import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TRACKING_LOSS_GRACE_MS, TrackingLoss } from '../src/tracker/tracking-loss.ts';

function fixture() {
    let key = 0;
    const pending = new Map();
    const loss = new TrackingLoss(
        (callback, ms) => {
            pending.set(++key, { callback, ms });
            return key;
        },
        (id) => pending.delete(id),
    );
    return {
        loss,
        pending,
        fire() {
            const [id, item] = pending.entries().next().value;
            pending.delete(id);
            item.callback();
        },
    };
}

test('brief reacquisition cancels a loss without hiding content or restarting its runtime', () => {
    const f = fixture();
    let losses = 0;
    f.loss.defer(() => {
        losses++;
    });
    assert.equal(f.pending.values().next().value.ms, TRACKING_LOSS_GRACE_MS);
    f.loss.cancel();
    assert.equal(f.pending.size, 0);
    assert.equal(losses, 0);
});

test('repeated loss callbacks cannot keep stale content visible indefinitely', () => {
    const f = fixture();
    let losses = 0;
    f.loss.defer(() => {
        losses++;
    });
    for (let n = 0; n < 10; n++)
        f.loss.defer(() => {
            losses++;
        });
    assert.equal(f.pending.size, 1);
    f.fire();
    assert.equal(losses, 1);
    assert.equal(f.pending.size, 0);
});

test('changing page or stopping cancels an old pending loss and the next target gets its own window', () => {
    const f = fixture();
    const calls = [];
    f.loss.defer(() => {
        calls.push('old page');
    });
    f.loss.cancel();
    f.loss.defer(() => {
        calls.push('new page');
    });
    f.fire();
    assert.deepEqual(calls, ['new page']);
});
