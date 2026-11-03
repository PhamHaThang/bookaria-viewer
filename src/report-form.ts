import { ReportBookBodySchema } from './shared/contracts/api/public.schema';
import { LIMITS } from './shared/contracts/common.schema';
import type { ManifestPage } from './shared/contracts/manifest.schema';
import { reportBook, reportDeviceId } from './shared/reports';

export function installReportForm(slug: string, pages: ManifestPage[]) {
    const form = document.getElementById('report-form') as HTMLFormElement;
    const section = document.getElementById('report-section') as HTMLElement;
    const menu = document.getElementById('report-menu') as HTMLButtonElement;
    const dialog = document.getElementById('report-dialog') as HTMLDialogElement;
    const feedback = document.getElementById('report-feedback') as HTMLParagraphElement;
    const submit = form.querySelector('button') as HTMLButtonElement;
    const note = form.elements.namedItem('note') as HTMLTextAreaElement;
    const page = form.elements.namedItem('pageId') as HTMLSelectElement;
    let pending = false,
        disposed = false;
    note.maxLength = LIMITS.reportNoteChars;
    page.replaceChildren(
        new Option('Toàn bộ sách', ''),
        ...pages.map(
            (item, index) => new Option(`${index + 1}. ${item.title || 'Trang sách'}`, item.pageId),
        ),
    );
    feedback.textContent = '';
    feedback.setAttribute('role', 'status');
    form.reset();
    form.hidden = false;
    section.hidden = false;
    menu.hidden = false;
    submit.disabled = false;
    submit.textContent = 'Gửi báo cáo';
    const onSubmit = async (event: SubmitEvent) => {
        event.preventDefault();
        if (pending || disposed) return;
        const values = new FormData(form);
        let storage: Storage | undefined;
        try {
            storage = localStorage;
        } catch {
            /* Private browsing. */
        }
        const body = ReportBookBodySchema.safeParse({
            reason: values.get('reason'),
            note: values.get('note') || undefined,
            pageId: values.get('pageId') || undefined,
            deviceId: reportDeviceId(storage),
        });
        if (!body.success) {
            feedback.setAttribute('role', 'alert');
            feedback.textContent = 'Kiểm tra lý do và nội dung báo cáo.';
            return;
        }
        pending = true;
        submit.disabled = true;
        submit.textContent = 'Đang gửi…';
        feedback.textContent = '';
        try {
            await reportBook(slug, body.data);
            if (disposed) return;
            form.hidden = true;
            feedback.setAttribute('role', 'status');
            feedback.textContent = 'Đã nhận báo cáo. Cảm ơn bạn đã giúp kiểm tra nội dung.';
        } catch (error) {
            if (disposed) return;
            feedback.setAttribute('role', 'alert');
            feedback.textContent =
                error instanceof Error ? error.message : 'Chưa gửi được báo cáo.';
        } finally {
            pending = false;
            if (!disposed) {
                submit.disabled = false;
                submit.textContent = 'Gửi báo cáo';
            }
        }
    };
    form.addEventListener('submit', onSubmit);
    return () => {
        disposed = true;
        form.removeEventListener('submit', onSubmit);
        section.hidden = true;
        menu.hidden = true;
        dialog.close();
    };
}
