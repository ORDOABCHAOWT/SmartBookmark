const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

function loadUtilSearchHelpers() {
    const source = fs.readFileSync(path.join(root, 'util.js'), 'utf8');
    const sandbox = {
        console,
        URL,
        logger: {
            debug() {},
            error() {},
            warn() {},
            info() {}
        },
        LocalStorageMgr: {
            Namespace: { BOOKMARK: 'bookmark.' }
        }
    };

    vm.runInNewContext(`${source}
globalThis.utilSearchHelpers = {
    getBookmarkDerivedKeywords,
    getBookmarkDeterministicTags,
    getSearchQueryVariants
};`, sandbox);
    return sandbox.utilSearchHelpers;
}

function loadSearchManager(bookmarks, queryEmbedding = [1, 0], getEmbeddingImpl = null) {
    const source = fs.readFileSync(path.join(root, 'search.js'), 'utf8');
    const { getBookmarkDerivedKeywords, getSearchQueryVariants } = loadUtilSearchHelpers();
    const sandbox = {
        console,
        setTimeout,
        clearTimeout,
        logger: {
            debug() {},
            error() {},
            warn() {},
            info() {}
        },
        DEBUG: false,
        BookmarkSource: {
            EXTENSION: 'extension',
            CHROME: 'chrome'
        },
        SettingsManager: {
            async getAll() {
                return { search: { maxResults: 50 } };
            }
        },
        ConfigManager: {
            async getEmbeddingService() {
                return {
                    isCustom: false,
                    similarityThreshold: { MAX: 0.85, HIGH: 0.65, MEDIUM: 0.5, LOW: 0.4 }
                };
            }
        },
        getBookmarksForSearch: async (includeChromeBookmarks) =>
            typeof bookmarks === 'function' ? bookmarks(includeChromeBookmarks) : bookmarks,
        getBookmarkDerivedKeywords,
        getSearchQueryVariants,
        getEmbedding: getEmbeddingImpl || (async () => queryEmbedding),
        LocalStorageMgr: {
            async get() { return []; },
            async set() {}
        }
    };

    vm.runInNewContext(`${source}\nglobalThis.SearchManager = SearchManager;`, sandbox);
    return new sandbox.SearchManager();
}

function loadAICategorizer(chatResponse = 'AI工具,效率') {
    const source = fs.readFileSync(path.join(root, 'aiCategorizer.js'), 'utf8');
    const { getBookmarkDerivedKeywords, getBookmarkDeterministicTags } = loadUtilSearchHelpers();
    const sandbox = {
        console,
        logger: {
            debug() {},
            error() {},
            warn() {},
            info() {}
        },
        MessageType: {
            AI_CATEGORIZE_PROGRESS: 'AI_CATEGORIZE_PROGRESS'
        },
        LocalStorageMgr: {
            async getBookmarks() { return {}; },
            async updateBookmarksAndEmbedding() {},
            Namespace: { BOOKMARK: 'bookmark.' }
        },
        ConfigManager: {
            async getChatService() {
                return { apiKey: 'test-key', chatModel: 'test-model' };
            }
        },
        getChatCompletion: async () => chatResponse,
        getBookmarkDerivedKeywords,
        getBookmarkDeterministicTags,
        smartTruncate: (value) => value,
        sendMessageSafely() {}
    };

    vm.runInNewContext(`${source}\nglobalThis.AICategorizer = AICategorizer;`, sandbox);
    return new sandbox.AICategorizer();
}

function loadStorageManager(oldBookmark, savedBookmarks) {
    const source = fs.readFileSync(path.join(root, 'storageManager.js'), 'utf8');
    const sandbox = {
        console,
        EnvIdentifier: 'background',
        logger: {
            debug() {},
            error() {},
            warn() {},
            info() {}
        },
        chrome: {
            storage: {
                local: {
                    async get() { return {}; },
                    async set() {},
                    async remove() {}
                },
                onChanged: { addListener() {} }
            },
            runtime: { sendMessage() {} }
        },
        makeEmbeddingText(bookmark) {
            return `${bookmark.title || ''}\n${(bookmark.tags || []).join('|')}\n${bookmark.excerpt || ''}`;
        },
        setTimeout,
        clearTimeout
    };

    vm.runInNewContext(`${source}\nglobalThis.LocalStorageMgr = LocalStorageMgr;`, sandbox);
    sandbox.LocalStorageMgr.getBookmark = async () => oldBookmark;
    sandbox.LocalStorageMgr.setBookmarks = async (bookmarks) => {
        savedBookmarks.push(...bookmarks);
    };
    return sandbox.LocalStorageMgr;
}

