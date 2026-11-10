import { Matrix4, Quaternion, Vector3 } from 'three';

const RECOVERY_MS = 300;
const CONFIRM_MS = 24;
const CANDIDATE_MS = 300;
const MAX_ANGLE = Math.PI / 6;

class Pose {
    position = new Vector3();
    rotation = new Quaternion();
    scale = new Vector3();
    copy(other: Pose) {
        this.position.copy(other.position);
        this.rotation.copy(other.rotation);
        this.scale.copy(other.scale);
    }
}

function distance(a: Pose, b: Pose) {
    // Camera-space depth makes the threshold independent of target pixel dimensions.
    const depth = Math.max(Math.abs(a.position.z), Math.abs(b.position.z), 1e-6);
    return a.position.distanceTo(b.position) / depth;
}

function scaleChange(a: Pose, b: Pose) {
    return Math.max(
        Math.abs(Math.log(a.scale.x / b.scale.x)),
        Math.abs(Math.log(a.scale.y / b.scale.y)),
        Math.abs(Math.log(a.scale.z / b.scale.z)),
    );
}

/** Filter the target pose before converting it to page coordinates, including corner offsets. */
export class PoseFilter {
    private matrix = new Matrix4();
    private input = new Pose();
    private accepted = new Pose();
    private output = new Pose();
    private candidate = new Pose();
    private ready = false;
    private pending = false;
    private candidateAt = 0;
    private acceptedAt = 0;
    private lostAt: number | null = null;

    reset() {
        this.ready = false;
        this.pending = false;
        this.lostAt = null;
    }

    lost(now = performance.now()) {
        this.lostAt ??= now;
        this.pending = false;
    }

    /** Null is a missed pose, so the existing bounded loss grace also applies to outliers. */
    update(world: number[], now = performance.now()): number[] | null {
        if (
            world.length !== 16 ||
            !world.every(Number.isFinite) ||
            !Number.isFinite(now) ||
            Math.abs(world[3]) > 1e-6 ||
            Math.abs(world[7]) > 1e-6 ||
            Math.abs(world[11]) > 1e-6 ||
            Math.abs(world[15] - 1) > 1e-6
        ) {
            this.pending = false;
            return null;
        }
        this.matrix
            .fromArray(world)
            .decompose(this.input.position, this.input.rotation, this.input.scale);
        if (
            this.input.position.z >= -1e-6 ||
            ![...this.input.rotation.toArray(), ...this.input.scale.toArray()].every(
                Number.isFinite,
            ) ||
            Math.min(this.input.scale.x, this.input.scale.y, this.input.scale.z) <= 1e-6
        ) {
            this.pending = false;
            return null;
        }
        this.input.rotation.normalize();
        if (this.lostAt !== null && now - this.lostAt >= RECOVERY_MS) this.reset();
        this.lostAt = null;
        if (this.ready) {
            const jump =
                distance(this.input, this.accepted) > 0.18 ||
                this.input.rotation.angleTo(this.accepted.rotation) > MAX_ANGLE ||
                scaleChange(this.input, this.accepted) > Math.log(1.25);
            if (jump) {
                const consistent =
                    this.pending &&
                    now - this.candidateAt <= CANDIDATE_MS &&
                    distance(this.input, this.candidate) < 0.06 &&
                    this.input.rotation.angleTo(this.candidate.rotation) < Math.PI / 18 &&
                    scaleChange(this.input, this.candidate) < Math.log(1.1);
                if (!consistent) {
                    this.candidate.copy(this.input);
                    this.candidateAt = now;
                    this.pending = true;
                    return null;
                }
                if (now - this.candidateAt < CONFIRM_MS) return null;
            }
        }
        this.pending = false;
        if (!this.ready || now - this.acceptedAt >= RECOVERY_MS) {
            this.output.copy(this.input);
        } else {
            const delta = Math.max(0.001, Math.min(0.1, (now - this.acceptedAt) / 1000));
            const motion =
                Math.max(
                    distance(this.input, this.output),
                    this.input.rotation.angleTo(this.output.rotation),
                    scaleChange(this.input, this.output),
                ) / delta;
            // About 60 ms of smoothing when steady, approaching 25 ms during faster motion.
            const tau = Math.max(0.025, 0.06 / (1 + motion));
            const alpha = 1 - Math.exp(-delta / tau);
            this.output.position.lerp(this.input.position, alpha);
            this.output.rotation.slerp(this.input.rotation, alpha);
            this.output.scale.lerp(this.input.scale, alpha);
        }
        this.ready = true;
        this.accepted.copy(this.input);
        this.acceptedAt = now;
        return this.matrix
            .compose(this.output.position, this.output.rotation, this.output.scale)
            .toArray();
    }
}
