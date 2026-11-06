/** Search one target group at a time; a visible target always owns the camera. */
export const SEARCH_TIMING = {
    minScanMs: 1200,
    maxScanMs: 6500,
    minFrames: 12,
    pollMs: 200,
    lossGraceMs: 1800,
    preferredMs: 2500,
    failureMs: 1000,
} as const;

export class GroupSearch {
    private timer: ReturnType<typeof setTimeout> | undefined;
    private stopped = false;
    private found = false;
    private desired: number | undefined;
    private switching = false;
    private order: number[];
    private readonly natural: number[];
    private cursor = -1;
    private current: number | undefined;
    private frames = 0;
    private candidate = false;
    private since = 0;
    private lastFrame = 0;
    private minScanMs: number = SEARCH_TIMING.minScanMs;
    constructor(
        groups: number[],
        private select: (group: number) => Promise<void>,
        private onError: (error: unknown) => void,
        private schedule = (fn: () => void, ms: number) => setTimeout(fn, ms),
        private cancel = (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
        private now = () => performance.now(),
    ) {
        this.natural = [...new Set(groups)];
        this.order = [...this.natural];
    }
    async start(preferred?: number) {
        if (preferred !== undefined) this.prioritize(preferred);
        await this.advance();
    }
    private prioritize(group: number) {
        const position = this.natural.indexOf(group);
        if (position < 0) return;
        this.order = [...this.natural].sort((left, right) => {
            const a = this.natural.indexOf(left),
                b = this.natural.indexOf(right);
            return Math.abs(a - position) - Math.abs(b - position) || b - a;
        });
        this.cursor = -1;
    }
    /** Only the next likely group is prefetched; never a second GPU tracker. */
    nextGroup() {
        return this.order.length > 1
            ? this.order[(this.cursor + 1) % this.order.length]
            : undefined;
    }
    private clear() {
        if (this.timer !== undefined) this.cancel(this.timer);
        this.timer = undefined;
    }
    private later(ms: number, review = false) {
        this.clear();
        if (this.stopped || this.found || this.order.length < 2) return;
        this.timer = this.schedule(() => {
            if (review) this.review();
            else void this.advance();
        }, ms);
    }
    private scan(minMs: number = SEARCH_TIMING.minScanMs) {
        this.frames = 0;
        this.candidate = false;
        this.since = this.lastFrame = this.now();
        this.minScanMs = minMs;
        this.later(minMs, true);
    }
    private review() {
        if (this.stopped || this.found || this.switching) return;
        const elapsed = this.now() - this.since;
        // MindAR needs six consecutive tracked frames before it publishes a pose.
        // Do not leave during that warmup, or make a slow phone race a fixed timer.
        const warming = this.candidate && this.now() - this.lastFrame < 2500;
        if (
            elapsed < this.minScanMs ||
            warming ||
            (this.frames < SEARCH_TIMING.minFrames && elapsed < SEARCH_TIMING.maxScanMs)
        ) {
            this.later(SEARCH_TIMING.pollMs, true);
            return;
        }
        void this.advance();
    }
    frame(group: number, candidate = false) {
        if (this.stopped || this.switching || group !== this.current) return;
        this.frames++;
        this.candidate = candidate;
        this.lastFrame = this.now();
    }
    private async advance() {
        if (this.stopped || this.found || this.switching || !this.order.length) return;
        this.clear();
        this.cursor = (this.cursor + 1) % this.order.length;
        const next = this.desired ?? this.order[this.cursor];
        this.desired = undefined;
        this.current = undefined;
        this.switching = true;
        let succeeded = false;
        try {
            await this.select(next);
            this.current = next;
            succeeded = true;
        } catch (error) {
            if (!this.stopped) this.onError(error);
        } finally {
            this.switching = false;
            if (!this.stopped) {
                if (this.desired !== undefined) void this.advance();
                else if (succeeded) this.scan();
                else this.later(SEARCH_TIMING.failureMs);
            }
        }
    }
    recognized(group: number) {
        if (this.stopped || this.switching || group !== this.current || this.found) return;
        this.found = true;
        this.prioritize(group);
        this.cursor = 0;
        this.clear();
    }
    lost(group: number) {
        if (this.stopped || group !== this.current || !this.found) return;
        this.found = false;
        this.later(SEARCH_TIMING.lossGraceMs);
    }
    prefer(group: number) {
        if (this.stopped || !this.order.includes(group)) return;
        if (group === this.current && this.found) return;
        this.found = false;
        this.clear();
        this.prioritize(group);
        if (group === this.current && !this.switching) {
            this.cursor = 0;
            this.scan(SEARCH_TIMING.preferredMs);
        } else {
            this.desired = group;
            void this.advance();
        }
    }
    stop() {
        this.stopped = true;
        this.clear();
    }
}
