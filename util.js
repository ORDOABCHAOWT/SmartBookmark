// 业务相关的辅助函数

async function validateToken() {
    const token = await LocalStorageMgr.get('token');
    logger.debug('检查登录token是否过期', { token: token });
    if (!token) {
        return { valid: false, user: null };
    }

    try {
        // 解析 JWT token
        const tokenData = JSON.parse(atob(token.split('.')[1]));
        // 检查 token 是否过期
        if (tokenData.exp && tokenData.exp < Date.now() / 1000) {
            // token 已过期，清除登录状态
            await LocalStorageMgr.remove(['token']);
            return { valid: false, user: null };
        }

        return { valid: true, user: tokenData };
    } catch (error) {
        logger.error('Token 解析失败:', error);
        return { valid: false, user: null };
    }
}

async function updateSettingsWithSync(updates) {
    await SettingsManager.update(updates);
    sendMessageSafely({
        type: MessageType.SCHEDULE_SYNC,
        data: {
            reason: ScheduleSyncReason.SETTINGS
        }
    });
    sendMessageSafely({
        type: MessageType.SETTINGS_CHANGED
    });
}

// 检查页面是否已收藏
async function checkIfPageSaved(url) {
    const result = await LocalStorageMgr.getBookmark(url, true);
    return !!result;
}

async function openOptionsPage(section = 'overview') {
    // 查找所有标签页
    const tabs = await chrome.tabs.query({
        url: chrome.runtime.getURL('settings.html*')  // 使用通配符匹配任何hash
    });

    if (tabs.length > 0) {
        sendMessageSafely({
            type: MessageType.SWITCH_TO_TAB,
            tab: section
        });
        await chrome.runtime.openOptionsPage();
    } else {
        // 如果没有找到settings页面，创建新页面
        const url = chrome.runtime.getURL('settings.html#' + section);
        await chrome.tabs.create({
            url: url
        });
    }
}

// 修改更新书签使用频率的函数
async function updateBookmarkUsage(url) {
    try {
        const data = await LocalStorageMgr.getBookmark(url, true);
        if (data) {
            logger.debug('更新书签使用频率', { url: url, data: data });
            const bookmark = data;

            // 更新使用次数和最后使用时间
            bookmark.useCount = calculateWeightedScore(
                bookmark.useCount,
                bookmark.lastUsed
            ) + 1;
            bookmark.lastUsed = Date.now();

            await LocalStorageMgr.setBookmark(url, bookmark, { noUpdateEmbedding: true });
            logger.debug('更新书签使用频率完成', { url: url, bookmark: bookmark });
        }
    } catch (error) {
        logger.error('更新书签使用频率失败:', error);
    }
}

// 批量更新书签使用频率
async function batchUpdateBookmarksUsage(urls) {
    try {
        const bookmarks = await LocalStorageMgr.batchGetBookmarks(urls, true);
        logger.debug('批量更新书签使用频率', { bookmarks: bookmarks, urls: urls });
        for (const bookmark of bookmarks) {
            // 更新使用次数和最后使用时间
            bookmark.useCount = calculateWeightedScore(
                bookmark.useCount,
                bookmark.lastUsed
            ) + 1;
            bookmark.lastUsed = Date.now();
        }
        await LocalStorageMgr.setBookmarks(bookmarks, { noUpdateEmbedding: true });
        logger.debug('批量更新书签使用频率完成', { bookmarks: bookmarks, urls: urls });
    } catch (error) {
        logger.error('批量更新书签使用频率失败:', error);
    }
}

// 添加计算加权使用分数的函数
function calculateWeightedScore(useCount, lastUsed) {
    if (!useCount || !lastUsed) return 0;

    const now = new Date();
    const lastUsedDate = new Date(lastUsed);
    const daysDiff = Math.floor((now - lastUsedDate) / (1000 * 60 * 60 * 24)); // 转换为天数并向下取整

    // 使用指数衰减函数
    // 半衰期设为30天，即30天前的使用次数权重减半
    const decayFactor = Math.exp(-Math.log(2) * daysDiff / 30);

    // 基础分数 = 使用次数 * 时间衰减因子
    const weightedScore = useCount * decayFactor;

    // 返回四舍五入后的整数
    return Math.round(weightedScore);
}

function getStoredBookmarkUrl(storageKey, bookmark) {
    if (bookmark?.url) {
        return bookmark.url;
    }

    const storagePrefix = LocalStorageMgr.Namespace?.BOOKMARK || 'bookmark.';
    if (typeof storageKey === 'string' && storageKey.startsWith(storagePrefix)) {
        return storageKey.slice(storagePrefix.length);
    }

    return typeof storageKey === 'string' ? storageKey : '';
}

function normalizeStoredBookmark(storageKey, bookmark) {
    if (!bookmark) {
        return bookmark;
    }

    const url = getStoredBookmarkUrl(storageKey, bookmark);
    return url ? { ...bookmark, url } : bookmark;
}

async function getAllBookmarks(includeChromeBookmarks = false, withEmbedding = false) {
    try {
        // 获取扩展书签
        let extensionBookmarks = {};
        if (!withEmbedding) {
            extensionBookmarks = await LocalStorageMgr.getBookmarksFromLocalCache();
        }
        if (Object.keys(extensionBookmarks).length === 0) {
            extensionBookmarks = await LocalStorageMgr.getBookmarks();
        }
        
        // 检查需要删除的不可标记扩展书签
        const bookmarksToDelete = [];
        const extensionBookmarksMap = {};
        
        // 遍历并检查扩展书签
        Object.entries(extensionBookmarks).forEach(([storageKey, data]) => {
            const normalizedData = normalizeStoredBookmark(storageKey, data);
            const bookmark = new UnifiedBookmark(normalizedData, BookmarkSource.EXTENSION);
            if (isNonMarkableUrl(bookmark.url)) {
                // 添加到待删除列表
                bookmarksToDelete.push(bookmark);
            } else {
                // 添加到有效书签映射
                extensionBookmarksMap[bookmark.url] = bookmark;
            }
        });
        
        // 如果有不可标记的扩展书签，批量删除它们
        if (bookmarksToDelete.length > 0) {
            logger.debug('删除不可标记的扩展书签', { count: bookmarksToDelete.length, urls: bookmarksToDelete.map(b => b.url) });
            // 批量删除书签
            await LocalStorageMgr.removeBookmarks(bookmarksToDelete.map(b => b.url));
        }

        let chromeBookmarksMap = {};
        // 获取Chrome书签
        if (includeChromeBookmarks) {
            const chromeBookmarks = await getChromeBookmarks();
            chromeBookmarksMap = chromeBookmarks
                .reduce((map, bookmark) => {
                    // 如果URL已经存在于扩展书签中,则跳过
                    if (extensionBookmarksMap[bookmark.url]) {
                        return map;
                    }
                    const unifiedBookmark = new UnifiedBookmark(bookmark, BookmarkSource.CHROME);
                    // 只添加可标记的Chrome书签
                    if (!isNonMarkableUrl(bookmark.url)) {
                        map[bookmark.url] = unifiedBookmark;
                    }
                    return map;
                }, {});
        }

        // 合并书签
        return { ...extensionBookmarksMap, ...chromeBookmarksMap };
    } catch (error) {
        logger.error('获取书签失败:', error);
        return {};
    }
}