function loadUtilBookmarkNormalizer() {
    const source = fs.readFileSync(path.join(root, 'util.js'), 'utf8');
    const sandbox = {
        console,
        logger: {
            debug() {},
            error() {},
            warn() {},
            info() {}
        },
        LocalStorageMgr: {
            Namespace: { BOOKMARK: 'bookmark.' }
        }
    };

    vm.runInNewContext(`${source}\nglobalThis.normalizeStoredBookmark = normalizeStoredBookmark;`, sandbox);
    return sandbox.normalizeStoredBookmark;
}

function loadSettingsManagerDefaults() {
    const source = fs.readFileSync(path.join(root, 'settingsManager.js'), 'utf8');
    const sandbox = {
        console,
        logger: {
            debug() {},
            error() {},
            warn() {},
            info() {}
        },
        chrome: {
            storage: {
                sync: {
                    async get() { return {}; },
                    async set() {}
                },
                onChanged: { addListener() {} }
            }
        }
    };

    vm.runInNewContext(`${source}
globalThis.defaultSettings = SettingsManager.DEFAULT_SETTINGS;`, sandbox);
    return sandbox.defaultSettings;
}

function loadPopupSearchHelpers() {
    const source = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
    const { getBookmarkDerivedKeywords, getSearchQueryVariants } = loadUtilSearchHelpers();
    const helperSource = source.slice(
        source.indexOf('function getPopupSearchTextScore'),
        source.indexOf('function displaySearchResults')
    );
    const sandbox = {
        currentRenderer: {
            allBookmarks: [{
                url: 'https://aihot.example',
                title: 'AIHOT',
                tags: [],
                excerpt: '',
                savedAt: 1
            }, {
                url: 'https://www.mingcute.com/',
                title: 'MingCute',
                tags: [],
                excerpt: '',
                savedAt: 2
            }]
        },
        getBookmarkDerivedKeywords,
        getSearchQueryVariants,
        getDisplayedBookmarks: async () => ({})
    };

    vm.runInNewContext(`${helperSource}
globalThis.searchVisibleBookmarks = searchVisibleBookmarks;
globalThis.mergeSearchResults = mergeSearchResults;`, sandbox);
    return {
        searchVisibleBookmarks: sandbox.searchVisibleBookmarks,
        mergeSearchResults: sandbox.mergeSearchResults
    };
}

async function testExactTitleMatchBeatsSemanticOnlyResult() {
    const manager = loadSearchManager({
        'https://semantic.example': {
            url: 'https://semantic.example',
            title: 'Totally unrelated',
            tags: [],
            excerpt: '',
            embedding: [1, 0],
            source: 'extension'
        },
        'https://aihot.example': {
            url: 'https://aihot.example',
            title: 'aihot',
            tags: [],
            excerpt: '',
            embedding: [0, 1],
            source: 'extension'
        }
    });

    const results = await manager.search('aihot', {
        debounce: false,
        maxResults: 1,
        includeUrl: true,
        includeChromeBookmarks: false,
        recordSearch: false
    });

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].title, 'aihot');
}

async function testExactTitleMatchDoesNotRequireEmbeddingApi() {
    let embeddingCalled = false;
    const manager = loadSearchManager({
        'https://aihot.example': {
            url: 'https://aihot.example',
            title: 'aihot',
            tags: [],
            excerpt: '',
            embedding: null,
            source: 'extension'
        }
    }, null, async () => {
        embeddingCalled = true;
        throw new Error('embedding API should not be called for keyword hit');
    });

    const results = await manager.search('aihot', {
        debounce: false,
        maxResults: 10,
        includeUrl: true,
        includeChromeBookmarks: false,
        recordSearch: false
    });

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].title, 'aihot');
    assert.strictEqual(embeddingCalled, false);
}

async function testKeywordSearchFallsBackToChromeBookmarks() {
    const manager = loadSearchManager((includeChromeBookmarks) => {
        if (!includeChromeBookmarks) {
            return {};
        }

        return {
            'https://aihot.example': {
                url: 'https://aihot.example',
                title: 'aihot',
                tags: [],
                excerpt: '',
                embedding: null,
                source: 'chrome'
            }
        };
    });

    const results = await manager.search('aihot', {
        debounce: false,
        maxResults: 10,
        includeUrl: true,
        includeChromeBookmarks: false,
        recordSearch: false
    });

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].title, 'aihot');
}

