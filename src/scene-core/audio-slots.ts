import type { ManifestPage } from '../shared/contracts/manifest.schema';

/** Reserve a page's maximum audio channels, rather than one player for every book asset. */
export function audioPlaybackSlots(pages: readonly Pick<ManifestPage, 'settings' | 'scene'>[]) {
    const slots = new Set<string>();
    let channels = 0;
    for (const page of pages) {
        if (page.settings.backgroundAudioAssetId) slots.add('background');
        if (page.settings.narrationAssetId) slots.add('narration');
        const objects = page.scene.objects.filter((object) => object.type === 'audio');
        const objectAssets = new Set(objects.map((object) => object.assetId));
        const actions = new Set(
            page.scene.interactions.flatMap((rule) =>
                rule.actions.flatMap((action) =>
                    action.type === 'playAudio' && !objectAssets.has(action.assetId)
                        ? [action.assetId]
                        : [],
                ),
            ),
        );
        channels = Math.max(channels, objects.length + actions.size);
    }
    for (let i = 0; i < channels; i++) slots.add(`audio:${i}`);
    return slots;
}