async function getDisplayedBookmarks() {
    const showChromeBookmarks = await SettingsManager.get('display.showChromeBookmarks');
    return await getAllBookmarks(showChromeBookmarks, false);
}

async function getBookmarksForSearch(includeChromeBookmarks = false) {
    return await getAllBookmarks(includeChromeBookmarks, true);
}

// 获取Chrome书签的辅助函数
async function getChromeBookmarks() {
    try {
        const bookmarkTree = await chrome.bookmarks.getTree();
        return flattenBookmarkTree(bookmarkTree);
    } catch (error) {
        logger.error('获取Chrome书签失败:', error);
        return [];
    }
}

// 展平书签树的辅助函数
function flattenBookmarkTree(nodes, parentFolders = []) {
    const bookmarks = [];

    function traverse(node, folders, level = 0) {
        // 如果是文件夹，添加到路径中
        if (!node.url) {
            const currentFolders = [...folders];
            if (node.title && level > 1) { // 排除根文件夹
                currentFolders.push(node.title);
            }

            if (node.children) {
                node.children.forEach(child => traverse(child, currentFolders, level + 1));
            }
        } else {
            // 如果是书签，添加文件夹路径作为标签
            bookmarks.push({
                ...node,
                folderTags: folders.filter(folder => folder.trim() !== '')
            });
        }
    }

    nodes.forEach(node => traverse(node, parentFolders));
    return bookmarks;
}

// 检查URL是否不可标记
function isNonMarkableUrl(url) {
    try {
        // 1. 基本URL格式检查
        if (!url || typeof url !== 'string') {
            logger.debug('无效URL格式');
            return true;
        }

        // 2. 解析URL
        const urlObj = new URL(url);

        // 3. 定义不可标记的URL模式
        const nonMarkablePatterns = {
            // Chrome特殊页面
            chromeInternal: {
                pattern: /^chrome(?:-extension|-search|-devtools|-component)?:\/\//i,
                description: 'Chrome内部页面',
                example: 'chrome://, chrome-extension://'
            },

            // 浏览器设置和内部页面
            browserInternal: {
                pattern: /^(?:about|edge|browser|file|view-source):/i,
                description: '浏览器内部页面',
                example: 'about:blank, file:///'
            },

            // 扩展和应用页面
            extensionPages: {
                pattern: /^(?:chrome-extension|moz-extension|extension):\/\//i,
                description: '浏览器扩展页面',
                example: 'chrome-extension://'
            },

            // 本地开发服务器
            localDevelopment: {
                pattern: /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|::1)(?::[0-9]+)?(?:\/|$)/i,
                description: '本地开发服务器',
                example: 'http://localhost:3000/'
            },

            // Web Socket连接
            webSocket: {
                pattern: /^wss?:/i,
                description: 'WebSocket连接',
                example: 'ws://, wss://'
            },

            // 数据URL
            dataUrl: {
                pattern: /^data:/i,
                description: '数据URL',
                example: 'data:text/plain'
            },

            // 空白页和无效页面
            emptyPages: {
                pattern: /^(?:about:blank|about:newtab|about:home)$/i,
                description: '空白页面',
                example: 'about:blank'
            }
        };

        // 4. 检查是否匹配任何不可标记模式
        for (const [key, rule] of Object.entries(nonMarkablePatterns)) {
            if (rule.pattern.test(url)) {
                // 5. 检查是否有例外情况
                if (shouldAllowNonMarkableException(url, key)) {
                    logger.debug('URL虽然匹配不可标记规则，但属于例外情况');
                    continue;
                }

                return true;
            }
        }

        // 6. 检查URL长度限制
        const MAX_URL_LENGTH = 2048; // 常见浏览器的URL长度限制
        if (url.length > MAX_URL_LENGTH) {
            logger.debug('URL长度超出限制:', {
                url: url.substring(0, 100) + '...',
                length: url.length,
                maxLength: MAX_URL_LENGTH
            });
            return true;
        }

        // 7. 检查协议安全性
        if (!urlObj.protocol.match(/^https?:$/i)) {
            logger.debug('不支持的URL协议:', {
                url: url,
                protocol: urlObj.protocol
            });
            return true;
        }

        return false;

    } catch (error) {
        logger.error('URL检查失败:', error);
        return true; // 出错时默认为不可标记
    }
}

// 处理特殊例外情况
function shouldAllowNonMarkableException(url, ruleKey) {
    try {
        const urlObj = new URL(url);

        // 1. 允许特定的本地开发环境
        if (ruleKey === 'localDevelopment') {
            const allowedLocalPaths = [
                /^\/docs\//i,
                /^\/api\//i,
                /^\/swagger\//i
            ];
            if (allowedLocalPaths.some(pattern => pattern.test(urlObj.pathname))) {
                return true;
            }
        }

        // 2. 允许特定的Chrome扩展页面
        if (ruleKey === 'extensionPages') {
            const allowedExtensionPages = [
                /\/documentation\.html$/i,
                /\/help\.html$/i
            ];
            if (allowedExtensionPages.some(pattern => pattern.test(urlObj.pathname))) {
                return true;
            }
        }

        return false;
    } catch (error) {
        logger.error('处理URL例外情况时出错:', error);
        return false;
    }
}

// 处理标签格式的辅助函数
function cleanTags(tags) {
    return tags.map(tag => {
        // 移除序号、星号和多余空格
        return tag.replace(/^\d+\.\s*\*+|\*+/g, '').trim();
    });
}

function getBookmarkHostname(bookmark) {
    try {
        return new URL(bookmark?.url || '').hostname.replace(/^www\./i, '').toLowerCase();
    } catch (error) {
        return '';
    }
}