async function testSpecificGitHubSearchIsNotCrowdedOutByGenericDeveloperBookmarks() {
    const bookmarks = {};
    for (let index = 0; index < 60; index += 1) {
        const url = `https://gitlab.com/example/project-${index}`;
        bookmarks[url] = {
            url,
            title: `Source project ${index}`,
            tags: [],
            excerpt: '',
            embedding: null,
            source: 'chrome'
        };
    }

    bookmarks['https://github.com/example/target'] = {
        url: 'https://github.com/example/target',
        title: 'Target repository',
        tags: [],
        excerpt: '',
        embedding: null,
        source: 'chrome'
    };

    const manager = loadSearchManager(bookmarks);
    const results = await manager.search('GitHub', {
        debounce: false,
        maxResults: 50,
        includeUrl: true,
        includeChromeBookmarks: true,
        recordSearch: false
    });

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].url, 'https://github.com/example/target');
}

function testSpecificDeveloperBrandDoesNotBecomeAGenericAlias() {
    const { getBookmarkDerivedKeywords, getSearchQueryVariants } = loadUtilSearchHelpers();
    const variants = getSearchQueryVariants('GitHub');
    const gitLabKeywords = getBookmarkDerivedKeywords({
        url: 'https://gitlab.com/example/project',
        title: 'Source project',
        tags: [],
        excerpt: ''
    });

    assert.ok(variants.includes('github'));
    assert.strictEqual(variants.includes('python'), false);
    assert.strictEqual(variants.includes('code'), false);
    assert.strictEqual(gitLabKeywords.includes('github'), false);
}

async function testBroadDeveloperIntentStillFindsGitHub() {
    const manager = loadSearchManager({
        'https://github.com/example/project': {
            url: 'https://github.com/example/project',
            title: 'Source repository',
            tags: [],
            excerpt: '',
            embedding: null,
            source: 'chrome'
        }
    });

    const results = await manager.search('开发', {
        debounce: false,
        maxResults: 10,
        includeUrl: true,
        includeChromeBookmarks: true,
        recordSearch: false
    });

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].url, 'https://github.com/example/project');
}

async function testIconIntentFindsMingCuteWithoutEmbeddingApi() {
    let embeddingCalled = false;
    const manager = loadSearchManager({
        'https://www.mingcute.com/': {
            url: 'https://www.mingcute.com/',
            title: 'MingCute',
            tags: [],
            excerpt: '',
            embedding: null,
            source: 'extension'
        }
    }, null, async () => {
        embeddingCalled = true;
        throw new Error('embedding API should not be called for derived keyword hit');
    });

    const results = await manager.search('icon', {
        debounce: false,
        maxResults: 10,
        includeUrl: true,
        includeChromeBookmarks: false,
        recordSearch: false
    });

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].url, 'https://www.mingcute.com/');
    assert.strictEqual(embeddingCalled, false);
}

async function testChineseIconIntentFindsMingCuteWithoutEmbeddingApi() {
    let embeddingCalled = false;
    const manager = loadSearchManager({
        'https://www.mingcute.com/': {
            url: 'https://www.mingcute.com/',
            title: 'MingCute',
            tags: [],
            excerpt: '',
            embedding: null,
            source: 'extension'
        }
    }, null, async () => {
        embeddingCalled = true;
        throw new Error('embedding API should not be called for derived keyword hit');
    });

    const results = await manager.search('图标', {
        debounce: false,
        maxResults: 10,
        includeUrl: true,
        includeChromeBookmarks: false,
        recordSearch: false
    });

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].url, 'https://www.mingcute.com/');
    assert.strictEqual(embeddingCalled, false);
}

async function testChineseIconIntentFallsBackToChromeMingCute() {
    const manager = loadSearchManager((includeChromeBookmarks) => {
        if (!includeChromeBookmarks) {
            return {};
        }

        return {
            'https://www.mingcute.com/': {
                url: 'https://www.mingcute.com/',
                title: 'MingCute',
                tags: [],
                excerpt: '',
                embedding: null,
                source: 'chrome'
            }
        };
    });

    const results = await manager.search('图标', {
        debounce: false,
        maxResults: 10,
        includeUrl: true,
        includeChromeBookmarks: false,
        recordSearch: false
    });

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].url, 'https://www.mingcute.com/');
}

