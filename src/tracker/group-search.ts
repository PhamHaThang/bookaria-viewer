/** Search one target group at a time; a visible target always owns the camera. */
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
    constructor(
        groups: number[],
        private select: (group: number) => Promise<void>,
        private onError: (error: unknown) => void,
        private schedule = (fn: () => void, ms: number) => setTimeout(fn, ms),
        private cancel = (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
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
    private clear() {
        if (this.timer !== undefined) this.cancel(this.timer);
        this.timer = undefined;
    }
    private later(ms: number) {
        this.clear();
        if (this.stopped || this.found || this.order.length < 2) return;
        this.timer = this.schedule(() => void this.advance(), ms);
    }
    private async advance() {
        if (this.stopped || this.found || this.switching || !this.order.length) return;
        this.clear();
        this.cursor = (this.cursor + 1) % this.order.length;
        const next = this.desired ?? this.order[this.cursor];
        this.desired = undefined;
        this.switching = true;
        try {
            await this.select(next);
            this.current = next;
        } catch (error) {
            if (!this.stopped) this.onError(error);
        } finally {
            this.switching = false;
            if (!this.stopped) {
                if (this.desired !== undefined) void this.advance();
                else this.later(3500);
            }
        }
    }
    recognized(group: number) {
        if (this.stopped || this.switching || group !== this.current) return;
        if (this.found) return;
        this.found = true;
        this.prioritize(group);
        this.cursor = 0;
        this.clear();
    }
    lost(group: number) {
        if (this.stopped || group !== this.current || !this.found) return;
        this.found = false;
        this.later(1800);
    }
    prefer(group: number) {
        if (this.stopped || !this.order.includes(group)) return;
        this.found = false;
        this.clear();
        this.prioritize(group);
        if (group === this.current && !this.switching) {
            this.cursor = 0;
            this.later(6500);
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
