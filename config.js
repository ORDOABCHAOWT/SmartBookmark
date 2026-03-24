// API 服务配置
const API_SERVICES = {
    OPENAI: {
        id: 'openai',
        name: 'OpenAI',
        description: 'OpenAI大模型，由OpenAI提供',
        baseUrl: 'https://api.openai.com/v1/',
        defaultEmbedModel: 'text-embedding-3-small',
        defaultChatModel: 'gpt-3.5-turbo',
        embedModel: 'text-embedding-3-small',
        chatModel: 'gpt-3.5-turbo',
        logo: 'logo-openai.svg',
        similarityThreshold: {
            MAX: 0.7,
            HIGH: 0.50,
            MEDIUM: 0.35,
            LOW: 0.2
        },
        getKeyUrl: 'https://platform.openai.com/api-keys',
        pricingUrl: 'https://openai.com/api/pricing/',
        recommendTags: []
    },
    GLM: {
        id: 'glm',
        name: '智谱AI',
        description: '智谱GLM大模型，由智谱AI提供',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4/',
        defaultEmbedModel: 'embedding-2',
        defaultChatModel: 'glm-4-flash',
        embedModel: 'embedding-2',
        chatModel: 'glm-4-flash',
        logo: 'logo-glm.svg',
        similarityThreshold: {
            MAX: 0.7,
            HIGH: 0.55,
            MEDIUM: 0.30,
            LOW: 0.2
        },
        getKeyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
        pricingUrl: 'https://open.bigmodel.cn/pricing',
        recommendTags: ['免费模型']
    },
    DASHSCOPE: {
        id: 'dashscope',
        name: '阿里云百炼',
        description: '阿里云百炼大模型平台，它集成了通义系列大模型和第三方大模型',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/',
        defaultEmbedModel: 'text-embedding-v3',
        defaultChatModel: 'qwen-plus',
        embedModel: 'text-embedding-v3',
        chatModel: 'qwen-plus',
        logo: 'logo-dashscope.svg',
        similarityThreshold: {
            MAX: 0.85,
            HIGH: 0.65,
            MEDIUM: 0.50,
            LOW: 0.4
        },
        getKeyUrl: 'https://bailian.console.aliyun.com/cn-beijing/?apiKey=1&tab=model#/api-key',
        pricingUrl: 'https://help.aliyun.com/zh/model-studio/getting-started/models',
        recommendTags: ['模型丰富', '稳定', '赠送Token']
    },
    SILICONFLOW: {
        id: 'siliconflow',
        name: '硅基流动',
        description: 'SiliconCloud 硅基流动云服务，高效、模型丰富、性价比高的大模型服务平台',
        baseUrl: 'https://api.siliconflow.cn/v1',
        defaultEmbedModel: 'BAAI/bge-m3',
        defaultChatModel: 'Qwen/Qwen2.5-7B-Instruct',
        embedModel: 'BAAI/bge-m3',
        chatModel: 'Qwen/Qwen2.5-7B-Instruct',
        logo: 'logo-siliconflow.svg',
        similarityThreshold: {
            MAX: 0.85,
            HIGH: 0.60,
            MEDIUM: 0.50,
            LOW: 0.4
        },
        getKeyUrl: 'https://cloud.siliconflow.cn/account/ak',
        pricingUrl: 'https://cloud.siliconflow.cn/models',
        recommendTags: ['免费模型', '模型丰富']
    },
    HUNYUAN: {
        id: 'hunyuan',
        name: '腾讯混元',
        description: '腾讯混元大模型，由腾讯云提供',
        baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
        defaultEmbedModel: 'hunyuan-embedding',
        defaultChatModel: 'hunyuan-standard-256K',
        embedModel: 'hunyuan-embedding',
        chatModel: 'hunyuan-standard-256K',
        logo: 'logo-hunyuan.svg',
        similarityThreshold: {
            MAX: 0.85,
            HIGH: 0.60,
            MEDIUM: 0.40,
            LOW: 0.35
        },
        getKeyUrl: 'https://console.cloud.tencent.com/hunyuan/api-key',
        pricingUrl: 'https://cloud.tencent.com/document/product/1729/97731',
        recommendTags: []
    }
};

function getHeaders(key) {
    return {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
    };
}

function joinUrl(baseUrl, path) {
    if (baseUrl.endsWith('/')) {
        return baseUrl + path;
    }
    return baseUrl + '/' + path;
}

const MAX_CUSTOM_SERVICES = 11;

class ConfigManager {
    static STORAGE = chrome.storage.sync;
    static SECRET_STORAGE = chrome.storage.local;
    static _secretMigrationPromise = null;
    static _secretsMigrated = false;
    
    static STORAGE_KEYS = {
        ACTIVE_SERVICE: 'activeService',
        API_KEYS: 'apiKeys',
        BUILTIN_SERVICES_SETTINGS: 'builtinServicesSettings',
        CUSTOM_SERVICES: 'customServices',
        PINNED_SITES: 'pinnedSites',
        SERVICE_TYPES: 'serviceTypes'
    };

    static SECRET_STORAGE_KEYS = {
        BUILTIN_API_KEYS: 'secret_builtin_api_keys',
        CUSTOM_SERVICE_API_KEYS: 'secret_custom_service_api_keys',
        MIGRATION_DONE: 'secret_storage_migration_v1'
    };