const SEARCH_INTENT_PROFILES = [
    {
        id: 'icon-assets',
        hostnames: [
            'mingcute.com',
            'iconify.design',
            'svgrepo.com',
            'lucide.dev',
            'heroicons.com',
            'fontawesome.com',
            'icons8.com',
            'flaticon.com',
            'thenounproject.com',
            'simpleicons.org',
            'phosphoricons.com',
            'remixicon.com',
            'tabler.io',
            'iconfont.cn',
            'feathericons.com',
            'material.io'
        ],
        hostPatterns: [
            /(^|[.-])(icon|icons|icones|svg)[a-z0-9-]*(\.|$)/i
        ],
        signals: [
            /\bicons?\b/i,
            /\bsvg\b/i,
            /\bfavicon\b/i,
            /\biconfont\b/i,
            /\bmingcute\b/i,
            /\blucide\b/i,
            /\bheroicons?\b/i,
            /\bfontawesome\b/i,
            /\biconify\b/i,
            /\btabler\b/i,
            /\bremixicon\b/i,
            /图标/,
            /矢量/
        ],
        querySignals: ['图标', 'icon', 'icons', 'svg', '矢量', '素材'],
        queryAliases: [
            'icon',
            'icons',
            'icon website',
            'icon library',
            'icon set',
            'svg',
            '图标',
            '图标库',
            '图标网站',
            '矢量图标'
        ],
        keywords: [
            'icon',
            'icons',
            'icon website',
            'icon library',
            'icon set',
            'svg',
            '图标',
            '图标库',
            '图标网站',
            '矢量图标',
            '设计',
            '设计资源',
            '素材'
        ],
        tags: ['图标', '设计资源', 'SVG']
    },
    {
        id: 'ai-tools',
        hostnames: [
            'openai.com',
            'chatgpt.com',
            'anthropic.com',
            'claude.ai',
            'huggingface.co',
            'gemini.google.com',
            'aistudio.google.com',
            'perplexity.ai',
            'replicate.com',
            'poe.com',
            'midjourney.com'
        ],
        hostPatterns: [
            /(^|[.-])(ai|llm|gpt|chatgpt|claude|gemini)([.-]|$)/i
        ],
        signals: [
            /\bai\b/i,
            /\bllm\b/i,
            /\bgpt\b/i,
            /\bchatgpt\b/i,
            /\bopenai\b/i,
            /\bclaude\b/i,
            /\bgemini\b/i,
            /\bhugging ?face\b/i,
            /人工智能/,
            /大模型/
        ],
        querySignals: ['ai', '人工智能', '大模型', '模型', 'llm'],
        queryAliases: [
            'ai',
            'ai tool',
            'artificial intelligence',
            'llm',
            'chatgpt',
            'openai',
            'claude',
            'gemini',
            '人工智能',
            '大模型',
            'AI工具'
        ],
        keywords: [
            'ai',
            'ai tool',
            'artificial intelligence',
            'llm',
            '人工智能',
            '大模型',
            'AI工具'
        ],
        tags: ['AI工具', '人工智能']
    },
    {
        id: 'design-resources',
        hostnames: [
            'figma.com',
            'dribbble.com',
            'behance.net',
            'canva.com',
            'framer.com',
            'webflow.com',
            'uiverse.io',
            'mobbin.com'
        ],
        hostPatterns: [
            /(^|[.-])(design|ui|ux|figma|prototype)[a-z0-9-]*(\.|$)/i
        ],
        signals: [
            /\bdesign\b/i,
            /\bui\b/i,
            /\bux\b/i,
            /\bfigma\b/i,
            /\bprototype\b/i,
            /设计/,
            /原型/,
            /界面/
        ],
        querySignals: ['设计', 'design', 'ui', 'ux', '原型', '界面'],
        queryAliases: [
            'design',
            'design resource',
            'ui',
            'ux',
            'figma',
            'prototype',
            '设计',
            '设计资源',
            '产品设计',
            '视觉设计',
            '界面设计'
        ],
        keywords: [
            'design',
            'design resource',
            'ui',
            'ux',
            'prototype',
            '设计',
            '设计资源',
            '产品设计',
            '视觉设计',
            '界面设计'
        ],
        tags: ['设计资源', '产品设计', 'UI']
    },
    {
        id: 'developer-resources',
        hostnames: [
            'github.com',
            'gitlab.com',
            'stackoverflow.com',
            'npmjs.com',
            'nodejs.org',
            'react.dev',
            'nextjs.org',
            'vercel.com',
            'developer.mozilla.org'
        ],
        hostPatterns: [
            /(^|[.-])(dev|developer|code|github|npm|react|nextjs)[a-z0-9-]*(\.|$)/i
        ],
        signals: [
            /\bcode\b/i,
            /\bdev(eloper)?\b/i,
            /\bprogramming\b/i,
            /\bjavascript\b/i,
            /\btypescript\b/i,
            /\bpython\b/i,
            /\bgithub\b/i,
            /代码/,
            /开发/,
            /编程/
        ],
        // 只有宽泛的开发意图才扩展同义词。GitHub、JavaScript、Python
        // 这类具体品牌/技术词应保持精确，否则大量开发类书签会互相串搜。
        querySignals: ['代码', '开发', '编程', '前端', 'dev', 'developer', 'programming'],
        queryAliases: [
            'code',
            'dev',
            'developer',
            'programming',
            'github',
            'javascript',
            'typescript',
            'python',
            '代码',
            '开发',
            '编程',
            '前端开发'
        ],
        keywords: [
            'code',
            'dev',
            'developer',
            'programming',
            '代码',
            '开发',
            '编程',
            '前端开发'
        ],
        tags: ['开发', '编程']
    },
    {
        id: 'documentation',
        hostnames: [
            'developer.mozilla.org',
            'docs.github.com',
            'docs.python.org',
            'react.dev',
            'nextjs.org',
            'developer.chrome.com',
            'developer.apple.com',
            'learn.microsoft.com'
        ],
        hostPatterns: [
            /(^|[.-])(docs?|documentation|developer|learn|reference)[a-z0-9-]*(\.|$)/i
        ],
        signals: [
            /\bdocs?\b/i,
            /\bdocumentation\b/i,
            /\breference\b/i,
            /\bhandbook\b/i,
            /\bguide\b/i,
            /文档/,
            /手册/,
            /指南/,
            /参考/
        ],
        querySignals: ['文档', '手册', '指南', '参考', 'docs', 'documentation', 'reference', 'guide'],
        queryAliases: [
            'docs',
            'documentation',
            'developer docs',
            'reference',
            'guide',
            'handbook',
            '文档',
            '技术文档',
            '开发文档',
            '参考资料',
            '指南'
        ],
        keywords: [
            'docs',
            'documentation',
            'developer docs',
            'reference',
            'guide',
            'handbook',
            '文档',
            '技术文档',
            '开发文档',
            '参考资料',
            '指南'
        ],
        tags: ['技术文档', '开发文档']
    },
    {
        id: 'video',
        hostnames: [
            'youtube.com',
            'youtu.be',
            'bilibili.com',
            'vimeo.com',
            'ted.com'
        ],
        hostPatterns: [
            /(^|[.-])(video|tube|bilibili|youtube)[a-z0-9-]*(\.|$)/i
        ],
        signals: [
            /\bvideo\b/i,
            /\byoutube\b/i,
            /\bbilibili\b/i,
            /视频/,
            /哔哩/,
            /教程/
        ],
        querySignals: ['视频', 'video', '教程'],
        queryAliases: [
            'video',
            'youtube',
            'bilibili',
            '视频',
            '哔哩哔哩',
            'b站',
            '教程'
        ],
        keywords: [
            'video',
            '视频',
            '教程'
        ],
        tags: ['视频', '教程']
    }
];

