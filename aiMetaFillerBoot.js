/**
 * aiMetaFillerBoot.js
 *
 * When popup opens, ask background to (idempotently) kick off aiMetaFiller.
 * Background-side filler has its own running-guard, so re-issuing this
 * message on every popup open is safe.
 *
 * Delay 5s so popup's own init (bookmark fetch, render) finishes first
 * and we don't compete for the API quota during the user's first interaction.
 */
(function () {
    function boot() {
        setTimeout(() => {
            try {
                chrome.runtime.sendMessage(
                    { type: MessageType.START_AI_META_FILLER },
                    (resp) => {
                        // service worker may not respond if it was sleeping; that's fine
                        if (chrome.runtime.lastError) {
                            // Swallow — alarm heartbeat will pick it up
                            return;
                        }
                        if (resp?.success && resp.result?.ok && resp.result.filled > 0) {
                            console.log('[aiMetaFiller] background filled', resp.result.filled, 'bookmarks');
                        }
                    }
                );
            } catch (err) {
                // Non-fatal; alarm heartbeat will trigger it on schedule
                console.debug('[aiMetaFiller] boot send failed:', err);
            }
        }, 5000);
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