    static async getServiceExportData() {
        await this.ensureSecretsStoredLocally();

        const exportKeys = [
            this.STORAGE_KEYS.ACTIVE_SERVICE,
            this.STORAGE_KEYS.BUILTIN_SERVICES_SETTINGS,
            this.STORAGE_KEYS.SERVICE_TYPES
        ];
        try {
            const data = await this.STORAGE.get(exportKeys);
            const customServices = await this.getStoredCustomServices();
            if (Object.keys(customServices).length > 0) {
                data[this.STORAGE_KEYS.CUSTOM_SERVICES] = customServices;
            }
            logger.debug('获取服务导出数据:', data);
            return data;
        } catch (error) {
            logger.error('获取服务导出数据失败:', error);
            return {};
        }
    }

    static async getConfigExportData() {
        const exportKeys = [
            this.STORAGE_KEYS.PINNED_SITES
        ];
        try {
            const data = await this.STORAGE.get(exportKeys);
            logger.debug('获取配置导出数据:', data);
            return data;
        } catch (error) {
            logger.error('获取配置导出数据失败:', error);
            return {};
        }
    }

    static getBuiltinServiceIds() {
        return Object.values(API_SERVICES).map(service => service.id);
    }

    static isBuiltinServiceId(serviceId) {
        return this.getBuiltinServiceIds().includes(serviceId);
    }

    static isValidServiceId(serviceId, customServices = {}) {
        if (!serviceId) {
            return false;
        }
        return this.isBuiltinServiceId(serviceId) || Boolean(customServices[serviceId]);
    }

    static normalizeCustomServiceConfig(serviceId, config, options = {}) {
        const allowMissingApiKey = options.allowMissingApiKey === true;
        if (!config || typeof config !== 'object') {
            throw new Error('无效的自定义服务配置');
        }

        const normalizedConfig = {
            id: typeof serviceId === 'string' && serviceId.trim() ?
                serviceId.trim() :
                (typeof config.id === 'string' ? config.id.trim() : ''),
            name: typeof config.name === 'string' ? config.name.trim() : '',
            baseUrl: typeof config.baseUrl === 'string' ? config.baseUrl.trim() : '',
            chatModel: typeof config.chatModel === 'string' ? config.chatModel.trim() : '',
            embedModel: typeof config.embedModel === 'string' ? config.embedModel.trim() : '',
            apiKey: typeof config.apiKey === 'string' ? config.apiKey.trim() : '',
            highSimilarity: Number.parseFloat(config.highSimilarity),
            hideLowSimilarity: config.hideLowSimilarity === true
        };

        if (!normalizedConfig.id) {
            throw new Error('无效的服务ID');
        }
        if (!normalizedConfig.name || !normalizedConfig.baseUrl || (!allowMissingApiKey && !normalizedConfig.apiKey)) {
            throw new Error('请填写服务名称、API接口地址和API Key');
        }
        if (!normalizedConfig.chatModel && !normalizedConfig.embedModel) {
            throw new Error('文本模型和向量模型至少填写一个');
        }
        if (!isSecureEndpointUrl(normalizedConfig.baseUrl, { allowHttpLocalhost: true })) {
            throw new Error('出于安全考虑，自定义服务地址必须使用 HTTPS，本地回环地址可使用 HTTP');
        }

        if (Number.isNaN(normalizedConfig.highSimilarity)) {
            normalizedConfig.highSimilarity = 0.35;
        } else {
            normalizedConfig.highSimilarity = Math.min(1, Math.max(0, normalizedConfig.highSimilarity));
        }

        return normalizedConfig;
    }

    static sanitizeCustomServicesMap(services, options = {}) {
        if (!services || typeof services !== 'object') {
            return {};
        }

        const sanitizedServices = {};
        for (const [serviceId, serviceConfig] of Object.entries(services)) {
            try {
                const normalizedService = this.normalizeCustomServiceConfig(serviceId, serviceConfig, options);
                sanitizedServices[normalizedService.id] = normalizedService;
            } catch (error) {
                logger.warn('跳过无效的自定义服务配置', {
                    serviceId,
                    error: error.message
                });
            }
        }

        return sanitizedServices;
    }

    static stripCustomServiceSecret(config) {
        if (!config || typeof config !== 'object') {
            return config;
        }
        const { apiKey, ...serviceWithoutSecret } = config;
        return serviceWithoutSecret;
    }

    static async getSecretMap(secretKey) {
        try {
            const data = await this.SECRET_STORAGE.get(secretKey);
            const secretMap = data[secretKey];
            if (!secretMap || typeof secretMap !== 'object') {
                return {};
            }
            return secretMap;
        } catch (error) {
            logger.error('获取本地敏感配置失败:', error);
            return {};
        }
    }

    static async setSecretMap(secretKey, secretMap) {
        await this.SECRET_STORAGE.set({
            [secretKey]: secretMap
        });
    }

    static async getStoredCustomServices() {
        const data = await this.STORAGE.get(this.STORAGE_KEYS.CUSTOM_SERVICES);
        const customServices = this.sanitizeCustomServicesMap(
            data[this.STORAGE_KEYS.CUSTOM_SERVICES],
            { allowMissingApiKey: true }
        );
        return Object.fromEntries(
            Object.entries(customServices).map(([serviceId, serviceConfig]) => [
                serviceId,
                this.stripCustomServiceSecret(serviceConfig)
            ])
        );
    }