function hostMatchesSearchIntent(host, profile) {
    if (!host) {
        return false;
    }
    // Defensive normalization — profile hostnames may have varied casing /
    // be authored with or without www; we strip both sides symmetrically.
    const normHost = host.replace(/^www\./i, '').toLowerCase();

    const hostnameMatches = (profile.hostnames || []).some(rawDomain => {
        const domain = String(rawDomain || '').replace(/^www\./i, '').toLowerCase();
        if (!domain) return false;
        // Exact match OR strict subdomain match (avoid "evilmingcute.com" matching "mingcute.com")
        return normHost === domain || normHost.endsWith(`.${domain}`);
    });
    if (hostnameMatches) {
        return true;
    }

    return (profile.hostPatterns || []).some(pattern => pattern.test(normHost));
}

function valueMatchesSearchIntentSignals(value, signals) {
    const normalizedValue = (value || '').toString().trim().toLowerCase();
    if (!normalizedValue) {
        return false;
    }

    return (signals || []).some(signal => {
        if (signal instanceof RegExp) {
            return signal.test(normalizedValue);
        }
        return normalizedValue.includes(signal.toString().toLowerCase());
    });
}

function queryMatchesSearchIntentSignals(query, signals) {
    const normalizedQuery = normalizeSearchValue(query);
    if (!normalizedQuery) {
        return false;
    }

    return (signals || []).some(signal => {
        if (signal instanceof RegExp) {
            return signal.test(normalizedQuery);
        }

        const normalizedSignal = normalizeSearchValue(signal);
        if (!normalizedSignal) return false;

        // ASCII 短词（AI/UI/UX/dev 等）必须是完整单词，不能让 openai、
        // build、device 因包含相同字母而误触发整个分类扩展。
        if (/^[a-z0-9 ]+$/.test(normalizedSignal)) {
            const escapedSignal = normalizedSignal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return new RegExp(`(^|[^a-z0-9])${escapedSignal}($|[^a-z0-9])`, 'i').test(normalizedQuery);
        }

        return normalizedQuery.includes(normalizedSignal);
    });
}

function getBookmarkIntentProfiles(bookmark) {
    const host = getBookmarkHostname(bookmark);
    const text = [
        bookmark?.title,
        bookmark?.url,
        bookmark?.excerpt,
        ...(bookmark?.tags || [])
    ]
        .filter(Boolean)
        .join(' ');

    return SEARCH_INTENT_PROFILES.filter(profile =>
        hostMatchesSearchIntent(host, profile) ||
        valueMatchesSearchIntentSignals(text, profile.signals)
    );
}

function getBookmarkDerivedKeywords(bookmark) {
    const keywords = new Set();

    getBookmarkIntentProfiles(bookmark).forEach(profile => {
        (profile.keywords || []).forEach(keyword => keywords.add(keyword));
    });

    return Array.from(keywords);
}

function getBookmarkDeterministicTags(bookmark) {
    const tags = new Set();

    getBookmarkIntentProfiles(bookmark).forEach(profile => {
        (profile.tags || []).forEach(tag => tags.add(tag));
    });

    return Array.from(tags);
}

function getSearchQueryVariants(query) {
    const normalizedQuery = normalizeSearchValue(query);
    const variants = new Set([normalizedQuery].filter(Boolean));

    SEARCH_INTENT_PROFILES.forEach(profile => {
        if (queryMatchesSearchIntentSignals(normalizedQuery, profile.querySignals)) {
            (profile.queryAliases || profile.keywords || []).forEach(keyword => variants.add(keyword.toLowerCase()));
        }
    });

    return Array.from(variants);
}