async function testGenericIconIntentFindsIconLibraryByHostPattern() {
    let embeddingCalled = false;
    const manager = loadSearchManager({
        'https://icones.js.org/': {
            url: 'https://icones.js.org/',
            title: 'Icones',
            tags: [],
            excerpt: '',
            embedding: null,
            source: 'extension'
        }
    }, null, async () => {
        embeddingCalled = true;
        throw new Error('embedding API should not be called for intent keyword hit');
    });

    const results = await manager.search('图标', {
        debounce: false,
        maxResults: 10,
        includeUrl: true,
        includeChromeBookmarks: false,
        recordSearch: false
    });

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].url, 'https://icones.js.org/');
    assert.strictEqual(embeddingCalled, false);
}

async function testDocumentationIntentFindsMdnDocsWithoutEmbeddingApi() {
    let embeddingCalled = false;
    const manager = loadSearchManager({
        'https://developer.mozilla.org/': {
            url: 'https://developer.mozilla.org/',
            title: 'MDN Web Docs',
            tags: [],
            excerpt: '',
            embedding: null,
            source: 'extension'
        }
    }, null, async () => {
        embeddingCalled = true;
        throw new Error('embedding API should not be called for documentation intent hit');
    });

    const results = await manager.search('文档', {
        debounce: false,
        maxResults: 10,
        includeUrl: true,
        includeChromeBookmarks: false,
        recordSearch: false
    });

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].url, 'https://developer.mozilla.org/');
    assert.strictEqual(embeddingCalled, false);
}

async function testIconIntentDoesNotPullGenericDesignResources() {
    const manager = loadSearchManager({
        'https://icones.js.org/': {
            url: 'https://icones.js.org/',
            title: 'Icones',
            tags: [],
            excerpt: '',
            embedding: null,
            source: 'extension'
        },
        'https://www.figma.com/community': {
            url: 'https://www.figma.com/community',
            title: 'Figma Community',
            tags: [],
            excerpt: '',
            embedding: null,
            source: 'extension'
        }
    }, null, async () => {
        throw new Error('embedding API should not be called for intent keyword hit');
    });

    const results = await manager.search('图标', {
        debounce: false,
        maxResults: 10,
        includeUrl: true,
        includeChromeBookmarks: false,
        recordSearch: false
    });

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].url, 'https://icones.js.org/');
}

async function testAICategorizerSupportsSingleBookmark() {
    const categorizer = loadAICategorizer();
    assert.strictEqual(typeof categorizer.categorizeBookmark, 'function');

    const result = await categorizer.categorizeBookmark({
        url: 'https://aihot.example',
        title: 'aihot',
        tags: [],
        excerpt: ''
    });

    assert.deepStrictEqual(Array.from(result.tags), ['AI工具', '效率']);
    assert.strictEqual(result.url, 'https://aihot.example');
}

async function testAICategorizerKeepsDeterministicIconTags() {
    const categorizer = loadAICategorizer('工具');
    const result = await categorizer.categorizeBookmark({
        url: 'https://www.mingcute.com/',
        title: 'MingCute',
        tags: [],
        excerpt: ''
    });

    assert.ok(result.tags.includes('工具'));
    assert.ok(result.tags.includes('图标'));
}

async function testChangedTagsInvalidateOldEmbedding() {
    const savedBookmarks = [];
    const StorageManager = loadStorageManager({
        url: 'https://aihot.example',
        title: 'aihot',
        tags: ['旧标签'],
        excerpt: '',
        embedding: [1, 2, 3],
        apiService: 'old-service',
        embedModel: 'old-model'
    }, savedBookmarks);

    await StorageManager.updateBookmarksAndEmbedding([{
        url: 'https://aihot.example',
        title: 'aihot',
        tags: ['AI工具'],
        excerpt: ''
    }]);

    assert.strictEqual(savedBookmarks.length, 1);
    assert.strictEqual(savedBookmarks[0].embedding, undefined);
    assert.strictEqual(savedBookmarks[0].apiService, undefined);
    assert.strictEqual(savedBookmarks[0].embedModel, undefined);
}

function testStoredBookmarkUrlCanComeFromStorageKey() {
    const normalizeStoredBookmark = loadUtilBookmarkNormalizer();
    const bookmark = normalizeStoredBookmark('bookmark.https://aihot.example', {
        title: 'aihot',
        tags: []
    });

    assert.strictEqual(bookmark.url, 'https://aihot.example');
    assert.strictEqual(bookmark.title, 'aihot');
}

