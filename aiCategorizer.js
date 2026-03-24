/**
 * AI 一键归类模块
 * 读取所有书签，利用 AI 批量生成标签进行智能分类
 */

class AICategorizer {
    constructor() {
        this.isRunning = false;
        this.abortController = null;
        this.progress = { total: 0, completed: 0, failed: 0, status: 'idle' };
    }

    /**
     * 开始一键归类所有书签
     */
    async categorizeAll() {
        if (this.isRunning) {
            throw new Error('AI 归类正在进行中，请等待完成');
        }

        this.isRunning = true;
        this.abortController = new AbortController();
        this.progress = { total: 0, completed: 0, failed: 0, status: 'running' };

        try {
            // 1. 获取所有书签（优先读取插件内部书签，如果为空则读取 Chrome 原生书签）
            let bookmarks = await LocalStorageMgr.getBookmarks();
            let bookmarkEntries = [];
            let isFromChrome = false;

            if (bookmarks && Object.keys(bookmarks).length > 0) {
                // 使用插件内部存储的书签
                bookmarkEntries = Object.entries(bookmarks);
                logger.info(`从插件存储中获取到 ${bookmarkEntries.length} 个书签`);
            } else {
                // 回退到 Chrome 原生书签
                const chromeBookmarks = await getChromeBookmarks();
                if (!chromeBookmarks || chromeBookmarks.length === 0) {
                    throw new Error('没有找到任何书签');
                }
                // 转换为 [url, bookmark] 格式
                bookmarkEntries = chromeBookmarks
                    .filter(b => b.url && !b.url.startsWith('chrome://') && !b.url.startsWith('chrome-extension://'))
                    .map(b => [b.url, {
                        title: b.title || '',
                        url: b.url,
                        tags: b.folderTags || [],
                        excerpt: ''
                    }]);
                isFromChrome = true;
                logger.info(`从 Chrome 书签栏获取到 ${bookmarkEntries.length} 个书签`);
            }

            if (bookmarkEntries.length === 0) {
                throw new Error('没有找到任何书签');
            }

            this.progress.total = bookmarkEntries.length;
            this._broadcastProgress();

            // 3. 检查 API 配置
            const apiService = await ConfigManager.getChatService();
            if (!apiService.apiKey || !apiService.chatModel) {
                throw new Error('未配置 AI 服务的 API Key，请先在设置中配置');
            }

            // 4. 批量处理书签（每批 5 个，避免 API 频率限制）
            const BATCH_SIZE = 5;
            const updatedBookmarks = {};

            for (let i = 0; i < bookmarkEntries.length; i += BATCH_SIZE) {
                if (this.abortController.signal.aborted) {
                    this.progress.status = 'cancelled';
                    this._broadcastProgress();
                    break;
                }

                const batch = bookmarkEntries.slice(i, i + BATCH_SIZE);

                // 并发处理批次内的书签
                const results = await Promise.allSettled(
                    batch.map(([url, bookmark]) => this._categorizeBookmark(url, bookmark))
                );

                // 收集结果
                results.forEach((result, index) => {
                    const [url, bookmark] = batch[index];
                    if (result.status === 'fulfilled' && result.value) {
                        updatedBookmarks[url] = result.value;
                        this.progress.completed++;
                    } else {
                        // 保留原书签，标记失败
                        this.progress.failed++;
                        this.progress.completed++;
                    }
                    this._broadcastProgress();
                });

                // 每批之间延迟，避免 API 限速（指数退避）
                const failedInBatch = results.filter(r => r.status === 'rejected').length;
                if (i + BATCH_SIZE < bookmarkEntries.length) {
                    // 如果本批有失败，增加延迟（指数退避）
                    const baseDelay = 1500;
                    const backoffDelay = failedInBatch > 0 ? baseDelay * Math.pow(2, Math.min(failedInBatch, 4)) : baseDelay;
                    await this._delay(backoffDelay);
                }
            }

            // 5. 批量更新书签
            if (Object.keys(updatedBookmarks).length > 0) {
                await LocalStorageMgr.updateBookmarksAndEmbedding(
                    Object.values(updatedBookmarks),
                    { notifyChange: true }
                );
            }

            this.progress.status = 'completed';
            this._broadcastProgress();

            return {
                success: true,
                total: this.progress.total,
                categorized: Object.keys(updatedBookmarks).length,
                failed: this.progress.failed
            };

        } catch (error) {
            this.progress.status = 'error';
            this.progress.error = error.message;
            this._broadcastProgress();
            logger.error('AI 一键归类失败:', error);
            throw error;
        } finally {
            this.isRunning = false;
            this.abortController = null;
        }
    }

    /**
     * 对单个书签进行 AI 分类
     */
    async _categorizeBookmark(url, bookmark) {
        try {
            const systemPrompt = `你是一个书签分类助手。根据书签的标题和URL，生成 2-4 个精准的中文分类标签。
标签要求：
1. 每个标签 2-4 个字
2. 标签应反映内容的主题领域（如：前端开发、机器学习、产品设计、投资理财等）
3. 如果已有标签且合理，可以保留并优化
4. 只返回标签，用逗号分隔，不要有其他内容

示例输出：前端开发,React,性能优化`;

            const userPrompt = `标题: ${bookmark.title || '未知'}
URL: ${url}
${bookmark.tags && bookmark.tags.length > 0 ? `当前标签: ${bookmark.tags.join(',')}` : ''}
${bookmark.excerpt ? `摘要: ${smartTruncate(bookmark.excerpt, 200)}` : ''}`;

            const response = await getChatCompletion(
                systemPrompt,
                userPrompt,
                this.abortController.signal
            );

            if (!response) {
                return null;
            }

            // 解析 AI 返回的标签（消毒：去除 HTML 特殊字符，防止 XSS）
            const newTags = response
                .split(/[,，、\n]/)
                .map(tag => tag.trim().replace(/[<>&'"]/g, ''))
                .filter(tag => tag.length > 0 && tag.length <= 20 && !/^[\s\d]+$/.test(tag))
                .slice(0, 5); // 最多 5 个标签

            if (newTags.length === 0) {
                return null;
            }

            // 更新书签
            const updatedBookmark = { ...bookmark };
            updatedBookmark.tags = newTags;
            updatedBookmark.url = url;

            return updatedBookmark;
        } catch (error) {
            logger.warn(`归类书签失败: ${url}`, error.message);
            return null;
        }
    }

    /**
     * 取消归类操作
     */
    cancel() {
        if (this.abortController) {
            this.abortController.abort();
        }
        this.isRunning = false;
        this.progress.status = 'cancelled';
        this._broadcastProgress();
    }

    /**
     * 广播进度消息
     */
    _broadcastProgress() {
        sendMessageSafely({
            type: MessageType.AI_CATEGORIZE_PROGRESS,
            data: { ...this.progress }
        });
    }

    /**
     * 延迟函数
     */
    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 获取当前进度
     */
    getProgress() {
        return { ...this.progress };
    }
}

// 全局单例
const aiCategorizer = new AICategorizer();
