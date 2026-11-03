import { cameraError, requestCameraStream } from '../camera-access';
import { fetchBytes } from '../shared/api';
import { GroupSearch } from './group-search';

type Update = { type: string; targetIndex?: number; worldMatrix?: number[] | null };
interface Tensor {
    dispose(): void;
}
interface TargetTracker {
    featurePointsListT?: Tensor[];
    imagePixelsListT?: Tensor[];
    imagePropertiesListT?: Tensor[];
}
interface Controller {
    addImageTargetsFromBuffer(bytes: ArrayBuffer): { dimensions: [number, number][] };
    dummyRun(video: HTMLVideoElement): Promise<void> | void;
    getProjectionMatrix(): number[];
    processVideo(video: HTMLVideoElement): void;
    stopProcessVideo(): void;
    dispose(): void;
    worker?: Worker;
    tracker?: TargetTracker;
}
export interface TrackingGroup {
    group: number;
    url: string;
}
type Hooks = {
    update: (
        group: number,
        target: number,
        matrix: number[] | null,
        dimensions: [number, number],
    ) => void;
    resize: (projection: number[], width: number, height: number) => void;
    searching: () => void;
    issue: (message: string) => void;
};
type ControllerConstructor = new (options: object) => Controller;
let vendor: Promise<ControllerConstructor> | null = null;
function loadController() {
    if (vendor) return vendor;
    vendor = new Promise<ControllerConstructor>((resolve, reject) => {
        const script = document.createElement('script');
        script.type = 'module';
        script.src = '/tracker-loader.js';
        script.addEventListener(
            'load',
            () => {
                const controller = (
                    window as Window & {
                        MINDAR?: { IMAGE?: { Controller?: ControllerConstructor } };
                    }
                ).MINDAR?.IMAGE?.Controller;
                if (controller) resolve(controller);
                else {
                    vendor = null;
                    script.remove();
                    reject(new Error('Thư viện AR chưa sẵn sàng. Hãy thử lại.'));
                }
            },
            { once: true },
        );
        script.addEventListener(
            'error',
            () => {
                vendor = null;
                script.remove();
                reject(new Error('Không tải được thư viện AR. Kiểm tra kết nối và thử lại.'));
            },
            { once: true },
        );
        document.head.append(script);
    });
    return vendor;
}

/** MindAR 1.2.5 does not release the old target tensors when replacing its tracker.
 * Only these three target-owned arrays are disposed; detector/TF backend stay alive.
 * Keep this adapter pinned to the verified vendor distribution. */
export function releaseTargets(tracker?: TargetTracker) {
    const disposed = new Set<Tensor>();
    for (const list of [
        tracker?.featurePointsListT,
        tracker?.imagePixelsListT,
        tracker?.imagePropertiesListT,
    ])
        for (const tensor of list ?? []) {
            if (!disposed.has(tensor)) {
                disposed.add(tensor);
                tensor.dispose();
            }
        }
}

