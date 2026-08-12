class SearchManager {
    constructor() {
        this.searchTimer = null;
        this.DEBOUNCE_DELAY = 500; // 搜索防抖延迟(毫秒)
        this.searchHistoryManager = new SearchHistoryManager();
    }

    // 搜索书签
    async search(query, options = {}) {
        const {
            debounce = true,
            maxResults = null, // 改为null，从设置中获取
            includeUrl = false,
            includeChromeBookmarks = true, // 默认包含 Chrome 原生书签 (Stage 0.1)
            recordSearch = true
        } = options;

        // 从设置中获取最大结果数
        const settings = await SettingsManager.getAll();
        const actualMaxResults = maxResults || settings?.search?.maxResults || 50;

        logger.debug('搜索参数:', {
            ...options,
            maxResults: actualMaxResults
        });

        // 如果已有定时器，清除之前的定时器
        if (this.searchTimer) {
            clearTimeout(this.searchTimer);
        }

        // 返回一个 Promise
        return new Promise((resolve, reject) => {
            const executeSearch = async () => {
                logger.debug("开始搜索", {
                    query: query
                })
                try {
                    if (!query.trim()) {
                        resolve([]);
                        return;
                    }

                    const localResults = await this.searchBookmarks(null, query, actualMaxResults, includeUrl, includeChromeBookmarks, {
                        semantic: false
                    });

                    if (localResults.length > 0) {
                        logger.debug('本地关键词搜索命中，跳过向量搜索:', {
                            query,
                            results: localResults
                        });

                        if (recordSearch) {
                            await this.searchHistoryManager.addSearch(query);
                        }

                        resolve(localResults);
                        return;
                    }

                    if (!includeChromeBookmarks) {
                        const chromeLocalResults = await this.searchBookmarks(null, query, actualMaxResults, includeUrl, true, {
                            semantic: false
                        });

                        if (chromeLocalResults.length > 0) {
                            logger.debug('Chrome 书签关键词搜索命中:', {
                                query,
                                results: chromeLocalResults
                            });

                            if (recordSearch) {
                                await this.searchHistoryManager.addSearch(query);
                            }

                            resolve(chromeLocalResults);
                            return;
                        }
                    }

                    // 获取查询向量
                    let queryEmbedding = await this.searchHistoryManager.getVector(query);
                    logger.debug('获取缓存向量:', {
                        query,
                        queryEmbedding
                    });
                    
                    if (!queryEmbedding) {
                        queryEmbedding = await getEmbedding(query);
                        if (queryEmbedding) {
                            const activeService = await ConfigManager.getEmbeddingService();
                            await this.searchHistoryManager.cacheVector(query, queryEmbedding, activeService);
                        }
                    }

                    // 搜索书签
                    const results = await this.searchBookmarks(queryEmbedding, query, actualMaxResults, includeUrl, includeChromeBookmarks);

                    logger.debug('搜索结果:', {
                        query,
                        results
                    });
                    
                    // 添加到搜索历史
                    if (recordSearch) {
                        await this.searchHistoryManager.addSearch(query);
                    }
                    
                    resolve(results);
                } catch (error) {
                    logger.error('搜索失败:', error);
                    reject(error);
                }
            };

            // 如果启用防抖，设置定时器
            if (debounce) {
                this.searchTimer = setTimeout(executeSearch, this.DEBOUNCE_DELAY);
            } else {
                executeSearch();
            }
        });
    }

    // 搜索书签
    async searchBookmarks(queryEmbedding, searchInput, maxResults = 50, includeUrl = false, includeChromeBookmarks = false, searchOptions = {}) {
        const allBookmarks = await getBookmarksForSearch(includeChromeBookmarks);
        
        // 获取API服务配置
        const apiService = await ConfigManager.getEmbeddingService() || {};
        const semanticEnabled = searchOptions.semantic !== false && !!queryEmbedding;
        const SIMILARITY_THRESHOLDS = {
            MAX: apiService.similarityThreshold?.MAX || 0.85,
            HIGH: apiService.similarityThreshold?.HIGH || 0.65, // 高相关性，分数 >= 80
            MEDIUM: apiService.similarityThreshold?.MEDIUM || 0.5, // 有点相关，可以显示， 分数 >= 60
            LOW: apiService.similarityThreshold?.LOW || 0.4 // 基本无关，如果有关键词可能显示
        };
        // 自定义api参数
        let highSimilarity = apiService.highSimilarity || SIMILARITY_THRESHOLDS.MEDIUM;
        highSimilarity = Math.min(1, Math.max(0, highSimilarity));
        const hideLowSimilarity = apiService.hideLowSimilarity === true;

        logger.debug('相似度阈值:', {
            similarityThreshold: SIMILARITY_THRESHOLDS,
            highSimilarity,
            hideLowSimilarity
        });

        const normalizeSearchText = (value) => (value || '').toString().trim().toLowerCase();
        const searchInputLower = normalizeSearchText(searchInput);
        const searchVariants = typeof getSearchQueryVariants === 'function'
            ? getSearchQueryVariants(searchInput)
            : [searchInputLower].filter(Boolean);
        const getDerivedKeywords = (item) => {
            try {
                return typeof getBookmarkDerivedKeywords === 'function'
                    ? getBookmarkDerivedKeywords(item)
                    : [];
            } catch (error) {
                logger.warn('派生搜索关键词失败:', error);
                return [];
            }
        };

        // Stage 0.2: Pinyin fallback — let "tubiao" match "图标".
        // Only enable when query is pure ASCII alphanumeric (avoid false hits
        // when user types Chinese, which already has direct substring matches).
        const isAsciiQuery = /^[a-z0-9\s]+$/i.test(searchInputLower);
        // PinyinMatch is a UMD bundle. Depending on the environment it may be
        // attached to globalThis as PinyinMatch, OR exported via module.exports
        // (which in a service-worker context can land on `module`). Resolve both.
        let _pmLib = null;
        if (typeof PinyinMatch !== 'undefined') {
            _pmLib = PinyinMatch;
        } else if (typeof globalThis !== 'undefined' && globalThis.PinyinMatch) {
            _pmLib = globalThis.PinyinMatch;
        } else if (typeof self !== 'undefined' && self.PinyinMatch) {
            _pmLib = self.PinyinMatch;
        }
        const pinyinAvailable = !!(_pmLib && typeof _pmLib.match === 'function');
        const pinyinMatch = (value) => {
            if (!pinyinAvailable || !isAsciiQuery || !value) return false;
            try {
                return _pmLib.match(String(value), searchInputLower) !== false;
            } catch { return false; }
        };

        const getTextMatchScore = (value) => {
            const normalizedValue = normalizeSearchText(value);
            if (!normalizedValue || searchVariants.length === 0) {
                return 0;
            }
            const literalScore = Math.max(...searchVariants.map(variant => {
                if (normalizedValue === variant) {
                    return 100;
                }
                if (normalizedValue.startsWith(variant)) {
                    return 96;
                }
                if (normalizedValue.includes(variant)) {
                    return 92;
                }
                return 0;
            }));
            if (literalScore > 0) return literalScore;
            // pinyin fallback — slightly lower than literal "includes" to keep ranking sensible
            if (pinyinMatch(value)) return 85;
            return 0;
        };

        // 计算单个书签的分数
        const calculateBookmarkScore = (item) => {
            // 计算向量相似度
            // (Embedding 现在对所有有 embedding 字段的书签生效，不再仅限 EXTENSION 源 —
            //  Chrome 原生书签经过 aiMetaFiller 提升后也会有 embedding)
            let similarity = 0;
            if (semanticEnabled && item.embedding) {
                similarity = this.cosineSimilarity(queryEmbedding, item.embedding);
            }
            similarity = Math.min(1, Math.max(0, similarity));

            // aiMeta 字段（Stage 2 LLM 自动生成）
            const aiMeta = item.aiMeta || {};
            const aiTopics = Array.isArray(aiMeta.topics) ? aiMeta.topics : [];
            const aiSynonyms = Array.isArray(aiMeta.synonyms) ? aiMeta.synonyms : [];
            const aiPurpose = typeof aiMeta.purpose === 'string' ? aiMeta.purpose : '';

            // 检查关键词匹配
            const keywordMatch = {
                title: getTextMatchScore(item.title) > 0,
                tags: item.tags?.some(tag => getTextMatchScore(tag) > 0) || false,
                excerpt: getTextMatchScore(item.excerpt) > 0,
                url: includeUrl ? getTextMatchScore(item.url) > 0 : false,
                derived: false,
                aiTopics: aiTopics.some(t => getTextMatchScore(t) > 0),
                aiSynonyms: aiSynonyms.some(s => getTextMatchScore(s) > 0),
                aiPurpose: getTextMatchScore(aiPurpose) > 0
            };
            const derivedKeywords = getDerivedKeywords(item);
            keywordMatch.derived = derivedKeywords.some(keyword => getTextMatchScore(keyword) > 0);
            const keywordPriority = Math.max(
                getTextMatchScore(item.title),
                ...aiTopics.map(t => Math.max(0, getTextMatchScore(t) - 2)),    // aiTopics 仅次于 title
                ...(item.tags || []).map(tag => Math.max(0, getTextMatchScore(tag) - 4)),
                ...aiSynonyms.map(s => Math.max(0, getTextMatchScore(s) - 4)),
                ...derivedKeywords.map(keyword => Math.max(0, getTextMatchScore(keyword) - 5)),
                includeUrl ? Math.max(0, getTextMatchScore(item.url) - 8) : 0,
                Math.max(0, getTextMatchScore(aiPurpose) - 10),
                Math.max(0, getTextMatchScore(item.excerpt) - 12)
            );
            
            const hasKeywordMatch = Object.values(keywordMatch).some(match => match);
            
            // 计算基础分数
            let score = 0;
            if (apiService.isCustom) {
                const SIMILARITY_THRESHOLDS_MAX = highSimilarity >= 0.7 ? 1.0 : 0.7;
                if (similarity >= highSimilarity) {
                    const param = Math.sqrt((similarity - highSimilarity) / (SIMILARITY_THRESHOLDS_MAX - highSimilarity))
                    score = hasKeywordMatch 
                         ? 70 + 30 * param 
                         : 60 + 40 * param;
                }else {
                    const param = Math.sqrt(similarity / highSimilarity)
                    score = hasKeywordMatch
                        ? 30 + 30 * param
                        : 0 + 60 * param;
                }
            } else {
                if (similarity >= SIMILARITY_THRESHOLDS.HIGH) {
                    const param = Math.sqrt((similarity - SIMILARITY_THRESHOLDS.HIGH) / (SIMILARITY_THRESHOLDS.MAX - SIMILARITY_THRESHOLDS.HIGH))
                    score = hasKeywordMatch 
                        ? 90 + 10 * param
                        : 80 + 20 * param;
                } else if (similarity >= SIMILARITY_THRESHOLDS.MEDIUM) {
                    const param = Math.sqrt((similarity - SIMILARITY_THRESHOLDS.MEDIUM) / (SIMILARITY_THRESHOLDS.HIGH - SIMILARITY_THRESHOLDS.MEDIUM))
                    score = hasKeywordMatch
                        ? 70 + 20 * param
                        : 60 + 20 * param;
                } else if (similarity >= SIMILARITY_THRESHOLDS.LOW) {
                    const param = Math.sqrt((similarity - SIMILARITY_THRESHOLDS.LOW) / (SIMILARITY_THRESHOLDS.MEDIUM - SIMILARITY_THRESHOLDS.LOW))
                    score = hasKeywordMatch
                        ? 30 + 30 * param
                        : 20 + 40 * param;
                }
            }
            
            // 根据匹配位置调整分数
            if (hasKeywordMatch) {
                // 关键词匹配的书签应保证较高的最低分数，避免被仅靠向量相似度的无关结果排在前面
                const keywordBonus = (keywordMatch.title ? 8 : 0) +
                        (keywordMatch.aiTopics ? 7 : 0) +
                        (keywordMatch.tags ? 5 : 0) +
                        (keywordMatch.derived ? 5 : 0) +
                        (keywordMatch.aiSynonyms ? 4 : 0) +
                        (keywordMatch.url ? 4 : 0) +
                        (keywordMatch.aiPurpose ? 3 : 0) +
                        (keywordMatch.excerpt ? 3 : 0);
                score = Math.max(score, 75, keywordPriority) + keywordBonus;
            }
            
            score = Math.min(100, Math.max(0, score));
            
            return {
                ...item,
                score,
                similarity,
                keywordPriority,
                keywordMatch
            };
        };

        // 处理所有书签
        const results = Object.values(allBookmarks)
            .map(item => calculateBookmarkScore(item))
         
        if (DEBUG) {
            // 打印详细的匹配信息用于调试
            results.sort((a, b) => b.score - a.score || b.similarity - a.similarity);
            logger.debug('搜索结果详情:', results.map(r => ({
                title: r.title,
                score: Math.round(r.score),
                similarity: r.similarity.toFixed(3),
                keywordMatch: r.keywordMatch
            })));
        }
    
        const filteredResults = results.filter(item => {
            if (Object.values(item.keywordMatch).some(match => match)) {
                return true;
            }
            if (!semanticEnabled) {
                return false;
            }
            if (apiService.isCustom) {
                if (hideLowSimilarity && item.similarity < highSimilarity) {
                    return false;
                }
                return true;
            }
            return item.score >= 60;
        });
        // 文字命中优先，其次综合分和向量相似度。
        filteredResults.sort((a, b) =>
            b.keywordPriority - a.keywordPriority ||
            b.score - a.score ||
            b.similarity - a.similarity
        );
        
        return filteredResults.slice(0, maxResults);
    }

    // 计算余弦相似度
    cosineSimilarity(vec1, vec2) {
        if (!vec1 || !vec2 || vec1.length === 0 || vec2.length === 0) {
            return 0;
        }

        const dotProduct = vec1.reduce((sum, val, i) => sum + val * vec2[i], 0);
        const magnitudeA = Math.sqrt(vec1.reduce((sum, val) => sum + val * val, 0));
        const magnitudeB = Math.sqrt(vec2.reduce((sum, val) => sum + val * val, 0));
        
        return magnitudeA && magnitudeB ? dotProduct / (magnitudeA * magnitudeB) : 0;
    }
}