function normalizeSearchValue(value) {
    const text = (value || '').toString();
    const normalized = typeof text.normalize === 'function' ? text.normalize('NFKC') : text;
    return normalized.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * 统一的确定性文本匹配评分。
 *
 * 用户原始输入永远高于意图扩展词，防止具体软件名被同类站点淹没。
 * 多单词软件名允许各单词以任意顺序出现在标题或 URL 中，例如
 * "Visual Studio Code" 可以命中 code.visualstudio.com。
 */
function getSearchTextMatchScore(value, query, options = {}) {
    const text = normalizeSearchValue(value);
    const normalizedQuery = normalizeSearchValue(query);
    if (!text || !normalizedQuery) {
        return 0;
    }

    const includeAliases = options.includeAliases !== false;
    const terms = includeAliases ? getSearchQueryVariants(query) : [normalizedQuery];
    let bestScore = 0;

    terms.forEach(term => {
        const normalizedTerm = normalizeSearchValue(term);
        if (!normalizedTerm) return;

        const isLiteral = normalizedTerm === normalizedQuery;
        const exactScore = isLiteral ? 120 : 90;
        const prefixScore = isLiteral ? 116 : 86;
        const containsScore = isLiteral ? 112 : 82;

        if (text === normalizedTerm) {
            bestScore = Math.max(bestScore, exactScore);
        } else if (text.startsWith(normalizedTerm)) {
            bestScore = Math.max(bestScore, prefixScore);
        } else if (text.includes(normalizedTerm)) {
            bestScore = Math.max(bestScore, containsScore);
        } else if (isLiteral) {
            const tokens = normalizedTerm.split(' ').filter(token => token.length > 1);
            if (tokens.length > 1 && tokens.every(token => text.includes(token))) {
                bestScore = Math.max(bestScore, 108);
            }
        }
    });

    return bestScore;
}

// 获取隐私模式设置
async function determinePrivacyMode(tab) {
    const autoPrivacyMode = await SettingsManager.get('privacy.autoDetect');
    const manualPrivacyMode = await SettingsManager.get('privacy.enabled');
    // 打印隐私模式设置的调试信息
    logger.debug('隐私模式设置:', {
        autoPrivacyMode,
        manualPrivacyMode
    });
    
    // 判断是否启用隐私模式
    let isPrivate = false;
    if (autoPrivacyMode) {
        // 自动检测模式
        isPrivate = await containsPrivateContent(tab.url);
    } else {
        // 手动控制模式
        isPrivate = manualPrivacyMode;
    }
    return isPrivate;
}

async function isPrivacyModeManuallyDisabled() {
    const autoPrivacyMode = await SettingsManager.get('privacy.autoDetect');
    const manualPrivacyMode = await SettingsManager.get('privacy.enabled');
    if (autoPrivacyMode) {
        return false;
    }
    return !manualPrivacyMode;
}

// 检查URL是否包含隐私内容
async function containsPrivateContent(url) {
    try {
        const urlObj = new URL(url);

        // 1. 定义隐私相关路径模式
        const patterns = {
            // 认证相关页面
            auth: {
                pattern: /^.*\/(?:login|signin|signup|register|password|auth|oauth|sso)(?:\/|$)/i,
                scope: 'pathname',
                description: '认证页面'
            },

            // 验证和确认页面
            verification: {
                pattern: /^.*\/(?:verify|confirmation|activate|reset)(?:\/|$)/i,
                scope: 'pathname',
                description: '验证确认页面'
            },

            // 邮箱和消息页面
            mail: {
                pattern: /^.*\/(?:mail|inbox|compose|message|chat|conversation)(?:\/|$)/i,
                scope: 'pathname',
                description: '邮件消息页面'
            },

            // 个人账户和设置页面
            account: {
                pattern: /^.*\/(?:profile|account|settings|preferences|dashboard|admin)(?:\/|$)/i,
                scope: 'pathname',
                description: '账户设置页面'
            },

            // 支付和财务页面
            payment: {
                pattern: /^.*\/(?:payment|billing|invoice|subscription|wallet)(?:\/|$)/i,
                scope: 'pathname',
                description: '支付财务页面'
            },

            // 敏感查询参数
            sensitiveParams: {
                pattern: /[?&](?:token|auth|key|password|secret|access_token|refresh_token|session|code)=/i,
                scope: 'search',
                description: '包含敏感参数'
            }
        };

        // 2. 定义敏感域名列表
        const privateDomains = {
            // 邮箱服务
            mail: [
                'mail.google.com',
                'outlook.office.com',
                'mail.qq.com',
                'mail.163.com',
                'mail.126.com',
                'mail.sina.com',
                'mail.yahoo.com'
            ],
            // 网盘服务
            storage: [
                'drive.google.com',
                'onedrive.live.com',
                'dropbox.com',
                'pan.baidu.com'
            ],
            // 社交和通讯平台的私密页面
            social: [
                'messages.google.com',
                'web.whatsapp.com',
                'web.telegram.org',
                'discord.com/channels'
            ],
            // 在线办公和协作平台的私密页面
            workspace: [
                'docs.google.com',
                'sheets.googleapis.com',
                'notion.so'
            ]
        };

        // 3. 检查域名
        for (const [category, domains] of Object.entries(privateDomains)) {
            if (domains.some(domain => urlObj.hostname === domain || urlObj.hostname.endsWith('.' + domain))) {
                logger.debug('URL包含隐私内容:', {
                    url: url,
                    reason: `属于隐私域名类别: ${category}`,
                    domain: urlObj.hostname
                });

                // 检查是否有例外情况
                if (shouldAllowPrivateException(url, 'domain', category)) {
                    continue;
                }

                return true;
            }
        }

        // 4. 检查路径和查询参数
        for (const [key, rule] of Object.entries(patterns)) {
            let testString;

            switch (rule.scope) {
                case 'pathname':
                    testString = urlObj.pathname;
                    break;
                case 'search':
                    testString = urlObj.search;
                    break;
                case 'full':
                    testString = url;
                    break;
                default:
                    continue;
            }

            if (rule.pattern.test(testString)) {
                const match = testString.match(rule.pattern);
                logger.debug('URL包含隐私内容:', {
                    url: url,
                    reason: rule.description,
                    pattern: rule.pattern.toString(),
                    matchedPart: match[0],
                    matchLocation: rule.scope
                });

                // 检查是否有例外情况
                if (shouldAllowPrivateException(url, key, match)) {
                    continue;
                }

                return true;
            }
        }

        // 5. 检查自定义隐私域名
        const settings = await SettingsManager.getAll();
        const customDomains = settings.privacy.customDomains || [];

        for (const pattern of customDomains) {
            let isMatch = false;

            // 处理正则表达式模式
            if (pattern.startsWith('/') && pattern.endsWith('/')) {
                const regex = new RegExp(pattern.slice(1, -1));
                isMatch = regex.test(urlObj.hostname);
            }
            // 处理通配符模式
            else if (pattern.startsWith('*.')) {
                const domain = pattern.slice(2);
                isMatch = urlObj.hostname.endsWith(domain);
            }
            // 处理普通域名
            else {
                isMatch = urlObj.hostname === pattern;
            }

            if (isMatch) {
                logger.debug('URL匹配自定义隐私域名:', {
                    url: url,
                    pattern: pattern
                });
                return true;
            }
        }

        return false;

    } catch (error) {
        logger.error('隐私内容检查失败:', error);
        return true; // 出错时从安全角度返回true
    }
}

// 处理隐私检测的例外情况
function shouldAllowPrivateException(url, ruleKey, context) {
    try {
        const urlObj = new URL(url);

        // 1. 允许公开的文档页面
        if (context === 'workspace') {
            const publicDocPatterns = [
                /\/public\//i,
                /[?&]sharing=public/i,
                /[?&]view=public/i
            ];
            if (publicDocPatterns.some(pattern => pattern.test(url))) {
                return true;
            }
        }

        // 2. 允许公开的个人主页
        if (ruleKey === 'account') {
            const publicProfilePatterns = [
                /\/public\/profile\//i,
                /\/users\/[^\/]+$/i,
                /\/@[^\/]+$/i
            ];
            if (publicProfilePatterns.some(pattern => pattern.test(urlObj.pathname))) {
                return true;
            }
        }

        // 3. 允许特定域名的登录页面（如开发文档）
        if (ruleKey === 'auth') {
            const allowedAuthDomains = [
                'developer.mozilla.org',
                'docs.github.com',
                'learn.microsoft.com'
            ];
            if (allowedAuthDomains.some(domain => urlObj.hostname.endsWith(domain))) {
                return true;
            }
        }

        // 4. 允许公开的支付文档或API文档
        if (ruleKey === 'payment') {
            const publicPaymentDocs = [
                /\/docs\/payment/i,
                /\/api\/payment/i,
                /\/guides\/billing/i
            ];
            if (publicPaymentDocs.some(pattern => pattern.test(urlObj.pathname))) {
                return true;
            }
        }

        return false;
    } catch (error) {
        logger.error('处理隐私例外情况时出错:', error);
        return false;
    }
}

function isContentFulUrl(url) {
    try {
        const urlObj = new URL(url);

        // 1. 定义更精确的匹配规则
        const patterns = {
            // 错误页面 - 仅匹配路径部分
            errors: {
                pattern: /^.*\/(404|403|500|error|not[-\s]?found)(?:\.html?)?$/i,
                scope: 'pathname',
                description: '错误页面'
            },
            // 维护页面 - 仅匹配路径部分
            maintenance: {
                pattern: /^.*\/(maintenance|unavailable|blocked)(?:\.html?)?$/i,
                scope: 'pathname',
                description: '维护页面'
            },
            // 预览页面 - 需要考虑查询参数
            preview: {
                pattern: /^.*\/preview\/|[?&](?:preview|mode)=(?:preview|temp)/i,
                scope: 'full',
                description: '预览页面'
            },
            // 下载/上传页面 - 仅匹配路径结尾
            fileTransfer: {
                pattern: /\/(download|upload)(?:\/|$)/i,
                scope: 'pathname',
                description: '下载上传页面'
            },
            // 支付和订单页面 - 需要更精确的匹配
            payment: {
                pattern: /\/(?:cart|checkout|payment|order)(?:\/|$)|[?&](?:order_id|transaction_id)=/i,
                scope: 'full',
                description: '支付订单页面'
            },
            // 登出页面 - 仅匹配路径部分
            logout: {
                pattern: /\/(?:logout|signout)(?:\/|$)/i,
                scope: 'pathname',
                description: '登出页面'
            },
            // 打印页面 - 需要考虑查询参数
            print: {
                pattern: /\/print\/|[?&](?:print|format)=pdf/i,
                scope: 'full',
                description: '打印页面'
            },
            // 搜索结果页面 - 需要更精确的匹配
            search: {
                pattern: /\/search\/|\/(results|findings)(?:\/|$)|[?&](?:q|query|search|keyword)=/i,
                scope: 'full',
                description: '搜索结果页面'
            },
            // 回调和重定向页面 - 需要更精确的匹配
            redirect: {
                pattern: /\/(?:callback|redirect)(?:\/|$)|[?&](?:callback|redirect_uri|return_url)=/i,
                scope: 'full',
                description: '回调重定向页面'
            }
        };

        // 2. 检查每个规则
        for (const [key, rule] of Object.entries(patterns)) {
            let testString;

            switch (rule.scope) {
                case 'pathname':
                    // 仅检查路径部分
                    testString = urlObj.pathname;
                    break;
                case 'full':
                    // 检查完整URL（包括查询参数）
                    testString = url;
                    break;
                default:
                    continue;
            }

            if (rule.pattern.test(testString)) {
                // 记录详细的匹配信息
                const match = testString.match(rule.pattern);
                logger.debug('URL被过滤:', {
                    url: url,
                    reason: rule.description,
                    pattern: rule.pattern.toString(),
                    matchedPart: match[0],
                    matchLocation: rule.scope,
                    fullPath: urlObj.pathname,
                    hasQuery: urlObj.search.length > 0
                });

                // 3. 特殊情况处理
                if (shouldAllowException(url, key, match)) {
                    logger.debug('URL虽然匹配过滤规则，但属于例外情况，允许保存');
                    continue;
                }

                return false;
            }
        }

        return true;

    } catch (error) {
        logger.error('URL验证失败:', error);
        return false;
    }
}

// 处理特殊例外情况
function shouldAllowException(url, ruleKey, match) {
    try {
        const urlObj = new URL(url);

        // 1. 允许特定域名的搜索结果页面
        if (ruleKey === 'search') {
            const allowedSearchDomains = [
                'github.com',
                'stackoverflow.com',
                'developer.mozilla.org'
            ];
            if (allowedSearchDomains.some(domain => urlObj.hostname.endsWith(domain))) {
                return true;
            }
        }

        // 2. 允许包含有价值内容的错误页面
        if (ruleKey === 'errors') {
            const valuableErrorPages = [
                /\/guides\/errors\//i,
                /\/docs\/errors\//i,
                /\/error-reference\//i
            ];
            if (valuableErrorPages.some(pattern => pattern.test(urlObj.pathname))) {
                return true;
            }
        }

        // 3. 允许特定的下载页面（如软件发布页）
        if (ruleKey === 'fileTransfer') {
            const allowedDownloadPatterns = [
                /\/releases\/download\//i,
                /\/downloads\/release\//i,
                /\/software\/[^\/]+\/download\/?$/i
            ];
            if (allowedDownloadPatterns.some(pattern => pattern.test(urlObj.pathname))) {
                return true;
            }
        }

        return false;
    } catch (error) {
        logger.error('处理URL例外情况时出错:', error);
        return false;
    }
}

async function checkUrlAccessibility(url) {
    if (isNonMarkableUrl(url)) {
        return {accessible: false, reason: '不支持的URL'};
    }
    return {accessible: true, reason: '可访问'};
}


/**
 * 检测文本的主要语言类型
 * @param {string} text - 文本内容
 * @returns {string} 语言类型：'latin', 'cjk', 'cyrillic', 'arabic', 'mixed'
 */
function detectTextType(text) {
    if (!text) return 'mixed';
    
    // 统计前200个字符的语言特征（比 smartTruncate 多一些样本以提高准确性）
    const sample = text.slice(0, 200);
    
    // 统计不同类型字符的数量
    const stats = {
        latin: 0,      // 拉丁字母 (英文等)
        cjk: 0,        // 中日韩文字
        cyrillic: 0,   // 西里尔字母 (俄文等)
        arabic: 0,     // 阿拉伯文
        other: 0       // 其他字符
    };
    
    // 遍历样本文本的每个字符
    for (const char of sample) {
        if (/[\p{Script=Latin}]/u.test(char)) {
            stats.latin++;
        } else if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(char)) {
            stats.cjk++;
        } else if (/[\p{Script=Cyrillic}]/u.test(char)) {
            stats.cyrillic++;
        } else if (/[\p{Script=Arabic}]/u.test(char)) {
            stats.arabic++;
        } else if (!/[\s\p{P}]/u.test(char)) { // 排除空格和标点
            stats.other++;
        }
    }
    
    // 计算主要字符类型的占比
    const total = Object.values(stats).reduce((a, b) => a + b, 0);
    if (total === 0) return 'mixed';
    
    const threshold = 0.9; // 90%的阈值
    
    // 返回主要语言类型
    if (stats.latin / total > threshold) return 'latin';
    if (stats.cjk / total > threshold) return 'cjk';
    if (stats.cyrillic / total > threshold) return 'cyrillic';
    if (stats.arabic / total > threshold) return 'arabic';
    
    // 如果没有明显主导的语言类型，返回混合类型
    return 'mixed';
}

