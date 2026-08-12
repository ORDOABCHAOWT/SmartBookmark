const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

function createStorageArea(initial = {}) {
    const state = JSON.parse(JSON.stringify(initial));
    return {
        state,
        async get(keys) {
            if (keys === undefined || keys === null) return { ...state };
            if (typeof keys === 'string') return { [keys]: state[keys] };
            if (Array.isArray(keys)) {
                return Object.fromEntries(keys.map(key => [key, state[key]]));
            }
            return Object.fromEntries(Object.keys(keys).map(key => [
                key,
                state[key] === undefined ? keys[key] : state[key]
            ]));
        },
        async set(values) {
            Object.assign(state, JSON.parse(JSON.stringify(values)));
        },
        async remove(keys) {
            for (const key of Array.isArray(keys) ? keys : [keys]) delete state[key];
        }
    };
}

function loadConfigManager(syncState, localState) {
    const source = fs.readFileSync(path.join(root, 'config.js'), 'utf8');
    const sync = createStorageArea(syncState);
    const local = createStorageArea(localState);
    const sandbox = {
        console,
        URL,
        chrome: { storage: { sync, local } },
        logger: { debug() {}, info() {}, warn() {}, error() {} },
        isSecureEndpointUrl(value) {
            try {
                const url = new URL(value);
                return url.protocol === 'https:' ||
                    (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname));
            } catch {
                return false;
            }
        },
        fetch: async () => { throw new Error('Unexpected fetch'); }
    };
    vm.runInNewContext(`${source}\nglobalThis.ConfigManager = ConfigManager;`, sandbox);
    sandbox.ConfigManager._secretsMigrated = true;
    return { ConfigManager: sandbox.ConfigManager, sync, local };
}

function customService(baseUrl, apiKey) {
    return {
        id: 'victim',
        name: 'Victim service',
        baseUrl,
        chatModel: 'chat-model',
        embedModel: 'embed-model',
        highSimilarity: 0.35,
        hideLowSimilarity: false,
        ...(apiKey ? { apiKey } : {})
    };
}

test('a merged custom service cannot carry a local key or active selection to a new origin', async () => {
    const { ConfigManager, sync, local } = loadConfigManager({
        customServices: { victim: customService('https://legit.example/v1/') },
        serviceTypes: { chat: 'victim', embedding: 'victim' },
        activeService: 'victim'
    }, {
        secret_custom_service_api_keys: { victim: 'sk-local-secret' },
        secret_builtin_api_keys: {},
        secret_storage_migration_v1: true
    });

    await ConfigManager.importServiceData({
        customServices: { victim: customService('https://attacker.invalid/v1/') }
    }, false);

    assert.equal(local.state.secret_custom_service_api_keys.victim, undefined);
    assert.equal(sync.state.serviceTypes.chat, null);
    assert.equal(sync.state.serviceTypes.embedding, null);
    assert.equal(sync.state.activeService, null);
    assert.equal(sync.state.customServices.victim.baseUrl, 'https://attacker.invalid/v1/');
});

test('same-origin service path updates retain the local key and active selections', async () => {
    const { ConfigManager, sync, local } = loadConfigManager({
        customServices: { victim: customService('https://legit.example/v1/') },
        serviceTypes: { chat: 'victim', embedding: 'victim' },
        activeService: 'victim'
    }, {
        secret_custom_service_api_keys: { victim: 'sk-local-secret' },
        secret_builtin_api_keys: {},
        secret_storage_migration_v1: true
    });

    await ConfigManager.importServiceData({
        customServices: { victim: customService('https://legit.example/v2/') }
    }, false);

    assert.equal(local.state.secret_custom_service_api_keys.victim, 'sk-local-secret');
    assert.equal(sync.state.serviceTypes.chat, 'victim');
    assert.equal(sync.state.serviceTypes.embedding, 'victim');
    assert.equal(sync.state.activeService, 'victim');
});