// 搜索历史管理器
class SearchHistoryManager {
    constructor() {
        this.MAX_HISTORY = 50;
        this.MAX_HISTORY_SHOW = 8;
        this.MAX_HISTORY_SHOW_QUICK = 4;
        this.MAX_CACHE_HISTORY = 125;
        this.STORAGE_KEY = 'recentSearches';
        this.VECTOR_CACHE_KEY = 'searchVectorCache';
        this.historyCache = null;
    }

    async getHistory(fromCache = true) {
        if (fromCache && this.historyCache) {
            logger.debug('搜索历史缓存命中');
            return this.historyCache;
        }
        logger.debug('搜索历史缓存未命中', { fromCache });
        const history = await LocalStorageMgr.get(this.STORAGE_KEY) || [];
        this.historyCache = history;
        return history;
    }

    async addSearch(query) {
        if (!query) return;

        let history = await this.getHistory(false);
        // 移除重复项
        history = history.filter(item => item.query !== query);
        // 添加到开头
        history.unshift({
            query,
            timestamp: Date.now()
        });
        // 保持最大数量
        history = history.slice(0, this.MAX_HISTORY);
        await LocalStorageMgr.set(this.STORAGE_KEY, history);
        this.historyCache = null;
    }

    async removeSearch(query) {
        if (!query) return;
        
        let history = await this.getHistory(false);
        // 移除指定的搜索项
        history = history.filter(item => item.query !== query);
        await LocalStorageMgr.set(this.STORAGE_KEY, history);
        this.historyCache = null;
    }

