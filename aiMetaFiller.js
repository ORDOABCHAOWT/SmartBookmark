/**
 * aiMetaFiller — Stage 2 (Semantic Index Upgrade)
 *
 * 后台静默地为每个书签补充 aiMeta（LLM 生成的语义元数据）：
 *   {
 *     topics: ["图标库", "设计资源"],       // 中文主题
 *     synonyms: ["icon library", "svg icons"], // 英文同义词，跨语言匹配
 *     purpose: "用于查找和下载开源 SVG 图标"   // 用途描述
 *   }
 *
 * 这套数据被 search.js 用于字面匹配（topics 优先级仅次于 title），
 * 也被 api.js 的 makeEmbeddingText 注入到 embedding 输入文本里。
 *
 * 设计：
 * - 后台 worker，对所有书签（含 Chrome 原生）跑一次
 * - 速率限制：~1.5s/请求，避免 Qwen rate-limit
 * - 失败重试：每书签最多 3 次，超过即放弃（避免死循环）
 * - 版本控制：bumping AI_META_VERSION 会让所有书签重跑
 * - 中断恢复：写一个本地"队列指针"，下次启动从断点继续
 * - 触发 embedding 重算：写入 aiMeta 时清空 bookmark.embedding，
 *   下次 storageManager.scanAndUpdateEmbedding 会自动补
 */

const AI_META_FILLER_STATE_KEY = 'aiMetaFiller.state';
const AI_META_FILLER_FAIL_KEY = 'aiMetaFiller.failures';

class AiMetaFiller {
    constructor() {
        this.running = false;
        this.abortController = null;
        this.MIN_INTERVAL_MS = 1500; // ~0.7 QPS
        this.MAX_RETRY_PER_BOOKMARK = 3;
        this.BATCH_PERSIST_SIZE = 5; // 写盘批大小
        this.lastApiCall = 0;
    }

    /**
     * Public entry: scan all bookmarks and fill missing aiMeta.
     * Safe to call repeatedly — will no-op if already running.
     */
    async start({ silent = true } = {}) {
        if (this.running) {
            if (!silent) logger.info('[aiMetaFiller] already running, skip');
            return { ok: false, reason: 'already-running' };
        }
        this.running = true;
        this.abortController = new AbortController();

        try {
            const privacySettings = await this._getPrivacySettings();
            if (privacySettings.aiMetadataIndexing !== true) {
                logger.info('[aiMetaFiller] explicit user opt-in is not enabled, skip');
                return { ok: false, reason: 'not-enabled' };
            }

            // Pre-flight: need a chat service with a key
            const chatSvc = await ConfigManager.getChatService();
            if (!chatSvc?.apiKey || !chatSvc?.chatModel) {
                logger.warn('[aiMetaFiller] no chat API key configured, abort');
                return { ok: false, reason: 'no-api-key' };
            }

            // Gather all bookmarks (extension + Chrome native, merged)
            const allMap = await getAllBookmarks(/*includeChromeBookmarks*/ true, /*withEmbedding*/ false);
            const candidates = [];
            for (const bookmark of Object.values(allMap)) {
                if (this._needsFill(bookmark) &&
                    !await this._isPrivacyProtected(bookmark, privacySettings)) {
                    candidates.push(bookmark);
                }
            }

            if (candidates.length === 0) {
                logger.info('[aiMetaFiller] nothing to fill, all caught up');
                return { ok: true, filled: 0, total: 0 };
            }

            logger.info(`[aiMetaFiller] starting fill: ${candidates.length} bookmarks`);
            const failures = await this._loadFailures();
            let filled = 0;
            let failed = 0;
            const buffer = [];

            for (const bookmark of candidates) {
                if (this.abortController.signal.aborted) {
                    logger.info('[aiMetaFiller] aborted by caller');
                    break;
                }

                const currentPrivacySettings = await this._getPrivacySettings();
                if (currentPrivacySettings.aiMetadataIndexing !== true) {
                    logger.info('[aiMetaFiller] user disabled indexing, stop');
                    break;
                }
                if (await this._isPrivacyProtected(bookmark, currentPrivacySettings)) {
                    continue;
                }

                const failCount = failures[bookmark.url] || 0;
                if (failCount >= this.MAX_RETRY_PER_BOOKMARK) {
                    continue; // give up on this one
                }

                // rate limit
                await this._throttle();

                const aiMeta = await this._generateAiMeta(bookmark);
                if (!aiMeta) {
                    failures[bookmark.url] = failCount + 1;
                    failed++;
                    continue;
                }

                // Chrome native bookmarks need to be promoted to extension storage
                // before they can carry aiMeta (LocalStorageMgr only persists extension bookmarks).
                const upgraded = this._toExtensionBookmark(bookmark, aiMeta);
                buffer.push(upgraded);
                filled++;
                delete failures[bookmark.url]; // success clears retry count

                if (buffer.length >= this.BATCH_PERSIST_SIZE) {
                    await this._persist(buffer.splice(0));
                    await this._saveFailures(failures);
                }
            }

            if (buffer.length > 0) {
                await this._persist(buffer);
            }
            await this._saveFailures(failures);

            logger.info(`[aiMetaFiller] done: ${filled} filled, ${failed} failed`);
            return { ok: true, filled, failed, total: candidates.length };
        } catch (err) {
            logger.error('[aiMetaFiller] fatal error:', err);
            return { ok: false, reason: 'error', error: err.message };
        } finally {
            this.running = false;
            this.abortController = null;
        }
    }