function smartTruncate(text, maxLength = 500) {
    if (!text) return text;
    if (text.length <= maxLength) return text;

    const textType = detectTextType(text);
    logger.debug('文本类型:', textType);

    // 根据不同语言类型选择截取策略
    switch (textType) {
        case 'latin':
        case 'cyrillic':
        case 'arabic':
            // 按单词数量截取
            const maxWords = Math.round(maxLength * 0.5);
            const words = text.split(/\s+/).filter(word => word.length > 0);
            if (words.length <= maxWords) return text;

            return words
                .slice(0, maxWords)
                .join(' ');
        case 'cjk':
            // 中日韩文本按字符截取，在标点处断句
            const punctuation = /[，。！？；,!?;]/;
            let truncated = text.slice(0, maxLength);

            // 尝试在标点符号处截断
            for (let i = truncated.length - 1; i >= maxLength - 50; i--) {
                if (punctuation.test(truncated[i])) {
                    truncated = truncated.slice(0, i + 1);
                    break;
                }
            }
            return truncated;

        case 'mixed':
        default:
            // 混合文本采用通用策略
            // 先尝试在空格处截断
            let mixedTruncated = text.slice(0, maxLength);
            for (let i = mixedTruncated.length - 1; i >= maxLength - 30; i--) {
                if (/\s/.test(mixedTruncated[i])) {
                    mixedTruncated = mixedTruncated.slice(0, i);
                    break;
                }
            }
            return mixedTruncated;
    }
}

