/**
 * 诊断脚本 — 暴露全局函数 sbDiagnose()，在 background service worker 控制台调用
 *
 * 用法：
 *   1. chrome://extensions → 找到 Smart Bookmark → 点 "Service Worker"
 *   2. 在弹出的 DevTools Console 输入：  sbDiagnose()
 *   3. 回车，等几秒，会打出 8 行诊断结果
 *
 * 注：先输入 `allow pasting` 回车解锁，再调用 sbDiagnose()
 */

globalThis.sbDiagnose = async function sbDiagnose() {
  console.group('🔍 Smart Bookmark 搜索诊断');

  // 1️⃣ API key 是否配置
  try {
    const chatSvc = await ConfigManager.getChatService();
    const embedSvc = await ConfigManager.getEmbeddingService();
    console.log('1️⃣ Chat 服务：', chatSvc?.id, 'API key?', !!chatSvc?.apiKey, 'model:', chatSvc?.chatModel);
    console.log('   Embedding 服务：', embedSvc?.id, 'API key?', !!embedSvc?.apiKey, 'model:', embedSvc?.embedModel);
  } catch (e) {
    console.error('1️⃣ 获取服务配置失败：', e);
  }

  // 2️⃣ aiMetaFiller 心跳 alarm
  try {
    const alarm = await chrome.alarms.get('aiMetaFiller-heartbeat');
    console.log('2️⃣ aiMetaFiller 心跳 alarm 存在？', !!alarm, alarm);
  } catch (e) {
    console.error('2️⃣ 查询 alarm 失败：', e);
  }

  // 3️⃣ 书签数量
  try {
    const all = await getAllBookmarks(true, false);
    const ext = await LocalStorageMgr.getBookmarks();
    console.log('3️⃣ 书签总数（含原生）：', Object.keys(all).length);
    console.log('   插件存储里的书签数（不含原生）：', Object.keys(ext).length);
  } catch (e) {
    console.error('3️⃣ 获取书签失败：', e);
  }

  // 4️⃣ mingcute 在合并后的列表里
  try {
    const all = await getAllBookmarks(true, false);
    const mingcuteList = Object.values(all).filter(b => b.url?.toLowerCase().includes('mingcute'));
    console.log('4️⃣ 含 "mingcute" 的书签数（合并视图）：', mingcuteList.length);
    mingcuteList.forEach((b, i) => {
      console.log(`   [${i}]`, {
        url: b.url,
        title: b.title,
        source: b.source,
        tags: b.tags,
        excerpt: b.excerpt?.slice(0, 50),
        hasEmbedding: !!b.embedding,
        aiMeta: b.aiMeta
      });
    });
    if (mingcuteList.length === 0) {
      console.warn('   ⚠️ 合并视图里没有 mingcute！');
    }
  } catch (e) {
    console.error('4️⃣ 查 mingcute 失败：', e);
  }

  // 5️⃣ Chrome 原生书签里直接查
  try {
    const tree = await chrome.bookmarks.getTree();
    const flat = [];
    const walk = (nodes) => {
      for (const n of nodes) {
        if (n.url) flat.push(n);
        if (n.children) walk(n.children);
      }
    };
    walk(tree);
    const mingcuteRaw = flat.filter(b => b.url?.toLowerCase().includes('mingcute'));
    console.log('5️⃣ Chrome 原生书签里含 "mingcute"：', mingcuteRaw.length);
    mingcuteRaw.forEach(b => console.log('   ', { id: b.id, url: b.url, title: b.title }));
  } catch (e) {
    console.error('5️⃣ 查 Chrome 原生书签失败：', e);
  }

  // 6️⃣ 模拟搜索 "图标"
  try {
    console.log('6️⃣ 模拟搜索 "图标"...');
    const results = await searchManager.search('图标', {
      debounce: false,
      includeChromeBookmarks: true,
      recordSearch: false
    });
    console.log('   返回结果数：', results.length);
    const mingcuteHit = results.find(r => r.url?.toLowerCase().includes('mingcute'));
    console.log('   mingcute 命中？', !!mingcuteHit);
    if (mingcuteHit) console.log('   mingcute 命中项：', mingcuteHit);
    console.log('   前 5 个结果：', results.slice(0, 5).map(r => ({
      title: r.title,
      score: Math.round(r.score),
      similarity: r.similarity?.toFixed(3),
      keywordMatch: r.keywordMatch
    })));
  } catch (e) {
    console.error('6️⃣ 搜索失败：', e);
  }

  // 7️⃣ mingcute 应该匹配什么 derived keywords
  try {
    const all = await getAllBookmarks(true, false);
    const mc = Object.values(all).find(b => b.url?.toLowerCase().includes('mingcute'));
    if (mc) {
      const dk = getBookmarkDerivedKeywords(mc);
      const profiles = getBookmarkIntentProfiles(mc);
      const iconProfile = SEARCH_INTENT_PROFILES.find(p => p.id === 'icon-assets');
      console.log('7️⃣ mingcute 的 derivedKeywords：', dk);
      console.log('   命中的 profile：', profiles.map(p => p.id));
      console.log('   hostMatchesSearchIntent("mingcute.com", icon-assets) =',
        hostMatchesSearchIntent('mingcute.com', iconProfile));
      console.log('   getBookmarkHostname(mingcute) =', getBookmarkHostname(mc));
    } else {
      console.warn('   没找到 mingcute，跳过 derived 检查');
    }
  } catch (e) {
    console.error('7️⃣ 派生关键词检查失败：', e);
  }

  // 8️⃣ aiMetaFiller 状态
  try {
    if (typeof aiMetaFiller !== 'undefined') {
      console.log('8️⃣ aiMetaFiller 当前是否在跑：', aiMetaFiller.running);
    } else {
      console.warn('8️⃣ aiMetaFiller 未定义');
    }
  } catch (e) {
    console.error('8️⃣ aiMetaFiller 检查失败：', e);
  }

  // 9️⃣ PinyinMatch 库
  try {
    const pm = (typeof PinyinMatch !== 'undefined') ? PinyinMatch
      : (typeof globalThis !== 'undefined' && globalThis.PinyinMatch) ? globalThis.PinyinMatch
      : (typeof self !== 'undefined' && self.PinyinMatch) ? self.PinyinMatch : null;
    console.log('9️⃣ PinyinMatch 库加载？', !!pm, 'match 方法：', typeof pm?.match);
    if (pm && typeof pm.match === 'function') {
      console.log('   PinyinMatch.match("图标", "tubiao") =', pm.match('图标', 'tubiao'));
      console.log('   PinyinMatch.match("MingCute Icon - Carefully Designed Icon Library", "tubiao") =',
        pm.match('MingCute Icon - Carefully Designed Icon Library', 'tubiao'));
    }
  } catch (e) {
    console.error('9️⃣ PinyinMatch 检查失败：', e);
  }

  // 🔟 模拟搜索 "tubiao"
  try {
    console.log('🔟 模拟搜索 "tubiao"...');
    const results = await searchManager.search('tubiao', {
      debounce: false,
      includeChromeBookmarks: true,
      recordSearch: false
    });
    console.log('   返回结果数：', results.length);
    const mingcuteHit = results.find(r => r.url?.toLowerCase().includes('mingcute'));
    console.log('   mingcute 命中？', !!mingcuteHit, mingcuteHit && { score: Math.round(mingcuteHit.score), keywordMatch: mingcuteHit.keywordMatch });
  } catch (e) {
    console.error('🔟 搜索 tubiao 失败：', e);
  }

  console.groupEnd();
  console.log('✅ 诊断完成。把整个 console 截图发给我。');
};

// 自动提示（service worker 启动时打印一次）
console.log('%c💡 输入 sbDiagnose() 运行诊断', 'color:#1f6feb;font-weight:bold');
