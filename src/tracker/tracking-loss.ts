export const TRACKING_LOSS_GRACE_MS = 180;

/** Debounce brief lost/found pairs, without extending a real loss on repeated callbacks. */
export class TrackingLoss {
    private timer: ReturnType<typeof setTimeout> | undefined;
    constructor(
        private schedule = (callback: () => void, ms: number) => setTimeout(callback, ms),
        private clear = (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
    ) {}
    defer(confirm: () => void) {
        if (this.timer !== undefined) return;
        this.timer = this.schedule(() => {
            this.timer = undefined;
            confirm();
        }, TRACKING_LOSS_GRACE_MS);
    }
    cancel() {
        if (this.timer !== undefined) this.clear(this.timer);
        this.timer = undefined;
    }
}