// 获取备选标签的辅助函数
function getFallbackTags(title, metadata) {
    const maxTags = 5;
    const tags = new Set();

    // 1. 首先尝试使用 metadata 中的关键词
    if (metadata?.keywords) {
        const metaKeywords = metadata.keywords
            .split(/[,，;；]/) // 分割关键词
            .map(tag => tag.trim())
            .filter(tag => {
                return tag.length >= 1 &&
                    tag.length <= 20;
            });

        metaKeywords.forEach(tag => tags.add(tag));
    }

    const stopWords = new Set([
        // 中文停用词
        '的', '了', '和', '与', '或', '在', '是', '到', '等', '把',
        // 英文停用词
        'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for',
        'from', 'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on',
        'that', 'the', 'to', 'was', 'were', 'will', 'with', 'the',
        // 常见连接词和介词
        'about', 'after', 'before', 'but', 'how', 'into', 'over',
        'under', 'what', 'when', 'where', 'which', 'who', 'why',
        // 常见动词
        'can', 'could', 'did', 'do', 'does', 'had', 'have', 'may',
        'might', 'must', 'should', 'would',
        // 其他常见词
        'this', 'these', 'those', 'they', 'you', 'your'
    ]);

    // 2. 如果 metadata 中没有足够的关键词，使用标题关键词
    if (tags.size < 2 && title) {
        // 移除常见的无意义词
        const titleWords = title
            .split(/[\s\-\_\,\.\。\，]/) // 分割标题
            .map(word => word.trim())
            .filter(word => {
                return word.length >= 2 &&
                    word.length <= 20 &&
                    !stopWords.has(word) &&
                    !/[^\u4e00-\u9fa5a-zA-Z0-9]/.test(word);
            });

        titleWords.forEach(word => {
            if (tags.size < maxTags) { // 最多添加5个标签
                tags.add(word);
            }
        });
    }

    // 3. 如果还是没有足够的标签，尝试使用 metadata 的其他信息
    if (tags.size < 2) {
        // 尝试使用文章分类信息
        if (metadata?.category && metadata.category.length <= 20) {
            tags.add(metadata.category);
        }

        // 尝试使用文章题信息
        if (metadata?.subject && metadata.subject.length <= 20) {
            tags.add(metadata.subject);
        }

        // 尝试从描述中提取关键词
        if (metadata?.description) {
            const descWords = metadata.description
                .split(/[\s\,\.\。\，]/)
                .map(word => word.trim())
                .filter(word => {
                    return word.length >= 2 &&
                        word.length <= 20 &&
                        !stopWords.has(word) &&
                        !/[^\u4e00-\u9fa5a-zA-Z0-9]/.test(word);
                })
                .slice(0, 2); // 最多取2个关键词

            descWords.forEach(word => {
                if (tags.size < maxTags) {
                    tags.add(word);
                }
            });
        }
    }

    logger.debug('备选标签生成过程:', {
        fromMetaKeywords: metadata?.keywords ? true : false,
        fromTitle: title ? true : false,
        finalTags: Array.from(tags)
    });

    return Array.from(tags).slice(0, maxTags);
}

// 获取当前页面的文本内容
async function getPageContent(tab) {
    try {
        const isPrivate = await determinePrivacyMode(tab);
        if (isPrivate || !isContentFulUrl(tab.url)) {
            logger.info('页面为隐私模式或URL无内容');
            return {};
        }
        // 首先注 content script
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["lib/Readability-readerable.js", "lib/Readability.js", "contentScript.js"]
        });
        
        const response = await chrome.tabs.sendMessage(tab.id, { action: "getContent" });
        
        // 如果提取失败，返回空字符串
        if (!response) {
            logger.warn('内容提取失败');
            return {};
        }

        return response;
    } catch (error) {
        logger.error('获取页面内容时出错:', error);
        return {};
    }
}

/**
 * 获取当前设备信息
 * @returns {Promise<string>} 设备信息字符串
 */