    stop() {
        if (this.abortController) {
            this.abortController.abort();
        }
        this.running = false;
    }

    async _getPrivacySettings() {
        const settings = await SettingsManager.get('privacy');
        return settings && typeof settings === 'object' ? settings : {};
    }

    _matchesCustomPrivateDomain(url, patterns) {
        let hostname;
        try {
            hostname = new URL(url).hostname.toLowerCase();
        } catch {
            return true;
        }

        return (Array.isArray(patterns) ? patterns : []).some(rawPattern => {
            const pattern = String(rawPattern || '').trim();
            if (!pattern) {
                return false;
            }
            if (pattern.startsWith('/') && pattern.endsWith('/')) {
                try {
                    return new RegExp(pattern.slice(1, -1), 'i').test(hostname);
                } catch {
                    return false;
                }
            }

            const normalizedPattern = pattern.toLowerCase();
            if (normalizedPattern.startsWith('*.')) {
                const domain = normalizedPattern.slice(2);
                return hostname === domain || hostname.endsWith(`.${domain}`);
            }
            return hostname === normalizedPattern;
        });
    }

    async _isPrivacyProtected(bookmark, privacySettings) {
        if (!bookmark?.url) {
            return true;
        }
        if (privacySettings.enabled === true) {
            return true;
        }
        if (this._matchesCustomPrivateDomain(bookmark.url, privacySettings.customDomains)) {
            return true;
        }
        if (privacySettings.autoDetect === true && typeof containsPrivateContent === 'function') {
            try {
                return await containsPrivateContent(bookmark.url);
            } catch (error) {
                logger.warn('[aiMetaFiller] privacy check failed, skip bookmark:', error);
                return true;
            }
        }
        return false;
    }

    /** A bookmark needs aiMeta if it's missing entirely or version is stale. */
    _needsFill(bookmark) {
        if (!bookmark || !bookmark.url) return false;
        // Skip non-markable URLs (chrome://, etc.)
        if (typeof isNonMarkableUrl === 'function' && isNonMarkableUrl(bookmark.url)) return false;
        const aiMeta = bookmark.aiMeta;
        if (!aiMeta) return true;
        if ((aiMeta.version || 0) < (typeof AI_META_VERSION !== 'undefined' ? AI_META_VERSION : 1)) return true;
        return false;
    }

    async _throttle() {
        const now = Date.now();
        const elapsed = now - this.lastApiCall;
        if (elapsed < this.MIN_INTERVAL_MS) {
            await new Promise(r => setTimeout(r, this.MIN_INTERVAL_MS - elapsed));
        }
        this.lastApiCall = Date.now();
    }

    /**
     * Call LLM and parse a strict JSON response.
     * Returns null on failure (caller will increment retry counter).
     */
    async _generateAiMeta(bookmark) {
        const systemPrompt = `你是一个为书签生成语义索引的助手。根据书签的标题和 URL，输出一段严格的 JSON：
{
  "topics": ["..."],    // 2-4 个中文主题词（如"图标库"、"前端文档"、"设计灵感"），具体、准确
  "synonyms": ["..."],  // 2-4 个英文同义关键词（如"icon library"、"svg icons"），便于跨语言搜索
  "purpose": "..."      // 一句中文，描述该网站的核心用途（≤30字）
}

要求：
- 输出必须是合法 JSON，不要 markdown 代码块、不要解释
- topics 是用户搜索时可能输入的中文词
- synonyms 是英文场景下的同义检索词
- 如果是综合性平台，topics 取最主要的 2 个功能领域`;

        const userPrompt = `标题: ${bookmark.title || '(无标题)'}
URL: ${bookmark.url}
${(bookmark.tags && bookmark.tags.length > 0) ? `已有标签: ${bookmark.tags.join(', ')}` : ''}
${bookmark.excerpt ? `摘要: ${String(bookmark.excerpt).slice(0, 200)}` : ''}`;

        let raw;
        try {
            raw = await getChatCompletion(systemPrompt, userPrompt, this.abortController?.signal);
        } catch (err) {
            logger.warn(`[aiMetaFiller] LLM call failed for ${bookmark.url}:`, err?.message || err);
            return null;
        }
        if (!raw) return null;

        const parsed = this._parseStrictJson(raw);
        if (!parsed) {
            logger.debug(`[aiMetaFiller] could not parse LLM output for ${bookmark.url}:`, raw);
            return null;
        }

        return this._sanitizeAiMeta(parsed);
    }