test('file and WebDAV merges both use the hardened service import boundary', () => {
    const fileImport = fs.readFileSync(path.join(root, 'importExport.js'), 'utf8');
    const webdavImport = fs.readFileSync(path.join(root, 'webdavSync.js'), 'utf8');

    assert.match(fileImport, /ConfigManager\.importServiceData\(data\.apiServices, isOverwrite\)/);
    assert.match(webdavImport, /ConfigManager\.importServiceData\(configData\.apiServices, overwrite\)/);
});

function loadAiMetaFiller({ privacy, bookmarks }) {
    const source = fs.readFileSync(path.join(root, 'aiMetaFiller.js'), 'utf8');
    let llmCalls = 0;
    let bookmarkReads = 0;
    const sandbox = {
        console,
        URL,
        AbortController,
        setTimeout,
        clearTimeout,
        logger: { debug() {}, info() {}, warn() {}, error() {} },
        SettingsManager: {
            async get(path) {
                if (path === 'privacy') return privacy;
                if (path === 'privacy.aiMetadataIndexing') return privacy.aiMetadataIndexing;
                return undefined;
            }
        },
        ConfigManager: {
            async getChatService() {
                return { apiKey: 'test-key', chatModel: 'test-model' };
            }
        },
        async getAllBookmarks() {
            bookmarkReads++;
            return bookmarks;
        },
        async getChatCompletion() {
            llmCalls++;
            return JSON.stringify({ topics: ['测试'], synonyms: ['test'], purpose: '测试用途' });
        },
        containsPrivateContent(url) {
            return new URL(url).hostname === 'private.example';
        },
        isNonMarkableUrl() { return false; },
        BookmarkSource: { CHROME: 'chrome' },
        LocalStorageMgr: { async get() { return {}; }, async set() {}, async updateBookmarksAndEmbedding() {} }
    };
    vm.runInNewContext(`${source}\nglobalThis.AiMetaFiller = AiMetaFiller;`, sandbox);
    const filler = new sandbox.AiMetaFiller();
    filler._throttle = async () => {};
    filler._persist = async () => {};
    return {
        filler,
        metrics: () => ({ llmCalls, bookmarkReads })
    };
}

test('background AI metadata indexing is disabled until the user explicitly opts in', async () => {
    const { filler, metrics } = loadAiMetaFiller({
        privacy: { aiMetadataIndexing: false, enabled: false, autoDetect: true, customDomains: [] },
        bookmarks: {
            one: { url: 'https://public.example/', title: 'Public', source: 'extension' }
        }
    });

    const result = await filler.start();
    assert.equal(result.reason, 'not-enabled');
    assert.deepEqual(metrics(), { llmCalls: 0, bookmarkReads: 0 });
});

test('opted-in indexing skips automatic and custom privacy domains', async () => {
    const { filler, metrics } = loadAiMetaFiller({
        privacy: {
            aiMetadataIndexing: true,
            enabled: false,
            autoDetect: true,
            customDomains: ['*.custom-private.example']
        },
        bookmarks: {
            public: { url: 'https://public.example/', title: 'Public', source: 'extension' },
            automatic: { url: 'https://private.example/', title: 'Private', source: 'extension' },
            custom: { url: 'https://account.custom-private.example/', title: 'Custom private', source: 'extension' }
        }
    });

    const result = await filler.start();
    assert.equal(result.filled, 1);
    assert.deepEqual(metrics(), { llmCalls: 1, bookmarkReads: 1 });
});

test('the settings UI exposes a default-off disclosure and opt-in control', () => {
    const defaults = fs.readFileSync(path.join(root, 'settingsManager.js'), 'utf8');
    const html = fs.readFileSync(path.join(root, 'settings.html'), 'utf8');
    const settings = fs.readFileSync(path.join(root, 'settings.js'), 'utf8');

    assert.match(defaults, /aiMetadataIndexing:\s*false/);
    assert.match(html, /id=["']ai-metadata-indexing["']/);
    assert.match(html, /标题、URL、标签和摘要/);
    assert.match(settings, /privacy\.aiMetadataIndexing/);
    assert.match(settings, /START_AI_META_FILLER/);
});