    static async ensureSecretsStoredLocally() {
        if (this._secretsMigrated) {
            return;
        }
        if (this._secretMigrationPromise) {
            await this._secretMigrationPromise;
            return;
        }

        this._secretMigrationPromise = (async () => {
            try {
                const migrationFlagData = await this.SECRET_STORAGE.get(this.SECRET_STORAGE_KEYS.MIGRATION_DONE);
                const migrationDone = migrationFlagData[this.SECRET_STORAGE_KEYS.MIGRATION_DONE] === true;
                const syncData = await this.STORAGE.get([
                    this.STORAGE_KEYS.API_KEYS,
                    this.STORAGE_KEYS.CUSTOM_SERVICES
                ]);

                const legacyBuiltinApiKeys = syncData[this.STORAGE_KEYS.API_KEYS] || {};
                const legacyCustomServices = syncData[this.STORAGE_KEYS.CUSTOM_SERVICES] || {};
                const hasLegacyBuiltinApiKeys = Object.keys(legacyBuiltinApiKeys).length > 0;
                const hasLegacyCustomServiceSecrets = Object.values(legacyCustomServices).some(service =>
                    service &&
                    typeof service === 'object' &&
                    typeof service.apiKey === 'string' &&
                    service.apiKey.trim().length > 0
                );

                if (migrationDone && !hasLegacyBuiltinApiKeys && !hasLegacyCustomServiceSecrets) {
                    this._secretsMigrated = true;
                    return;
                }

                const builtinApiKeys = await this.getSecretMap(this.SECRET_STORAGE_KEYS.BUILTIN_API_KEYS);
                const customServiceApiKeys = await this.getSecretMap(this.SECRET_STORAGE_KEYS.CUSTOM_SERVICE_API_KEYS);
                let secretChanged = false;

                for (const [serviceId, apiKey] of Object.entries(legacyBuiltinApiKeys)) {
                    if (!this.isBuiltinServiceId(serviceId) || typeof apiKey !== 'string' || !apiKey.trim()) {
                        continue;
                    }
                    builtinApiKeys[serviceId] = apiKey.trim();
                    secretChanged = true;
                }

                const sanitizedCustomServices = {};
                let customServicesChanged = false;
                for (const [serviceId, serviceConfig] of Object.entries(legacyCustomServices)) {
                    if (!serviceConfig || typeof serviceConfig !== 'object') {
                        continue;
                    }
                    const nextConfig = { ...serviceConfig };
                    if (typeof nextConfig.apiKey === 'string' && nextConfig.apiKey.trim()) {
                        customServiceApiKeys[serviceId] = nextConfig.apiKey.trim();
                        secretChanged = true;
                    }
                    if (Object.prototype.hasOwnProperty.call(nextConfig, 'apiKey')) {
                        delete nextConfig.apiKey;
                        customServicesChanged = true;
                    }
                    sanitizedCustomServices[serviceId] = nextConfig;
                }

                if (secretChanged) {
                    await this.SECRET_STORAGE.set({
                        [this.SECRET_STORAGE_KEYS.BUILTIN_API_KEYS]: builtinApiKeys,
                        [this.SECRET_STORAGE_KEYS.CUSTOM_SERVICE_API_KEYS]: customServiceApiKeys
                    });
                }

                if (hasLegacyBuiltinApiKeys) {
                    await this.STORAGE.remove(this.STORAGE_KEYS.API_KEYS);
                }

                if (customServicesChanged) {
                    await this.STORAGE.set({
                        [this.STORAGE_KEYS.CUSTOM_SERVICES]: sanitizedCustomServices
                    });
                }

                await this.SECRET_STORAGE.set({
                    [this.SECRET_STORAGE_KEYS.MIGRATION_DONE]: true
                });
                this._secretsMigrated = true;
            } catch (error) {
                logger.error('迁移本地敏感配置失败:', error);
                throw error;
            } finally {
                this._secretMigrationPromise = null;
            }
        })();

        await this._secretMigrationPromise;
    }

    // 通过API_SERVICES的id获取服务对象
    static findBuiltinServiceById(serviceId) {
        return Object.values(API_SERVICES).find(s => s.id === serviceId);
    }

    static async findServiceById(serviceId) {
        if (!serviceId) {
            return null;
        }
        // 检查是否是内置服务
        const builtInService = this.findBuiltinServiceById(serviceId);
        if (builtInService) {
            builtInService.apiKey = await this.getBuiltinAPIKey(serviceId);
            const setting = await this.getBuiltinServiceSettingByServiceId(serviceId);
            builtInService.chatModel = setting?.chatModel || builtInService.defaultChatModel;
            return builtInService;
        }

        // 检查是否是自定义服务
        const customServices = await this.getCustomServices();
        return customServices[serviceId] || null;
    }