function testMingCuteGetsIconDerivedKeywordsAndTags() {
    const { getBookmarkDerivedKeywords, getBookmarkDeterministicTags } = loadUtilSearchHelpers();
    const bookmark = {
        title: 'MingCute',
        url: 'https://www.mingcute.com/',
        tags: [],
        excerpt: ''
    };

    assert.ok(getBookmarkDerivedKeywords(bookmark).includes('icon'));
    assert.ok(getBookmarkDerivedKeywords(bookmark).includes('图标'));
    assert.ok(getBookmarkDeterministicTags(bookmark).includes('图标'));
}

function testIntentProfilesGenerateReusableKeywordsAndTags() {
    const {
        getBookmarkDerivedKeywords,
        getBookmarkDeterministicTags,
        getSearchQueryVariants
    } = loadUtilSearchHelpers();

    const iconBookmark = {
        title: 'Icones',
        url: 'https://icones.js.org/',
        tags: [],
        excerpt: ''
    };
    const docsBookmark = {
        title: 'MDN Web Docs',
        url: 'https://developer.mozilla.org/',
        tags: [],
        excerpt: ''
    };

    assert.ok(getBookmarkDerivedKeywords(iconBookmark).includes('图标'));
    assert.ok(getBookmarkDeterministicTags(iconBookmark).includes('设计资源'));
    assert.ok(getBookmarkDerivedKeywords(docsBookmark).includes('文档'));
    assert.ok(getBookmarkDeterministicTags(docsBookmark).includes('技术文档'));
    assert.ok(getSearchQueryVariants('开发文档').includes('documentation'));
    assert.strictEqual(getSearchQueryVariants('图标').includes('设计资源'), false);
}

async function testPopupSearchMatchesVisibleUppercaseTitle() {
    const { searchVisibleBookmarks } = loadPopupSearchHelpers();
    const results = await searchVisibleBookmarks('aihot');

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].title, 'AIHOT');
}

async function testPopupSearchMatchesMingCuteByIconIntent() {
    const { searchVisibleBookmarks } = loadPopupSearchHelpers();
    const results = await searchVisibleBookmarks('icon');

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].title, 'MingCute');
}

async function testPopupSearchMatchesMingCuteByChineseIconIntent() {
    const { searchVisibleBookmarks } = loadPopupSearchHelpers();
    const results = await searchVisibleBookmarks('图标');

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].title, 'MingCute');
}

function testPopupSearchMergesLocalAndBackgroundResults() {
    const { mergeSearchResults } = loadPopupSearchHelpers();
    const results = mergeSearchResults(
        [{ url: 'https://local.example', title: 'Local hit' }],
        [{ url: 'https://www.mingcute.com/', title: 'MingCute' }]
    );

    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0].url, 'https://local.example');
    assert.strictEqual(results[1].url, 'https://www.mingcute.com/');
}

function testThemeDefaultsToSystemMode() {
    const defaultSettings = loadSettingsManagerDefaults();

    assert.strictEqual(defaultSettings.display.theme.mode, 'system');
}

function testPopupUsesTokenizedStylesheetWithoutInlineOverrides() {
    const popupHtml = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
    const tokensIndex = popupHtml.indexOf('css/tokens.css');
    const popupIndex = popupHtml.indexOf('css/popup.css');

    assert.ok(tokensIndex >= 0);
    assert.ok(popupIndex > tokensIndex);
    assert.strictEqual(/<style[\s>]/i.test(popupHtml), false);
}

function testSelectionRailIsSeparateFromFaviconColumn() {
    const css = fs.readFileSync(path.join(root, 'css/smartbookmark-redesign.css'), 'utf8');

    assert.match(css, /\.bookmark-item,\s*\.result-item,\s*\.search-result-item\s*{[^}]*grid-template-columns:\s*var\(--sb-select-rail\)\s*minmax\(0,\s*1fr\)/s);
    assert.match(css, /\.bookmark-checkbox,\s*\.result-item\s+\.bookmark-checkbox\s*{[^}]*position:\s*static/s);
    assert.match(css, /\.bookmark-checkbox,\s*\.result-item\s+\.bookmark-checkbox\s*{[^}]*grid-column:\s*1/s);
    assert.match(css, /\.bookmark-link,\s*\.result-link\s*{[^}]*grid-column:\s*2/s);
    assert.match(css, /\.bookmark-main,\s*\.result-title-wrapper\s*{[^}]*grid-template-columns:\s*var\(--sb-favicon-size\)\s*minmax\(0,\s*1fr\)\s*auto/s);
}

