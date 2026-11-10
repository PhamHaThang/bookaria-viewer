/** A native confirmation keeps destination text separate from the navigation action. */
export function createExternalLinkDialog() {
    const modal = document.getElementById('external-link') as HTMLDialogElement;
    const link = document.getElementById('link') as HTMLAnchorElement;
    const host = document.getElementById('external-link-host') as HTMLElement;
    const address = document.getElementById('external-link-address') as HTMLElement;
    let previousFocus: HTMLElement | null = null;
    modal.addEventListener('close', () => {
        const focus = previousFocus;
        previousFocus = null;
        if (
            focus?.isConnected &&
            focus !== document.body &&
            focus !== document.documentElement &&
            focus.getClientRects().length &&
            getComputedStyle(focus).visibility !== 'hidden'
        )
            focus.focus({ preventScroll: true });
        else
            document.querySelector<HTMLElement>('#viewport canvas')?.focus({ preventScroll: true });
    });
    // Keep href intact during the native anchor action, including Safari's new-tab handling.
    link.addEventListener('click', () => modal.close());
    return {
        show(value: string) {
            let url: URL;
            try {
                url = new URL(value);
            } catch {
                return false;
            }
            if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
            link.href = url.href;
            host.textContent = url.host;
            address.textContent = url.href;
            if (!modal.open) {
                previousFocus = document.activeElement as HTMLElement | null;
                const menu = document.getElementById('reader-menu') as HTMLDetailsElement;
                menu.open = false;
                modal.showModal();
                document.getElementById('dismiss-link')?.focus({ preventScroll: true });
            }
            return true;
        },
        close() {
            if (modal.open) modal.close();
        },
    };
}