    // 获取当前激活的服务
    static async getActiveService() {
        try {
            const data = await this.STORAGE.get(this.STORAGE_KEYS.ACTIVE_SERVICE);
            let activeServiceId = data[this.STORAGE_KEYS.ACTIVE_SERVICE];

            let service = await this.findServiceById(activeServiceId);
            if (service) {
                return service;
            }

            activeServiceId = API_SERVICES.DASHSCOPE.id;
            service = await this.findServiceById(activeServiceId);
            return service;
        } catch (error) {
            logger.error('获取当前服务失败:', error);
            return API_SERVICES.OPENAI;
        }
    }

    // 新增：获取服务类型配置
    static async getServiceTypeConfig() {
        try {
            const data = await this.STORAGE.get(this.STORAGE_KEYS.SERVICE_TYPES);
            const serviceTypes = data[this.STORAGE_KEYS.SERVICE_TYPES] || {
                chat: null, // 默认为null，表示使用activeService
                embedding: null // 默认为null，表示使用activeService
            };
            return serviceTypes;
        } catch (error) {
            logger.error('获取服务类型配置失败:', error);
            return { chat: null, embedding: null };
        }
    }

    // 新增：设置特定类型的服务
    static async setServiceType(type, serviceId) {
        if (!['chat', 'embedding'].includes(type)) {
            throw new Error('无效的服务类型');
        }
        
        if (serviceId !== null) {
            // 验证服务ID是否有效
            const service = await this.findServiceById(serviceId);
            if (!service) {
                throw new Error('无效的服务ID');
            }
        }
        
        try {
            const serviceTypes = await this.getServiceTypeConfig();
            serviceTypes[type] = serviceId;
            
            await this.STORAGE.set({
                [this.STORAGE_KEYS.SERVICE_TYPES]: serviceTypes
            });
            
            return serviceTypes;
        } catch (error) {
            logger.error(`设置${type}服务失败:`, error);
            throw error;
        }
    }

    // 新增：获取特定类型的服务
    static async getServiceByType(type) {
        if (!['chat', 'embedding'].includes(type)) {
            throw new Error('无效的服务类型');
        }
        
        try {
            const serviceTypes = await this.getServiceTypeConfig();
            const serviceId = serviceTypes[type];
            
            // 如果没有为该类型设置特定服务，则使用活跃服务
            if (serviceId === null) {
                return await this.getActiveService();
            }
            
            const service = await this.findServiceById(serviceId);
            if (!service) {
                // 如果找不到服务，回退到活跃服务
                return await this.getActiveService();
            }
            
            return service;
        } catch (error) {
            logger.error(`获取${type}服务失败:`, error);
            // 出错时回退到活跃服务
            return await this.getActiveService();
        }
    }

    // 新增：获取Chat服务
    static async getChatService() {
        return await this.getServiceByType('chat');
    }

    // 新增：获取Embedding服务
    static async getEmbeddingService() {
        return await this.getServiceByType('embedding');
    }

    // 新增：根据服务类型获取API Key
    static async getAPIKeyByType(type) {
        try {
            const service = await this.getServiceByType(type);
            return service.apiKey;
        } catch (error) {
            logger.error(`获取${type}服务API Key失败:`, error);
            return null;
        }
    }
    
    // 新增：获取Chat服务的API Key
    static async getChatAPIKey() {
        return await this.getAPIKeyByType('chat');
    }
    
    // 新增：获取Embedding服务的API Key
    static async getEmbeddingAPIKey() {
        return await this.getAPIKeyByType('embedding');
    }

    static async getBuiltinAPIKey(serviceId) {
        try {
            await this.ensureSecretsStoredLocally();
            const apiKeys = await this.getSecretMap(this.SECRET_STORAGE_KEYS.BUILTIN_API_KEYS);
            return apiKeys[serviceId] || null;
        } catch (error) {
            logger.error('获取内置服务 API Key 失败:', error);
            return null;
        }
    }

    static async getBuiltinServiceSettings() {
        try {
            const data = await this.STORAGE.get(this.STORAGE_KEYS.BUILTIN_SERVICES_SETTINGS);
            return data[this.STORAGE_KEYS.BUILTIN_SERVICES_SETTINGS] || {};
        } catch (error) {
            logger.error('获取内置服务设置失败:', error);
            return {};
        }
    }

    static async getBuiltinServiceSettingByServiceId(serviceId) {
        const serviceSettings = await this.getBuiltinServiceSettings();
        return serviceSettings[serviceId] || null;
    }

    // 设置 API Key
    static async saveBuiltinAPIKey(serviceId, apiKey, setting) {
        try {
            const service = this.findBuiltinServiceById(serviceId);
            if (!service) {
                throw new Error('无效的服务ID');
            }

            // 验证 API Key 是否可用
            await this.verifyAPIKey(serviceId, apiKey, setting?.chatModel);

            await this.ensureSecretsStoredLocally();
            const apiKeys = await this.getSecretMap(this.SECRET_STORAGE_KEYS.BUILTIN_API_KEYS);

            // 更新数据
            apiKeys[serviceId] = apiKey.trim();
            await this.setSecretMap(this.SECRET_STORAGE_KEYS.BUILTIN_API_KEYS, apiKeys);
            await this.STORAGE.remove(this.STORAGE_KEYS.API_KEYS);

            // 更新service设置
            const serviceSettings = await this.getBuiltinServiceSettings();
            serviceSettings[serviceId] = setting;
            await this.STORAGE.set({
                [this.STORAGE_KEYS.BUILTIN_SERVICES_SETTINGS]: serviceSettings
            });
        } catch (error) {
            logger.error('保存 API Key 失败:', error);
            throw error;
        }
    }