async function getDeviceInfo() {
    try {
        // 获取用户代理字符串
        const userAgent = navigator.userAgent;
        
        // 提取操作系统信息
        let osName = "未知系统";
        
        // 检测操作系统
        if (userAgent.indexOf("Win") !== -1) osName = "Windows";
        else if (userAgent.indexOf("Mac") !== -1) osName = "Mac OS";
        else if (userAgent.indexOf("Linux") !== -1) osName = "Linux";
        else if (userAgent.indexOf("Android") !== -1) osName = "Android";
        else if (userAgent.indexOf("iOS") !== -1 || userAgent.indexOf("iPhone") !== -1 || userAgent.indexOf("iPad") !== -1) osName = "iOS";
        
        // 获取浏览器信息和版本
        const browserInfo = (() => {
            const ua = navigator.userAgent;
            let browserName = "未知浏览器";
            let version = "";
            
            // 检测Chrome浏览器
            const chromeMatch = ua.match(/Chrome\/(\d+\.\d+)/i);
            if (chromeMatch) {
                browserName = "Chrome";
                version = chromeMatch[1];
            }
            // 检测Firefox浏览器
            else if (ua.indexOf("Firefox") !== -1) {
                const firefoxMatch = ua.match(/Firefox\/(\d+\.\d+)/i);
                browserName = "Firefox";
                version = firefoxMatch ? firefoxMatch[1] : "";
            }
            // 检测Safari浏览器 (但不是Chrome或Firefox)
            else if (ua.indexOf("Safari") !== -1) {
                const safariMatch = ua.match(/Safari\/(\d+\.\d+)/i);
                browserName = "Safari";
                version = safariMatch ? safariMatch[1] : "";
            }
            // 检测Edge浏览器
            else if (ua.indexOf("Edg") !== -1) {
                const edgeMatch = ua.match(/Edg\/(\d+\.\d+)/i);
                browserName = "Edge";
                version = edgeMatch ? edgeMatch[1] : "";
            }
            
            return {
                name: browserName,
                version: version
            };
        })();
        
        // 获取或创建设备随机ID
        let deviceRandomId = await LocalStorageMgr.get('device_uuid');
        if (!deviceRandomId) {
            // 生成5位随机字符作为设备ID
            const randomChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
            const randomId = Array.from(
                { length: 5 }, 
                () => randomChars.charAt(Math.floor(Math.random() * randomChars.length))
            ).join('');
            
            deviceRandomId = randomId;
            await LocalStorageMgr.set('device_uuid', deviceRandomId);
        }
        
        // 返回格式化的设备信息字符串
        return `${osName} ${browserInfo.name} ${browserInfo.version}-${deviceRandomId}`;
    } catch (error) {
        // 出错时返回默认值
        return "未知设备";
    }
}

// 检查是否配置了API Key，如果没有则抛出错误
async function checkAPIKeyValid(checkType) {
    if (!checkType || checkType === 'chat') {
        const chatService = await ConfigManager.getChatService();
        if (!chatService.apiKey || !chatService.chatModel) {
            throw new Error('未配置有效的对话模型');
        }
    }
    if (!checkType || checkType === 'embedding') {
        const embeddingService = await ConfigManager.getEmbeddingService();
        if (!embeddingService.apiKey || !embeddingService.embedModel) {
            throw new Error('未配置有效的向量模型');
        }
    }
}

/**
 * 安全地检查API Key是否有效
 * @param {string} checkType - 检查类型，可选值为 'chat' 或 'embedding'
 * @returns {Promise<boolean>} 如果API Key有效返回 true，否则返回 false
 */
async function checkAPIKeyValidSafe(checkType) {
    try {
        await checkAPIKeyValid(checkType);
        return true;
    } catch (error) {
        return false;
    }
}

async function searchBookmarksFromBackground(query, options = {}) {
    logger.debug('从background搜索书签', { query: query, options: options });
    try {
        const response = await chrome.runtime.sendMessage({
            type: MessageType.SEARCH_BOOKMARKS,
            data: {
                query: query,
                options: options
            }
        });
        if (!response.success) {
            throw new Error(response.error);
        }
        return response.results || [];
    }
    catch (error) {
        logger.error('搜索书签失败:', error);
        return [];
    }
}

async function getFullBookmarksFromBackground() {
    logger.debug('从background获取全部书签');
    try {
        const response = await chrome.runtime.sendMessage({
            type: MessageType.GET_FULL_BOOKMARKS
        });
        if (!response.success) {
            throw new Error(response.error);
        }
        logger.debug('从background获取全部书签完成', { response: response });
        return response.bookmarks || {};
    } catch (error) {
        logger.error('获取书签失败:', error);
        return {};
    }
}

 async function setBookmarksToBackground(bookmarks, options = {}) {
    logger.debug('从background更新书签', { bookmarks: bookmarks, options: options });
    try {
        const result = await chrome.runtime.sendMessage({
            type: MessageType.SET_BOOKMARKS,
            data: {
                bookmarks: bookmarks,
                options: options
            }
        });
        if (!result.success) {
            throw new Error(result.error);
        }
        logger.debug('从background更新书签完成', { result: result });
        return true;
    } catch (error) {
        logger.error('更新书签失败:', error);
        return false;
    }
}

async function updateBookmarksAndEmbedding(bookmarks, options = {}) {
    logger.debug('从background更新书签和向量', { bookmarks: bookmarks, options: options });
    try {
        const bookmarkArray = Array.isArray(bookmarks) ? bookmarks : [bookmarks];
        // 将书签转换为本地格式
        const localBookmarks = bookmarkArray.map(bookmark => {
            return unifiedBookmarkToLocalFormat(bookmark);
        });
        const result = await chrome.runtime.sendMessage({
            type: MessageType.UPDATE_BOOKMARKS_AND_EMBEDDING,
            data: {
                bookmarks: localBookmarks,
                options: options
            }
        });
        if (!result.success) {
            throw new Error(result.error);
        }
        logger.debug('从background更新书签和向量完成', { result: result });
        return true;
    } catch (error) {
        logger.error('更新书签和向量失败:', error);
        return false;
    }
}

async function removeBookmarksByBackground(urls, options = {}) {
    logger.debug('从background删除书签', { urls: urls, options: options });
    try {
        const result = await chrome.runtime.sendMessage({
            type: MessageType.REMOVE_BOOKMARKS,
            data: {
                urls: urls,
                options: options
            }
        });
        if (!result.success) {
            throw new Error(result.error);
        }
        logger.debug('从background删除书签完成', { result: result });
        return true;
    } catch (error) {
        logger.error('删除书签失败:', error);
        return false;
    }
}   

async function clearBookmarksByBackground(options = {}) {
    logger.debug('从background清除书签', { options: options });
    try {
        const result = await chrome.runtime.sendMessage({
            type: MessageType.CLEAR_BOOKMARKS,
            data: {
                options: options
            }
        });
        if (!result.success) {
            throw new Error(result.error);
        }
        logger.debug('从background清除书签完成', { result: result });
        return true;
    } catch (error) {
        logger.error('清除书签失败:', error);
        return false;
    }
}
