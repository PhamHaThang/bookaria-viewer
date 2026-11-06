import type { RouteHandler } from '../router/types';
import type { BookViewer } from '../viewer/book-viewer';

export function createHomeRoute(viewer: BookViewer): RouteHandler {
    return (_match, signal) => {
        if (signal.aborted) return;
        viewer.stop('');
        viewer.getUI().empty();
        viewer.status('');
    };
}