    // 验证 API Key
    static async verifyAPIKey(serviceId, apiKey, chatModel) {
        const service = this.findBuiltinServiceById(serviceId);
        if (!service) {
            throw new Error('无效的服务ID');
        }

        try {
            await this.testChatAPI(service.baseUrl, apiKey, chatModel);
            await this.testEmbeddingAPI(service.baseUrl, apiKey, service.embedModel);
        } catch (error) {
            logger.error('API Key 验证失败:', error);
            throw new Error(`验证失败: ${error.message}`);
        }
    }

    // 添加新方法用于获取自定义服务配置
    static async getCustomServices() {
        try {
            await this.ensureSecretsStoredLocally();
            const customServices = await this.getStoredCustomServices();
            const customServiceApiKeys = await this.getSecretMap(this.SECRET_STORAGE_KEYS.CUSTOM_SERVICE_API_KEYS);
            for (const service of Object.values(customServices)) {
                service.isCustom = true;
                service.apiKey = customServiceApiKeys[service.id] || '';
            }
            return customServices;
        } catch (error) {
            logger.error('获取自定义服务配置失败:', error);
            return {};
        }
    }

    // 添加新方法用于保存自定义服务配置
    static async saveCustomService(config) {
        try {
            const normalizedConfig = this.normalizeCustomServiceConfig(config.id, config);
            await this.ensureSecretsStoredLocally();
            const customServices = await this.getStoredCustomServices();
            if (customServices[normalizedConfig.id]) {
                customServices[normalizedConfig.id] = this.stripCustomServiceSecret(normalizedConfig);
            } else {
                if (Object.keys(customServices).length >= MAX_CUSTOM_SERVICES) {
                    throw new Error('自定义服务数量已达到最大限制');
                }
                customServices[normalizedConfig.id] = this.stripCustomServiceSecret(normalizedConfig);
            }

            const customServiceApiKeys = await this.getSecretMap(this.SECRET_STORAGE_KEYS.CUSTOM_SERVICE_API_KEYS);
            customServiceApiKeys[normalizedConfig.id] = normalizedConfig.apiKey.trim();

            await this.STORAGE.set({
                [this.STORAGE_KEYS.CUSTOM_SERVICES]: customServices
            });
            await this.setSecretMap(this.SECRET_STORAGE_KEYS.CUSTOM_SERVICE_API_KEYS, customServiceApiKeys);
        } catch (error) {
            logger.error('保存自定义服务配置失败:', error);
            throw error;
        }
    }

    static async deleteCustomService(serviceId) {
        try {
            const customServices = await this.getStoredCustomServices();
            
            // 检查服务是否存在
            if (!customServices[serviceId]) {
                throw new Error('服务不存在');
            }

            // 如果是当前激活的服务，需要切换到默认服务
            const serviceTypes = await this.getServiceTypeConfig();
            if (serviceTypes.chat === serviceId) {
                await this.setServiceType('chat', API_SERVICES.OPENAI.id);
            }
            if (serviceTypes.embedding === serviceId) {
                await this.setServiceType('embedding', API_SERVICES.OPENAI.id);
            }

            // 删除服务
            delete customServices[serviceId];
            await this.STORAGE.set({
                [this.STORAGE_KEYS.CUSTOM_SERVICES]: customServices
            });
            const customServiceApiKeys = await this.getSecretMap(this.SECRET_STORAGE_KEYS.CUSTOM_SERVICE_API_KEYS);
            delete customServiceApiKeys[serviceId];
            await this.setSecretMap(this.SECRET_STORAGE_KEYS.CUSTOM_SERVICE_API_KEYS, customServiceApiKeys);
        } catch (error) {
            logger.error('删除自定义服务失败:', error);
            throw error;
        }
    }

    // 测试自定义服务的chat接口
    static async testChatAPI(baseUrl, apiKey, chatModel) {
        try {
            try {
                new URL(baseUrl);
            } catch (error) {
                throw new Error('无效的API服务URL');
            }
            if (!isSecureEndpointUrl(baseUrl, { allowHttpLocalhost: true })) {
                throw new Error('出于安全考虑，自定义服务地址必须使用 HTTPS，本地回环地址可使用 HTTP');
            }
            if (!apiKey) {
                throw new Error('API Key 不能为空');
            }
            if (!chatModel) {
                throw new Error('Chat 模型不能为空');
            }
            const response = await fetch(joinUrl(baseUrl, 'chat/completions'), {
                method: 'POST',
                headers: getHeaders(apiKey),
                body: JSON.stringify({
                    model: chatModel,
                    messages: [{
                        role: "user",
                        content: "Hello"
                    }]
                })
            });

            if (!response.ok) {
                let errorMessage = response.statusText || `API 返回状态码: ${response.status}` || '未知错误';
                try {
                    const data = await response.json();
                    logger.debug('Chat接口测试失败:', {
                        data: data,
                        status: response.status,
                        statusText: response.statusText
                    });
                    // 如果data是字符串，则直接使用
                    if (typeof data === 'string') {
                        errorMessage = data;
                    } else {
                        errorMessage = data.error?.message || data.message || errorMessage;
                    }
                } catch (error) {
                    logger.debug('获取错误信息失败:', error);
                }
                throw new Error(errorMessage);
            } else {
                try {
                    const data = await response.json();
                    // 检查数据格式是否满足openai的格式
                    if (!data.choices || !data.choices[0] || !data.choices[0].message || !data.choices[0].message.content) {
                        logger.debug('Chat接口数据格式错误:', {
                            data: data
                        });
                        throw new Error('API 返回数据格式错误');
                    }
                } catch (error) {
                    throw new Error('API 返回数据格式错误');
                }
            }

            return true;
        } catch (error) {
            throw new Error(`${error.message}`);
        }
    }

