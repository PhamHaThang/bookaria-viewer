type Download = (url: string, signal: AbortSignal, limit: number) => Promise<ArrayBuffer>;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_CACHE_BYTES = 30 * 1024 * 1024;

/** Session-local compressed data cache. At most one download, including prefetch. */
export class TargetCache {
    private data = new Map<number, ArrayBuffer>();
    private size = 0;
    private stopped = false;
    private retryAfter = new Map<number, number>();
    private pending:
        | { group: number; abort: AbortController; task: Promise<ArrayBuffer> }
        | undefined;
    constructor(
        private download: Download,
        private now = () => performance.now(),
    ) {}
    private cached(group: number) {
        const bytes = this.data.get(group);
        if (bytes) {
            this.data.delete(group);
            this.data.set(group, bytes);
        }
        return bytes;
    }
    private start(group: number, url: string) {
        this.pending?.abort.abort();
        const abort = new AbortController();
        const deadline = setTimeout(() => abort.abort(), 10000);
        const task = this.download(url, abort.signal, MAX_FILE_BYTES)
            .then((bytes) => {
                abort.signal.throwIfAborted();
                if (this.stopped) throw new Error('Đã dừng camera.');
                if (bytes.byteLength > MAX_FILE_BYTES)
                    throw new Error('Dữ liệu nhận diện vượt giới hạn tải.');
                this.retryAfter.delete(group);
                this.data.set(group, bytes);
                this.size += bytes.byteLength;
                while (this.size > MAX_CACHE_BYTES) {
                    const key = this.data.keys().next().value as number;
                    this.size -= this.data.get(key)?.byteLength ?? 0;
                    this.data.delete(key);
                }
                return bytes;
            })
            .catch((error) => {
                if (abort.signal.aborted && !this.stopped)
                    throw new Error('Tải dữ liệu nhận diện bị gián đoạn. Hãy thử lại.');
                throw error;
            })
            .finally(() => {
                clearTimeout(deadline);
                if (this.pending?.abort === abort) this.pending = undefined;
            });
        this.pending = { group, abort, task };
        return task;
    }
    async get(group: number, url: string) {
        if (this.stopped) throw new Error('Đã dừng camera.');
        const cached = this.cached(group);
        if (cached) return cached;
        if (this.pending?.group === group) {
            try {
                return await this.pending.task;
            } catch {
                if (this.stopped) throw new Error('Đã dừng camera.');
                // A speculative download must not prevent a foreground retry.
            }
        }
        return this.start(group, url);
    }
    prefetch(group: number, url: string) {
        if (
            this.stopped ||
            this.pending ||
            this.data.has(group) ||
            this.now() < (this.retryAfter.get(group) ?? 0)
        )
            return;
        // Speculation is optional. A failure is surfaced only if this group is needed.
        void this.start(group, url).catch(() => {
            if (!this.stopped) this.retryAfter.set(group, this.now() + 15000);
        });
    }
    stop() {
        this.stopped = true;
        this.pending?.abort.abort();
        this.pending = undefined;
        this.data.clear();
        this.retryAfter.clear();
        this.size = 0;
    }
}
