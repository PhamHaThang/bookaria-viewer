/** Reuse the media elements granted playback by a reader's gesture across page changes. */
export class MediaElementPool {
    private entries: {
        kind: 'audio' | 'video';
        slot: string;
        element: HTMLMediaElement;
        leased: boolean;
    }[] = [];

    private acquire(kind: 'audio' | 'video', slot: string): HTMLMediaElement {
        let entry = this.entries.find(
            (item) => item.kind === kind && item.slot === slot && !item.leased,
        );
        entry ??= this.entries.find((item) => item.kind === kind && !item.leased);
        if (!entry) {
            entry = {
                kind,
                slot,
                element: kind === 'audio' ? new Audio() : document.createElement('video'),
                leased: false,
            };
            this.entries.push(entry);
        }
        entry.slot = slot;
        entry.leased = true;
        return entry.element;
    }

    audio(slot: string): HTMLAudioElement {
        return this.acquire('audio', slot) as HTMLAudioElement;
    }
    video(slot: string): HTMLVideoElement {
        return this.acquire('video', slot) as HTMLVideoElement;
    }

    release(element: HTMLMediaElement) {
        const entry = this.entries.find((item) => item.element === element);
        if (!entry?.leased) return;
        element.pause();
        element.removeAttribute('src');
        element.load();
        element.loop = false;
        element.muted = false;
        element.volume = 1;
        entry.leased = false;
    }

    dispose() {
        for (const entry of this.entries) this.release(entry.element);
        this.entries = [];
    }
}
