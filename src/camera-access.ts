/** Open only the rear camera; no microphone permission is requested. */
export async function requestCameraStream() {
    if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia)
        throw new Error('Camera cần kết nối HTTPS. Bạn vẫn có thể đọc sách trên màn hình.');
    return navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 640 },
            height: { ideal: 480 },
        },
    });
}

export function cameraError(error: unknown): Error {
    if (error instanceof DOMException) {
        if (['NotAllowedError', 'PermissionDeniedError'].includes(error.name))
            return new Error(
                'Camera chưa được cho phép. Bật quyền camera trong cài đặt Safari/Chrome, hoặc chọn Đọc trên màn hình.',
            );
        if (error.name === 'NotFoundError')
            return new Error(
                'Không tìm thấy camera trên thiết bị. Bạn vẫn có thể đọc trên màn hình.',
            );
        if (error.name === 'NotReadableError')
            return new Error(
                'Camera đang bận hoặc chưa mở được. Đóng ứng dụng đang dùng camera rồi thử lại.',
            );
    }
    return error instanceof Error
        ? error
        : new Error('Không mở được camera. Bạn vẫn có thể đọc trên màn hình.');
}

const cancelled = () => new DOMException('Đã hủy yêu cầu camera.', 'AbortError');
const stop = (stream: MediaStream) => {
    for (const track of stream.getTracks()) track.stop();
};

/** One explicit permission request, then transfer that same stream to the AR tracker. */
export class CameraAccess {
    private stream: MediaStream | null = null;
    private epoch = 0;
    private pending: { epoch: number; promise: Promise<void> } | null = null;
    constructor(private open: () => Promise<MediaStream> = requestCameraStream) {}

    async prepare(): Promise<void> {
        const epoch = this.epoch;
        if (this.stream?.getTracks().some((track) => track.readyState !== 'ended')) return;
        if (this.stream) {
            stop(this.stream);
            this.stream = null;
        }
        if (this.pending) {
            const pending = this.pending;
            try {
                await pending.promise;
            } catch (error) {
                if (
                    pending.epoch === epoch ||
                    !(error instanceof Error) ||
                    error.name !== 'AbortError'
                )
                    throw error;
            }
            if (epoch !== this.epoch) throw cancelled();
            if (!this.stream) return this.prepare();
            return;
        }
        const pending = {
            epoch,
            promise: this.open().then((stream) => {
                if (epoch !== this.epoch) {
                    stop(stream);
                    throw cancelled();
                }
                this.stream = stream;
            }),
        };
        this.pending = pending;
        try {
            await pending.promise;
        } finally {
            if (this.pending === pending) this.pending = null;
        }
    }

    async acquire(signal: AbortSignal): Promise<MediaStream> {
        signal.throwIfAborted();
        let onAbort = () => {};
        try {
            await Promise.race([
                this.prepare(),
                new Promise<never>((_, reject) => {
                    onAbort = () => reject(signal.reason ?? cancelled());
                    signal.addEventListener('abort', onAbort, { once: true });
                }),
            ]);
        } finally {
            signal.removeEventListener('abort', onAbort);
        }
        signal.throwIfAborted();
        const stream = this.stream;
        if (!stream) throw new Error('Camera chưa sẵn sàng. Hãy thử mở lại camera.');
        this.stream = null;
        return stream;
    }

    /** Invalidate pending grants too: a late approval must never leave the camera running. */
    clear() {
        this.epoch++;
        if (this.stream) stop(this.stream);
        this.stream = null;
    }
}
