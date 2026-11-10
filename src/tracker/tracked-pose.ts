import { PoseFilter } from './pose-filter';
import { TrackingLoss } from './tracking-loss';

/** Own the single loss deadline, starting at the first failed tracking sample. */
export class TrackedPose {
    private filter = new PoseFilter();
    private target: number | null = null;
    private visible = false;

    constructor(
        private emit: (target: number, matrix: number[] | null) => void,
        private loss = new TrackingLoss(),
        private now = () => performance.now(),
    ) {}

    update(target: number, matrix: number[] | null, tracking: boolean) {
        if (target !== this.target) {
            // An invalid or stale pose from another target must not cancel the active deadline.
            if (!tracking || !matrix) return;
            const next = new PoseFilter();
            const world = next.update(matrix, this.now());
            if (!world) return;
            this.reset();
            this.filter = next;
            this.target = target;
            this.visible = true;
            this.emit(target, world);
            return;
        }
        if (tracking && matrix) {
            const world = this.filter.update(matrix, this.now());
            if (world) {
                this.loss.cancel();
                this.visible = true;
                this.emit(target, world);
                return;
            }
            // Keep a candidate outlier for confirmation by the next genuine sample.
        } else this.filter.lost(this.now());
        if (!this.visible) return;
        this.loss.defer(() => {
            this.visible = false;
            this.filter.reset();
            this.emit(target, null);
        });
    }

    reset() {
        this.loss.cancel();
        this.filter.reset();
        this.target = null;
        this.visible = false;
    }
}