export async function startTracking(
    container: HTMLElement,
    groups: TrackingGroup[],
    preferred: number | undefined,
    signal: AbortSignal,
    hooks: Hooks,
    getCamera: (signal: AbortSignal) => Promise<MediaStream> = requestCameraStream,
) {
    if (!isSecureContext || !navigator.mediaDevices?.getUserMedia)
        throw new Error('Camera cần kết nối HTTPS. Bạn vẫn có thể đọc sách trên màn hình.');
    signal.throwIfAborted();
    if (!groups.length) throw new Error('Sách này chưa có trang nhận diện AR.');
    const video = document.createElement('video');
    video.className = 'camera-video';
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    let stream: MediaStream | null = null,
        controller: Controller | null = null;
    let stopped = false,
        released = false,
        processing = false;
    let current: number | undefined;
    let dimensions: [number, number][] = [];
    let inputWidth = 0,
        inputHeight = 0;
    let pauseResolve: (() => void) | undefined;
    let pauseReject: ((error: Error) => void) | undefined;
    let releaseTimer: ReturnType<typeof setTimeout> | undefined;
    let search: GroupSearch | undefined;
    const bytes = new Map<number, ArrayBuffer>();
    const projection = () => {
        const result = controller?.getProjectionMatrix().slice() ?? [];
        if (
            inputWidth !== inputHeight &&
            video.videoWidth === inputHeight &&
            video.videoHeight === inputWidth
        )
            [result[0], result[5]] = [result[5], result[0]];
        return result;
    };
    const resize = () => {
        video.width = video.videoWidth;
        video.height = video.videoHeight;
        if (controller && !stopped) hooks.resize(projection(), video.videoWidth, video.videoHeight);
    };
    const release = () => {
        if (released) return;
        released = true;
        clearTimeout(releaseTimer);
        releaseTargets(controller?.tracker);
        controller?.dispose();
        controller?.worker?.terminate();
    };
    const stop = () => {
        if (stopped) return;
        stopped = true;
        signal.removeEventListener('abort', stop);
        search?.stop();
        pauseReject?.(new Error('Đã dừng camera.'));
        pauseResolve = undefined;
        pauseReject = undefined;
        controller?.stopProcessVideo();
        if (processing) releaseTimer = setTimeout(release, 1500);
        else release();
        for (const track of stream?.getTracks() ?? []) track.stop();
        bytes.clear();
        video.pause();
        video.removeEventListener('resize', resize);
        video.srcObject = null;
        video.remove();
    };
    signal.addEventListener('abort', stop, { once: true });
    video.addEventListener('resize', resize);
    // Stop at a completed frame, then let MindAR's nextFrame continuation exit.
    const pause = async () => {
        if (!processing) return;
        await new Promise<void>((resolve, reject) => {
            const deadline = setTimeout(() => {
                pauseResolve = undefined;
                pauseReject = undefined;
                reject(new Error('Camera phản hồi chậm. Hãy đóng camera và thử lại.'));
            }, 8000);
            pauseResolve = () => {
                clearTimeout(deadline);
                resolve();
            };
            pauseReject = (error) => {
                clearTimeout(deadline);
                reject(error);
            };
        });
        await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        signal.throwIfAborted();
        if (stopped) throw new Error('Đã dừng camera.');
    };
    try {
        stream = await getCamera(signal);
        if (signal.aborted) {
            for (const track of stream.getTracks()) track.stop();
            signal.throwIfAborted();
        }
        video.srcObject = stream;
        container.prepend(video);
        await video.play();
        resize();
        const MindController = await loadController();
        signal.throwIfAborted();
        inputWidth = video.videoWidth;
        inputHeight = video.videoHeight;
        controller = new MindController({
            inputWidth,
            inputHeight,
            maxTrack: 1,
            onUpdate: (data: Update) => {
                if (data.type === 'processDone') {
                    if (stopped) {
                        release();
                        return;
                    }
                    if (pauseResolve) {
                        controller?.stopProcessVideo();
                        processing = false;
                        const resolve = pauseResolve;
                        pauseResolve = undefined;
                        pauseReject = undefined;
                        resolve();
                    }
                    return;
                }
                if (
                    !stopped &&
                    data.type === 'updateMatrix' &&
                    current !== undefined &&
                    data.targetIndex !== undefined &&
                    dimensions[data.targetIndex]
                ) {
                    if (data.worldMatrix) search?.recognized(current);
                    else search?.lost(current);
                    hooks.update(
                        current,
                        data.targetIndex,
                        data.worldMatrix ?? null,
                        dimensions[data.targetIndex],
                    );
                }
            },
        });
        const select = async (group: number) => {
            const item = groups.find((item) => item.group === group);
            if (!item || stopped || !controller) return;
            let buffer = bytes.get(group);
            if (!buffer) buffer = await fetchBytes(item.url, signal, 10 * 1024 * 1024);
            signal.throwIfAborted();
            if (stopped) return;
            // A bounded compressed-data cache, never one camera/GPU tracker per group.
            bytes.delete(group);
            bytes.set(group, buffer);
            while (
                [...bytes.values()].reduce((sum, value) => sum + value.byteLength, 0) >
                30 * 1024 * 1024
            )
                bytes.delete(bytes.keys().next().value as number);
            await pause();
            signal.throwIfAborted();
            if (stopped) return;
            hooks.searching();
            current = undefined;
            dimensions = [];
            const old = controller.tracker;
            try {
                dimensions = controller.addImageTargetsFromBuffer(buffer).dimensions;
            } finally {
                if (controller.tracker !== old) releaseTargets(old);
            }
            await controller.dummyRun(video);
            signal.throwIfAborted();
            if (stopped) return;
            current = group;
            resize();
            processing = true;
            controller.processVideo(video);
        };
        search = new GroupSearch(
            groups.map((item) => item.group),
            select,
            (error) => {
                if (!stopped && !signal.aborted)
                    hooks.issue(
                        error instanceof Error ? error.message : 'Chưa tải được dữ liệu nhận diện.',
                    );
            },
        );
        await search.start(preferred);
        signal.throwIfAborted();
        return {
            stop,
            prefer: (group: number) => search?.prefer(group),
            projection: projection(),
            width: video.videoWidth,
            height: video.videoHeight,
        };
    } catch (error) {
        stop();
        if (signal.aborted) throw error;
        throw cameraError(error);
    }
}
