import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readerFeedback } from '../src/reader-feedback.ts';

test('ordinary hints and completion messages never offer retry or media controls', () => {
    for (const message of [
        'Tiếp tục bằng cách quét trang 2.',
        'Bạn đang ở trang được chọn.',
        'Bạn đã hoàn thành chuyến khám phá!',
        'Đọc video và âm thanh trong sách',
    ]) {
        assert.equal(readerFeedback(message).retry, false);
        assert.equal(readerFeedback(message).media, false);
        assert.equal(readerFeedback(message).role, 'status');
    }
});
test('load failures and media failures get only their explicitly requested recovery', () => {
    const load = readerFeedback('Không mở được trang.', { kind: 'error', action: 'retry' });
    assert.equal(load.retry, true);
    assert.equal(load.media, false);
    assert.equal(load.role, 'alert');
    const denied = readerFeedback('Chạm để cho phép phát âm thanh.', {
        kind: 'error',
        action: 'media',
        mediaPermission: true,
    });
    assert.equal(denied.retry, false);
    assert.equal(denied.media, true);
    assert.equal(denied.mediaLabel, 'Chạm để bật âm thanh');
    assert.equal(
        readerFeedback('Tệp âm thanh lỗi', { action: 'media' }).mediaLabel,
        'Thử phát lại',
    );
});
test('terminal errors can be dismissed without offering an ineffective retry', () => {
    const expired = readerFeedback('Liên kết đã hết hạn.', { kind: 'error' });
    assert.equal(expired.retry, false);
    assert.equal(expired.media, false);
    assert.equal(expired.role, 'alert');
});
test('clearing a notice hides every recovery action', () => {
    for (const action of ['retry', 'media', undefined]) {
        const state = readerFeedback('', { action });
        assert.equal(state.visible, false);
        assert.equal(state.retry, false);
        assert.equal(state.media, false);
    }
});
