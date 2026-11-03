import { publicApiBase } from './api';
import {
    type EventBatchBody,
    EventBatchBodySchema,
    type ViewerEvent,
} from './contracts/api/public.schema';
import { IdSchema } from './contracts/common.schema';

type Device = EventBatchBody['device'];
type EventInput = ViewerEvent extends infer E
    ? E extends { at: string }
        ? Omit<E, 'at'>
        : never
    : never;
type Send = (batch: EventBatchBody, final: boolean) => Promise<unknown>;

export function readingDevice(agent: string): Device {
    const type =
        /iPad|Tablet/i.test(agent) || (/Android/i.test(agent) && !/Mobile/i.test(agent))
            ? 'tablet'
            : /Mobi|iPhone|Android/i.test(agent)
              ? 'mobile'
              : 'desktop';
    const os = /Android/i.test(agent)
        ? 'Android'
        : /iPhone|iPad/i.test(agent)
          ? 'iOS'
          : /Windows/i.test(agent)
            ? 'Windows'
            : /Mac/i.test(agent)
              ? 'macOS'
              : /Linux/i.test(agent)
                ? 'Linux'
                : 'Other';
    const browser = /Edg/i.test(agent)
        ? 'Edge'
        : /Firefox|FxiOS/i.test(agent)
          ? 'Firefox'
          : /Chrome|CriOS/i.test(agent)
            ? 'Chrome'
            : /Safari/i.test(agent)
              ? 'Safari'
              : 'Other';
    return { type, os, browser };
}

const sendEvents: Send = async (batch, final) => {
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 10000);
    try {
        await fetch(`${publicApiBase}/public/events`, {
            method: 'POST',
            body: JSON.stringify(batch),
            headers: { 'Content-Type': 'application/json' },
            credentials: 'omit',
            cache: 'no-store',
            referrerPolicy: 'no-referrer',
            keepalive: final,
            signal: controller.signal,
        });
    } finally {
        clearTimeout(deadline);
    }
};

// Memory only: each opening gets a fresh session; failed batches are never replayed.
export class ReadingEvents {
    private queue: ViewerEvent[] = [];
    private active = true;
    private pending: Promise<void> | null = null;
    private finalRequested = false;
    private head: Omit<EventBatchBody, 'events'>;
    constructor(
        versionId: string,
        device: Device,
        private send: Send = sendEvents,
        sessionId = crypto.randomUUID(),
    ) {
        this.head = {
            sessionId: IdSchema.parse(sessionId),
            bookVersionId: IdSchema.parse(versionId),
            device,
        };
        this.record({ type: 'OPEN' });
    }
    record(event: EventInput) {
        if (!this.active || this.queue.length >= 100) return;
        const parsed = EventBatchBodySchema.safeParse({
            ...this.head,
            events: [{ ...event, at: new Date().toISOString() }],
        });
        if (!parsed.success) return;
        this.queue.push(parsed.data.events[0]);
        if (this.queue.length >= 50) void this.flush();
    }
    flush(final = false): Promise<void> {
        this.finalRequested ||= final;
        if (this.pending) return this.pending;
        if (!this.queue.length) return Promise.resolve();
        this.pending = (async () => {
            while (this.queue.length) {
                const events = this.queue.splice(0, 50);
                const batch = EventBatchBodySchema.parse({ ...this.head, events });
                // Remove before I/O: visibilitychange and pagehide cannot send the same batch.
                try {
                    await this.send(batch, this.finalRequested);
                } catch {
                    /* Best effort; reading must continue. */
                }
            }
        })().finally(() => {
            this.pending = null;
            this.finalRequested = false;
        });
        return this.pending;
    }
    dispose() {
        if (!this.active) return;
        this.active = false;
        void this.flush(true);
    }
}

export function startReadingEvents(versionId: string) {
    const events = new ReadingEvents(versionId, readingDevice(navigator.userAgent));
    const timer = setInterval(() => {
        void events.flush();
    }, 30000);
    const hidden = () => {
        if (document.hidden) void events.flush(true);
    };
    const pagehide = () => {
        void events.flush(true);
    };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', pagehide);
    return {
        record: (event: EventInput) => events.record(event),
        dispose() {
            clearInterval(timer);
            document.removeEventListener('visibilitychange', hidden);
            window.removeEventListener('pagehide', pagehide);
            events.dispose();
        },
    };
}