    async clearHistory() {
        // 清除搜索历史
        await LocalStorageMgr.remove(this.STORAGE_KEY);
        this.historyCache = null;
    }

    async getVectorCache() {
        return await LocalStorageMgr.get(this.VECTOR_CACHE_KEY) || {};
    }

    async cacheVector(query, vector, service) {
        const cache = await this.getVectorCache();
        cache[query] = {
            vector,
            serviceId: service.id,
            embedModel: service.embedModel,
            timestamp: Date.now()
        };
        
        // 如果缓存项超过上限，删除最旧的
        const entries = Object.entries(cache);
        if (entries.length > this.MAX_CACHE_HISTORY) {
            // 按时间戳排序
            entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
            // 只保留最新的10个
            const newCache = Object.fromEntries(entries.slice(0, this.MAX_CACHE_HISTORY));
            await LocalStorageMgr.set(this.VECTOR_CACHE_KEY, newCache);
        } else {
            await LocalStorageMgr.set(this.VECTOR_CACHE_KEY, cache);
        }
    }

    async getVector(query) {
        const cache = await this.getVectorCache();
        const activeService = await ConfigManager.getEmbeddingService();
        if (cache[query] && cache[query].serviceId === activeService.id && cache[query].embedModel === activeService.embedModel) {
            return cache[query].vector;
        }
        return null;
    }

    async clearVectorCache() {
        await LocalStorageMgr.remove(this.VECTOR_CACHE_KEY);
    }
}

// 导出搜索管理器实例
const searchManager = new SearchManager();