    /** Extract first {...} block, parse, defensively. */
    _parseStrictJson(text) {
        const trimmed = String(text || '').trim();
        // strip possible code-fence wrapping
        const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
        const candidate = fenced ? fenced[1].trim() : trimmed;
        const start = candidate.indexOf('{');
        const end = candidate.lastIndexOf('}');
        if (start < 0 || end <= start) return null;
        const slice = candidate.slice(start, end + 1);
        try {
            return JSON.parse(slice);
        } catch {
            return null;
        }
    }

    /** Sanitize LLM output into the canonical aiMeta shape. */
    _sanitizeAiMeta(raw) {
        const arr = (v) => Array.isArray(v)
            ? v.map(x => String(x || '').trim())
                .filter(x => x.length > 0 && x.length <= 40)
                .slice(0, 6)
            : [];
        const topics = arr(raw.topics);
        const synonyms = arr(raw.synonyms);
        const purpose = String(raw.purpose || '').trim().slice(0, 80);

        if (topics.length === 0 && synonyms.length === 0 && !purpose) return null;

        return {
            topics,
            synonyms,
            purpose,
            version: typeof AI_META_VERSION !== 'undefined' ? AI_META_VERSION : 1,
            generatedAt: Date.now()
        };
    }

    /**
     * If the bookmark was a Chrome native bookmark, build an extension-format
     * bookmark object so it can be persisted via LocalStorageMgr.
     */
    _toExtensionBookmark(bookmark, aiMeta) {
        const isChrome = bookmark.source === BookmarkSource.CHROME;
        const base = {
            url: bookmark.url,
            title: bookmark.title || '',
            tags: Array.isArray(bookmark.tags) ? [...bookmark.tags] : [],
            excerpt: bookmark.excerpt || '',
            savedAt: bookmark.savedAt || Date.now(),
            useCount: bookmark.useCount || 0,
            lastUsed: bookmark.lastUsed || null,
            // intentionally do NOT carry embedding here — we want it recomputed
            // now that aiMeta will change the embedding input text
            embedding: null,
            apiService: null,
            embedModel: null,
            aiMeta
        };
        // If it was already in extension storage, preserve original timestamps that we don't override
        if (!isChrome) {
            // For extension bookmarks, keep existing embedding ONLY if aiMeta didn't change anything
            // material to the embedding input — but to keep semantics simple, we always retrigger.
            base.embedding = null;
            base.apiService = null;
            base.embedModel = null;
        }
        return base;
    }

    async _persist(bookmarks) {
        try {
            // updateBookmarksAndEmbedding triggers scanAndUpdateEmbedding downstream
            await LocalStorageMgr.updateBookmarksAndEmbedding(bookmarks, {
                notifyChange: true,
                noSync: false
            });
            logger.debug(`[aiMetaFiller] persisted ${bookmarks.length} bookmarks with aiMeta`);
        } catch (err) {
            logger.error('[aiMetaFiller] persist failed:', err);
        }
    }

    async _loadFailures() {
        try {
            const data = await LocalStorageMgr.get(AI_META_FILLER_FAIL_KEY);
            return (data && typeof data === 'object') ? data : {};
        } catch {
            return {};
        }
    }

    async _saveFailures(failures) {
        try {
            await LocalStorageMgr.set(AI_META_FILLER_FAIL_KEY, failures);
        } catch (err) {
            logger.debug('[aiMetaFiller] saveFailures error:', err);
        }
    }
}

// Global singleton
const aiMetaFiller = new AiMetaFiller();

// Convenience helper for popup / background to call
async function startAiMetaFillerIfReady({ delayMs = 5000 } = {}) {
    setTimeout(async () => {
        try {
            await aiMetaFiller.start({ silent: true });
        } catch (err) {
            logger?.error?.('[aiMetaFiller] auto-start failed:', err);
        }
    }, delayMs);
}