function testQuickSearchInputDoesNotDrawNestedFocusRing() {
    const css = fs.readFileSync(path.join(root, 'css/quickSearch.css'), 'utf8');

    assert.match(css, /#search-input:focus,\s*#search-input:focus-visible\s*{[^}]*box-shadow:\s*none/s);
}

function testSettingsShortcutButtonCanFitTextLabel() {
    const css = fs.readFileSync(path.join(root, 'css/settings.css'), 'utf8');

    assert.match(css, /#edit-shortcuts-btn\s*{[^}]*width:\s*auto/s);
    assert.match(css, /#edit-shortcuts-btn\s*{[^}]*white-space:\s*nowrap/s);
    assert.match(css, /\.shortcut-info\s*{[^}]*display:\s*flex/s);
}

function testSettingsInlineLabelsKeepTooltipIconsAligned() {
    const css = fs.readFileSync(path.join(root, 'css/settings.css'), 'utf8');

    assert.match(css, /\.form-group\s*>\s*label,\s*\.setting-item-card\s*>\s*label\s*{[^}]*display:\s*inline-flex/s);
    assert.match(css, /\.tooltip-icon\s*{[^}]*display:\s*inline-flex/s);
}

function testPopupBookmarkCountDoesNotWrapOrCollapse() {
    const css = fs.readFileSync(path.join(root, 'css/popup.css'), 'utf8');

    assert.match(css, /\.bookmark-count-wrapper\s*{[^}]*min-width:\s*72px/s);
    assert.match(css, /\.bookmark-count-wrapper\s*{[^}]*white-space:\s*nowrap/s);
    assert.match(css, /\.bookmark-count-wrapper\s*{[^}]*align-items:\s*center/s);
    assert.match(css, /\.bookmark-count\s*{[^}]*white-space:\s*nowrap/s);
    assert.match(css, /\.bookmark-count\s*{[^}]*align-items:\s*center/s);
}

async function run() {
    await testExactTitleMatchBeatsSemanticOnlyResult();
    await testExactTitleMatchDoesNotRequireEmbeddingApi();
    await testKeywordSearchFallsBackToChromeBookmarks();
    await testSpecificGitHubSearchIsNotCrowdedOutByGenericDeveloperBookmarks();
    testSpecificDeveloperBrandDoesNotBecomeAGenericAlias();
    await testBroadDeveloperIntentStillFindsGitHub();
    await testIconIntentFindsMingCuteWithoutEmbeddingApi();
    await testChineseIconIntentFindsMingCuteWithoutEmbeddingApi();
    await testChineseIconIntentFallsBackToChromeMingCute();
    await testGenericIconIntentFindsIconLibraryByHostPattern();
    await testDocumentationIntentFindsMdnDocsWithoutEmbeddingApi();
    await testIconIntentDoesNotPullGenericDesignResources();
    await testAICategorizerSupportsSingleBookmark();
    await testAICategorizerKeepsDeterministicIconTags();
    await testChangedTagsInvalidateOldEmbedding();
    testStoredBookmarkUrlCanComeFromStorageKey();
    testMingCuteGetsIconDerivedKeywordsAndTags();
    testIntentProfilesGenerateReusableKeywordsAndTags();
    await testPopupSearchMatchesVisibleUppercaseTitle();
    await testPopupSearchMatchesMingCuteByIconIntent();
    await testPopupSearchMatchesMingCuteByChineseIconIntent();
    testPopupSearchMergesLocalAndBackgroundResults();
    testThemeDefaultsToSystemMode();
    testPopupUsesTokenizedStylesheetWithoutInlineOverrides();
    testSelectionRailIsSeparateFromFaviconColumn();
    testQuickSearchInputDoesNotDrawNestedFocusRing();
    testSettingsShortcutButtonCanFitTextLabel();
    testSettingsInlineLabelsKeepTooltipIconsAligned();
    testPopupBookmarkCountDoesNotWrapOrCollapse();
    console.log('smartbookmark regression tests passed');
}

run().catch(error => {
    console.error(error);
    process.exit(1);
});