    // 测试自定义服务的embedding接口
    static async testEmbeddingAPI(baseUrl, apiKey, embedModel) {
        try {
            try {
                new URL(baseUrl);
            } catch (error) {
                throw new Error('无效的API服务URL');
            }
            if (!isSecureEndpointUrl(baseUrl, { allowHttpLocalhost: true })) {
                throw new Error('出于安全考虑，自定义服务地址必须使用 HTTPS，本地回环地址可使用 HTTP');
            }
            if (!apiKey) {
                throw new Error('API Key 不能为空');
            }
            if (!embedModel) {
                throw new Error('Embedding 模型不能为空');
            }
            const response = await fetch(joinUrl(baseUrl, 'embeddings'), {
                method: 'POST',
                headers: getHeaders(apiKey),
                body: JSON.stringify({
                    model: embedModel,
                    input: "test"
                })
            });

            if (!response.ok) {
                let errorMessage = response.statusText || `API 返回状态码: ${response.status}` || '未知错误';
                try {
                    const data = await response.json();
                    logger.debug('Embedding接口测试失败:', {
                        data: data,
                        status: response.status,
                        statusText: response.statusText
                    });
                    // 如果data是字符串，则直接使用
                    if (typeof data === 'string') {
                        errorMessage = data;
                    } else {
                        errorMessage = data.error?.message || data.message || errorMessage;
                    }
                } catch (error) {
                    logger.debug('获取错误信息失败:', error);
                }
                throw new Error(errorMessage);
            } else {
                try {
                    const data = await response.json();
                    // 检查数据格式是否满足 data.data[0].embedding
                    if (!data.data || !data.data[0] || !data.data[0].embedding) {
                        logger.debug('Embedding接口数据格式错误:', {
                            data: data
                        });
                        throw new Error('API 返回数据格式错误');
                    }
                } catch (error) {
                    throw new Error('API 返回数据格式错误');
                }
            }

            return true;
        } catch (error) {
            throw new Error(`${error.message}`);
        }
    }

    static isNeedUpdateEmbedding(bookmark, activeService) {
        if (!bookmark.embedding) {
            return true;
        }

        if (bookmark.apiService !== activeService.id) {
            return true;
        }

        const oldEmbedModel = bookmark.embedModel ? bookmark.embedModel : activeService.defaultEmbedModel;
        const newEmbedModel = activeService.embedModel;
        if (oldEmbedModel !== newEmbedModel) {
            return true;
        }

        return false;
    }

    // 新增：使用当前embedding服务检查是否需要更新embedding
    static async isNeedUpdateEmbeddingWithCurrentService(bookmark) {
        if (!bookmark) {
            return false;
        }
        
        try {
            const embeddingService = await this.getEmbeddingService();
            if (!embeddingService || !embeddingService.apiKey) {
                return false;
            }
            return this.isNeedUpdateEmbedding(bookmark, embeddingService);
        } catch (error) {
            logger.error('检查是否需要更新embedding失败:', error);
            return false; // 安全起见，返回false以确保不更新
        }
    }

    // 获取常用网站列表
    static async getPinnedSites() {
        try {
            const data = await this.STORAGE.get(this.STORAGE_KEYS.PINNED_SITES);
            return data[this.STORAGE_KEYS.PINNED_SITES] || [];
        } catch (error) {
            logger.error('获取常用网站失败:', error);
            return [];
        }
    }

    // 保存常用网站列表
    static async savePinnedSites(sites) {
        try {
            if (sites.length > MAX_PINNED_SITES) {
                throw new Error(`最多只能固定 ${MAX_PINNED_SITES} 个网站`);
            }
            await this.STORAGE.set({
                [this.STORAGE_KEYS.PINNED_SITES]: sites
            });
        } catch (error) {
            logger.error('保存常用网站失败:', error);
            throw error;
        }
    }

    // 添加常用网站
    static async addPinnedSite(site) {
        try {
            const sites = await this.getPinnedSites();
            if (sites.length >= MAX_PINNED_SITES) {
                throw new Error(`最多只能固定 ${MAX_PINNED_SITES} 个网站`);
            }
            if (!sites.some(s => s.url === site.url)) {
                sites.push(site);
                await this.savePinnedSites(sites);
            }
            return sites;
        } catch (error) {
            logger.error('添加常用网站失败:', error);
            throw error;
        }
    }

