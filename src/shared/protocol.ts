import { z } from 'zod';
import { ManifestAssetSchema } from './contracts/asset.schema';
import { IdSchema } from './contracts/common.schema';
import { ManifestPageSchema } from './contracts/manifest.schema';
import { sceneAssetIds } from './contracts/scene.schema';

export const PreviewPayloadSchema = z
    .object({
        title: z.string().max(200),
        page: ManifestPageSchema,
        assets: z.record(IdSchema, ManifestAssetSchema),
    })
    .superRefine((data, ctx) => {
        for (const id of sceneAssetIds(data.page.scene, data.page.settings)) {
            if (!data.assets[id])
                ctx.addIssue({ code: 'custom', message: `Thiếu tài nguyên ${id}` });
        }
    });
export type PreviewPayload = z.infer<typeof PreviewPayloadSchema>;
export const PreviewMessageSchema = z.object({
    type: z.literal('BOOKARIA_PREVIEW'),
    nonce: z.string().uuid(),
    requestId: z.int().positive(),
    payload: PreviewPayloadSchema,
});
export const RunMessageSchema = z.object({
    type: z.literal('BOOKARIA_RUN_RULE'),
    nonce: z.string().uuid(),
    ruleId: z.string().min(1).max(50),
});
export function trustedMessage(
    event: Pick<MessageEvent, 'origin' | 'source'>,
    parent: MessageEventSource | null,
    origin: string,
) {
    return event.source === parent && event.origin === origin;
}