    // 移除常用网站
    static async removePinnedSite(url) {
        try {
            const sites = await this.getPinnedSites();
            const index = sites.findIndex(site => site.url === url);
            if (index !== -1) {
                sites.splice(index, 1);
                await this.savePinnedSites(sites);
            }
            return sites;
        } catch (error) {
            logger.error('移除常用网站失败:', error);
            throw error;
        }
    }

    // 检查网站是否已固定
    static async isPinnedSite(url) {
        try {
            const sites = await this.getPinnedSites();
            return sites.some(site => site.url === url);
        } catch (error) {
            logger.error('检查常用网站状态失败:', error);
            return false;
        }
    }

    static async importServiceData(data, isOverwrite = false) {
        try {
            await this.ensureSecretsStoredLocally();
            const importData = {};
            let hasImportedSecrets = false;
            const builtinServiceIds = new Set(this.getBuiltinServiceIds());
            const currentCustomServicesData = !isOverwrite ?
                (await this.STORAGE.get(this.STORAGE_KEYS.CUSTOM_SERVICES))[this.STORAGE_KEYS.CUSTOM_SERVICES] || {} :
                {};
            const currentCustomServices = this.sanitizeCustomServicesMap(currentCustomServicesData, { allowMissingApiKey: true });
            const importedCustomServices = this.sanitizeCustomServicesMap(data?.[this.STORAGE_KEYS.CUSTOM_SERVICES], { allowMissingApiKey: true });

            const currentBuiltinApiKeys = !isOverwrite ?
                await this.getSecretMap(this.SECRET_STORAGE_KEYS.BUILTIN_API_KEYS) :
                {};
            const currentCustomServiceApiKeys = !isOverwrite ?
                await this.getSecretMap(this.SECRET_STORAGE_KEYS.CUSTOM_SERVICE_API_KEYS) :
                {};

            let sanitizedCustomServices = isOverwrite ?
                importedCustomServices :
                { ...currentCustomServices, ...importedCustomServices };

            const serviceEntries = Object.entries(sanitizedCustomServices);
            if (serviceEntries.length > MAX_CUSTOM_SERVICES) {
                logger.warn(`自定义服务数量超过限制(${MAX_CUSTOM_SERVICES})，仅保留前${MAX_CUSTOM_SERVICES}个`);
                sanitizedCustomServices = Object.fromEntries(serviceEntries.slice(0, MAX_CUSTOM_SERVICES));
            }
            if (Object.keys(sanitizedCustomServices).length > 0) {
                importData[this.STORAGE_KEYS.CUSTOM_SERVICES] = Object.fromEntries(
                    Object.entries(sanitizedCustomServices).map(([serviceId, serviceConfig]) => [
                        serviceId,
                        this.stripCustomServiceSecret(serviceConfig)
                    ])
                );
            } else if (isOverwrite && data?.hasOwnProperty(this.STORAGE_KEYS.CUSTOM_SERVICES)) {
                importData[this.STORAGE_KEYS.CUSTOM_SERVICES] = {};
            }

            const collectCustomServiceApiKeys = (services) => {
                if (!services || typeof services !== 'object') {
                    return {};
                }
                return Object.fromEntries(
                    Object.entries(services)
                        .filter(([, serviceConfig]) =>
                            serviceConfig &&
                            typeof serviceConfig === 'object' &&
                            typeof serviceConfig.apiKey === 'string' &&
                            serviceConfig.apiKey.trim().length > 0
                        )
                        .map(([serviceId, serviceConfig]) => [serviceId, serviceConfig.apiKey.trim()])
                );
            };

            const nextCustomServiceApiKeys = isOverwrite ?
                collectCustomServiceApiKeys(data?.[this.STORAGE_KEYS.CUSTOM_SERVICES]) :
                {
                    ...currentCustomServiceApiKeys,
                    ...collectCustomServiceApiKeys(data?.[this.STORAGE_KEYS.CUSTOM_SERVICES])
                };
            const limitedCustomServiceIds = new Set(Object.keys(sanitizedCustomServices));
            const prunedCustomServiceApiKeys = Object.fromEntries(
                Object.entries(nextCustomServiceApiKeys).filter(([serviceId]) => limitedCustomServiceIds.has(serviceId))
            );

            if (data?.hasOwnProperty(this.STORAGE_KEYS.API_KEYS)) {
                const importedApiKeys = data[this.STORAGE_KEYS.API_KEYS];
                const sanitizeBuiltinKeys = (apiKeys) => {
                    if (!apiKeys || typeof apiKeys !== 'object') {
                        return {};
                    }
                    return Object.fromEntries(
                        Object.entries(apiKeys)
                            .filter(([serviceId, apiKey]) =>
                                builtinServiceIds.has(serviceId) &&
                                typeof apiKey === 'string' &&
                                apiKey.trim().length > 0
                            )
                            .map(([serviceId, apiKey]) => [serviceId, apiKey.trim()])
                    );
                };
                const nextBuiltinApiKeys = isOverwrite ?
                    sanitizeBuiltinKeys(importedApiKeys) :
                    {
                        ...sanitizeBuiltinKeys(currentBuiltinApiKeys),
                        ...sanitizeBuiltinKeys(importedApiKeys)
                    };
                await this.setSecretMap(this.SECRET_STORAGE_KEYS.BUILTIN_API_KEYS, nextBuiltinApiKeys);
                hasImportedSecrets = hasImportedSecrets || Object.keys(nextBuiltinApiKeys).length > 0;
            } else if (isOverwrite) {
                await this.setSecretMap(this.SECRET_STORAGE_KEYS.BUILTIN_API_KEYS, currentBuiltinApiKeys);
            }

            await this.setSecretMap(this.SECRET_STORAGE_KEYS.CUSTOM_SERVICE_API_KEYS, prunedCustomServiceApiKeys);
            hasImportedSecrets = hasImportedSecrets || Object.keys(prunedCustomServiceApiKeys).length > 0;
            await this.STORAGE.remove(this.STORAGE_KEYS.API_KEYS);

            if (data?.hasOwnProperty(this.STORAGE_KEYS.BUILTIN_SERVICES_SETTINGS)) {
                const currentSettings = !isOverwrite ? await this.getBuiltinServiceSettings() : {};
                const importedSettings = data[this.STORAGE_KEYS.BUILTIN_SERVICES_SETTINGS];
                const sanitizeBuiltinSettings = (settingsMap) => {
                    if (!settingsMap || typeof settingsMap !== 'object') {
                        return {};
                    }
                    return Object.fromEntries(
                        Object.entries(settingsMap).filter(([serviceId, setting]) =>
                            builtinServiceIds.has(serviceId) &&
                            setting &&
                            typeof setting === 'object'
                        )
                    );
                };
                importData[this.STORAGE_KEYS.BUILTIN_SERVICES_SETTINGS] = isOverwrite ?
                    sanitizeBuiltinSettings(importedSettings) :
                    {
                        ...sanitizeBuiltinSettings(currentSettings),
                        ...sanitizeBuiltinSettings(importedSettings)
                    };
            }

            if (data?.hasOwnProperty(this.STORAGE_KEYS.SERVICE_TYPES)) {
                const currentServiceTypes = !isOverwrite ?
                    await this.getServiceTypeConfig() :
                    { chat: null, embedding: null };
                const importedServiceTypes = data[this.STORAGE_KEYS.SERVICE_TYPES];
                const nextServiceTypes = { ...currentServiceTypes };

                if (importedServiceTypes && typeof importedServiceTypes === 'object') {
                    for (const type of ['chat', 'embedding']) {
                        if (!importedServiceTypes.hasOwnProperty(type)) {
                            continue;
                        }
                        const serviceId = importedServiceTypes[type];
                        if (serviceId === null || this.isValidServiceId(serviceId, sanitizedCustomServices)) {
                            nextServiceTypes[type] = serviceId;
                        } else {
                            logger.warn('跳过无效的服务类型配置', {
                                type,
                                serviceId
                            });
                            if (isOverwrite) {
                                nextServiceTypes[type] = null;
                            }
                        }
                    }
                }

                importData[this.STORAGE_KEYS.SERVICE_TYPES] = nextServiceTypes;
            }

            if (data?.hasOwnProperty(this.STORAGE_KEYS.ACTIVE_SERVICE)) {
                const activeServiceId = data[this.STORAGE_KEYS.ACTIVE_SERVICE];
                if (this.isValidServiceId(activeServiceId, sanitizedCustomServices)) {
                    importData[this.STORAGE_KEYS.ACTIVE_SERVICE] = activeServiceId;
                } else if (isOverwrite && typeof activeServiceId === 'string') {
                    logger.warn('跳过无效的激活服务配置', { activeServiceId });
                }
            }

            // 保存数据
            if (Object.keys(importData).length > 0) {
                await this.STORAGE.set(importData);
                return true;
            }
            return hasImportedSecrets;
        } catch (error) {
            logger.error('导入服务数据失败:', error);
            throw error;
        }
    }

    static async importConfigData(data, isOverwrite = false) {
        if (!data) {
            return;
        }
        try {
            const validKeys = [
                this.STORAGE_KEYS.PINNED_SITES
            ];
            const importData = {};

            for (const key of validKeys) {
                if (data[key]) {
                    if (key === this.STORAGE_KEYS.PINNED_SITES) {
                        // 验证并处理固定网站数据
                        let sites = data[key];
                        if (!Array.isArray(sites)) {
                            continue;
                        }
                        // 验证每个网站对象的格式
                        sites = sites.filter(site => site && typeof site === 'object' && site.url && site.title);
                        if (!isOverwrite) {
                            // 合并模式：获取现有网站
                            const currentSites = await this.getPinnedSites();
                            // 去重合并
                            const urlSet = new Set(currentSites.map(site => site.url));
                            sites = [...currentSites, ...sites.filter(site => !urlSet.has(site.url))];
                        }
                        // 确保不超过最大限制
                        if (sites.length > MAX_PINNED_SITES) {
                            logger.warn(`固定网站数量超过限制(${MAX_PINNED_SITES})，仅保留前${MAX_PINNED_SITES}个`);
                            sites = sites.slice(0, MAX_PINNED_SITES);
                        }
                        importData[key] = sites;
                    }
                }
            }

            // 保存数据
            if (Object.keys(importData).length > 0) {
                await this.STORAGE.set(importData);
                return true;
            }
            return false;
        } catch (error) {
            logger.error('导入配置数据失败:', error);
            throw error;
        }
    }
}
