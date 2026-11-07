// 构建产物：由 build.mjs 从 src/panel 打包生成，请勿直接编辑。

// src/panel/ui/runtime.js
var bound = null;
function bindReact(React) {
  if (!React || typeof React.createElement !== "function") return false;
  bound = { React, createElement: React.createElement };
  return true;
}
function getReact() {
  if (!bound) throw new Error("宿主 React 尚未注入");
  return bound.React;
}
function h(type, props, ...children) {
  if (!bound) throw new Error("宿主 React 尚未注入");
  const flat = [];
  for (const child of children) {
    if (Array.isArray(child)) {
      for (const item of child) flat.push(item);
    } else {
      flat.push(child);
    }
  }
  return bound.createElement(type, props, ...flat);
}

// locales/zh-CN.json
var zh_CN_default = {
  "plugin.title": "红果短剧",
  "app.subtitle": "短剧浏览",
  "tab.discover": "发现",
  "tab.search": "搜索",
  "tab.history": "历史",
  "tab.settings": "设置",
  "boot.loading": "正在连接本机后台…",
  "boot.failedTitle": "后台未就绪",
  "boot.failedHint": "面板依赖本插件后台模块提供数据。若刚安装或更新插件，请在插件列表点「重新读取清单」，或禁用后重新启用插件；仍无效时重启宿主。",
  "boot.retry": "重新检测",
  "action.retry": "重试",
  "action.refresh": "刷新",
  "action.back": "返回",
  "action.loadMore": "加载更多",
  "action.browse": "去看看",
  "unit.episodes": "{{count}} 集",
  "unit.episodeShort": "第{{number}}集",
  "unit.untitled": "未命名",
  "discover.heading": "推荐",
  "discover.empty": "暂无推荐内容",
  "discover.emptyHint": "稍后再试，或下拉刷新",
  "discover.end": "已经到底了",
  "discover.loadingMore": "正在加载更多…",
  "discover.refreshing": "正在刷新…",
  "discover.pull": "下拉刷新",
  "discover.release": "松开刷新",
  "search.placeholder": "搜索短剧",
  "search.hint": "输入关键词，停止输入 300 毫秒后自动搜索",
  "search.recent": "最近搜索",
  "search.clearRecent": "清空记录",
  "search.noRecent": "暂无搜索记录",
  "search.empty": "没有找到相关内容",
  "search.emptyHint": "换个关键词再试",
  "search.searching": "正在搜索…",
  "search.results": "已加载 {{count}} 个结果",
  "search.suggestions": "搜索联想",
  "search.hotLoading": "正在加载热搜…",
  "search.guesses": "猜你想搜",
  "search.loadMore": "加载更多结果",
  "search.loadingMore": "正在加载更多…",
  "search.clearInput": "清空输入",
  "detail.episodes": "选集",
  "detail.episodeGroups": "集数分组",
  "detail.episodeRange": "第 {{start}}–{{end}} 集",
  "detail.backToCurrent": "回到当前集",
  "detail.description": "简介",
  "detail.noDescription": "暂无简介",
  "detail.expand": "展开",
  "detail.collapse": "收起",
  "detail.continue": "继续观看",
  "detail.continueAt": "第{{number}}集 · {{time}}",
  "detail.start": "从第 1 集开始",
  "detail.watched": "已看完",
  "detail.current": "当前",
  "detail.loading": "正在加载详情…",
  "detail.missingId": "剧集标识无效",
  "detail.truncated": "分集过多，仅显示前 {{count}} 集",
  "detail.unplayable": "该集暂不可播放",
  "detail.recordFailed": "写入观看历史失败",
  "detail.episodesFailed": "分集加载失败",
  "player.region": "视频播放器",
  "player.loading": "正在加载视频…",
  "player.buffering": "缓冲中…",
  "player.play": "播放",
  "player.pause": "暂停",
  "player.playPause": "播放 / 暂停",
  "player.next": "下一集",
  "player.nextEpisode": "播放下一集",
  "player.lastEpisode": "已经是最后一集",
  "player.mute": "静音",
  "player.unmute": "取消静音",
  "player.volume": "音量",
  "player.speed": "播放速度",
  "player.decodeFailed": "本机解码失败",
  "player.fallbackCompatible": "已回退到兼容播放",
  "player.quality": "清晰度",
  "player.pip": "画中画",
  "player.pipFailed": "画中画不可用",
  "player.fill": "铺满侧栏",
  "player.exitFill": "退出铺满",
  "player.mini": "小窗播放",
  "player.exitMini": "返回详情页",
  "player.miniActive": "正在小窗播放",
  "player.opacity": "小窗不透明度",
  "player.opacityWheelTip": "Alt + 滚轮调整不透明度",
  "player.showMini": "显示小窗",
  "player.autoHide": "移出隐藏",
  "player.seek": "播放进度",
  "player.ended": "已播放完毕",
  "player.endedNext": "可播放下一集，或重新播放本集",
  "player.endedLast": "已经是最后一集，可重新播放",
  "player.replay": "重播",
  "player.unsupportedTitle": "无法播放该编码",
  "player.unsupportedHint": "面板无法直接加载该视频流（宿主页面禁止媒体元素加载外部地址）。所有清晰度都是同一编码，切换无效；点「直接播放」可在面板内用本机解码器出画面，或下载本集用外部播放器打开",
  "player.transcode": "转码后播放",
  "player.playDirect": "直接播放（本机解码）",
  "player.transcodingTitle": "正在转码",
  "player.transcodingHint": "本机没有 HEVC 解码器，正在用 ffmpeg 转成 H.264… {{percent}}%",
  "player.actualQuality": "实际清晰度：{{quality}}",
  "player.switchTo": "切换到 {{quality}}",
  "player.copyAddress": "复制播放地址",
  "player.copyDone": "播放地址已复制",
  "player.copyFailed": "复制失败，请手动选择地址",
  "player.addressUnavailable": "播放地址不可用",
  "player.download": "下载本集",
  "player.downloading": "正在下载 {{done}}/{{total}} 段",
  "player.downloadDone": "已开始下载",
  "player.downloadFailed": "下载失败：{{error}}",
  "player.errorTitle": "播放失败",
  "player.errorHint": "网络中断或后台未响应时可重试；切换清晰度会重新建立连接",
  "player.segmentFailed": "视频分片加载失败",
  "player.stalled": "视频加载超时，可能是网络中断",
  "player.retry": "重试",
  "player.resumeClamped": "目标位置超出本集时长，已从头播放",
  "player.qualitySwitched": "已切换到 {{quality}}",
  "player.qualityHeavy": "高清晰度由本机软件解码，若出现卡顿可切回 480p",
  "player.resumeJump": "已跳到 {{time}}",
  "player.noEpisode": "暂无可播放的分集",
  "player.unplayable": "该集暂不可播放",
  "player.autoplayBlocked": "点击画面开始播放",
  "history.heading": "观看历史",
  "history.empty": "还没有观看记录",
  "history.emptyHint": "打开一部短剧并选择集数后，这里会显示进度",
  "history.lastWatched": "第{{number}}集 · {{time}}",
  "history.remove": "删除这条记录",
  "history.clear": "清空历史",
  "history.clearConfirm": "确认清空全部历史？",
  "history.confirmRemove": "确认删除？",
  "history.cleared": "已清空观看历史",
  "history.removed": "已删除记录",
  "settings.heading": "设置",
  "settings.playback": "播放偏好",
  "settings.quality": "默认清晰度",
  "settings.qualityHint": "播放器默认按此清晰度取流，播放中也可随时切换",
  "settings.miniOpacity": "小窗不透明度",
  "settings.miniOpacityHint": "调整范围 5%～100%，正在播放的小窗会同步生效",
  "settings.miniAutoHide": "鼠标移出后隐藏",
  "settings.miniAutoHideHint": "移出 500ms 后隐藏并暂停，移回恢复按钮后自动显示并继续播放；原本暂停的不自动恢复",
  "settings.cache": "缓存",
  "settings.cacheHint": "清理后台的视频分片与封面缓存",
  "settings.clearCache": "清理缓存",
  "settings.clearCacheConfirm": "确认清理？",
  "settings.cacheCleared": "缓存已清理",
  "settings.cacheUnsupported": "后台版本过旧，暂不支持缓存清理",
  "settings.cacheFailed": "缓存清理失败：{{error}}",
  "settings.status": "后台状态",
  "settings.statusHint": "面板只与本机 127.0.0.1 回环地址上的后台通信",
  "settings.running": "运行中",
  "settings.notRunning": "未连接",
  "settings.port": "端口",
  "settings.version": "版本",
  "settings.pid": "进程",
  "settings.uptime": "运行时长",
  "settings.sdk": "SDK",
  "settings.sdkReady": "已就绪",
  "settings.sdkIdle": "未加载",
  "settings.sdkLastError": "最近错误",
  "settings.recheck": "重新检测",
  "settings.unavailableHint": "后台未响应。若刚安装或更新插件，请在插件列表点「重新读取清单」或重启宿主。",
  "settings.about": "关于",
  "settings.aboutText": "面板通过非官方匿名 SDK 读取公开目录数据；不登录账号、不上传数据。",
  "settings.saveFailed": "保存设置失败：{{error}}",
  "error.title": "出错了",
  "error.rateLimited": "请求太频繁，稍后再试",
  "error.rateLimitedAnonymous": "匿名设备被限流，稍后再试",
  "error.rateLimitedWait": "{{seconds}} 秒后可重试",
  "error.backgroundUnavailable": "后台未启动或端口不可达",
  "error.backgroundHint": "在插件列表点「重新读取清单」，或重启宿主后重试",
  "error.transport": "网络请求失败，请检查网络",
  "error.timeout": "请求超时，稍后重试",
  "error.contentUnavailable": "内容暂不可用",
  "error.notFound": "没有找到对应的内容",
  "error.protocol": "后台响应格式不正确",
  "error.invalidParam": "请求参数不合法",
  "error.unknown": "未知错误",
  "error.renderTitle": "界面渲染出错",
  "error.retryPanel": "重新加载界面",
  "detail.noEpisodes": "暂无分集",
  "settings.cacheClearedCount": "缓存已清理（{{count}} 个文件）",
  "tab.watchlist": "追剧",
  "watchlist.heading": "我的追剧",
  "watchlist.loading": "正在读取追剧记录",
  "watchlist.all": "全部",
  "watchlist.planned": "想看",
  "watchlist.watching": "在看",
  "watchlist.completed": "已看完",
  "watchlist.status": "追剧状态",
  "watchlist.filter": "筛选追剧状态",
  "watchlist.add": "加入追剧",
  "watchlist.saved": "已收藏",
  "watchlist.remove": "取消收藏",
  "watchlist.empty": "还没有收藏的剧",
  "watchlist.filterEmpty": "这个分类还没有剧",
  "watchlist.emptyHint": "在详情页点“加入追剧”，好剧随时接着看",
  "watchlist.saveFailed": "保存追剧记录失败，请重试",
  "detail.partialAt": "已看到 {{time}}",
  "settings.autoNext": "自动播放下一集",
  "settings.playbackRemembered": "倍速、音量、静音及连播设置自动保存，下次打开仍然生效；关闭连播后，本集播完即停止",
  "settings.loadFailed": "读取播放偏好失败，已暂时静音；可在设置中重新调整",
  "catalog.navigation": "发现短剧",
  "catalog.recommend": "推荐",
  "catalog.rank": "排行",
  "catalog.filter": "分类",
  "catalog.content": "作品类型",
  "catalog.board": "榜单",
  "catalog.defaultBoard": "默认榜单",
  "catalog.rankNumber": "第 {{number}} 名",
  "catalog.promoted": "平台推荐",
  "catalog.any": "不限",
  "catalog.reset": "重置筛选",
  "catalog.empty": "暂无符合条件的短剧",
  "catalog.emptyHint": "试试其他榜单或筛选条件",
  "catalog.filtersLoading": "正在加载分类条件…",
  "catalog.cursorExpired": "分页已过期，请重试以重新加载列表"
};

// locales/zh-TW.json
var zh_TW_default = {
  "plugin.title": "紅果短劇",
  "app.subtitle": "短劇瀏覽",
  "tab.discover": "發現",
  "tab.search": "搜尋",
  "tab.history": "歷史",
  "tab.settings": "設定",
  "boot.loading": "正在連線本機後台…",
  "boot.failedTitle": "後台未就緒",
  "boot.failedHint": "面板依賴本外掛後台模組提供資料。若剛安裝或更新外掛，請在外掛清單點「重新讀取清單」，或停用後重新啟用外掛；仍無效時請重啟宿主。",
  "boot.retry": "重新檢測",
  "action.retry": "重試",
  "action.refresh": "重新整理",
  "action.back": "返回",
  "action.loadMore": "載入更多",
  "action.browse": "去看看",
  "unit.episodes": "{{count}} 集",
  "unit.episodeShort": "第{{number}}集",
  "unit.untitled": "未命名",
  "discover.heading": "推薦",
  "discover.empty": "暫無推薦內容",
  "discover.emptyHint": "稍後再試，或下拉重新整理",
  "discover.end": "已經到底了",
  "discover.loadingMore": "正在載入更多…",
  "discover.refreshing": "正在重新整理…",
  "discover.pull": "下拉重新整理",
  "discover.release": "放開重新整理",
  "search.placeholder": "搜尋短劇",
  "search.hint": "輸入關鍵詞，停止輸入 300 毫秒後自動搜尋",
  "search.recent": "最近搜尋",
  "search.clearRecent": "清空記錄",
  "search.noRecent": "暫無搜尋記錄",
  "search.empty": "沒有找到相關內容",
  "search.emptyHint": "換個關鍵詞再試",
  "search.searching": "正在搜尋…",
  "search.results": "已載入 {{count}} 個結果",
  "search.suggestions": "搜尋建議",
  "search.hotLoading": "正在載入熱搜…",
  "search.guesses": "猜你想搜",
  "search.loadMore": "載入更多結果",
  "search.loadingMore": "正在載入更多…",
  "search.clearInput": "清空輸入",
  "detail.episodes": "選集",
  "detail.episodeGroups": "集數分組",
  "detail.episodeRange": "第 {{start}}–{{end}} 集",
  "detail.backToCurrent": "回到目前集數",
  "detail.description": "簡介",
  "detail.noDescription": "暫無簡介",
  "detail.expand": "展開",
  "detail.collapse": "收起",
  "detail.continue": "繼續觀看",
  "detail.continueAt": "第{{number}}集 · {{time}}",
  "detail.start": "從第 1 集開始",
  "detail.watched": "已看完",
  "detail.current": "目前",
  "detail.loading": "正在載入詳情…",
  "detail.missingId": "劇集識別碼無效",
  "detail.truncated": "分集過多，僅顯示前 {{count}} 集",
  "detail.unplayable": "該集暫不可播放",
  "detail.recordFailed": "寫入觀看歷史失敗",
  "detail.episodesFailed": "分集載入失敗",
  "player.region": "影片播放器",
  "player.loading": "正在載入影片…",
  "player.buffering": "緩衝中…",
  "player.play": "播放",
  "player.pause": "暫停",
  "player.playPause": "播放 / 暫停",
  "player.next": "下一集",
  "player.nextEpisode": "播放下一集",
  "player.lastEpisode": "已經是最後一集",
  "player.mute": "靜音",
  "player.unmute": "取消靜音",
  "player.volume": "音量",
  "player.speed": "播放速度",
  "player.decodeFailed": "本機解碼失敗",
  "player.fallbackCompatible": "已回退到相容播放",
  "player.quality": "清晰度",
  "player.pip": "子母畫面",
  "player.pipFailed": "子母畫面無法使用",
  "player.fill": "填滿側欄",
  "player.exitFill": "退出填滿",
  "player.mini": "小窗播放",
  "player.exitMini": "返回詳情頁",
  "player.miniActive": "正在小窗播放",
  "player.opacity": "小窗不透明度",
  "player.opacityWheelTip": "Alt + 滾輪調整不透明度",
  "player.showMini": "顯示小窗",
  "player.autoHide": "移出隱藏",
  "player.seek": "播放進度",
  "player.ended": "已播放完畢",
  "player.endedNext": "可播放下一集，或重新播放本集",
  "player.endedLast": "已經是最後一集，可重新播放",
  "player.replay": "重播",
  "player.unsupportedTitle": "無法播放該編碼",
  "player.unsupportedHint": "面板無法直接載入該視訊串流（宿主頁面禁止媒體元素載入外部位址）。所有清晰度都是同一編碼，切換無效；點「直接播放」可在面板內用本機解碼器出畫面，或下載本集用外部播放器開啟",
  "player.transcode": "轉碼後播放",
  "player.playDirect": "直接播放（本機解碼）",
  "player.transcodingTitle": "正在轉碼",
  "player.transcodingHint": "本機沒有 HEVC 解碼器，正在用 ffmpeg 轉成 H.264… {{percent}}%",
  "player.actualQuality": "實際清晰度：{{quality}}",
  "player.switchTo": "切換到 {{quality}}",
  "player.copyAddress": "複製播放位址",
  "player.copyDone": "播放位址已複製",
  "player.copyFailed": "複製失敗，請手動選擇位址",
  "player.addressUnavailable": "播放位址不可用",
  "player.download": "下載本集",
  "player.downloading": "正在下載 {{done}}/{{total}} 段",
  "player.downloadDone": "已開始下載",
  "player.downloadFailed": "下載失敗：{{error}}",
  "player.errorTitle": "播放失敗",
  "player.errorHint": "網路中斷或後台未回應時可重試；切換清晰度會重新建立連線",
  "player.segmentFailed": "影片分片載入失敗",
  "player.stalled": "影片載入逾時，可能是網路中斷",
  "player.retry": "重試",
  "player.resumeClamped": "目標位置超出本集長度，已從頭播放",
  "player.qualitySwitched": "已切換到 {{quality}}",
  "player.qualityHeavy": "高清晰度由本機軟體解碼，若出現卡頓可切回 480p",
  "player.resumeJump": "已跳到 {{time}}",
  "player.noEpisode": "暫無可播放的分集",
  "player.unplayable": "該集暫不可播放",
  "player.autoplayBlocked": "點擊畫面開始播放",
  "history.heading": "觀看歷史",
  "history.empty": "還沒有觀看記錄",
  "history.emptyHint": "開啟一部短劇並選擇集數後，這裡會顯示進度",
  "history.lastWatched": "第{{number}}集 · {{time}}",
  "history.remove": "刪除這條記錄",
  "history.clear": "清空歷史",
  "history.clearConfirm": "確認清空全部歷史？",
  "history.confirmRemove": "確認刪除？",
  "history.cleared": "已清空觀看歷史",
  "history.removed": "已刪除記錄",
  "settings.heading": "設定",
  "settings.playback": "播放偏好",
  "settings.quality": "預設清晰度",
  "settings.qualityHint": "播放器預設依此清晰度取流，播放中也可隨時切換",
  "settings.miniOpacity": "小窗不透明度",
  "settings.miniOpacityHint": "調整範圍 5%～100%，正在播放的小窗會同步生效",
  "settings.miniAutoHide": "滑鼠移出後隱藏",
  "settings.miniAutoHideHint": "移出 500ms 後隱藏並暫停，移回恢復按鈕後自動顯示並繼續播放；原本暫停的不自動恢復",
  "settings.cache": "快取",
  "settings.cacheHint": "清理後台的影片分片與封面快取",
  "settings.clearCache": "清理快取",
  "settings.clearCacheConfirm": "確認清理？",
  "settings.cacheCleared": "快取已清理",
  "settings.cacheUnsupported": "後台版本過舊，暫不支援快取清理",
  "settings.cacheFailed": "快取清理失敗：{{error}}",
  "settings.status": "後台狀態",
  "settings.statusHint": "面板只與本機 127.0.0.1 回環位址上的後台通訊",
  "settings.running": "執行中",
  "settings.notRunning": "未連線",
  "settings.port": "連接埠",
  "settings.version": "版本",
  "settings.pid": "程序",
  "settings.uptime": "執行時長",
  "settings.sdk": "SDK",
  "settings.sdkReady": "已就緒",
  "settings.sdkIdle": "未載入",
  "settings.sdkLastError": "最近錯誤",
  "settings.recheck": "重新檢測",
  "settings.unavailableHint": "後台未回應。若剛安裝或更新外掛，請在外掛清單點「重新讀取清單」或重啟宿主。",
  "settings.about": "關於",
  "settings.aboutText": "面板透過非官方匿名 SDK 讀取公開目錄資料；不登入帳號、不上傳資料。",
  "settings.saveFailed": "儲存設定失敗：{{error}}",
  "error.title": "出錯了",
  "error.rateLimited": "請求太頻繁，稍後再試",
  "error.rateLimitedAnonymous": "匿名裝置被限流，稍後再試",
  "error.rateLimitedWait": "{{seconds}} 秒後可重試",
  "error.backgroundUnavailable": "後台未啟動或連接埠不可達",
  "error.backgroundHint": "在外掛清單點「重新讀取清單」，或重啟宿主後重試",
  "error.transport": "網路請求失敗，請檢查網路",
  "error.timeout": "請求逾時，稍後重試",
  "error.contentUnavailable": "內容暫不可用",
  "error.notFound": "沒有找到對應的內容",
  "error.protocol": "後台回應格式不正確",
  "error.invalidParam": "請求參數不合法",
  "error.unknown": "未知錯誤",
  "error.renderTitle": "介面渲染出錯",
  "error.retryPanel": "重新載入介面",
  "detail.noEpisodes": "暫無分集",
  "settings.cacheClearedCount": "快取已清理（{{count}} 個檔案）",
  "tab.watchlist": "追劇",
  "watchlist.heading": "我的追劇",
  "watchlist.loading": "正在讀取追劇記錄",
  "watchlist.all": "全部",
  "watchlist.planned": "想看",
  "watchlist.watching": "在看",
  "watchlist.completed": "已看完",
  "watchlist.status": "追劇狀態",
  "watchlist.filter": "篩選追劇狀態",
  "watchlist.add": "加入追劇",
  "watchlist.saved": "已收藏",
  "watchlist.remove": "取消收藏",
  "watchlist.empty": "還沒有收藏的劇",
  "watchlist.filterEmpty": "這個分類還沒有劇",
  "watchlist.emptyHint": "在詳情頁點「加入追劇」，好劇隨時接著看",
  "watchlist.saveFailed": "儲存追劇記錄失敗，請重試",
  "detail.partialAt": "已看到 {{time}}",
  "settings.autoNext": "自動播放下一集",
  "settings.playbackRemembered": "倍速、音量、靜音及連播設定自動儲存，下次開啟仍然生效；關閉連播後，本集播完即停止",
  "settings.loadFailed": "讀取播放偏好失敗，已暫時靜音；可在設定中重新調整",
  "catalog.navigation": "發現短劇",
  "catalog.recommend": "推薦",
  "catalog.rank": "排行",
  "catalog.filter": "分類",
  "catalog.content": "作品類型",
  "catalog.board": "榜單",
  "catalog.defaultBoard": "預設榜單",
  "catalog.rankNumber": "第 {{number}} 名",
  "catalog.promoted": "平台推薦",
  "catalog.any": "不限",
  "catalog.reset": "重設篩選",
  "catalog.empty": "暫無符合條件的短劇",
  "catalog.emptyHint": "試試其他榜單或篩選條件",
  "catalog.filtersLoading": "正在載入分類條件…",
  "catalog.cursorExpired": "分頁已過期，請重試以重新載入列表"
};

// locales/en.json
var en_default = {
  "plugin.title": "Hongguo Shorts",
  "app.subtitle": "Short-drama browsing",
  "tab.discover": "Discover",
  "tab.search": "Search",
  "tab.history": "History",
  "tab.settings": "Settings",
  "boot.loading": "Connecting to the local background service…",
  "boot.failedTitle": "Background service unavailable",
  "boot.failedHint": "The panel reads data from this plugin's background module. If the plugin was just installed or updated, choose “Reload manifest” in the plugin list, or disable and re-enable it; if that does not help, restart the host.",
  "boot.retry": "Check again",
  "action.retry": "Retry",
  "action.refresh": "Refresh",
  "action.back": "Back",
  "action.loadMore": "Load more",
  "action.browse": "Browse",
  "unit.episodes": "{{count}} episodes",
  "unit.episodeShort": "Episode {{number}}",
  "unit.untitled": "Untitled",
  "discover.heading": "Discover",
  "discover.empty": "No recommendations yet",
  "discover.emptyHint": "Try again later, or pull down to refresh",
  "discover.end": "You have reached the end",
  "discover.loadingMore": "Loading more…",
  "discover.refreshing": "Refreshing…",
  "discover.pull": "Pull down to refresh",
  "discover.release": "Release to refresh",
  "search.placeholder": "Search short dramas",
  "search.hint": "Search starts automatically 300 ms after you stop typing",
  "search.recent": "Recent searches",
  "search.clearRecent": "Clear history",
  "search.noRecent": "No recent searches",
  "search.empty": "No results found",
  "search.emptyHint": "Try a different keyword",
  "search.searching": "Searching…",
  "search.results": "{{count}} results loaded",
  "search.suggestions": "Search suggestions",
  "search.hotLoading": "Loading trending searches…",
  "search.guesses": "Suggested for you",
  "search.loadMore": "Load more results",
  "search.loadingMore": "Loading more…",
  "search.clearInput": "Clear input",
  "detail.episodes": "Episodes",
  "detail.episodeGroups": "Episode groups",
  "detail.episodeRange": "Episodes {{start}}–{{end}}",
  "detail.backToCurrent": "Back to current",
  "detail.description": "Synopsis",
  "detail.noDescription": "No synopsis available",
  "detail.expand": "Expand",
  "detail.collapse": "Collapse",
  "detail.continue": "Continue watching",
  "detail.continueAt": "Episode {{number}} · {{time}}",
  "detail.start": "Start from episode 1",
  "detail.watched": "Watched",
  "detail.current": "Current",
  "detail.loading": "Loading details…",
  "detail.missingId": "Invalid series id",
  "detail.truncated": "Too many episodes; showing the first {{count}}",
  "detail.unplayable": "This episode is not playable",
  "detail.recordFailed": "Failed to save watch history",
  "detail.episodesFailed": "Failed to load episodes",
  "player.region": "Video player",
  "player.loading": "Loading video…",
  "player.buffering": "Buffering…",
  "player.play": "Play",
  "player.pause": "Pause",
  "player.playPause": "Play / pause",
  "player.next": "Next episode",
  "player.nextEpisode": "Play next episode",
  "player.lastEpisode": "This is the last episode",
  "player.mute": "Mute",
  "player.unmute": "Unmute",
  "player.volume": "Volume",
  "player.speed": "Playback speed",
  "player.decodeFailed": "Local decoding failed",
  "player.fallbackCompatible": "Switched to compatible playback",
  "player.quality": "Quality",
  "player.pip": "Picture in picture",
  "player.pipFailed": "Picture in picture is unavailable",
  "player.fill": "Fill sidebar",
  "player.exitFill": "Exit fill",
  "player.mini": "Floating mini player",
  "player.exitMini": "Return to details",
  "player.miniActive": "Playing in the floating window",
  "player.opacity": "Mini player opacity",
  "player.opacityWheelTip": "Alt + mouse wheel adjusts opacity",
  "player.showMini": "Show mini player",
  "player.autoHide": "Auto-hide",
  "player.seek": "Playback position",
  "player.ended": "Finished",
  "player.endedNext": "Play the next episode or replay this one",
  "player.endedLast": "This was the last episode; you can replay it",
  "player.replay": "Replay",
  "player.unsupportedTitle": "This codec cannot be played",
  "player.unsupportedHint": 'The panel cannot load this stream through a media element (the host page blocks external media URLs). Every quality uses the same codec, so switching will not help. Use "Play directly" to decode it in the panel with the local decoder, or download the episode and open it in an external player',
  "player.transcode": "Play after transcoding",
  "player.playDirect": "Play directly (local decoder)",
  "player.transcodingTitle": "Transcoding",
  "player.transcodingHint": "No HEVC decoder on this system; converting to H.264 with ffmpeg… {{percent}}%",
  "player.actualQuality": "Actual quality: {{quality}}",
  "player.switchTo": "Switch to {{quality}}",
  "player.copyAddress": "Copy playback address",
  "player.copyDone": "Playback address copied",
  "player.copyFailed": "Copy failed; select the address manually",
  "player.addressUnavailable": "Playback address unavailable",
  "player.download": "Download episode",
  "player.downloading": "Downloading {{done}}/{{total}} segments",
  "player.downloadDone": "Download started",
  "player.downloadFailed": "Download failed: {{error}}",
  "player.errorTitle": "Playback failed",
  "player.errorHint": "Retry after a network interruption, or switch quality to rebuild the connection",
  "player.segmentFailed": "Failed to load a video segment",
  "player.stalled": "Video loading timed out; the network may be interrupted",
  "player.retry": "Retry",
  "player.resumeClamped": "The saved position is past the end of this episode; playing from the start",
  "player.qualitySwitched": "Switched to {{quality}}",
  "player.qualityHeavy": "High resolutions are decoded in software locally; switch back to 480p if playback stutters",
  "player.resumeJump": "Jumped to {{time}}",
  "player.noEpisode": "No playable episode",
  "player.unplayable": "This episode cannot be played",
  "player.autoplayBlocked": "Click the picture to start playback",
  "history.heading": "Watch history",
  "history.empty": "No watch history yet",
  "history.emptyHint": "Open a series and pick an episode; your progress will appear here",
  "history.lastWatched": "Episode {{number}} · {{time}}",
  "history.remove": "Delete this entry",
  "history.clear": "Clear history",
  "history.clearConfirm": "Clear all watch history?",
  "history.confirmRemove": "Confirm delete?",
  "history.cleared": "Watch history cleared",
  "history.removed": "Entry deleted",
  "settings.heading": "Settings",
  "settings.playback": "Playback",
  "settings.quality": "Preferred quality",
  "settings.qualityHint": "The player starts with this quality; you can switch at any time",
  "settings.miniOpacity": "Mini player opacity",
  "settings.miniOpacityHint": "Adjust from 5% to 100%; changes apply to an active mini player immediately",
  "settings.miniAutoHide": "Hide when the pointer leaves",
  "settings.miniAutoHideHint": "Hides and pauses after 500ms; hovering the restore button shows and resumes playback, unless it was already paused",
  "settings.cache": "Cache",
  "settings.cacheHint": "Clear cached video segments and covers in the background",
  "settings.clearCache": "Clear cache",
  "settings.clearCacheConfirm": "Confirm clear?",
  "settings.cacheCleared": "Cache cleared",
  "settings.cacheUnsupported": "The background version is too old to clear the cache",
  "settings.cacheFailed": "Failed to clear cache: {{error}}",
  "settings.status": "Background status",
  "settings.statusHint": "The panel only talks to the loopback service on 127.0.0.1",
  "settings.running": "Running",
  "settings.notRunning": "Not connected",
  "settings.port": "Port",
  "settings.version": "Version",
  "settings.pid": "PID",
  "settings.uptime": "Uptime",
  "settings.sdk": "SDK",
  "settings.sdkReady": "Ready",
  "settings.sdkIdle": "Not loaded",
  "settings.sdkLastError": "Last error",
  "settings.recheck": "Check again",
  "settings.unavailableHint": "The background did not respond. If the plugin was just installed or updated, choose “Reload manifest” in the plugin list or restart the host.",
  "settings.about": "About",
  "settings.aboutText": "The panel reads public catalogue data through an unofficial anonymous SDK; no account login and no data upload.",
  "settings.saveFailed": "Failed to save settings: {{error}}",
  "error.title": "Something went wrong",
  "error.rateLimited": "Too many requests; please try again later",
  "error.rateLimitedAnonymous": "The anonymous device is rate limited; please try again later",
  "error.rateLimitedWait": "Retry in {{seconds}} s",
  "error.backgroundUnavailable": "The background service is not running or unreachable",
  "error.backgroundHint": "Choose “Reload manifest” in the plugin list, or restart the host and retry",
  "error.transport": "Network request failed; check your connection",
  "error.timeout": "Request timed out; try again later",
  "error.contentUnavailable": "Content is temporarily unavailable",
  "error.notFound": "The requested content was not found",
  "error.protocol": "The background returned an unexpected response",
  "error.invalidParam": "Invalid request parameters",
  "error.unknown": "Unknown error",
  "error.renderTitle": "The interface failed to render",
  "error.retryPanel": "Reload interface",
  "detail.noEpisodes": "No episodes available",
  "settings.cacheClearedCount": "Cache cleared ({{count}} files)",
  "tab.watchlist": "Watchlist",
  "watchlist.heading": "My watchlist",
  "watchlist.loading": "Loading watchlist",
  "watchlist.all": "All",
  "watchlist.planned": "To watch",
  "watchlist.watching": "Watching",
  "watchlist.completed": "Finished",
  "watchlist.status": "Watch status",
  "watchlist.filter": "Filter watch status",
  "watchlist.add": "Add to watchlist",
  "watchlist.saved": "Saved",
  "watchlist.remove": "Remove",
  "watchlist.empty": "Your watchlist is empty",
  "watchlist.filterEmpty": "No series in this category",
  "watchlist.emptyHint": "Save a series from its details page to find it here.",
  "watchlist.saveFailed": "Could not save your watchlist. Please retry.",
  "detail.partialAt": "Watched up to {{time}}",
  "settings.autoNext": "Play next episode automatically",
  "settings.playbackRemembered": "Speed, volume, mute and autoplay settings are saved for next time. Turn autoplay off to stop at the end of an episode.",
  "settings.loadFailed": "Could not load playback settings. Playback is muted for now; adjust it in Settings.",
  "catalog.navigation": "Browse series",
  "catalog.recommend": "For you",
  "catalog.rank": "Rankings",
  "catalog.filter": "Categories",
  "catalog.content": "Content type",
  "catalog.board": "Ranking",
  "catalog.defaultBoard": "Default ranking",
  "catalog.rankNumber": "Rank {{number}}",
  "catalog.promoted": "Promoted",
  "catalog.any": "Any",
  "catalog.reset": "Reset filters",
  "catalog.empty": "No matching series",
  "catalog.emptyHint": "Try another ranking or filter.",
  "catalog.filtersLoading": "Loading filters…",
  "catalog.cursorExpired": "This list has expired. Retry to reload it from the first page."
};

// src/panel/i18n.js
var PACKS = { "zh-CN": zh_CN_default, "zh-TW": zh_TW_default, en: en_default };
var normalizeLocale = (locale) => {
  const raw = String(locale || "").toLowerCase();
  if (!raw) return "zh-CN";
  if (raw.startsWith("zh-tw") || raw.startsWith("zh-hk") || raw === "zh-hant") return "zh-TW";
  if (raw.startsWith("zh")) return "zh-CN";
  if (raw.startsWith("en")) return "en";
  return "zh-CN";
};
var interpolate = (template, values) => {
  if (!values) return template;
  return String(template).replace(
    /\{\{\s*([\w.]+)\s*\}\}/g,
    (match, key) => Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match
  );
};
function createTranslator(api, locale) {
  const resolved = normalizeLocale(locale || api?.locale);
  const pack = PACKS[resolved] || PACKS["zh-CN"];
  const fallbackPack = PACKS["zh-CN"];
  const t = (key, values) => {
    const fallback = pack[key] ?? fallbackPack[key] ?? key;
    try {
      if (api && typeof api.t === "function") {
        return api.t(key, { defaultValue: fallback, values });
      }
    } catch {
    }
    return interpolate(fallback, values);
  };
  return { t, locale: resolved };
}

// src/shared/contract.js
var PLUGIN_ID = "com.snow.hongguo";
var PORT_FIRST = 37191;
var PORT_LAST = 37200;
var CHANNEL_HEADER = "x-snow-hongguo-channel";
var CHANNEL_HEADER_VALUE = "panel-rpc-v1";
var LIMITS = {
  /** 列表项简介最多保留多少个字符（按 Unicode 码点计）。 */
  descriptionChars: 300,
  seriesDescriptionChars: 1e3,
  /** /episodes 响应体的硬上限。 */
  episodesMaxBytes: 64 * 1024,
  /** 分集翻页保护：异常 has_more 不会把请求拖死。 */
  episodesMaxPages: 8,
  episodesMaxItems: 2e3,
  /** 封面单张 3 MB（面板 5 MB 上限内，留出 base64 膨胀空间），磁盘保留 300 张。 */
  coverMaxBytes: 3 * 1024 * 1024,
  coverKeep: 300,
  videoKeep: 6,
  /** 本机播放最多保留的分段数；后台按时长切片时也遵守此预算。 */
  localSegmentsMax: 128,
  /** 综合搜索缺封面时并发补全 getSeries 的上限。 */
  searchEnrichConcurrency: 4,
  /** 同一上游接口两次调用之间的最小间隔。 */
  upstreamMinIntervalMs: 300,
  /** 按 retryAfterMs 退避时的单次等待上限。 */
  upstreamMaxBackoffMs: 2e3,
  seriesCacheTtlMs: 5 * 60 * 1e3,
  seriesCacheMax: 200
};

// src/panel/rpc.js
var PANEL_ROUTES = {
  health: "/health",
  discover: "/discover",
  rank: "/rank",
  filterPanel: "/filter-panel",
  filter: "/filter",
  search: "/search",
  suggest: "/search/suggest",
  hotSearch: "/search/hot",
  series: "/series",
  episodes: "/episodes",
  playback: "/playback",
  cover: "/cover",
  clearCache: "/cache/clear",
  streamInfo: "/stream/info",
  streamInit: "/stream/init",
  streamSegment: "/stream/segment",
  streamPrefetch: "/stream/prefetch",
  streamPrefetchCancel: "/stream/prefetch/cancel",
  h264Info: "/h264/info",
  h264Start: "/h264/start",
  h264Chunk: "/h264/chunk"
};
var TIMEOUTS = {
  health: 3e3,
  probe: 2e3,
  list: 25e3,
  search: 35e3,
  detail: 25e3,
  episodes: 35e3,
  cover: 2e4,
  action: 2e4,
  media: 12e4
};
var PanelError = class extends Error {
  constructor(code, message, options = {}) {
    super(message || code);
    this.name = "PanelError";
    this.code = String(code || "UNKNOWN");
    this.status = Number.isFinite(options.status) ? options.status : 0;
    this.retryable = options.retryable === true;
    this.retryAfterMs = Number.isFinite(options.retryAfterMs) ? options.retryAfterMs : null;
    this.cause = options.cause;
  }
};
var isConnectionError = (text) => /ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|EPIPE|connection refused|connection reset|failed to fetch|net::ERR|socket hang up|fetch failed|不可用/i.test(
  text
);
var isTimeoutError = (text) => /timeout|timed out|ETIMEDOUT|请求超时/i.test(text);
var toPanelError = (payload, status, fallbackMessage) => {
  const detail = payload && typeof payload === "object" ? payload.error : null;
  let code = typeof detail?.code === "string" && detail.code ? detail.code : "";
  if (!code) {
    if (status === 404) code = "NOT_FOUND";
    else if (status === 429) code = "RATE_LIMITED";
    else code = "HTTP_ERROR";
  }
  const message = typeof detail?.message === "string" && detail.message || fallbackMessage || `HTTP ${status || 0}`;
  return new PanelError(code, message, {
    status,
    retryable: detail?.retryable === true,
    // 兼容 SDK 原始字段与后台信封里的 camelCase 写法。
    retryAfterMs: Number.isFinite(detail?.retryAfterMs) ? detail.retryAfterMs : Number.isFinite(detail?.retry_after_ms) ? detail.retry_after_ms : null
  });
};
var headerValue = (headers, name) => {
  if (!headers) return "";
  if (typeof headers.get === "function") return String(headers.get(name) || "");
  const target = String(name).toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target) return String(headers[key] ?? "");
  }
  return "";
};
var base64ToBytes = (value) => {
  const binary = atob(String(value));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};
var buildQuery = (query) => {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === void 0 || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
};
function createRpc(api, { log = () => {
} } = {}) {
  let port = 0;
  let health = null;
  let discovering = null;
  let lastScanError = null;
  const requestJson = async (targetPort, pathname, options = {}) => {
    if (!api?.net || typeof api.net.fetch !== "function") {
      throw new PanelError("NET_UNAVAILABLE", "api.net.fetch 不可用（请在 plugin.json 声明 network 隐私域）");
    }
    const method = options.method || "GET";
    const queryText = buildQuery(options.query);
    const url = `http://127.0.0.1:${targetPort}${pathname}${queryText}`;
    let response;
    try {
      response = await api.net.fetch(url, {
        method,
        headers: {
          [CHANNEL_HEADER]: CHANNEL_HEADER_VALUE,
          ...options.body === void 0 ? {} : { "content-type": "application/json" }
        },
        body: options.body === void 0 ? void 0 : JSON.stringify(options.body),
        responseType: "text",
        timeoutMs: options.timeoutMs ?? TIMEOUTS.list
      });
    } catch (error) {
      const text2 = String(error?.message || error);
      throw new PanelError(isConnectionError(text2) ? "BACKGROUND_UNAVAILABLE" : "TRANSPORT", text2, {
        cause: error
      });
    }
    const failure = String(response?.error || "");
    if (!response || response.error) {
      if (isConnectionError(failure)) {
        throw new PanelError("BACKGROUND_UNAVAILABLE", failure, { status: response?.status ?? 0 });
      }
      if (isTimeoutError(failure)) {
        throw new PanelError("TIMEOUT", failure, { status: response?.status ?? 0, retryable: true });
      }
      throw new PanelError("TRANSPORT", failure || "网络请求失败", { status: response?.status ?? 0 });
    }
    let payload = null;
    const text = typeof response.body === "string" ? response.body : "";
    if (text.trim()) {
      try {
        payload = JSON.parse(text);
      } catch (error) {
        throw new PanelError("PROTOCOL", `后台响应不是 JSON：${error?.message ?? error}`, {
          status: response.status ?? 0
        });
      }
    }
    const status = Number.isFinite(response.status) ? response.status : 0;
    if (response.ok !== true || payload && payload.error) {
      throw toPanelError(payload, status, response.statusText);
    }
    return payload;
  };
  const probePort = async (candidate) => {
    try {
      const data = await requestJson(candidate, PANEL_ROUTES.health, {
        timeoutMs: TIMEOUTS.probe
      });
      if (data?.ok === true && data?.pluginId === PLUGIN_ID) return { port: candidate, health: data };
      return null;
    } catch (error) {
      if (error?.code !== "BACKGROUND_UNAVAILABLE" && error?.code !== "TRANSPORT") {
        lastScanError = error?.message || lastScanError;
      }
      return null;
    }
  };
  const scanPorts = async () => {
    const candidates = [];
    for (let candidate = PORT_FIRST; candidate <= PORT_LAST; candidate += 1) candidates.push(candidate);
    const results = await Promise.all(candidates.map((candidate) => probePort(candidate)));
    return results.find(Boolean) || null;
  };
  const reset = () => {
    port = 0;
    health = null;
  };
  const ensureReady = async () => {
    if (port && health) return health;
    if (!discovering) {
      discovering = (async () => {
        lastScanError = null;
        const found = await scanPorts();
        if (!found) {
          throw new PanelError(
            "BACKGROUND_UNAVAILABLE",
            lastScanError || `已在 127.0.0.1:${PORT_FIRST}-${PORT_LAST} 扫描，未发现本插件后台服务`
          );
        }
        port = found.port;
        health = found.health;
        log(`[rpc] background ready on 127.0.0.1:${port}`);
        return health;
      })().finally(() => {
        discovering = null;
      });
    }
    return discovering;
  };
  const call = async (pathname, options = {}, retried = false) => {
    await ensureReady();
    const targetPort = port;
    try {
      return await requestJson(targetPort, pathname, options);
    } catch (error) {
      if (error?.code === "BACKGROUND_UNAVAILABLE" && !retried) {
        reset();
        return call(pathname, options, true);
      }
      if (error?.code === "BACKGROUND_UNAVAILABLE") reset();
      throw error;
    }
  };
  const fetchCover = async (coverPath) => {
    if (typeof coverPath !== "string" || !coverPath.startsWith("/cover?")) {
      throw new PanelError("INVALID_PARAM", "封面路径不合法");
    }
    if (!api?.net || typeof api.net.fetch !== "function") {
      throw new PanelError("NET_UNAVAILABLE", "api.net.fetch 不可用");
    }
    await ensureReady();
    const targetPort = port;
    const url = `http://127.0.0.1:${targetPort}${coverPath}`;
    let response;
    try {
      response = await api.net.fetch(url, {
        method: "GET",
        headers: { [CHANNEL_HEADER]: CHANNEL_HEADER_VALUE },
        responseType: "arraybuffer",
        timeoutMs: TIMEOUTS.cover
      });
    } catch (error) {
      throw new PanelError("TRANSPORT", String(error?.message || error), { cause: error });
    }
    if (!response || response.error) {
      throw new PanelError("TRANSPORT", String(response?.error || "封面请求失败"), {
        status: response?.status ?? 0
      });
    }
    if (response.ok !== true) {
      throw new PanelError("TRANSPORT", `封面请求失败（HTTP ${response.status ?? 0}）`, {
        status: response.status ?? 0
      });
    }
    const base64 = typeof response.bodyBase64 === "string" && response.bodyBase64 ? response.bodyBase64 : typeof response.body === "string" ? response.body : "";
    if (!base64) throw new PanelError("PROTOCOL", "封面响应缺少二进制内容");
    let bytes;
    try {
      bytes = base64ToBytes(base64);
    } catch (error) {
      throw new PanelError("PROTOCOL", `封面数据解码失败：${error?.message ?? error}`);
    }
    const contentType = headerValue(response.headers, "content-type").split(";")[0].trim();
    const type = contentType.startsWith("image/") ? contentType : "application/octet-stream";
    return { blob: new Blob([bytes], { type }), contentType: type, bytes: bytes.length };
  };
  const clearCache = async () => {
    try {
      return await call(PANEL_ROUTES.clearCache, {
        method: "POST",
        // 后台会先等在途下载/转码收敛再删目录，按媒体级超时给足时间。
        timeoutMs: TIMEOUTS.media
      });
    } catch (error) {
      if (error?.code === "METHOD_NOT_ALLOWED") {
        return call(PANEL_ROUTES.clearCache, { timeoutMs: TIMEOUTS.media });
      }
      throw error;
    }
  };
  return {
    ensureReady,
    reset,
    getState: () => ({ port, health }),
    health: async () => {
      try {
        const data = await call(PANEL_ROUTES.health, { timeoutMs: TIMEOUTS.health });
        if (data?.pluginId !== PLUGIN_ID) {
          reset();
          throw new PanelError("PROTOCOL", "端口上的服务不是本插件后台");
        }
        health = data;
        return data;
      } catch (error) {
        if (error?.code === "BACKGROUND_UNAVAILABLE" || error?.code === "PROTOCOL") reset();
        throw error;
      }
    },
    discover: (cursor) => call(PANEL_ROUTES.discover, {
      query: { cursor },
      timeoutMs: TIMEOUTS.list
    }),
    getRank: (query = {}) => call(PANEL_ROUTES.rank, { query, timeoutMs: TIMEOUTS.list }),
    getFilterPanel: (genre) => call(PANEL_ROUTES.filterPanel, { query: { genre }, timeoutMs: TIMEOUTS.list }),
    filterSeries: (selections = {}, cursor) => call(PANEL_ROUTES.filter, {
      query: { selections: JSON.stringify(selections), cursor },
      timeoutMs: TIMEOUTS.list
    }),
    search: (q, cursor) => call(PANEL_ROUTES.search, {
      query: { q, cursor },
      timeoutMs: TIMEOUTS.search
    }),
    suggest: (q) => call(PANEL_ROUTES.suggest, { query: { q }, timeoutMs: TIMEOUTS.list }),
    hotSearch: () => call(PANEL_ROUTES.hotSearch, { timeoutMs: TIMEOUTS.list }),
    getSeries: (id) => call(PANEL_ROUTES.series, {
      query: { id },
      timeoutMs: TIMEOUTS.detail
    }),
    getEpisodes: (seriesId) => call(PANEL_ROUTES.episodes, {
      query: { seriesId },
      timeoutMs: TIMEOUTS.episodes
    }),
    getPlayback: (episodeId) => call(PANEL_ROUTES.playback, {
      query: { episodeId },
      timeoutMs: TIMEOUTS.detail
    }),
    /** 媒体管道：仅供播放器使用，返回的 base64 由播放器自行转成字节。 */
    getStreamInfo: (episodeId, quality) => call(PANEL_ROUTES.streamInfo, {
      query: { episodeId, quality },
      timeoutMs: TIMEOUTS.media
    }),
    getStreamInit: (episodeId, quality) => call(PANEL_ROUTES.streamInit, {
      query: { episodeId, quality },
      timeoutMs: TIMEOUTS.media
    }),
    getStreamSegment: (episodeId, quality, seq) => call(PANEL_ROUTES.streamSegment, {
      query: { episodeId, quality, seq },
      timeoutMs: TIMEOUTS.media
    }),
    prefetchStream: (episodeId, quality, token) => call(PANEL_ROUTES.streamPrefetch, {
      method: "POST",
      query: { episodeId, quality, token },
      timeoutMs: TIMEOUTS.media
    }),
    cancelPrefetch: (token) => call(PANEL_ROUTES.streamPrefetchCancel, {
      method: "POST",
      query: { token },
      timeoutMs: TIMEOUTS.action
    }),
    /** 转码兜底：查询进度 / 启动 / 分块读取成品（宿主没有 HEVC 解码器时使用）。 */
    h264Info: (episodeId, quality) => call(PANEL_ROUTES.h264Info, {
      query: { episodeId, quality },
      timeoutMs: TIMEOUTS.detail
    }),
    h264Start: (episodeId, quality) => call(PANEL_ROUTES.h264Start, {
      method: "POST",
      query: { episodeId, quality },
      timeoutMs: TIMEOUTS.action
    }),
    h264Chunk: (episodeId, quality, offset, length) => call(PANEL_ROUTES.h264Chunk, {
      query: { episodeId, quality, offset, length },
      timeoutMs: TIMEOUTS.media
    }),
    clearCache,
    fetchCover
  };
}

// src/panel/cover.js
var MAX_ENTRIES = 80;
function createCoverStore(rpc, { max = MAX_ENTRIES, log = () => {
} } = {}) {
  const entries = /* @__PURE__ */ new Map();
  const order = [];
  const revoke = (record) => {
    if (record?.url) {
      try {
        URL.revokeObjectURL(record.url);
      } catch {
      }
    }
  };
  const trim = () => {
    while (entries.size > max) {
      const oldest = order.find((path) => {
        const record2 = entries.get(path);
        return record2 && !record2.pending;
      });
      if (!oldest) break;
      const index = order.indexOf(oldest);
      if (index >= 0) order.splice(index, 1);
      const record = entries.get(oldest);
      revoke(record);
      entries.delete(oldest);
    }
  };
  const load = (path) => {
    if (!path) return Promise.resolve(null);
    const existing = entries.get(path);
    if (existing) {
      if (existing.url) return Promise.resolve(existing.url);
      if (existing.failed) return Promise.resolve(null);
      return existing.promise;
    }
    const record = { url: null, failed: false, pending: true, promise: null };
    record.promise = rpc.fetchCover(path).then(({ blob }) => {
      if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
        throw new Error("object URL 不可用");
      }
      record.url = URL.createObjectURL(blob);
      return record.url;
    }).catch((error) => {
      record.failed = true;
      log(`[cover] 加载失败：${error?.code || ""} ${error?.message || error}`);
      return null;
    }).finally(() => {
      record.pending = false;
      record.promise = null;
    });
    entries.set(path, record);
    order.push(path);
    trim();
    return record.promise;
  };
  const dispose = () => {
    for (const record of entries.values()) revoke(record);
    entries.clear();
    order.length = 0;
  };
  return { load, dispose };
}

// src/panel/playback-prefs.js
var PLAYBACK_RATES = Object.freeze([0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3]);
var normalizePlaybackPrefs = (raw) => ({
  playbackRate: PLAYBACK_RATES.includes(Number(raw?.playbackRate)) ? Number(raw.playbackRate) : 1,
  volume: raw?.volume != null && Number.isFinite(Number(raw.volume)) ? Math.min(1, Math.max(0, Number(raw.volume))) : 1,
  muted: raw?.muted === true,
  autoNext: raw?.autoNext !== false
});

// src/panel/storage.js
var HISTORY_KEY = "history";
var WATCHLIST_KEY = "watchlist";
var PREFS_KEY = "prefs";
var RECENT_SEARCH_KEY = "search.recent";
var HISTORY_LIMIT = 100;
var EPISODE_HISTORY_LIMIT = 2e3;
var WATCHLIST_LIMIT = 500;
var WATCH_STATUSES = ["planned", "watching", "completed"];
var RECENT_SEARCH_LIMIT = 10;
var QUALITY_OPTIONS = ["1080p", "720p", "540p", "480p", "360p"];
var DEFAULT_QUALITY = "720p";
var DEFAULT_MINI_WINDOW = Object.freeze({
  x: null,
  y: null,
  width: 320,
  height: 540,
  opacity: 0.92,
  autoHide: false
});
var normalizeNumber = (value, fallback, min, max) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
};
var normalizeMiniWindow = (raw) => ({
  x: raw?.x == null || !Number.isFinite(Number(raw.x)) ? null : Math.round(Number(raw.x)),
  y: raw?.y == null || !Number.isFinite(Number(raw.y)) ? null : Math.round(Number(raw.y)),
  width: Math.round(normalizeNumber(raw?.width, DEFAULT_MINI_WINDOW.width, 240, 900)),
  height: Math.round(normalizeNumber(raw?.height, DEFAULT_MINI_WINDOW.height, 360, 1200)),
  opacity: normalizeNumber(raw?.opacity, DEFAULT_MINI_WINDOW.opacity, 0.05, 1),
  autoHide: raw?.autoHide === true
});
var writes = /* @__PURE__ */ new WeakMap();
var mutate = (api, task) => {
  const previous = writes.get(api.storage) || Promise.resolve();
  const result = previous.then(task);
  const settled = result.catch(() => {
  });
  writes.set(api.storage, settled);
  settled.then(() => {
    if (writes.get(api.storage) === settled) writes.delete(api.storage);
  });
  return result;
};
var readStored = async (api, key, fallback) => {
  await writes.get(api.storage);
  return api.storage.getJson(key, fallback);
};
var nonnegative = (value) => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
var normalizeEpisode = (raw) => {
  if (!raw || typeof raw !== "object") return null;
  const episodeIndex = nonnegative(raw.episodeIndex);
  const durationMs = nonnegative(raw.durationMs);
  const positionMs = nonnegative(raw.positionMs);
  return {
    episodeId: typeof raw.episodeId === "string" ? raw.episodeId : "",
    episodeIndex,
    episodeNumber: nonnegative(raw.episodeNumber) || episodeIndex + 1,
    positionMs: durationMs ? Math.min(positionMs, durationMs) : positionMs,
    durationMs,
    completed: raw.completed === true,
    updatedAt: nonnegative(raw.updatedAt)
  };
};
var normalizeHistoryEntry = (raw) => {
  if (!raw || typeof raw !== "object") return null;
  const seriesId = String(raw.seriesId ?? "").trim();
  if (!seriesId) return null;
  const latest = normalizeEpisode(raw);
  const records = Array.isArray(raw.episodes) ? raw.episodes : [raw];
  const seen = /* @__PURE__ */ new Set();
  const episodes = records.map(normalizeEpisode).filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt).filter((entry) => {
    const key = entry.episodeId ? `id:${entry.episodeId}` : `index:${entry.episodeIndex}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, EPISODE_HISTORY_LIMIT);
  return {
    seriesId,
    title: typeof raw.title === "string" ? raw.title : "",
    cover: typeof raw.cover === "string" && raw.cover ? raw.cover : null,
    ...latest,
    episodes
  };
};
var normalizeHistory = (raw) => {
  if (!Array.isArray(raw)) return [];
  const normalized = raw.map(normalizeHistoryEntry).filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt);
  const seen = /* @__PURE__ */ new Set();
  const list = [];
  for (const entry of normalized) {
    if (seen.has(entry.seriesId)) continue;
    seen.add(entry.seriesId);
    list.push(entry);
  }
  return list.slice(0, HISTORY_LIMIT);
};
var readHistory = async (api) => normalizeHistory(await readStored(api, HISTORY_KEY, []));
var getEpisodeProgress = (entry, episode, index) => entry?.episodes?.find((item) => item.episodeId && item.episodeId === episode?.id) || entry?.episodes?.find((item) => !item.episodeId && item.episodeIndex === index) || null;
var resumePosition = (record) => {
  if (!record) return 0;
  if (record.completed && record.durationMs > 0 && record.positionMs >= record.durationMs - 1e3) return 0;
  return record.positionMs || 0;
};
var resumeEpisodeIndex = (entry, episodes) => {
  if (!entry) return 0;
  if (entry.episodeId) {
    const index = episodes.findIndex((episode) => episode.id === entry.episodeId);
    return index >= 0 ? index : 0;
  }
  return entry.episodeIndex < episodes.length ? entry.episodeIndex : 0;
};
var upsertHistory = (api, input) => mutate(api, async () => {
  const entry = normalizeHistoryEntry({ ...input, updatedAt: Date.now() });
  if (!entry) throw new Error("无效的观看记录");
  const list = normalizeHistory(await api.storage.getJson(HISTORY_KEY, []));
  const previous = list.find((item) => item.seriesId === entry.seriesId);
  const oldRecord = getEpisodeProgress(previous, { id: entry.episodeId }, entry.episodeIndex);
  const record = {
    ...normalizeEpisode(entry),
    durationMs: entry.durationMs || oldRecord?.durationMs || 0,
    completed: entry.completed || oldRecord?.completed || false
  };
  entry.episodes = [record, ...(previous?.episodes || []).filter((item) => item !== oldRecord)].slice(0, EPISODE_HISTORY_LIMIT);
  Object.assign(entry, record);
  const next = [entry, ...list.filter((item) => item.seriesId !== entry.seriesId)].slice(0, HISTORY_LIMIT);
  await api.storage.setJson(HISTORY_KEY, next);
  return next;
});
var removeHistory = (api, seriesId) => mutate(api, async () => {
  const list = normalizeHistory(await api.storage.getJson(HISTORY_KEY, []));
  const next = list.filter((item) => item.seriesId !== seriesId);
  await api.storage.setJson(HISTORY_KEY, next);
  return next;
});
var clearHistory = (api) => mutate(api, async () => {
  await api.storage.setJson(HISTORY_KEY, []);
});
var normalizeWatchlist = (raw) => {
  if (!Array.isArray(raw)) return [];
  const seen = /* @__PURE__ */ new Set();
  return raw.filter((entry) => entry && typeof entry.seriesId === "string" && entry.seriesId.trim()).map((entry) => ({
    seriesId: entry.seriesId.trim(),
    title: typeof entry.title === "string" ? entry.title : "",
    cover: typeof entry.cover === "string" ? entry.cover : null,
    count: nonnegative(entry.count),
    status: WATCH_STATUSES.includes(entry.status) ? entry.status : "planned",
    updatedAt: nonnegative(entry.updatedAt)
  })).sort((a, b) => b.updatedAt - a.updatedAt).filter((entry) => {
    if (seen.has(entry.seriesId)) return false;
    seen.add(entry.seriesId);
    return true;
  }).slice(0, WATCHLIST_LIMIT);
};
var readWatchlist = async (api) => normalizeWatchlist(await readStored(api, WATCHLIST_KEY, []));
var saveWatchlistEntry = (api, input) => mutate(api, async () => {
  const list = normalizeWatchlist(await api.storage.getJson(WATCHLIST_KEY, []));
  const previous = list.find((item) => item.seriesId === input.seriesId);
  if (!previous && list.length >= WATCHLIST_LIMIT) throw new Error(`最多收藏 ${WATCHLIST_LIMIT} 部剧`);
  const entry = normalizeWatchlist([{ ...previous, ...input, updatedAt: Date.now() }])[0];
  if (!entry) throw new Error("无效的收藏记录");
  const next = [entry, ...list.filter((item) => item.seriesId !== entry.seriesId)];
  await api.storage.setJson(WATCHLIST_KEY, next);
  return next;
});
var removeWatchlistEntry = (api, seriesId) => mutate(api, async () => {
  const list = normalizeWatchlist(await api.storage.getJson(WATCHLIST_KEY, []));
  const next = list.filter((item) => item.seriesId !== seriesId);
  await api.storage.setJson(WATCHLIST_KEY, next);
  return next;
});
var markWatching = (api, seriesId) => mutate(api, async () => {
  const list = normalizeWatchlist(await api.storage.getJson(WATCHLIST_KEY, []));
  const entry = list.find((item) => item.seriesId === seriesId);
  if (!entry || entry.status !== "planned") return false;
  entry.status = "watching";
  entry.updatedAt = Date.now();
  await api.storage.setJson(WATCHLIST_KEY, list);
  return true;
});
var normalizePrefs = (raw) => ({
  quality: QUALITY_OPTIONS.includes(raw?.quality) ? raw.quality : DEFAULT_QUALITY,
  miniWindow: normalizeMiniWindow(raw?.miniWindow),
  ...normalizePlaybackPrefs(raw)
});
var readPrefs = async (api) => {
  return normalizePrefs(await readStored(api, PREFS_KEY, null));
};
var writePrefs = (api, prefs) => mutate(api, async () => {
  const raw = await api.storage.getJson(PREFS_KEY, null);
  const next = normalizePrefs({ ...raw, ...prefs, miniWindow: { ...raw?.miniWindow, ...prefs?.miniWindow } });
  await api.storage.setJson(PREFS_KEY, next);
  return next;
});
var normalizeRecentSearches = (raw) => {
  if (!Array.isArray(raw)) return [];
  const seen = /* @__PURE__ */ new Set();
  const list = [];
  for (const item of raw) {
    const text = typeof item === "string" ? item.trim().slice(0, 80) : "";
    if (!text || seen.has(text)) continue;
    seen.add(text);
    list.push(text);
    if (list.length >= RECENT_SEARCH_LIMIT) break;
  }
  return list;
};
var readRecentSearches = async (api) => normalizeRecentSearches(await readStored(api, RECENT_SEARCH_KEY, []));
var pushRecentSearch = async (api, query) => {
  const text = String(query || "").trim().slice(0, 80);
  if (!text) return readRecentSearches(api);
  return mutate(api, async () => {
    const list = normalizeRecentSearches(await api.storage.getJson(RECENT_SEARCH_KEY, []));
    const next = [text, ...list.filter((item) => item !== text)].slice(0, RECENT_SEARCH_LIMIT);
    await api.storage.setJson(RECENT_SEARCH_KEY, next);
    return next;
  });
};
var clearRecentSearches = (api) => mutate(api, async () => {
  await api.storage.setJson(RECENT_SEARCH_KEY, []);
});

// src/panel/ui/common.js
function Icon({ ctx, name, size = 14 }) {
  const api = ctx?.api;
  if (!api?.ui || typeof api.ui.icon !== "function") return null;
  let Component = null;
  try {
    Component = api.ui.icon(name);
  } catch {
    Component = null;
  }
  if (!Component) return null;
  return h(Component, { size, strokeWidth: 1.8, "aria-hidden": "true" });
}
function Spinner({ label }) {
  return h("span", {
    className: "hg-spinner",
    role: "status",
    "aria-label": label || "loading"
  });
}
function Cover({ ctx, path, className }) {
  const React = getReact();
  const [src, setSrc] = React.useState(null);
  const [failed, setFailed] = React.useState(!path);
  React.useEffect(() => {
    let alive = true;
    setSrc(null);
    setFailed(!path);
    if (!path || !ctx?.cover) return void 0;
    ctx.cover.load(path).then((url) => {
      if (!alive) return;
      if (url) setSrc(url);
      else setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [path, ctx?.cover]);
  return h(
    "div",
    { className: `hg-cover${className ? ` ${className}` : ""}${src && !failed ? " has-image" : ""}` },
    src && !failed ? h("img", {
      src,
      alt: "",
      loading: "lazy",
      draggable: false,
      onError: () => setFailed(true)
    }) : h("div", { className: "hg-cover-fallback" }, h(Icon, { ctx, name: "Film", size: 18 }))
  );
}
function describeError(t, error) {
  const code = String(error?.code || "UNKNOWN");
  const retrySeconds = Number.isFinite(error?.retryAfterMs) && error.retryAfterMs > 0 ? Math.ceil(error.retryAfterMs / 1e3) : 0;
  let title = t("error.title");
  let message = "";
  switch (code) {
    case "BACKGROUND_UNAVAILABLE":
    case "NET_UNAVAILABLE":
      message = t("error.backgroundUnavailable");
      break;
    case "RATE_LIMITED":
      message = t("error.rateLimited");
      break;
    case "ANONYMOUS_LIMITED":
      message = t("error.rateLimitedAnonymous");
      break;
    case "TIMEOUT":
      message = t("error.timeout");
      break;
    case "TRANSPORT":
      message = t("error.transport");
      break;
    case "CONTENT_UNAVAILABLE":
    case "ALBUM_UNAVAILABLE":
    case "NOT_PROTECTED":
    case "DRM_PROTECTED":
      message = t("error.contentUnavailable");
      break;
    case "NOT_FOUND":
      message = t("error.notFound");
      break;
    case "PROTOCOL":
      message = t("error.protocol");
      break;
    case "CURSOR_EXPIRED":
      message = t("catalog.cursorExpired");
      break;
    case "INVALID_PARAM":
    case "PARAM_INVALID":
    case "INVALID_OPTIONS":
      message = t("error.invalidParam");
      break;
    default:
      message = error?.message || t("error.unknown");
  }
  return {
    code,
    title,
    message,
    rateLimited: code === "RATE_LIMITED" || code === "ANONYMOUS_LIMITED",
    retrySeconds,
    hint: code === "BACKGROUND_UNAVAILABLE" ? t("error.backgroundHint") : "",
    raw: error?.message || ""
  };
}
function ErrorNotice({ ctx, error, onRetry, compact }) {
  const React = getReact();
  const t = ctx.t;
  const info = describeError(t, error);
  const [remaining, setRemaining] = React.useState(info.retrySeconds);
  React.useEffect(() => {
    setRemaining(info.retrySeconds);
    if (!info.retrySeconds) return void 0;
    const timer = setInterval(() => {
      setRemaining((value) => {
        if (value <= 1) {
          clearInterval(timer);
          return 0;
        }
        return value - 1;
      });
    }, 1e3);
    return () => clearInterval(timer);
  }, [error, info.retrySeconds]);
  return h(
    "div",
    { className: `hg-state hg-state-error${compact ? " is-compact" : ""}` },
    h("div", { className: "hg-state-icon" }, h(Icon, { ctx, name: "TriangleAlert", size: 18 })),
    h(
      "div",
      { className: "hg-state-body" },
      h("div", { className: "hg-state-title" }, info.title),
      h("div", { className: "hg-state-text" }, info.message),
      info.hint ? h("div", { className: "hg-state-hint" }, info.hint) : null,
      info.rateLimited && remaining > 0 ? h("div", { className: "hg-state-wait" }, t("error.rateLimitedWait", { seconds: remaining })) : null,
      onRetry ? h(
        "button",
        {
          type: "button",
          className: "hg-btn",
          disabled: remaining > 0,
          onClick: onRetry
        },
        t("action.retry")
      ) : null
    )
  );
}
function EmptyState({ ctx, icon: icon2 = "Inbox", title, hint, action }) {
  return h(
    "div",
    { className: "hg-state hg-state-empty" },
    h("div", { className: "hg-state-icon" }, h(Icon, { ctx, name: icon2, size: 22 })),
    h(
      "div",
      { className: "hg-state-body" },
      h("div", { className: "hg-state-title" }, title),
      hint ? h("div", { className: "hg-state-text" }, hint) : null,
      action || null
    )
  );
}
function SkeletonCards({ count = 4 }) {
  return h(
    "div",
    { className: "hg-grid", "aria-hidden": "true" },
    Array.from(
      { length: count },
      (_, index) => h(
        "div",
        { key: `skeleton-${index}`, className: "hg-card hg-card-skeleton" },
        h("div", { className: "hg-skeleton hg-skeleton-cover" }),
        h("div", { className: "hg-skeleton hg-skeleton-line" }),
        h("div", { className: "hg-skeleton hg-skeleton-line short" })
      )
    )
  );
}
var pad2 = (value) => String(value).padStart(2, "0");
function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms) / 1e3) || 0);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds % 3600 / 60);
  const seconds = totalSeconds % 60;
  return hours > 0 ? `${hours}:${pad2(minutes)}:${pad2(seconds)}` : `${pad2(minutes)}:${pad2(seconds)}`;
}
function formatUptime(ms) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms) / 1e3) || 0);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor(totalSeconds % 86400 / 3600);
  const minutes = Math.floor(totalSeconds % 3600 / 60);
  const seconds = totalSeconds % 60;
  const clock = `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
  return days > 0 ? `${days}d ${clock}` : clock;
}
function formatDateTime(value, locale) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  const date = new Date(timestamp);
  try {
    return new Intl.DateTimeFormat(locale || void 0, {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

// src/panel/ui/select.js
var nextId = 0;
var opened = /* @__PURE__ */ new WeakMap();
var glyph = (doc, path) => {
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [key, value] of Object.entries({ viewBox: "0 0 24 24", width: "14", height: "14", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) svg.setAttribute(key, value);
  const line = doc.createElementNS(svg.namespaceURI, "path");
  line.setAttribute("d", path);
  svg.append(line);
  return svg;
};
function createSelect(initial, element = document.createElement("button")) {
  const doc = element.ownerDocument;
  const win = doc.defaultView;
  const contains = (parent, target) => target instanceof win.Node && parent?.contains(target);
  const menuId = `hg-select-menu-${++nextId}`;
  const label = doc.createElement("span");
  label.className = "hg-select-label";
  const arrow = glyph(doc, "m6 9 6 6 6-6");
  arrow.classList.add("hg-select-arrow");
  element.replaceChildren(label, arrow);
  element.type = "button";
  element.setAttribute("role", "combobox");
  element.setAttribute("aria-haspopup", "listbox");
  element.setAttribute("aria-expanded", "false");
  let props = {};
  let options = [];
  let menu = null;
  let rows = [];
  let active = -1;
  let disposed = false;
  let cleanup = () => {
  };
  let typed = "";
  let typedAt = 0;
  const close = (restoreFocus = false) => {
    if (!menu) return;
    cleanup();
    menu.remove();
    menu = null;
    rows = [];
    element.setAttribute("aria-expanded", "false");
    element.removeAttribute("aria-controls");
    element.removeAttribute("aria-activedescendant");
    if (opened.get(doc) === close) opened.delete(doc);
    if (restoreFocus && element.isConnected) element.focus({ preventScroll: true });
    props.onOpenChange?.(false);
  };
  const highlight = (index, scroll = false) => {
    active = index;
    rows.forEach((row, position2) => row.classList.toggle("is-active", position2 === active));
    if (rows[active]) {
      element.setAttribute("aria-activedescendant", rows[active].id);
      if (scroll) rows[active].scrollIntoView?.({ block: "nearest" });
    } else element.removeAttribute("aria-activedescendant");
  };
  const syncValue = () => {
    const value = String(props.value ?? "");
    const selected = options.find((option) => option.value === value);
    label.textContent = selected?.label ?? value;
    label.title = label.textContent;
    element.value = value;
    element.title = props.title || label.textContent;
    element.setAttribute("aria-label", props.ariaLabel || label.textContent);
    rows.forEach((row, index) => {
      const chosen = options[index].value === value;
      row.setAttribute("aria-selected", String(chosen));
      row.lastChild.style.visibility = chosen ? "visible" : "hidden";
    });
  };
  const position = () => {
    if (!menu) return;
    if (!element.isConnected || element.disabled || element.closest('[hidden], [inert], [aria-hidden="true"]')) return close();
    const rect = element.getBoundingClientRect();
    for (let node = element; node && node !== doc.body; node = node.parentElement) {
      const style = win.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return close();
      if (node !== element) {
        const bounds = node.getBoundingClientRect();
        const clips = (overflow) => /^(auto|scroll|hidden|clip)$/.test(overflow);
        if (bounds.height > 0 && clips(style.overflowY) && (rect.bottom <= bounds.top || rect.top >= bounds.bottom)) return close();
        if (bounds.width > 0 && clips(style.overflowX) && (rect.right <= bounds.left || rect.left >= bounds.right)) return close();
      }
    }
    const viewportWidth = win.innerWidth;
    const viewportHeight = win.innerHeight;
    if (rect.bottom < 0 || rect.top > viewportHeight || rect.right < 0 || rect.left > viewportWidth) return close();
    const width = Math.min(Math.max(rect.width, props.dropdownMinWidth || 128), Math.max(0, viewportWidth - 16));
    menu.style.width = `${width}px`;
    const desired = Math.min(240, menu.scrollHeight || options.length * 32 + 14);
    const below = Math.max(0, viewportHeight - rect.bottom - 12);
    const above = Math.max(0, rect.top - 12);
    const up = below < desired && above > below;
    const height = Math.min(desired, up ? above : below);
    menu.dataset.placement = up ? "top" : "bottom";
    menu.style.maxHeight = `${height}px`;
    menu.style.left = `${Math.max(8, Math.min(rect.left, viewportWidth - width - 8))}px`;
    menu.style.top = `${up ? Math.max(8, rect.top - height - 4) : rect.bottom + 4}px`;
  };
  const choose = (index) => {
    const option = options[index];
    if (!option || option.disabled || element.disabled) return;
    const changed = String(props.value ?? "") !== option.value;
    props = { ...props, value: option.value };
    syncValue();
    close(true);
    if (changed) props.onChange?.(option.value);
  };
  const renderOptions = () => {
    rows = options.map((option, index) => {
      const row = doc.createElement("button");
      row.type = "button";
      row.tabIndex = -1;
      row.id = `${menuId}-${index}`;
      row.className = "hg-select-option";
      row.setAttribute("role", "option");
      row.dataset.value = option.value;
      row.disabled = option.disabled;
      row.title = option.label;
      const text = doc.createElement("span");
      text.textContent = option.label;
      row.append(text, glyph(doc, "m20 6-11 11-5-5"));
      row.addEventListener("mousedown", (event) => event.preventDefault());
      row.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        choose(index);
      });
      row.addEventListener("pointermove", () => {
        if (!option.disabled) highlight(index);
      });
      return row;
    });
    menu.replaceChildren(...rows);
    syncValue();
    const selected = options.findIndex((option) => option.value === String(props.value ?? "") && !option.disabled);
    highlight(selected >= 0 ? selected : options.findIndex((option) => !option.disabled));
  };
  const open = () => {
    if (disposed || element.disabled || props.active === false || menu || !options.length) return;
    opened.get(doc)?.();
    menu = doc.createElement("div");
    menu.id = menuId;
    menu.className = "hg-select-menu";
    menu.setAttribute("role", "listbox");
    menu.setAttribute("aria-label", props.ariaLabel || label.textContent);
    menu.addEventListener("keydown", onKeyDown);
    renderOptions();
    doc.body.append(menu);
    element.setAttribute("aria-expanded", "true");
    element.setAttribute("aria-controls", menuId);
    element.focus({ preventScroll: true });
    opened.set(doc, close);
    typed = "";
    const outside = (event) => {
      if (!contains(element, event.target) && !contains(menu, event.target)) close();
    };
    const scroll = (event) => {
      if (!contains(menu, event.target)) position();
    };
    const resize = typeof win.ResizeObserver === "function" ? new win.ResizeObserver(position) : null;
    resize?.observe(element);
    const observer = new win.MutationObserver(position);
    for (let node = element; node; node = node.parentElement) {
      observer.observe(node, { childList: true, attributes: true, attributeFilter: ["hidden", "inert", "aria-hidden", "class", "style"] });
    }
    doc.addEventListener("pointerdown", outside, true);
    doc.addEventListener("focusin", outside);
    win.addEventListener("resize", position);
    win.addEventListener("scroll", scroll, true);
    cleanup = () => {
      observer.disconnect();
      resize?.disconnect();
      doc.removeEventListener("pointerdown", outside, true);
      doc.removeEventListener("focusin", outside);
      win.removeEventListener("resize", position);
      win.removeEventListener("scroll", scroll, true);
    };
    props.onOpenChange?.(true);
    position();
    if (menu) highlight(active, true);
  };
  const onClick = (event) => {
    event.stopPropagation();
    menu ? close() : open();
  };
  const onKeyDown = (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || element.disabled) return;
    const key = event.key;
    if (key === "Tab") {
      close(true);
      return;
    }
    if (key === "Escape") {
      if (!menu) return;
      close(true);
    } else if (key === "Enter" || key === " " || key === "Spacebar") {
      menu ? choose(active) : open();
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(key)) {
      const wasOpen = Boolean(menu);
      open();
      const enabled = options.map((option, index) => option.disabled ? -1 : index).filter((index) => index >= 0);
      if (key === "Home") highlight(enabled[0] ?? -1, true);
      else if (key === "End") highlight(enabled.at(-1) ?? -1, true);
      else if (wasOpen && enabled.length) {
        const offset = key === "ArrowDown" ? 1 : -1;
        highlight(enabled[(enabled.indexOf(active) + offset + enabled.length) % enabled.length], true);
      }
    } else if (key.length === 1) {
      open();
      const now = Date.now();
      typed = now - typedAt > 700 ? key : typed + key;
      typedAt = now;
      const index = options.findIndex((option) => !option.disabled && option.label.toLocaleLowerCase().startsWith(typed.toLocaleLowerCase()));
      if (index >= 0) highlight(index, true);
    } else return;
    event.preventDefault();
    event.stopPropagation();
  };
  element.addEventListener("click", onClick);
  element.addEventListener("keydown", onKeyDown);
  const update = (next) => {
    if (disposed) return;
    const previousValue = props.value;
    props = { ...props, ...next };
    const normalized = (props.options || []).map((option) => ({ value: String(option.value), label: String(option.label), disabled: option.disabled === true }));
    const changed = JSON.stringify(options) !== JSON.stringify(normalized);
    options = normalized;
    element.className = `hg-select${props.className ? ` ${props.className}` : ""}`;
    element.disabled = props.disabled === true;
    if (props.id) element.id = props.id;
    if (props.filterKey) element.dataset.filter = props.filterKey;
    if (element.disabled || props.active === false) close();
    if (menu && changed) renderOptions();
    else {
      syncValue();
      if (menu && previousValue !== props.value) highlight(options.findIndex((option) => option.value === String(props.value)));
    }
    position();
  };
  update(initial);
  return {
    element,
    update,
    close,
    isOpen: () => Boolean(menu),
    destroy() {
      if (disposed) return;
      close();
      disposed = true;
      element.removeEventListener("click", onClick);
      element.removeEventListener("keydown", onKeyDown);
    }
  };
}
function Select(props) {
  const React = getReact();
  const ref = React.useRef(null);
  const control = React.useRef(null);
  React.useLayoutEffect(() => {
    control.current = createSelect(props, ref.current);
    return () => {
      control.current.destroy();
      control.current = null;
    };
  }, []);
  React.useLayoutEffect(() => {
    control.current?.update(props);
  });
  return h("button", { ref });
}

// src/panel/pages/discover.js
var dedupeById = (list) => {
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const item of list) {
    if (!item || typeof item !== "object" || !item.id || seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }
  return result;
};
function DiscoverPage({ ctx, active }) {
  const React = getReact();
  const t = ctx.t;
  const rpc = ctx.rpc;
  const [items, setItems] = React.useState([]);
  const [hasMore, setHasMore] = React.useState(false);
  const [status, setStatus] = React.useState("idle");
  const [error, setError] = React.useState(null);
  const [loaded, setLoaded] = React.useState(false);
  const [pull, setPull] = React.useState(0);
  const scrollRef = React.useRef(null);
  const sentinelRef = React.useRef(null);
  const itemsRef = React.useRef([]);
  const cursorRef = React.useRef(null);
  const hasMoreRef = React.useRef(false);
  const busyRef = React.useRef(false);
  const seqRef = React.useRef(0);
  const loadedRef = React.useRef(false);
  const scheduleNearEndCheckRef = React.useRef(null);
  const autoMorePausedRef = React.useRef(false);
  const suppressUntilRef = React.useRef(0);
  const pullRef = React.useRef({ active: false, startY: 0, moved: false, value: 0 });
  React.useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  const loadFirst = React.useCallback(
    async (refresh) => {
      const seq = seqRef.current + 1;
      seqRef.current = seq;
      busyRef.current = true;
      setStatus(refresh ? "refreshing" : "loading");
      setError(null);
      let succeeded = false;
      try {
        const page = await rpc.discover();
        if (seq !== seqRef.current) return;
        const list = dedupeById(Array.isArray(page?.items) ? page.items : []);
        itemsRef.current = list;
        setItems(list);
        cursorRef.current = page?.cursor ?? null;
        hasMoreRef.current = page?.hasMore === true;
        autoMorePausedRef.current = false;
        setHasMore(hasMoreRef.current);
        setStatus("idle");
        setLoaded(true);
        loadedRef.current = true;
        if (refresh && scrollRef.current && typeof scrollRef.current.scrollTo === "function") {
          scrollRef.current.scrollTo({ top: 0 });
        }
        succeeded = true;
      } catch (loadError) {
        if (seq !== seqRef.current) return;
        setError(loadError);
        setStatus("error");
      } finally {
        if (seq === seqRef.current) {
          busyRef.current = false;
          if (succeeded && hasMoreRef.current) scheduleNearEndCheckRef.current?.();
        }
      }
    },
    [rpc]
  );
  const loadMore = React.useCallback(async () => {
    if (busyRef.current || !hasMoreRef.current || !cursorRef.current) return;
    const seq = seqRef.current;
    const requestCursor = cursorRef.current;
    busyRef.current = true;
    setStatus("more");
    setError(null);
    let succeeded = false;
    try {
      const page = await rpc.discover(requestCursor);
      if (seq !== seqRef.current) return;
      const incoming = dedupeById(Array.isArray(page?.items) ? page.items : []);
      const merged = dedupeById([...itemsRef.current, ...incoming]);
      const nextCursor = page?.cursor ?? null;
      const nextHasMore = page?.hasMore === true && Boolean(nextCursor) && nextCursor !== requestCursor;
      itemsRef.current = merged;
      setItems(merged);
      cursorRef.current = nextCursor;
      hasMoreRef.current = nextHasMore;
      autoMorePausedRef.current = false;
      setHasMore(nextHasMore);
      setStatus("idle");
      succeeded = true;
    } catch (loadError) {
      if (seq !== seqRef.current) return;
      autoMorePausedRef.current = true;
      setError(loadError);
      setStatus("idle");
    } finally {
      if (seq === seqRef.current) {
        busyRef.current = false;
        if (succeeded && hasMoreRef.current) scheduleNearEndCheckRef.current?.();
      }
    }
  }, [rpc]);
  React.useEffect(() => {
    if (!active) return;
    if (loadedRef.current || busyRef.current) return;
    void loadFirst(false);
  }, [active, loadFirst]);
  React.useEffect(() => {
    if (!active) return void 0;
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (!root) return void 0;
    let disposed = false;
    let frame = null;
    const checkNearEnd = () => {
      if (disposed) return;
      const nearEnd = root.scrollHeight - root.scrollTop - root.clientHeight < 240;
      if (!nearEnd) {
        autoMorePausedRef.current = false;
        return;
      }
      if (!autoMorePausedRef.current) void loadMore();
    };
    const scheduleNearEndCheck = () => {
      if (disposed || frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        checkNearEnd();
      });
    };
    scheduleNearEndCheckRef.current = scheduleNearEndCheck;
    const intersectionObserver = typeof IntersectionObserver === "function" ? new IntersectionObserver(
      () => {
        checkNearEnd();
      },
      { root, rootMargin: "240px 0px" }
    ) : null;
    const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(checkNearEnd) : null;
    if (sentinel) intersectionObserver?.observe(sentinel);
    resizeObserver?.observe(root);
    root.addEventListener("scroll", checkNearEnd, { passive: true });
    window.addEventListener("resize", checkNearEnd);
    checkNearEnd();
    return () => {
      disposed = true;
      if (frame !== null) window.cancelAnimationFrame(frame);
      if (scheduleNearEndCheckRef.current === scheduleNearEndCheck) scheduleNearEndCheckRef.current = null;
      intersectionObserver?.disconnect();
      resizeObserver?.disconnect();
      root.removeEventListener("scroll", checkNearEnd);
      window.removeEventListener("resize", checkNearEnd);
    };
  }, [active, hasMore, items.length, loadMore]);
  const endPull = () => {
    const state = pullRef.current;
    if (!state.active) return;
    state.active = false;
    const shouldRefresh = state.value >= 48;
    const moved = state.moved;
    state.value = 0;
    setPull(0);
    if (moved) suppressUntilRef.current = Date.now() + 250;
    if (shouldRefresh && !busyRef.current) void loadFirst(true);
  };
  const onPointerDown = (event) => {
    if (busyRef.current) return;
    const root = scrollRef.current;
    if (!root || root.scrollTop > 0) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    pullRef.current = { active: true, startY: event.clientY, moved: false, value: 0 };
  };
  const onPointerMove = (event) => {
    const state = pullRef.current;
    if (!state.active) return;
    const root = scrollRef.current;
    const delta = event.clientY - state.startY;
    if (!root || root.scrollTop > 0 || delta <= 0) {
      if (state.value !== 0) {
        state.value = 0;
        setPull(0);
      }
      if (delta < -6) state.active = false;
      return;
    }
    if (delta > 8) state.moved = true;
    const value = Math.min(72, delta * 0.55);
    state.value = value;
    setPull(value);
  };
  const openItem = (item) => {
    if (Date.now() < suppressUntilRef.current) return;
    ctx.openSeries(item);
  };
  const busy = status === "loading" || status === "refreshing" || status === "more";
  const showEmpty = loaded && !busy && items.length === 0 && !error;
  return h(
    "div",
    { className: "hg-page hg-discover" },
    h(
      "div",
      { className: "hg-page-head" },
      h("div", { className: "hg-page-title" }, t("discover.heading")),
      h(
        "button",
        {
          type: "button",
          className: `hg-iconbtn${busy ? " is-busy" : ""}`,
          title: t("action.refresh"),
          "aria-label": t("action.refresh"),
          disabled: busy,
          onClick: () => void loadFirst(true)
        },
        h(Icon, { ctx, name: "RefreshCw", size: 15 })
      )
    ),
    h(
      "div",
      {
        className: "hg-scroll hg-pull",
        ref: scrollRef,
        onPointerDown,
        onPointerMove,
        onPointerUp: endPull,
        onPointerCancel: endPull,
        onPointerLeave: endPull
      },
      h(
        "div",
        { className: "hg-pull-bar", style: { height: `${pull}px` } },
        pull > 0 ? h(
          "span",
          { className: "hg-pull-text" },
          pull >= 48 ? t("discover.release") : t("discover.pull")
        ) : null
      ),
      status === "refreshing" ? h(
        "div",
        { className: "hg-loading-line" },
        h(Spinner, { label: t("discover.refreshing") }),
        h("span", null, t("discover.refreshing"))
      ) : null,
      error && items.length > 0 ? h(ErrorNotice, { ctx, error, compact: true, onRetry: () => void loadFirst(true) }) : null,
      items.length === 0 && (status === "loading" || status === "refreshing") ? h(SkeletonCards, { count: 4 }) : null,
      items.length === 0 && status === "error" && error ? h(ErrorNotice, { ctx, error, onRetry: () => void loadFirst(false) }) : null,
      showEmpty ? h(EmptyState, {
        ctx,
        icon: "Popcorn",
        title: t("discover.empty"),
        hint: t("discover.emptyHint"),
        action: h(
          "button",
          { type: "button", className: "hg-btn", onClick: () => void loadFirst(true) },
          t("action.refresh")
        )
      }) : null,
      items.length > 0 ? h(
        "div",
        { className: "hg-grid" },
        items.map(
          (item) => h(
            "button",
            {
              key: item.id,
              type: "button",
              className: "hg-card",
              title: item.title || t("unit.untitled"),
              onClick: () => openItem(item)
            },
            h(
              "div",
              { className: "hg-card-cover" },
              h(Cover, { ctx, path: item.cover }),
              item.count != null ? h("span", { className: "hg-card-badge" }, t("unit.episodes", { count: item.count })) : null
            ),
            h("div", { className: "hg-card-title" }, item.title || t("unit.untitled"))
          )
        )
      ) : null,
      items.length > 0 ? h(
        "div",
        { className: "hg-list-foot", ref: sentinelRef },
        status === "more" ? h(Spinner, { label: t("discover.loadingMore") }) : hasMore ? h("span", null, t("action.loadMore")) : h("span", null, t("discover.end"))
      ) : null
    )
  );
}

// src/panel/pages/catalog.js
var emptyList = () => ({ items: [], page: null, cursor: null, hasMore: false, status: "idle", error: null });
var mergeItems = (previous, incoming) => {
  const seen = /* @__PURE__ */ new Set();
  return [...previous, ...Array.isArray(incoming) ? incoming : []].filter((item) => {
    if (!item?.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
};
function useCatalogList(React, active, request) {
  const [state, setState] = React.useState(emptyList);
  const stateRef = React.useRef(state);
  const identity = React.useRef(null);
  const generation = React.useRef(0);
  const busy = React.useRef(false);
  const loaded = React.useRef(false);
  const alive = React.useRef(true);
  const seenCursors = React.useRef(/* @__PURE__ */ new Set());
  const publish = (next) => {
    stateRef.current = next;
    setState(next);
  };
  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current += 1;
    };
  }, []);
  const load = React.useCallback(async (append = false) => {
    if (append && identity.current !== request) return;
    if (busy.current || append && !stateRef.current.hasMore) return;
    const seq = append ? generation.current : ++generation.current;
    const before = stateRef.current;
    const cursor = append ? before.cursor : null;
    if (!append) seenCursors.current.clear();
    if (cursor) seenCursors.current.add(cursor);
    busy.current = true;
    publish({ ...append ? before : emptyList(), status: append ? "more" : "loading", error: null });
    try {
      const page = await request(cursor);
      if (!alive.current || seq !== generation.current) return;
      const nextCursor = page?.cursor || null;
      loaded.current = true;
      publish({
        items: mergeItems(append ? before.items : [], page?.items),
        page,
        cursor: nextCursor,
        hasMore: page?.hasMore === true && Boolean(nextCursor) && !seenCursors.current.has(nextCursor),
        status: "ready",
        error: null
      });
    } catch (error) {
      if (!alive.current || seq !== generation.current) return;
      publish({ ...append ? before : emptyList(), status: "error", error });
    } finally {
      if (seq === generation.current) busy.current = false;
    }
  }, [request]);
  React.useEffect(() => {
    if (identity.current !== request) {
      identity.current = request;
      generation.current += 1;
      busy.current = false;
      loaded.current = false;
      publish(emptyList());
    }
    if (active && !loaded.current && !busy.current) void load();
  }, [active, request, load]);
  return { ...state, load, busy: state.status === "loading" || state.status === "more" };
}
function CatalogItems({ ctx, list, active, scrollRef, ranked = false }) {
  const React = getReact();
  const t = ctx.t;
  const sentinelRef = React.useRef(null);
  React.useEffect(() => {
    if (!active || list.status !== "ready" || !list.hasMore) return void 0;
    const root = scrollRef.current;
    if (!root) return void 0;
    let disposed = false;
    const checkNearEnd = () => {
      if (disposed || root.clientHeight <= 0) return;
      if (root.scrollHeight - root.scrollTop - root.clientHeight < 240) void list.load(true);
    };
    const intersectionObserver = typeof IntersectionObserver === "function" ? new IntersectionObserver(checkNearEnd, { root, rootMargin: "240px 0px" }) : null;
    const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(checkNearEnd) : null;
    if (sentinelRef.current) intersectionObserver?.observe(sentinelRef.current);
    resizeObserver?.observe(root);
    root.addEventListener("scroll", checkNearEnd, { passive: true });
    window.addEventListener("resize", checkNearEnd);
    checkNearEnd();
    return () => {
      disposed = true;
      intersectionObserver?.disconnect();
      resizeObserver?.disconnect();
      root.removeEventListener("scroll", checkNearEnd);
      window.removeEventListener("resize", checkNearEnd);
    };
  }, [active, scrollRef, list.load, list.status, list.hasMore, list.cursor]);
  return h(
    "div",
    { className: "hg-catalog-results", "aria-busy": list.busy },
    list.error ? h(ErrorNotice, {
      ctx,
      error: list.error,
      compact: list.items.length > 0,
      onRetry: () => void list.load(list.hasMore && list.error.code !== "CURSOR_EXPIRED")
    }) : null,
    list.status === "loading" ? h(SkeletonCards, { count: 4 }) : null,
    list.status === "ready" && list.items.length === 0 && !list.hasMore ? h(EmptyState, {
      ctx,
      icon: ranked ? "Trophy" : "ListFilter",
      title: t("catalog.empty"),
      hint: t("catalog.emptyHint")
    }) : null,
    list.items.length ? h(
      "div",
      { className: ranked ? "hg-rank-list" : "hg-grid" },
      list.items.map((item) => h(
        "button",
        {
          key: item.id,
          type: "button",
          className: ranked ? "hg-rank-item" : "hg-card",
          title: item.title || t("unit.untitled"),
          onClick: () => ctx.openSeries(item)
        },
        ranked ? h("span", {
          className: `hg-rank-number${!item.promoted && item.position > 0 && item.position <= 3 ? " is-top" : ""}`,
          "aria-label": item.promoted ? t("catalog.promoted") : item.position ? t("catalog.rankNumber", { number: item.position }) : void 0
        }, item.promoted ? "—" : item.position || "—") : null,
        h(
          "div",
          { className: "hg-card-cover" },
          h(Cover, { ctx, path: item.cover }),
          !ranked && item.count != null ? h("span", { className: "hg-card-badge" }, t("unit.episodes", { count: item.count })) : null
        ),
        h(
          "div",
          { className: ranked ? "hg-rank-info" : "hg-card-info" },
          h("div", { className: "hg-card-title" }, item.title || t("unit.untitled")),
          ranked && item.count != null ? h("div", { className: "hg-meta" }, t("unit.episodes", { count: item.count })) : null,
          ranked ? h("div", { className: "hg-rank-score" }, item.promoted ? t("catalog.promoted") : item.score) : null
        )
      ))
    ) : null,
    list.items.length || list.hasMore ? h(
      "div",
      { className: "hg-list-foot", ref: sentinelRef },
      list.status === "more" ? h(Spinner, { label: t("discover.loadingMore") }) : list.hasMore ? !list.error ? h("span", null, t("action.loadMore")) : null : h("span", null, t("discover.end"))
    ) : null
  );
}
function RankPage({ ctx, active }) {
  const React = getReact();
  const t = ctx.t;
  const [query, setQuery] = React.useState({});
  const [directory, setDirectory] = React.useState([]);
  const request = React.useMemo(() => {
    let resolved = query;
    return async (cursor) => {
      const page = await ctx.rpc.getRank({ ...cursor ? resolved : query, cursor });
      resolved = { content: page?.content || query.content, board: page?.board || query.board };
      return page;
    };
  }, [ctx.rpc, query]);
  const list = useCatalogList(React, active, request);
  const scroll = React.useRef(null);
  React.useEffect(() => {
    if (list.page?.contents?.length) setDirectory(list.page.contents);
  }, [list.page]);
  React.useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = 0;
  }, [query]);
  const content = list.page?.content || query.content || directory.find((item) => item.selected)?.id || directory[0]?.id || "";
  const boards = directory.find((item) => item.id === content)?.boards || [];
  const board = list.page?.board || query.board || boards.find((item) => item.selected)?.id || "";
  return h(
    "div",
    { className: "hg-page hg-ranking" },
    h(
      "div",
      { className: "hg-page-head" },
      h("div", { className: "hg-page-title" }, t("catalog.rank")),
      h(
        "button",
        {
          type: "button",
          className: "hg-iconbtn",
          disabled: list.busy,
          title: t("action.refresh"),
          "aria-label": t("action.refresh"),
          onClick: () => void list.load()
        },
        h(Icon, { ctx, name: "RefreshCw", size: 15 })
      )
    ),
    h(
      "div",
      { className: "hg-scroll", ref: scroll },
      directory.length ? h(
        "div",
        { className: "hg-catalog-controls" },
        h(
          "label",
          { className: "hg-catalog-field" },
          h("span", null, t("catalog.content")),
          h(Select, {
            ariaLabel: t("catalog.content"),
            value: content,
            active,
            onChange: (value) => setQuery({ content: value }),
            options: directory.map((item) => ({ value: item.id, label: item.name }))
          })
        ),
        boards.length ? h(
          "label",
          { className: "hg-catalog-field" },
          h("span", null, t("catalog.board")),
          h(Select, {
            ariaLabel: t("catalog.board"),
            value: board,
            active,
            onChange: (value) => setQuery({ content, board: value }),
            options: [
              ...!board ? [{ value: "", label: t("catalog.defaultBoard") }] : [],
              ...boards.map((item) => ({ value: item.id, label: item.name }))
            ]
          })
        ) : null
      ) : null,
      h(CatalogItems, { ctx, list, active, scrollRef: scroll, ranked: true })
    )
  );
}
function FilterPage({ ctx, active }) {
  const React = getReact();
  const t = ctx.t;
  const [selections, setSelections] = React.useState({});
  const [panel, setPanel] = React.useState({ genre: null, rows: [], status: "idle", error: null });
  const [reload, setReload] = React.useState(0);
  const panelSeq = React.useRef(0);
  const scroll = React.useRef(null);
  const genre = selections.genre?.[0] || "";
  const request = React.useCallback((cursor) => ctx.rpc.filterSeries(selections, cursor), [ctx.rpc, selections]);
  const list = useCatalogList(React, active && panel.status === "ready" && panel.genre === genre, request);
  React.useEffect(() => {
    if (!active || panel.genre === genre && panel.status === "ready") return void 0;
    let alive = true;
    const seq = ++panelSeq.current;
    setPanel((prev) => ({ ...prev, status: "loading", error: null }));
    ctx.rpc.getFilterPanel(genre).then((result) => {
      if (!alive || seq !== panelSeq.current) return;
      setPanel({ genre, rows: Array.isArray(result?.rows) ? result.rows : [], status: "ready", error: null });
    }).catch((error) => {
      if (alive && seq === panelSeq.current) setPanel((prev) => ({ ...prev, status: "error", error }));
    });
    return () => {
      alive = false;
    };
  }, [ctx.rpc, active, genre, reload]);
  React.useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = 0;
  }, [selections]);
  const choose = (key, value) => {
    setSelections((previous) => {
      const next = key === "genre" ? {} : { ...previous };
      if (value) next[key] = [value];
      else delete next[key];
      return next;
    });
  };
  const currentPanel = panel.genre === genre;
  return h(
    "div",
    { className: "hg-page hg-filter-page" },
    h(
      "div",
      { className: "hg-page-head" },
      h("div", { className: "hg-page-title" }, t("catalog.filter")),
      h("button", {
        type: "button",
        className: "hg-linkbtn",
        disabled: !Object.keys(selections).length,
        onClick: () => setSelections({})
      }, t("catalog.reset")),
      h(
        "button",
        {
          type: "button",
          className: "hg-iconbtn",
          disabled: list.busy || panel.status !== "ready" || !currentPanel,
          title: t("action.refresh"),
          "aria-label": t("action.refresh"),
          onClick: () => void list.load()
        },
        h(Icon, { ctx, name: "RefreshCw", size: 15 })
      )
    ),
    h(
      "div",
      { className: "hg-scroll", ref: scroll },
      panel.status === "loading" ? h(
        "div",
        { className: "hg-loading-line" },
        h(Spinner, { label: t("catalog.filtersLoading") }),
        t("catalog.filtersLoading")
      ) : null,
      panel.error ? h(ErrorNotice, { ctx, error: panel.error, onRetry: () => setReload((value) => value + 1) }) : null,
      currentPanel && panel.rows.length ? h(
        "div",
        { className: "hg-catalog-controls hg-filter-controls" },
        panel.rows.map((row) => h(
          "label",
          { key: row.key, className: "hg-catalog-field" },
          h("span", null, row.name),
          h(Select, {
            ariaLabel: row.name,
            filterKey: row.key,
            active,
            value: selections[row.key]?.[0] || "",
            disabled: panel.status !== "ready",
            onChange: (value) => choose(row.key, value),
            options: [
              ...!row.options.some((option) => option.value === "") ? [{ value: "", label: t("catalog.any") }] : [],
              ...row.options.map((option) => ({ value: option.value, label: option.name }))
            ]
          })
        ))
      ) : null,
      currentPanel && panel.status === "ready" ? h(CatalogItems, { ctx, list, active, scrollRef: scroll }) : null
    )
  );
}
function DiscoveryPage({ ctx, active }) {
  const React = getReact();
  const [mode, setMode] = React.useState("recommend");
  const [visited, setVisited] = React.useState({ recommend: true });
  const pages = { recommend: DiscoverPage, rank: RankPage, filter: FilterPage };
  return h(
    "div",
    { className: "hg-page hg-discovery" },
    h(
      "div",
      { className: "hg-discovery-modes", role: "group", "aria-label": ctx.t("catalog.navigation") },
      Object.keys(pages).map((id) => h("button", {
        type: "button",
        key: id,
        className: `hg-discovery-mode${mode === id ? " is-active" : ""}`,
        "aria-pressed": mode === id,
        onClick: () => {
          setMode(id);
          setVisited((prev) => ({ ...prev, [id]: true }));
        }
      }, ctx.t(`catalog.${id}`)))
    ),
    Object.entries(pages).map(([id, Component]) => visited[id] ? h("div", {
      key: id,
      className: "hg-discovery-pane",
      hidden: mode !== id
    }, h(Component, { ctx, active: active && mode === id })) : null)
  );
}

// src/panel/ui/auto-load.js
function useAutoLoadMore({ active, ready, hasMore, cursor, scrollRef, sentinelRef, load }) {
  const React = getReact();
  React.useEffect(() => {
    if (!active || !ready || !hasMore) return void 0;
    const root = scrollRef.current;
    if (!root) return void 0;
    let disposed = false;
    const check = () => {
      if (!disposed && root.clientHeight > 0 && root.scrollHeight - root.scrollTop - root.clientHeight < 240) load();
    };
    const intersection = typeof IntersectionObserver === "function" ? new IntersectionObserver(check, { root, rootMargin: "240px 0px" }) : null;
    const resize = typeof ResizeObserver === "function" ? new ResizeObserver(check) : null;
    if (sentinelRef.current) intersection?.observe(sentinelRef.current);
    resize?.observe(root);
    root.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    check();
    return () => {
      disposed = true;
      intersection?.disconnect();
      resize?.disconnect();
      root.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, [active, ready, hasMore, cursor, scrollRef, sentinelRef, load]);
}

// src/panel/pages/search-explore.js
function SearchExplore({ ctx, active, visible, onSearch }) {
  const React = getReact();
  const [state, setState] = React.useState({ status: "idle", data: null, error: null });
  const [retry, setRetry] = React.useState(0);
  const loaded = React.useRef(false);
  React.useEffect(() => {
    if (!active || !visible || loaded.current) return void 0;
    let alive = true;
    setState((prev) => ({ ...prev, status: "loading", error: null }));
    Promise.resolve().then(() => ctx.rpc.hotSearch()).then((data) => {
      if (!alive) return;
      loaded.current = true;
      setState({ status: "ready", data, error: null });
    }).catch((error) => {
      if (alive) setState({ status: "error", data: null, error });
    });
    return () => {
      alive = false;
    };
  }, [ctx.rpc, active, visible, retry]);
  if (!visible) return null;
  const { t } = ctx;
  const guesses = state.data?.guesses || [];
  const boards = state.data?.boards || [];
  return h(
    "div",
    { className: "hg-search-explore" },
    state.status === "loading" ? h(
      "div",
      { className: "hg-loading-line" },
      h(Spinner, { label: t("search.hotLoading") }),
      t("search.hotLoading")
    ) : null,
    state.error ? h(ErrorNotice, { ctx, error: state.error, compact: true, onRetry: () => setRetry((value) => value + 1) }) : null,
    guesses.length ? h(
      "section",
      { className: "hg-search-section" },
      h("div", { className: "hg-sec-head" }, t("search.guesses")),
      h("div", { className: "hg-chips" }, guesses.map((item) => h("button", {
        key: item.id,
        type: "button",
        className: "hg-chip",
        title: item.title,
        onClick: () => ctx.openSeries(item)
      }, item.title)))
    ) : null,
    boards.map((board, index) => h(
      "section",
      { key: `${index}:${board.name}`, className: "hg-search-section" },
      h("div", { className: "hg-sec-head" }, board.name),
      h(
        "div",
        { className: "hg-hot-list" },
        (board.items || []).map((item, position) => h(
          "button",
          {
            key: item.id,
            type: "button",
            className: "hg-hot-row",
            onClick: () => ctx.openSeries(item),
            title: item.title
          },
          h("span", { className: `hg-hot-position${(item.position || position + 1) <= 3 ? " is-top" : ""}` }, item.position || position + 1),
          h("span", { className: "hg-hot-title" }, item.title),
          item.tag ? h("span", { className: "hg-hot-tag" }, item.tag) : null,
          item.score ? h("span", { className: "hg-hot-score" }, item.score) : null
        )),
        (board.topics || []).map((topic) => h(
          "button",
          {
            key: `topic:${topic.query}`,
            type: "button",
            className: "hg-hot-row hg-hot-topic",
            onClick: () => onSearch(topic.query),
            title: topic.title
          },
          h("span", { className: "hg-hot-position", "aria-hidden": true }, "#"),
          h("span", { className: "hg-hot-title" }, topic.title),
          topic.heat ? h("span", { className: "hg-hot-score" }, topic.heat) : null
        ))
      )
    ))
  );
}

// src/panel/pages/search.js
var normalize = (value) => String(value || "").trim().slice(0, 80);
var empty = () => ({ query: "", items: [], cursor: null, hasMore: false, status: "idle", error: null });
var merge = (previous, incoming) => {
  const seen = /* @__PURE__ */ new Set();
  return [...previous, ...Array.isArray(incoming) ? incoming : []].filter((item) => {
    if (!item?.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
};
function SearchPage({ ctx, active }) {
  const React = getReact();
  const { t, rpc, api } = ctx;
  const [text, setText] = React.useState("");
  const [list, setList] = React.useState(empty);
  const [recent, setRecent] = React.useState([]);
  const [suggestions, setSuggestions] = React.useState([]);
  const [selected, setSelected] = React.useState(-1);
  const [focused, setFocused] = React.useState(false);
  const [composing, setComposing] = React.useState(false);
  const [dismissed, setDismissed] = React.useState(false);
  const input = React.useRef(null);
  const scroll = React.useRef(null);
  const sentinel = React.useRef(null);
  const live = React.useRef(true);
  const enabled = React.useRef(active);
  enabled.current = active;
  const composition = React.useRef(false);
  const query = React.useRef("");
  const current = React.useRef(list);
  const generation = React.useRef(0);
  const suggestionSeq = React.useRef(0);
  const recentSeq = React.useRef(0);
  const busy = React.useRef(false);
  const timer = React.useRef(null);
  const cursors = React.useRef(/* @__PURE__ */ new Set());
  const popupId = React.useId();
  const publish = (next) => {
    current.current = next;
    setList(next);
  };
  const cancelDebounce = () => {
    clearTimeout(timer.current);
    timer.current = null;
  };
  React.useEffect(() => {
    live.current = true;
    const seq = ++recentSeq.current;
    readRecentSearches(api).then((rows) => {
      if (live.current && seq === recentSeq.current) setRecent(rows);
    }).catch(() => {
    });
    return () => {
      live.current = false;
      generation.current += 1;
      suggestionSeq.current += 1;
      cancelDebounce();
    };
  }, [api]);
  const changeText = (value) => {
    cancelDebounce();
    setText(value);
    setDismissed(false);
    setSelected(-1);
    setSuggestions([]);
    suggestionSeq.current += 1;
    const q = normalize(value);
    if (q !== query.current) {
      query.current = q;
      generation.current += 1;
      busy.current = false;
      cursors.current.clear();
      publish(empty());
      if (scroll.current) scroll.current.scrollTop = 0;
    }
  };
  const load = React.useCallback(async (q, append = false) => {
    if (!q || !enabled.current || composition.current || q !== query.current || busy.current) return;
    const before = current.current;
    if (append && (!before.hasMore || !before.cursor || before.query !== q)) return;
    const seq = ++generation.current;
    const recentVersion = recentSeq.current;
    const cursor = append ? before.cursor : null;
    if (!append) cursors.current.clear();
    if (cursor) cursors.current.add(cursor);
    busy.current = true;
    publish({ ...append ? before : empty(), query: q, status: append ? "more" : "loading", error: null });
    try {
      const page = await rpc.search(q, cursor);
      if (!live.current || seq !== generation.current) return;
      const nextCursor = page?.cursor || null;
      publish({
        query: q,
        items: merge(append ? before.items : [], page?.items),
        cursor: nextCursor,
        hasMore: page?.hasMore === true && Boolean(nextCursor) && !cursors.current.has(nextCursor),
        status: "ready",
        error: null
      });
      if (!append && recentVersion === recentSeq.current) {
        const recordSeq = ++recentSeq.current;
        pushRecentSearch(api, q).then((rows) => {
          if (live.current && recordSeq === recentSeq.current) setRecent(rows);
        }).catch(() => {
        });
      }
    } catch (error) {
      if (live.current && seq === generation.current) publish({ ...append ? before : empty(), query: q, status: "error", error });
    } finally {
      if (seq === generation.current) busy.current = false;
    }
  }, [rpc, api]);
  React.useEffect(() => {
    const q = normalize(text);
    if (!active || composing || !q || current.current.query === q) return void 0;
    timer.current = setTimeout(() => {
      timer.current = null;
      void load(q);
    }, 300);
    return cancelDebounce;
  }, [text, composing, active, load]);
  React.useEffect(() => {
    const seq = ++suggestionSeq.current;
    const q = normalize(text);
    if (!active || !focused || composing || !q || dismissed) return void 0;
    const timeout = setTimeout(() => {
      Promise.resolve().then(() => rpc.suggest(q)).then((page) => {
        if (live.current && seq === suggestionSeq.current) {
          setSuggestions(Array.isArray(page?.items) ? page.items.slice(0, 6) : []);
          setSelected(-1);
        }
      }).catch(() => {
      });
    }, 180);
    return () => {
      clearTimeout(timeout);
      suggestionSeq.current += 1;
    };
  }, [rpc, text, active, focused, composing, dismissed]);
  const submit = (value) => {
    const q = normalize(value);
    changeText(q);
    setDismissed(true);
    if (q) void load(q);
  };
  const clearRecent = () => {
    const seq = ++recentSeq.current;
    clearRecentSearches(api).then(() => {
      if (live.current && seq === recentSeq.current) setRecent([]);
    }).catch(() => {
    });
  };
  const loadMore = React.useCallback(() => {
    void load(query.current, true);
  }, [load]);
  useAutoLoadMore({
    active,
    ready: list.status === "ready",
    hasMore: list.hasMore,
    cursor: list.cursor,
    scrollRef: scroll,
    sentinelRef: sentinel,
    load: loadMore
  });
  const showSuggestions = active && focused && !composing && !dismissed && suggestions.length > 0;
  const showLanding = !normalize(text);
  return h(
    "div",
    { className: "hg-page hg-search" },
    h("div", { className: "hg-page-head" }, h("div", { className: "hg-page-title" }, t("tab.search"))),
    h(
      "div",
      { className: "hg-search-entry" },
      h(
        "div",
        { className: "hg-searchbar" },
        h("span", { className: "hg-searchbar-icon" }, h(Icon, { ctx, name: "Search", size: 15 })),
        h("input", {
          ref: input,
          className: "hg-input",
          type: "search",
          value: text,
          placeholder: t("search.placeholder"),
          "aria-label": t("search.placeholder"),
          maxLength: 80,
          spellCheck: false,
          autoComplete: "off",
          role: "combobox",
          "aria-autocomplete": "list",
          "aria-expanded": Boolean(showSuggestions),
          "aria-controls": showSuggestions ? popupId : void 0,
          "aria-activedescendant": showSuggestions && selected >= 0 ? `${popupId}-${selected}` : void 0,
          onChange: (event) => changeText(event.target.value),
          onFocus: () => {
            setFocused(true);
            setDismissed(false);
          },
          onBlur: () => setFocused(false),
          onCompositionStart: () => {
            composition.current = true;
            setComposing(true);
            cancelDebounce();
            suggestionSeq.current += 1;
          },
          onCompositionEnd: (event) => {
            composition.current = false;
            setComposing(false);
            changeText(event.target.value);
          },
          onKeyDown: (event) => {
            if (composition.current || event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229) return;
            if ((event.key === "ArrowDown" || event.key === "ArrowUp") && showSuggestions) {
              event.preventDefault();
              setSelected((prev) => event.key === "ArrowDown" ? (prev + 1) % suggestions.length : prev < 0 ? suggestions.length - 1 : (prev - 1 + suggestions.length) % suggestions.length);
            } else if (event.key === "Enter") {
              event.preventDefault();
              submit(showSuggestions && selected >= 0 ? suggestions[selected].query : text);
            } else if (event.key === "Escape") {
              event.preventDefault();
              if (showSuggestions) {
                setDismissed(true);
                setSelected(-1);
              } else changeText("");
            }
          }
        }),
        text ? h("button", {
          type: "button",
          className: "hg-iconbtn",
          title: t("search.clearInput"),
          "aria-label": t("search.clearInput"),
          onClick: () => {
            changeText("");
            input.current?.focus();
          }
        }, h(Icon, { ctx, name: "X", size: 14 })) : null
      ),
      showSuggestions ? h(
        "div",
        { id: popupId, className: "hg-suggestions", role: "listbox", "aria-label": t("search.suggestions") },
        suggestions.map((item, index) => h("button", {
          key: item.query,
          id: `${popupId}-${index}`,
          type: "button",
          role: "option",
          "aria-selected": index === selected,
          tabIndex: -1,
          className: `hg-suggestion${index === selected ? " is-selected" : ""}`,
          onMouseDown: (event) => event.preventDefault(),
          onClick: () => submit(item.query),
          onMouseEnter: () => setSelected(index)
        }, h(Icon, { ctx, name: "Search", size: 13 }), h("span", null, item.text)))
      ) : null
    ),
    h(
      "div",
      { className: "hg-scroll", ref: scroll },
      showLanding ? h(
        "div",
        { className: "hg-recent" },
        h(
          "div",
          { className: "hg-sec-head" },
          h("span", null, t("search.recent")),
          recent.length ? h("button", { type: "button", className: "hg-linkbtn", onClick: clearRecent }, t("search.clearRecent")) : null
        ),
        recent.length ? h("div", { className: "hg-chips" }, recent.map((q) => h("button", {
          key: q,
          type: "button",
          className: "hg-chip",
          onClick: () => submit(q)
        }, q))) : h("div", { className: "hg-muted" }, t("search.noRecent"))
      ) : null,
      h(SearchExplore, { ctx, active, visible: showLanding, onSearch: submit }),
      list.status === "loading" ? h("div", { className: "hg-loading-line" }, h(Spinner, { label: t("search.searching") }), t("search.searching")) : null,
      list.error ? h(ErrorNotice, {
        ctx,
        error: list.error,
        compact: list.items.length > 0,
        onRetry: () => void load(query.current, list.hasMore && list.error.code !== "CURSOR_EXPIRED")
      }) : null,
      list.status === "ready" && !list.items.length && !list.hasMore ? h(EmptyState, {
        ctx,
        icon: "SearchX",
        title: t("search.empty"),
        hint: t("search.emptyHint")
      }) : null,
      list.items.length ? h("div", { className: "hg-result-count", role: "status" }, t("search.results", { count: list.items.length })) : null,
      list.items.length ? h("div", { className: "hg-results" }, list.items.map((item) => h(
        "button",
        {
          key: item.id,
          type: "button",
          className: "hg-result",
          onClick: () => ctx.openSeries(item)
        },
        h(Cover, { ctx, path: item.cover, className: "hg-result-cover" }),
        h(
          "div",
          { className: "hg-result-main" },
          h("div", { className: "hg-result-title" }, item.title || t("unit.untitled")),
          h("div", { className: "hg-result-meta" }, item.count != null ? t("unit.episodes", { count: item.count }) : ""),
          item.description ? h("div", { className: "hg-result-desc" }, item.description) : null
        )
      ))) : null,
      list.items.length || list.hasMore ? h(
        "div",
        { className: "hg-list-foot", ref: sentinel },
        list.status === "more" ? h(Spinner, { label: t("search.loadingMore") }) : list.hasMore ? !list.error ? t("action.loadMore") : null : t("discover.end")
      ) : null
    )
  );
}

// src/panel/player/util.js
var clamp = (value, min, max) => {
  const number = Number.isFinite(Number(value)) ? Number(value) : 0;
  if (number < min) return min;
  if (number > max) return max;
  return number;
};
var decodeBase64 = (value) => {
  const text = typeof value === "string" ? value.replace(/\s+/g, "") : "";
  if (!text) return new Uint8Array(0);
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};
var formatClock = (ms) => formatDuration(Number.isFinite(Number(ms)) ? Number(ms) : 0);
var safeFileName = (name) => {
  const text = String(name || "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  return (text || "video").slice(0, 80);
};
var copyText = async (text) => {
  const value = String(text || "");
  if (!value) return false;
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
  }
  try {
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = typeof document.execCommand === "function" ? document.execCommand("copy") : false;
    area.remove();
    return ok;
  } catch {
    return false;
  }
};
var codecLabel = (codec) => {
  const text = String(codec || "").toLowerCase();
  if (/hvc1|hev1|hevc/.test(text)) return "HEVC";
  if (/avc1|avc3|h264/.test(text)) return "H.264";
  if (/av01|av1/.test(text)) return "AV1";
  if (/vp09|vp9/.test(text)) return "VP9";
  const first = String(codec || "").split(",")[0].trim();
  return first || "unknown";
};

// src/panel/player/engine.js
var MSE_STATE = Object.freeze({
  IDLE: "idle",
  PROBING: "probing",
  OPENING: "opening",
  BUFFERING: "buffering",
  READY: "ready",
  RECOVERING: "recovering",
  DEGRADED: "degraded",
  ERROR: "error",
  ENDED: "ended",
  DISPOSED: "disposed"
});
var PREFETCH_AHEAD = 3;
var HIGH_WATER_SECONDS = 12;
var MAX_FETCH_ATTEMPTS = 3;
var MAX_REBUILDS = 1;
var SOURCE_OPEN_TIMEOUT_MS = 1e4;
var APPEND_TIMEOUT_MS = 2e4;
var NON_RETRYABLE = /* @__PURE__ */ new Set(["INVALID_PARAM", "PARAM_INVALID", "NOT_FOUND"]);
var getMediaSourceCtor = () => {
  if (typeof window === "undefined") return null;
  return window.ManagedMediaSource || window.MediaSource || null;
};
var checkSupport = (mime) => {
  const Ctor = getMediaSourceCtor();
  if (!Ctor || typeof Ctor.isTypeSupported !== "function") return { ok: false, reason: "no-mse" };
  try {
    return Ctor.isTypeSupported(mime) ? { ok: true, reason: "" } : { ok: false, reason: "codec" };
  } catch {
    return { ok: false, reason: "codec" };
  }
};
var buildMimeCandidates = (info) => {
  const mime = info.mime || "video/mp4";
  const codec = String(info.codec || "").trim();
  const list = [];
  const push = (value) => {
    if (value && !list.includes(value)) list.push(value);
  };
  if (codec) push(`${mime}; codecs="${codec}"`);
  const parts = codec.split(",").map((item) => item.trim()).filter(Boolean);
  const video = parts.find((item) => /^(hvc1|hev1|avc1|av01|vp0?9)/i.test(item)) || "";
  const audio = parts.filter((item) => item !== video);
  const audioSuffix = audio.length ? `,${audio.join(",")}` : "";
  if (/^(hvc1|hev1)/i.test(video)) {
    push(`${mime}; codecs="hvc1${audioSuffix}"`);
    push(`${mime}; codecs="hvc1.1.6.L120.B0${audioSuffix}"`);
    push(`${mime}; codecs="hvc1.1.6.L93.B0${audioSuffix}"`);
    push(`${mime}; codecs="hev1.1.6.L93.B0${audioSuffix}"`);
  }
  if (video) push(`${mime}; codecs="${video}${audioSuffix}"`);
  if (video && audioSuffix) push(`${mime}; codecs="${video}"`);
  return list;
};
var pickSupportedMime = (info) => {
  const Ctor = getMediaSourceCtor();
  if (!Ctor || typeof Ctor.isTypeSupported !== "function") {
    return { ok: false, reason: "no-mse", mime: "", checked: [] };
  }
  const candidates = buildMimeCandidates(info);
  const checked = candidates.map((mime) => ({ mime, ok: checkSupport(mime).ok }));
  const hit = checked.find((item) => item.ok);
  return hit ? { ok: true, reason: "", mime: hit.mime, checked } : { ok: false, reason: "codec", mime: "", checked };
};
var normalizeInfo = (raw) => ({
  codec: typeof raw?.codec === "string" ? raw.codec : "",
  durationMs: Number.isFinite(Number(raw?.durationMs)) ? Number(raw.durationMs) : 0,
  segmentCount: Math.max(0, Math.floor(Number(raw?.segmentCount) || 0)),
  timescale: Number.isFinite(Number(raw?.timescale)) ? Number(raw.timescale) : 0,
  mime: typeof raw?.mime === "string" && raw.mime ? raw.mime : "video/mp4",
  definition: typeof raw?.definition === "string" ? raw.definition : "",
  bytes: Number.isFinite(Number(raw?.bytes)) ? Number(raw.bytes) : 0
});
function createMseEngine({ video, getRpc, log = () => {
}, onState = () => {
}, onError = () => {
} }) {
  if (!video) throw new TypeError("createMseEngine 需要 video 元素");
  let disposed = false;
  let session = null;
  let counter = 0;
  const snapshotOf = (target) => {
    if (!target) return { state: disposed ? MSE_STATE.DISPOSED : MSE_STATE.IDLE, quality: "", info: null };
    return {
      state: target.state,
      reason: target.reason,
      quality: target.quality,
      info: target.info,
      mime: target.mime,
      codecLabel: target.info ? codecLabel(target.info.codec) : "",
      appended: target.appended,
      segmentCount: target.info?.segmentCount ?? 0,
      appendedBytes: target.appendedBytes,
      error: target.error || null,
      degradedReason: target.state === MSE_STATE.DEGRADED ? target.degradeReason : "",
      probe: target.probe || [],
      episodeId: target.episodeId,
      mode: target.mode || "mse",
      transcode: target.transcode || null,
      transcodeProgress: target.transcodeProgress ?? 0,
      videoError: target.videoError || null,
      canPlay: target.canPlay || "",
      retryInfo: target.retryInfo || null,
      resumeAppliedMs: target.resumeAppliedMs,
      resumeClamped: target.resumeClamped,
      rebuilds: target.rebuilds
    };
  };
  const emit = (target) => {
    try {
      onState(snapshotOf(target));
    } catch (error) {
      log("[player] onState 回调异常", String(error?.message || error));
    }
  };
  const isCurrent = (target) => !disposed && !!target && session === target;
  const isLive = (target) => isCurrent(target) && target.active && !target.halted;
  const sleep = (ms, target) => new Promise((resolve) => {
    const timer = setTimeout(() => {
      target.timers.delete(timer);
      resolve();
    }, ms);
    target.timers.add(timer);
  });
  const clearTimers = (target) => {
    for (const timer of target.timers) {
      clearTimeout(timer);
      clearInterval(timer);
    }
    target.timers.clear();
  };
  const durationSeconds = () => {
    const value = Number(video.duration);
    if (Number.isFinite(value) && value > 0) return value;
    const fromInfo = (session?.info?.durationMs || 0) / 1e3;
    return Number.isFinite(fromInfo) && fromInfo > 0 ? fromInfo : 0;
  };
  const bufferedAheadSeconds = () => {
    const ranges = video.buffered;
    if (!ranges || !ranges.length) return 0;
    const time = Number(video.currentTime) || 0;
    for (let index = 0; index < ranges.length; index += 1) {
      const start = ranges.start(index);
      const end = ranges.end(index);
      if (time >= start - 0.35 && time <= end + 0.35) return Math.max(0, end - time);
    }
    return 0;
  };
  const createSession = (options) => ({
    token: counter += 1,
    episodeId: options.episodeId,
    quality: options.quality,
    reason: options.reason || "initial",
    resumeMs: Math.max(0, Number(options.resumeMs) || 0),
    autoplay: options.autoplay !== false,
    info: null,
    mime: "",
    state: MSE_STATE.IDLE,
    mediaSource: null,
    sb: null,
    objectUrl: "",
    nextFetch: 1,
    nextAppend: 1,
    fetching: false,
    appending: false,
    store: /* @__PURE__ */ new Map(),
    appended: 0,
    appendedBytes: 0,
    initAppended: false,
    endedStream: false,
    active: true,
    halted: false,
    tearingDown: false,
    error: null,
    degradeReason: "",
    retryInfo: null,
    resumeAppliedMs: 0,
    resumeClamped: false,
    rebuilds: Math.max(0, Number(options.rebuilds) || 0),
    timers: /* @__PURE__ */ new Set(),
    cleanups: []
  });
  const clearSourceBuffer = (target) => {
    const sb = target.sb;
    target.sb = null;
    if (!sb) return;
    try {
      sb.removeEventListener("updateend", target.onUpdateEnd);
      sb.removeEventListener("error", target.onSbError);
    } catch {
    }
  };
  const teardown = (target) => {
    if (!target) return;
    target.tearingDown = true;
    target.active = false;
    target.halted = true;
    clearTimers(target);
    for (const cleanup of target.cleanups) {
      try {
        cleanup();
      } catch {
      }
    }
    target.cleanups = [];
    clearSourceBuffer(target);
    const ms = target.mediaSource;
    target.mediaSource = null;
    try {
      video.pause();
    } catch {
    }
    if (target.objectUrl) {
      const url = target.objectUrl;
      target.objectUrl = "";
      try {
        if (video.getAttribute("src") === url || video.src === url) {
          video.removeAttribute("src");
          if (typeof video.load === "function") video.load();
        }
      } catch {
      }
      setTimeout(() => {
        try {
          URL.revokeObjectURL(url);
        } catch {
        }
      }, 0);
    }
    if (ms) {
      try {
        if (ms.readyState === "open") ms.endOfStream();
      } catch {
      }
    }
  };
  const halt = (target, state, error, reason) => {
    if (!isCurrent(target)) return;
    target.state = state;
    target.error = error || null;
    if (reason) target.degradeReason = reason;
    target.halted = true;
    try {
      video.pause();
    } catch {
    }
    emit(target);
    if (state === MSE_STATE.ERROR) {
      try {
        onError(target.error, snapshotOf(target));
      } catch (callbackError) {
        log("[player] onError 回调异常", String(callbackError?.message || callbackError));
      }
    }
  };
  const fail = (target, error) => {
    const normalized = error instanceof Error ? error : new PanelError("PLAYER_ERROR", String(error || "播放失败"));
    log(`[player] 播放失败：${normalized.code || ""} ${normalized.message || ""}`);
    halt(target, MSE_STATE.ERROR, normalized, "");
  };
  const degrade = (target, reason) => {
    log(`[player] 降级：${reason}`);
    halt(target, MSE_STATE.DEGRADED, null, reason || "codec");
  };
  const appendBytes = (target, bytes) => new Promise((resolve, reject) => {
    const sb = target.sb;
    if (!sb) {
      reject(new PanelError("PLAYER_ERROR", "SourceBuffer 已释放"));
      return;
    }
    let settled = false;
    let timer = 0;
    const cleanup = () => {
      sb.removeEventListener("updateend", onEnd);
      sb.removeEventListener("error", onError2);
      if (timer) {
        clearTimeout(timer);
        target.timers.delete(timer);
        timer = 0;
      }
    };
    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onError2 = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new PanelError("MEDIA_APPEND_FAILED", "appendBuffer 失败"));
    };
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new PanelError("MEDIA_APPEND_TIMEOUT", "appendBuffer 超时"));
    }, APPEND_TIMEOUT_MS);
    target.timers.add(timer);
    sb.addEventListener("updateend", onEnd);
    sb.addEventListener("error", onError2);
    try {
      sb.appendBuffer(bytes);
    } catch (error) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    }
  });
  const evictOldBuffer = (target) => new Promise((resolve) => {
    const sb = target.sb;
    if (!sb || sb.updating) {
      resolve();
      return;
    }
    const end = Math.max(0, Math.min((Number(video.currentTime) || 0) - 1, durationSeconds() - 1));
    if (!(end > 0)) {
      resolve();
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      sb.removeEventListener("updateend", finish);
      clearTimeout(timer);
      target.timers.delete(timer);
      resolve();
    };
    const timer = setTimeout(finish, 5e3);
    target.timers.add(timer);
    sb.addEventListener("updateend", finish);
    try {
      sb.remove(0, end);
    } catch {
      finish();
    }
  });
  const isQuotaError = (error) => String(error?.name || "").toLowerCase().includes("quota") || String(error?.code || "").toUpperCase() === "QUOTA_EXCEEDED";
  const rebuild = async (target, reason) => {
    if (!isCurrent(target)) return;
    const episodeId = target.episodeId;
    const quality = target.quality;
    const timeMs = Math.max(0, Number(video.currentTime) * 1e3);
    const autoplay = !video.paused && !video.ended;
    const rebuilds = target.rebuilds + 1;
    log(`[player] 重建 MSE（${reason}，第 ${rebuilds} 次）`);
    await load({ episodeId, quality, resumeMs: timeMs, autoplay, rebuilds, reason: "rebuild" });
  };
  const finishStream = (target) => {
    if (!isCurrent(target) || target.endedStream) return;
    target.endedStream = true;
    const ms = target.mediaSource;
    try {
      if (ms && ms.readyState === "open") ms.endOfStream();
    } catch {
    }
    emit(target);
  };
  const appendLoop = async (target) => {
    if (!isLive(target) || target.appending) return;
    target.appending = true;
    let progressed = false;
    try {
      const total = target.info?.segmentCount || 0;
      while (isLive(target) && target.nextAppend <= total) {
        const bytes = target.store.get(target.nextAppend);
        if (!bytes) break;
        await appendBytes(target, bytes);
        if (!isLive(target)) return;
        target.store.delete(target.nextAppend);
        target.nextAppend += 1;
        target.appended += 1;
        target.appendedBytes += bytes.length;
        target.retryInfo = null;
        progressed = true;
        if (target.state !== MSE_STATE.READY) target.state = MSE_STATE.READY;
        emit(target);
      }
      if (isLive(target) && target.nextAppend > total && !target.endedStream) finishStream(target);
    } catch (error) {
      if (!isLive(target)) return;
      if (isQuotaError(error)) {
        await evictOldBuffer(target);
        if (isLive(target)) {
          try {
            const bytes = target.store.get(target.nextAppend);
            if (bytes) {
              await appendBytes(target, bytes);
              if (!isLive(target)) return;
              target.store.delete(target.nextAppend);
              target.nextAppend += 1;
              target.appended += 1;
              target.appendedBytes += bytes.length;
              target.state = MSE_STATE.READY;
              progressed = true;
              emit(target);
              return;
            }
          } catch (retryError) {
            fail(target, retryError);
            return;
          }
        }
      }
      if (target.rebuilds < MAX_REBUILDS) {
        await rebuild(target, "append");
        return;
      }
      fail(target, error);
    } finally {
      target.appending = false;
      if (progressed && isLive(target)) pump(target);
    }
  };
  const fetchSegment = async (target, seq) => {
    let attempt = 1;
    for (; ; ) {
      if (!isLive(target)) throw new PanelError("ABORTED", "播放会话已结束");
      try {
        const payload = await getRpc().getStreamSegment(target.episodeId, target.quality, seq);
        if (!isLive(target)) throw new PanelError("ABORTED", "播放会话已结束");
        const bytes = decodeBase64(payload?.base64);
        if (!bytes.length) throw new PanelError("PROTOCOL", `分段 ${seq} 内容为空`);
        return bytes;
      } catch (error) {
        if (!isLive(target)) throw error;
        const code = String(error?.code || "");
        const retryable = !NON_RETRYABLE.has(code);
        if (!retryable || attempt >= MAX_FETCH_ATTEMPTS) throw error;
        target.retryInfo = { seq, attempt, code, message: String(error?.message || "") };
        target.state = MSE_STATE.RECOVERING;
        emit(target);
        log(`[player] 分段 ${seq} 第 ${attempt} 次失败，${attempt === 1 ? 0.7 : 1.6}s 后重试：${code}`);
        await sleep(attempt === 1 ? 700 : 1600, target);
        if (!isLive(target)) throw error;
        target.state = MSE_STATE.BUFFERING;
        emit(target);
        attempt += 1;
      }
    }
  };
  const pumpFetch = (target) => {
    if (!isLive(target) || !target.sb || !target.initAppended || target.fetching) return;
    const total = target.info?.segmentCount || 0;
    if (target.nextFetch > total) return;
    if (target.store.size >= PREFETCH_AHEAD) return;
    if (target.nextAppend > 1 && bufferedAheadSeconds() >= HIGH_WATER_SECONDS) return;
    const seq = target.nextFetch;
    target.nextFetch += 1;
    target.fetching = true;
    fetchSegment(target, seq).then((bytes) => {
      if (!isLive(target)) return;
      target.store.set(seq, bytes);
    }).catch((error) => {
      if (!isLive(target)) return;
      fail(target, error);
    }).finally(() => {
      if (!isLive(target)) return;
      target.fetching = false;
      pump(target);
    });
  };
  function pump(target) {
    if (!isLive(target)) return;
    pumpFetch(target);
    void appendLoop(target).catch((error) => {
      log("[player] append 循环异常", String(error?.message || error));
    });
  }
  const applyResume = (target) => {
    const targetMs = Math.max(0, Number(target.resumeMs) || 0);
    if (!targetMs) return;
    const attempt = () => {
      if (!isLive(target)) return;
      const reported = Number(video.duration);
      const duration = Number.isFinite(reported) && reported > 0 ? reported : 0;
      let seconds = targetMs / 1e3;
      let clamped = false;
      if (duration > 0 && seconds > duration - 0.5) {
        seconds = 0;
        clamped = true;
      }
      try {
        video.currentTime = seconds;
      } catch {
        return;
      }
      target.resumeAppliedMs = Math.round(seconds * 1e3);
      target.resumeClamped = clamped;
    };
    const known = Number(video.duration);
    if (Number.isFinite(known) && known > 0) {
      attempt();
      return;
    }
    let fallback = 0;
    const onMeta = () => {
      video.removeEventListener("durationchange", onMeta);
      video.removeEventListener("loadedmetadata", onMeta);
      if (fallback) {
        clearTimeout(fallback);
        target.timers.delete(fallback);
        fallback = 0;
      }
      attempt();
    };
    video.addEventListener("durationchange", onMeta);
    video.addEventListener("loadedmetadata", onMeta);
    fallback = setTimeout(() => {
      target.timers.delete(fallback);
      fallback = 0;
      if (!isLive(target)) return;
      const fromInfo = (target.info?.durationMs || 0) / 1e3;
      const tooLate = fromInfo > 0 && targetMs / 1e3 > fromInfo - 0.5;
      const seconds = tooLate ? 0 : fromInfo > 0 ? Math.min(targetMs / 1e3, fromInfo - 0.3) : targetMs / 1e3;
      try {
        video.currentTime = seconds;
      } catch {
        return;
      }
      target.resumeAppliedMs = Math.round(seconds * 1e3);
      target.resumeClamped = tooLate;
    }, 1500);
    target.timers.add(fallback);
    target.cleanups.push(() => {
      video.removeEventListener("durationchange", onMeta);
      video.removeEventListener("loadedmetadata", onMeta);
      if (fallback) clearTimeout(fallback);
    });
  };
  const openSourceBuffer = async (target) => {
    const ms = target.mediaSource;
    if (!isLive(target) || !ms) return;
    if (ms.readyState !== "open") {
      fail(target, new PanelError("MEDIA_STATE", "媒体源未就绪（sourceopen 时状态不是 open）"));
      return;
    }
    let sb;
    try {
      sb = ms.addSourceBuffer(target.mime);
    } catch (error) {
      log(`[player] addSourceBuffer 失败：${String(error?.message || error)}`);
      degrade(target, "add-source-buffer");
      return;
    }
    target.sb = sb;
    try {
      sb.mode = "segments";
    } catch {
    }
    target.state = MSE_STATE.BUFFERING;
    emit(target);
    try {
      const payload = await getRpc().getStreamInit(target.episodeId, target.quality);
      if (!isLive(target)) return;
      const bytes = decodeBase64(payload?.base64);
      if (!bytes.length) throw new PanelError("PROTOCOL", "init segment 为空");
      await appendBytes(target, bytes);
      if (!isLive(target)) return;
      target.initAppended = true;
      applyResume(target);
      emit(target);
      pump(target);
    } catch (error) {
      if (!isLive(target)) return;
      fail(target, error);
    }
  };
  const openMediaSource = (target) => {
    const Ctor = getMediaSourceCtor();
    if (!Ctor) {
      degrade(target, "no-mse");
      return;
    }
    let ms;
    try {
      ms = new Ctor();
    } catch (error) {
      fail(target, error);
      return;
    }
    target.mediaSource = ms;
    try {
      target.objectUrl = URL.createObjectURL(ms);
    } catch (error) {
      fail(target, error);
      return;
    }
    const timer = setTimeout(() => {
      target.timers.delete(timer);
      if (isLive(target) && !target.sb) fail(target, new PanelError("MEDIA_OPEN_TIMEOUT", "媒体源打开超时"));
    }, SOURCE_OPEN_TIMEOUT_MS);
    target.timers.add(timer);
    target.cleanups.push(() => clearTimeout(timer));
    ms.addEventListener("sourceopen", () => {
      clearTimeout(timer);
      void openSourceBuffer(target);
    });
    ms.addEventListener("sourceclose", () => {
      target.timers.delete(timer);
      clearTimeout(timer);
    });
    try {
      video.src = target.objectUrl;
      if (typeof video.load === "function") video.load();
    } catch (error) {
      fail(target, error);
    }
  };
  async function load(options = {}) {
    if (disposed) return;
    const episodeId = String(options.episodeId || "");
    if (!episodeId) return;
    if (session) teardown(session);
    const target = createSession({
      episodeId,
      quality: String(options.quality || "720p"),
      resumeMs: options.resumeMs,
      autoplay: options.autoplay,
      reason: options.reason,
      rebuilds: options.rebuilds
    });
    session = target;
    target.state = MSE_STATE.PROBING;
    emit(target);
    try {
      const raw = await getRpc().getStreamInfo(target.episodeId, target.quality);
      if (!isLive(target)) return;
      target.info = normalizeInfo(raw);
      if (!target.info.codec) throw new PanelError("PROTOCOL", "媒体信息缺少编码");
      if (!target.info.segmentCount) throw new PanelError("PROTOCOL", "媒体分片数量为 0");
      const support = pickSupportedMime(target.info);
      target.probe = support.checked;
      target.mime = support.mime;
      if (!support.ok) {
        target.state = MSE_STATE.DEGRADED;
        target.degradeReason = support.reason;
        target.halted = true;
        target.active = false;
        emit(target);
        return;
      }
      target.state = MSE_STATE.OPENING;
      emit(target);
      openMediaSource(target);
    } catch (error) {
      if (!isLive(target)) return;
      fail(target, error);
    }
  }
  const TRANSCODE_TIMEOUT_MS = 10 * 60 * 1e3;
  const H264_CHUNK_BYTES = 3 * 1024 * 1024;
  const applyLocalResume = (target) => {
    const ms = Number(target.resumeMs) || 0;
    if (ms <= 0) return;
    const apply = () => {
      try {
        video.currentTime = ms / 1e3;
        target.resumeAppliedMs = ms;
      } catch {
      }
    };
    if (video.readyState >= 1) {
      apply();
      return;
    }
    const onMeta = () => {
      video.removeEventListener("loadedmetadata", onMeta);
      if (isLive(target)) apply();
    };
    video.addEventListener("loadedmetadata", onMeta);
    target.cleanups.push(() => video.removeEventListener("loadedmetadata", onMeta));
  };
  const downloadTranscoded = async (target, state) => {
    const rpc = getRpc();
    const total = Number(state?.bytes) || 0;
    const parts = [];
    let offset = 0;
    for (let guard = 0; guard < 200; guard += 1) {
      const chunk = await rpc.h264Chunk(target.episodeId, target.quality, offset, H264_CHUNK_BYTES);
      const bytes = decodeBase64(chunk?.base64);
      if (!bytes.length) break;
      parts.push(bytes);
      offset += bytes.length;
      target.transcodeProgress = total > 0 ? Math.min(100, Math.round(offset / total * 100)) : 0;
      emit(target);
      if (Number(chunk?.total) > 0 && offset >= Number(chunk.total)) break;
      if (!(Number(chunk?.total) > 0) && bytes.length < H264_CHUNK_BYTES) break;
    }
    if (!parts.length) throw new PanelError("PROTOCOL", "转码结果为空");
    return new Blob(parts, { type: "video/mp4" });
  };
  async function loadLocal(options = {}) {
    if (disposed) return;
    const episodeId = String(options.episodeId || "");
    if (!episodeId) return;
    if (session) teardown(session);
    const target = createSession({
      episodeId,
      quality: String(options.quality || "720p"),
      resumeMs: options.resumeMs,
      autoplay: options.autoplay ?? true,
      reason: options.reason || "transcode",
      rebuilds: 0
    });
    target.mode = "local";
    session = target;
    target.state = MSE_STATE.PROBING;
    emit(target);
    try {
      const rpc = getRpc();
      let state = await rpc.h264Info(target.episodeId, target.quality);
      if (!isLive(target)) return;
      target.transcode = state;
      if (state?.status === "unavailable") {
        throw new PanelError("TRANSCODE_UNAVAILABLE", state.error || "本机没有可用的 ffmpeg");
      }
      if (state?.status !== "done") {
        target.state = MSE_STATE.BUFFERING;
        emit(target);
        state = await rpc.h264Start(target.episodeId, target.quality);
        const startedAt = Date.now();
        while (state?.status !== "done") {
          if (!isLive(target)) return;
          if (state?.status === "unavailable") {
            throw new PanelError("TRANSCODE_UNAVAILABLE", state.error || "本机没有可用的 ffmpeg");
          }
          if (state?.status === "error") {
            throw new PanelError("TRANSCODE_FAILED", state.error || "转码失败");
          }
          if (Date.now() - startedAt > TRANSCODE_TIMEOUT_MS) {
            throw new PanelError("TRANSCODE_TIMEOUT", "转码超时，请稍后重试");
          }
          target.transcode = state;
          emit(target);
          await sleep(1200, target);
          state = await rpc.h264Info(target.episodeId, target.quality);
        }
      }
      target.transcode = state;
      if (!isLive(target)) return;
      target.state = MSE_STATE.BUFFERING;
      emit(target);
      const blob = await downloadTranscoded(target, state);
      if (!isLive(target)) return;
      const url = URL.createObjectURL(blob);
      target.objectUrl = url;
      target.info = {
        codec: state?.codec || "avc1.640028,mp4a.40.2",
        durationMs: Number(state?.durationMs) || 0,
        segmentCount: 1,
        timescale: 0,
        mime: "video/mp4",
        definition: state?.definition || target.quality,
        bytes: Number(state?.bytes) || 0
      };
      target.mime = `video/mp4; codecs="${target.info.codec}"`;
      target.transcodeProgress = 100;
      try {
        video.pause();
        video.removeAttribute("src");
      } catch {
      }
      target.canPlay = (() => {
        try {
          return video.canPlayType('video/mp4; codecs="avc1.640028,mp4a.40.2"') || "no";
        } catch {
          return "?";
        }
      })();
      const loaded = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup();
          reject(new PanelError("MEDIA_LOAD_TIMEOUT", "视频加载超时（直链未被解码）"));
        }, 2e4);
        const onMeta = () => {
          cleanup();
          resolve();
        };
        const onError2 = () => {
          cleanup();
          reject(new PanelError("MEDIA_DECODE_FAILED", `视频加载失败（video.error ${video.error?.code ?? 0}）`));
        };
        const cleanup = () => {
          clearTimeout(timer);
          target.timers.delete(timer);
          video.removeEventListener("loadedmetadata", onMeta);
          video.removeEventListener("error", onError2);
        };
        target.timers.add(timer);
        target.cleanups.push(cleanup);
        video.addEventListener("loadedmetadata", onMeta);
        video.addEventListener("error", onError2);
      });
      try {
        video.src = url;
        if (typeof video.load === "function") video.load();
      } catch (error) {
        fail(target, error);
        return;
      }
      await loaded;
      if (!isLive(target)) return;
      target.state = MSE_STATE.READY;
      applyLocalResume(target);
      emit(target);
      if (target.autoplay) void video.play().catch(() => {
      });
    } catch (error) {
      if (!isLive(target)) return;
      fail(target, error instanceof Error ? error : new PanelError("PLAYER_ERROR", String(error)));
    }
  }
  const ownsMedia = (target) => !!target.objectUrl && video.src === target.objectUrl;
  const onVideoError = () => {
    const target = session;
    if (!isCurrent(target) || !target.active || target.halted || target.tearingDown) return;
    if (!ownsMedia(target)) return;
    const code = video.error?.code ?? 0;
    const message = String(video.error?.message || "");
    target.videoError = { code, message };
    if (target.mode === "local") return;
    if (code === 1) return;
    if (code === 4) {
      degrade(target, "src-not-supported");
      return;
    }
    if (code === 3) {
      if (target.rebuilds < MAX_REBUILDS) void rebuild(target, "decode");
      else fail(target, new PanelError("MEDIA_DECODE_FAILED", "视频解码失败"));
      return;
    }
    fail(target, new PanelError("MEDIA_NETWORK", "媒体流读取失败"));
  };
  const onVideoEnded = () => {
    const target = session;
    if (!isLive(target) || !ownsMedia(target)) return;
    target.state = MSE_STATE.ENDED;
    emit(target);
  };
  const onTimeUpdate = () => {
    const target = session;
    if (!isLive(target)) return;
    if (!target.fetching) pumpFetch(target);
  };
  video.addEventListener("error", onVideoError);
  video.addEventListener("ended", onVideoEnded);
  video.addEventListener("timeupdate", onTimeUpdate);
  video.addEventListener("waiting", onTimeUpdate);
  video.addEventListener("progress", onTimeUpdate);
  video.addEventListener("seeked", onTimeUpdate);
  video.addEventListener("play", onTimeUpdate);
  const currentTimeMs = () => {
    const value = Number(video.currentTime);
    return Number.isFinite(value) && value > 0 ? Math.round(value * 1e3) : 0;
  };
  return {
    /** 载入一集；同一 episodeId 换清晰度时由 switchQuality 调用。 */
    load,
    /** 转码兜底：等后台转成 H.264 后用 Blob 直接播放（宿主没有 HEVC 解码器时使用）。 */
    loadLocal,
    /** 换清晰度：销毁 SourceBuffer 重建，尽量保留播放位置。 */
    async switchQuality(quality) {
      const target = session;
      if (!isCurrent(target)) return;
      const next = String(quality || "");
      if (!next || next === target.quality) return;
      const timeMs = currentTimeMs() || target.resumeMs || 0;
      const autoplay = !video.paused && !video.ended;
      await load({
        episodeId: target.episodeId,
        quality: next,
        resumeMs: timeMs,
        autoplay,
        rebuilds: target.rebuilds,
        reason: "quality"
      });
    },
    /** 错误/降级后重试：重建整条链路，位置尽量保留。 */
    async retry() {
      const target = session;
      if (!isCurrent(target)) return;
      const timeMs = currentTimeMs() || target.resumeMs || 0;
      const autoplay = !video.paused && !video.ended;
      await load({
        episodeId: target.episodeId,
        quality: target.quality,
        resumeMs: timeMs,
        autoplay,
        rebuilds: target.rebuilds,
        reason: "retry"
      });
    },
    /** 媒体元素解码错误后由控制器调用。 */
    async recover(reason) {
      const target = session;
      if (!isLive(target)) return;
      if (target.rebuilds < MAX_REBUILDS) await rebuild(target, reason || "media");
      else fail(target, new PanelError("MEDIA_DECODE_FAILED", "视频解码失败"));
    },
    snapshot: () => snapshotOf(session),
    isPlaying: () => !video.paused && !video.ended,
    /** 交还给本机解码时取消兼容会话；之后仍可重新 load。 */
    stop() {
      if (session) teardown(session);
      session = null;
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      if (session) teardown(session);
      session = null;
      try {
        video.removeEventListener("error", onVideoError);
        video.removeEventListener("ended", onVideoEnded);
        video.removeEventListener("timeupdate", onTimeUpdate);
        video.removeEventListener("waiting", onTimeUpdate);
        video.removeEventListener("progress", onTimeUpdate);
        video.removeEventListener("seeked", onTimeUpdate);
        video.removeEventListener("play", onTimeUpdate);
      } catch {
      }
      try {
        onState({ state: MSE_STATE.DISPOSED });
      } catch {
      }
    }
  };
}

// src/panel/player/icons.js
var SVG_NS = "http://www.w3.org/2000/svg";
var PATHS = {
  play: '<path d="M8 5.2v13.6L19.4 12z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6.4" y="5" width="4" height="14" rx="0.8" fill="currentColor" stroke="none"/><rect x="13.6" y="5" width="4" height="14" rx="0.8" fill="currentColor" stroke="none"/>',
  next: '<path d="M6 5.6v12.8L15.2 12z" fill="currentColor" stroke="none"/><rect x="16.6" y="5" width="2" height="14" rx="0.8" fill="currentColor" stroke="none"/>',
  volume: '<path d="M4 9.2h3.4L12 5.4v13.2L7.4 14.8H4z" fill="currentColor" stroke="none"/><path d="M15 9.2a4 4 0 0 1 0 5.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M17.6 6.8a7.4 7.4 0 0 1 0 10.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  mute: '<path d="M4 9.2h3.4L12 5.4v13.2L7.4 14.8H4z" fill="currentColor" stroke="none"/><path d="M16 9.6l5 5m0-5l-5 5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  pip: '<rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="12" y="11" width="7" height="6" rx="1" fill="currentColor" stroke="none"/>',
  mini: '<rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="12" y="11" width="7" height="6" rx="1" fill="currentColor" stroke="none"/>',
  restore: '<rect x="4" y="4" width="16" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9 12h6m-2.5-2.5L15 12l-2.5 2.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  collapse: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'
};
function icon(name, size = 16) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("hg-player-icon");
  svg.innerHTML = PATHS[name] || "";
  return svg;
}

// src/shared/aac.js
var readDescriptor = (bytes, offset, limit) => {
  if (offset >= limit) throw new Error("音频配置描述符缺失");
  const tag = bytes[offset++];
  let size = 0;
  for (let index = 0; index < 4; index++) {
    if (offset >= limit) break;
    const byte = bytes[offset++];
    size = size * 128 + (byte & 127);
    if (!(byte & 128)) {
      const end = offset + size;
      if (end > limit) break;
      return { tag, start: offset, end };
    }
  }
  throw new Error("音频配置描述符长度无效");
};
var findDescriptor = (bytes, start, end, tag) => {
  for (let at = start; at < end; ) {
    const descriptor = readDescriptor(bytes, at, end);
    if (descriptor.tag === tag) return descriptor;
    at = descriptor.end;
  }
  throw new Error("音频配置描述符缺失");
};
function parseEsds(bytes, sampleType = "mp4a") {
  let descriptor = readDescriptor(bytes, 4, bytes.length);
  if (descriptor.tag === 3) {
    const limit = descriptor.end;
    if (descriptor.start + 3 > limit) throw new Error("ES 音频描述符不完整");
    const flags = bytes[descriptor.start + 2];
    let at = descriptor.start + 3;
    if (flags & 128) at += 2;
    if (flags & 64) {
      if (at >= limit) throw new Error("ES 音频描述符不完整");
      at += 1 + bytes[at];
    }
    if (flags & 32) at += 2;
    descriptor = findDescriptor(bytes, at, limit, 4);
  }
  if (descriptor.tag !== 4 || descriptor.start + 13 > descriptor.end) {
    throw new Error("音频缺少解码配置");
  }
  const objectType = bytes[descriptor.start];
  const specific = findDescriptor(bytes, descriptor.start + 13, descriptor.end, 5);
  const description = bytes.subarray(specific.start, specific.end);
  if (description.length < 2) throw new Error("AudioSpecificConfig 不完整");
  let audioObjectType = description[0] >> 3;
  if (audioObjectType === 31) audioObjectType = 32 + ((description[0] & 7) << 3 | description[1] >> 5);
  if (!audioObjectType) throw new Error("音频编码类型无效");
  return {
    codec: objectType === 64 ? `${sampleType}.40.${audioObjectType}` : `${sampleType}.${objectType.toString(16)}`,
    description
  };
}

// src/panel/player/mp4.js
var textAt = (bytes, at) => String.fromCharCode(bytes[at] || 0, bytes[at + 1] || 0, bytes[at + 2] || 0, bytes[at + 3] || 0);
var u16 = (bytes, at) => (bytes[at] << 8 | bytes[at + 1]) >>> 0;
var u32 = (bytes, at) => (bytes[at] << 24 | bytes[at + 1] << 16 | bytes[at + 2] << 8 | bytes[at + 3]) >>> 0;
var u64 = (bytes, at) => u32(bytes, at) * 2 ** 32 + u32(bytes, at + 4);
var readBoxes = (bytes, start = 0, end = bytes.length) => {
  const list = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = u32(bytes, offset);
    const type = textAt(bytes, offset + 4);
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > end) break;
      size = u64(bytes, offset + 8);
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < headerSize || offset + size > end) break;
    list.push({
      type,
      start: offset,
      size,
      headerSize,
      bodyStart: offset + headerSize,
      bodyEnd: offset + size
    });
    offset += size;
  }
  return list;
};
var childOf = (list, type) => list.find((box) => box.type === type) || null;
var childrenOf = (list, type) => list.filter((box) => box.type === type);
var ENTRY_PREFIX = { avc1: 78, avc3: 78, hvc1: 78, hev1: 78, encv: 78, mp4a: 28, enca: 28 };
var readEntryCodec = (bytes, entry) => {
  const prefix = ENTRY_PREFIX[entry.type] ?? 0;
  const inner = readBoxes(bytes, entry.bodyStart + prefix, entry.bodyEnd);
  const config = childOf(inner, "hvcC") || childOf(inner, "avcC") || childOf(inner, "esds");
  if (!config) return { configType: "", description: null };
  return {
    configType: config.type,
    // 视频配置直接取 box 内容；esds 会在 readTracks 中继续提取内部的 ASC。
    description: bytes.subarray(config.bodyStart, config.bodyEnd)
  };
};
var hevcCodecString = (bytes, description, sampleType) => {
  if (!description || description.length < 13) return sampleType;
  const profileSpace = ["", "A", "B", "C"][description[1] >> 6 & 3];
  const tierFlag = description[1] >> 5 & 1 ? "H" : "L";
  const profileIdc = description[1] & 31;
  const compatFlags = (description[2] << 24 | description[3] << 16 | description[4] << 8 | description[5]) >>> 0;
  let reversed = 0;
  for (let index = 0; index < 32; index += 1) reversed = reversed << 1 | compatFlags >>> index & 1;
  reversed >>>= 0;
  const levelIdc = description[12];
  return `${sampleType}.${profileSpace}${profileIdc}.${reversed.toString(16).toUpperCase()}.${tierFlag}${levelIdc}`;
};
var avcCodecString = (bytes, description, sampleType) => {
  if (!description || description.length < 4) return sampleType;
  const hex = (value) => value.toString(16).padStart(2, "0");
  return `${sampleType}.${hex(description[1])}${hex(description[2])}${hex(description[3])}`;
};
var readSampleTable = (bytes, stbl) => {
  const stts = childOf(stbl, "stts");
  const stsc = childOf(stbl, "stsc");
  const stsz = childOf(stbl, "stsz");
  const stco = childOf(stbl, "stco") || childOf(stbl, "co64");
  const stss = childOf(stbl, "stss");
  if (!stts || !stsc || !stsz || !stco) return [];
  const sttsCount = u32(bytes, stts.bodyStart + 4);
  const deltas = [];
  for (let index = 0; index < sttsCount; index += 1) {
    const at = stts.bodyStart + 8 + index * 8;
    deltas.push({ count: u32(bytes, at), delta: u32(bytes, at + 4) });
  }
  const stscCount = u32(bytes, stsc.bodyStart + 4);
  const runs = [];
  for (let index = 0; index < stscCount; index += 1) {
    const at = stsc.bodyStart + 8 + index * 12;
    runs.push({
      firstChunk: u32(bytes, at),
      samplesPerChunk: u32(bytes, at + 4),
      sampleDescIndex: u32(bytes, at + 8)
    });
  }
  const uniformSize = u32(bytes, stsz.bodyStart + 4);
  const sampleCount = u32(bytes, stsz.bodyStart + 8);
  const sizes = [];
  for (let index = 0; index < sampleCount; index += 1) {
    sizes.push(uniformSize || u32(bytes, stsz.bodyStart + 12 + index * 4));
  }
  const chunkCount = u32(bytes, stco.bodyStart + 4);
  const chunkOffsets = [];
  for (let index = 0; index < chunkCount; index += 1) {
    const at = stco.bodyStart + 8 + (stco.type === "co64" ? index * 8 : index * 4);
    chunkOffsets.push(stco.type === "co64" ? u64(bytes, at) : u32(bytes, at));
  }
  const syncSamples = /* @__PURE__ */ new Set();
  if (stss) {
    const syncCount = u32(bytes, stss.bodyStart + 4);
    for (let index = 0; index < syncCount; index += 1) {
      syncSamples.add(u32(bytes, stss.bodyStart + 8 + index * 4));
    }
  }
  const samples = [];
  let sampleIndex = 0;
  for (let chunk = 0; chunk < chunkCount; chunk += 1) {
    let perChunk = runs[0]?.samplesPerChunk || 1;
    for (let runIndex = 0; runIndex < runs.length; runIndex += 1) {
      if (chunk + 1 >= runs[runIndex].firstChunk) perChunk = runs[runIndex].samplesPerChunk;
    }
    let offset = chunkOffsets[chunk];
    for (let inner = 0; inner < perChunk && sampleIndex < sampleCount; inner += 1) {
      const size = sizes[sampleIndex] || 0;
      samples.push({
        index: sampleIndex,
        offset,
        size,
        // stss 缺省时全部样本都是同步样本。
        key: stss ? syncSamples.has(sampleIndex + 1) : true
      });
      offset += size;
      sampleIndex += 1;
    }
  }
  let cursor = 0;
  let sampleAt = 0;
  for (const entry of deltas) {
    for (let index = 0; index < entry.count && sampleAt < samples.length; index += 1) {
      samples[sampleAt].time = cursor;
      samples[sampleAt].duration = entry.delta;
      cursor += entry.delta;
      sampleAt += 1;
    }
  }
  return samples;
};
var readTracks = (bytes, moov) => {
  const tracks = [];
  for (const trak of childrenOf(readBoxes(bytes, moov.bodyStart, moov.bodyEnd), "trak")) {
    const trakBoxes = readBoxes(bytes, trak.bodyStart, trak.bodyEnd);
    const mdia = childOf(trakBoxes, "mdia");
    if (!mdia) continue;
    const tkhd = childOf(trakBoxes, "tkhd");
    const edts = childOf(trakBoxes, "edts");
    let mediaTime = 0;
    if (edts) {
      const elst = childOf(readBoxes(bytes, edts.bodyStart, edts.bodyEnd), "elst");
      if (elst) {
        const raw = bytes[elst.bodyStart] === 1 ? u32(bytes, elst.bodyStart + 20) : u32(bytes, elst.bodyStart + 12);
        mediaTime = raw === 4294967295 ? 0 : raw;
      }
    }
    const mdiaBoxes = readBoxes(bytes, mdia.bodyStart, mdia.bodyEnd);
    const mdhd = childOf(mdiaBoxes, "mdhd");
    const hdlr = childOf(mdiaBoxes, "hdlr");
    const minf = childOf(mdiaBoxes, "minf");
    if (!mdhd || !hdlr || !minf) continue;
    const version = bytes[mdhd.bodyStart];
    const timescale = version === 1 ? u32(bytes, mdhd.bodyStart + 20) : u32(bytes, mdhd.bodyStart + 12);
    let trackId = 0;
    if (tkhd) {
      trackId = bytes[tkhd.bodyStart] === 1 ? u32(bytes, tkhd.bodyStart + 20) : u32(bytes, tkhd.bodyStart + 12);
    }
    const handler = textAt(bytes, hdlr.bodyStart + 8);
    const minfBoxes = readBoxes(bytes, minf.bodyStart, minf.bodyEnd);
    const stbl = childOf(minfBoxes, "stbl");
    if (!stbl) continue;
    const stblBoxes = readBoxes(bytes, stbl.bodyStart, stbl.bodyEnd);
    const stsd = childOf(stblBoxes, "stsd");
    if (!stsd) continue;
    const entries = readBoxes(bytes, stsd.bodyStart + 8, stsd.bodyEnd);
    const entry = entries[0];
    if (!entry) continue;
    let { configType, description } = readEntryCodec(bytes, entry);
    const sampleType = entry.type;
    let codec = sampleType;
    if (configType === "hvcC") codec = hevcCodecString(bytes, description, sampleType);
    else if (configType === "avcC") codec = avcCodecString(bytes, description, sampleType);
    else if (configType === "esds") {
      ({ codec, description } = parseEsds(description, sampleType));
    }
    const width = ENTRY_PREFIX[sampleType] ? u16(bytes, entry.bodyStart + 24) : 0;
    const height = ENTRY_PREFIX[sampleType] ? u16(bytes, entry.bodyStart + 26) : 0;
    const channels = sampleType === "mp4a" || sampleType === "enca" ? u16(bytes, entry.bodyStart + 16) : 0;
    const sampleRate = sampleType === "mp4a" || sampleType === "enca" ? u16(bytes, entry.bodyStart + 24) : 0;
    tracks.push({
      id: trackId,
      handler,
      kind: handler === "vide" ? "video" : handler === "soun" ? "audio" : "other",
      timescale: timescale || 1,
      sampleType,
      configType,
      codec,
      description,
      width,
      height,
      channels,
      sampleRate,
      mediaTime,
      samples: readSampleTable(bytes, stblBoxes)
    });
  }
  return tracks;
};
var parseMp4 = (bytes) => {
  const top = readBoxes(bytes);
  const moov = childOf(top, "moov");
  const mvhd = moov && childOf(readBoxes(bytes, moov.bodyStart, moov.bodyEnd), "mvhd");
  const version = mvhd ? bytes[mvhd.bodyStart] : 0;
  const movieTimescale = mvhd ? u32(bytes, mvhd.bodyStart + (version === 1 ? 20 : 12)) : 0;
  const movieDuration = !mvhd ? 0 : version === 1 ? u64(bytes, mvhd.bodyStart + 24) : u32(bytes, mvhd.bodyStart + 16);
  const tracks = moov ? readTracks(bytes, moov) : [];
  const withSamples = tracks.filter((track) => track.samples.length > 0);
  return {
    tracks,
    durationMs: movieTimescale ? Math.round(movieDuration / movieTimescale * 1e3) : 0,
    video: tracks.find((track) => track.kind === "video") || null,
    audio: tracks.find((track) => track.kind === "audio") || null,
    playable: withSamples,
    // 分片解析要用 trex 的默认样本参数。
    trex: moov ? readTrex(bytes, moov) : {}
  };
};
var toMicros = (time, timescale) => Math.round(time * 1e6 / (timescale || 1));
var readTrex = (bytes, moov) => {
  const mvex = childOf(readBoxes(bytes, moov.bodyStart, moov.bodyEnd), "mvex");
  const table = {};
  if (!mvex) return table;
  for (const trex of childrenOf(readBoxes(bytes, mvex.bodyStart, mvex.bodyEnd), "trex")) {
    const at = trex.bodyStart + 4;
    table[u32(bytes, at)] = {
      duration: u32(bytes, at + 8),
      size: u32(bytes, at + 12),
      flags: u32(bytes, at + 16)
    };
  }
  return table;
};
var readTraf = (bytes, traf, context, buckets) => {
  const inner = readBoxes(bytes, traf.bodyStart, traf.bodyEnd);
  const tfhd = childOf(inner, "tfhd");
  if (!tfhd) return;
  const tfhdFlags = u32(bytes, tfhd.bodyStart) & 16777215;
  let at = tfhd.bodyStart + 4;
  const trackId = u32(bytes, at);
  at += 4;
  let baseDataOffset = 0;
  if (tfhdFlags & 1) {
    baseDataOffset = u64(bytes, at);
    at += 8;
  }
  if (tfhdFlags & 2) at += 4;
  let defaultDuration = 0;
  if (tfhdFlags & 8) {
    defaultDuration = u32(bytes, at);
    at += 4;
  }
  let defaultSize = 0;
  if (tfhdFlags & 16) {
    defaultSize = u32(bytes, at);
    at += 4;
  }
  let defaultFlags = 0;
  if (tfhdFlags & 32) {
    defaultFlags = u32(bytes, at);
    at += 4;
  }
  const defaults = context.trex[trackId] || {};
  if (!defaultDuration) defaultDuration = defaults.duration || 0;
  if (!defaultSize) defaultSize = defaults.size || 0;
  if (!defaultFlags) defaultFlags = defaults.flags || 0;
  const tfdt = childOf(inner, "tfdt");
  let decodeTime = 0;
  if (tfdt) {
    decodeTime = bytes[tfdt.bodyStart] === 1 ? u64(bytes, tfdt.bodyStart + 4) : u32(bytes, tfdt.bodyStart + 4);
  } else {
    const track2 = context.tracks.find((item) => item.id === trackId);
    decodeTime = track2?.decodeTime || 0;
  }
  const base = baseDataOffset || context.moofStart;
  const list = buckets.get(trackId) || [];
  for (const trun of childrenOf(inner, "trun")) {
    const version = bytes[trun.bodyStart];
    const flags = u32(bytes, trun.bodyStart) & 16777215;
    const count = u32(bytes, trun.bodyStart + 4);
    let ptr = trun.bodyStart + 8;
    let dataOffset = 0;
    if (flags & 1) {
      dataOffset = u32(bytes, ptr) | 0;
      ptr += 4;
    }
    let firstSampleFlags = 0;
    if (flags & 4) {
      firstSampleFlags = u32(bytes, ptr);
      ptr += 4;
    }
    let offset = base + dataOffset;
    for (let index = 0; index < count; index += 1) {
      let duration = defaultDuration;
      let size = defaultSize;
      let sampleFlags = defaultFlags;
      let cts = 0;
      if (flags & 256) {
        duration = u32(bytes, ptr);
        ptr += 4;
      }
      if (flags & 512) {
        size = u32(bytes, ptr);
        ptr += 4;
      }
      if (flags & 1024) {
        sampleFlags = u32(bytes, ptr);
        ptr += 4;
      } else if (index === 0 && firstSampleFlags) {
        sampleFlags = firstSampleFlags;
      }
      if (flags & 2048) {
        cts = version === 1 ? u32(bytes, ptr) | 0 : u32(bytes, ptr);
        ptr += 4;
      }
      list.push({
        trackId,
        offset,
        size,
        duration,
        // 解码时间（DTS），组帧时再叠加 cts 偏移。
        time: decodeTime,
        cts,
        // sample_is_non_sync_sample 为 0 即关键帧。
        key: (sampleFlags & 65536) === 0
      });
      offset += size;
      decodeTime += duration;
    }
  }
  buckets.set(trackId, list);
  const track = context.tracks.find((item) => item.id === trackId);
  if (track) track.decodeTime = decodeTime;
};
var parseSegment = (bytes, tracks, trex = {}) => {
  const buckets = /* @__PURE__ */ new Map();
  const context = { tracks, trex, moofStart: 0 };
  for (const box of readBoxes(bytes)) {
    if (box.type !== "moof") continue;
    context.moofStart = box.start;
    for (const traf of childrenOf(readBoxes(bytes, box.bodyStart, box.bodyEnd), "traf")) {
      readTraf(bytes, traf, context, buckets);
    }
  }
  return buckets;
};

// src/panel/player/tempo-audio.js
var WORKER_SOURCE = true ? '/*\n * SoundTouch JS audio processing library\n * Copyright (c) Olli Parviainen\n * Copyright (c) Ryan Berdeen\n * Copyright (c) Jakub Fiala\n * Copyright (c) Steve \'Cutter\' Blades\n *\n * Licensed under the Mozilla Public License, v. 2.0.\n * You can obtain one at https://mozilla.org/MPL/2.0/.\n */\n(() => {\n  var __defProp = Object.defineProperty;\n  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;\n  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);\n\n  // node_modules/@soundtouchjs/core/.dist/AbstractSamplePipe.js\n  var AbstractSamplePipe = class {\n    /**\n     * Constructs an AbstractSamplePipe.\n     * @param options Constructor options.\n     *\n     * @remarks\n     * When `createBuffers` is true, both factories are required so subclasses can\n     * control exact buffer implementations without unsafe casting.\n     */\n    constructor({ createBuffers = false, inputBufferFactory, outputBufferFactory } = {}) {\n      /**\n       * Input buffer for audio samples.\n       */\n      __publicField(this, "_inputBuffer");\n      /**\n       * Output buffer for processed audio samples.\n       */\n      __publicField(this, "_outputBuffer");\n      if (createBuffers) {\n        if (!inputBufferFactory || !outputBufferFactory) {\n          throw new Error("buffer factories are required when createBuffers is true");\n        }\n        this._inputBuffer = inputBufferFactory();\n        this._outputBuffer = outputBufferFactory();\n      } else {\n        this._inputBuffer = null;\n        this._outputBuffer = null;\n      }\n    }\n    /**\n     * Gets the input buffer.\n     * @returns The current input buffer instance, or null if not set.\n     */\n    get inputBuffer() {\n      return this._inputBuffer;\n    }\n    /**\n     * Sets the input buffer.\n     * @param inputBuffer The new input buffer instance, or null to unset.\n     */\n    set inputBuffer(inputBuffer) {\n      this._inputBuffer = inputBuffer;\n    }\n    /**\n     * Gets the output buffer.\n     * @returns The current output buffer instance, or null if not set.\n     */\n    get outputBuffer() {\n      return this._outputBuffer;\n    }\n    /**\n     * Sets the output buffer.\n     * @param outputBuffer The new output buffer instance, or null to unset.\n     */\n    set outputBuffer(outputBuffer) {\n      this._outputBuffer = outputBuffer;\n    }\n    /**\n     * Clears both input and output buffers.\n     *\n     * @remarks\n     * Resets the state of both input and output buffers, if present, by calling their `clear()` methods.\n     */\n    clear() {\n      this._inputBuffer?.clear();\n      this._outputBuffer?.clear();\n    }\n  };\n\n  // node_modules/@soundtouchjs/core/.dist/FifoSampleBuffer.js\n  var BYTES_PER_SAMPLE = 4;\n  var SAMPLES_PER_FRAME = 2;\n  var BYTES_PER_FRAME = BYTES_PER_SAMPLE * SAMPLES_PER_FRAME;\n  var DEFAULT_MAX_FRAMES = 131072;\n  var FifoSampleBuffer = class {\n    /**\n     * Creates a new FifoSampleBuffer.\n     * @param maxFrames Maximum number of frames for buffer allocation.\n     */\n    constructor(maxFrames = DEFAULT_MAX_FRAMES) {\n      /**\n       * Backing ArrayBuffer for sample storage.\n       * @remarks\n       * Underlying memory for the buffer, which may be resized as needed.\n       */\n      __publicField(this, "_buffer");\n      /**\n       * Float32Array view of the buffer.\n       * @remarks\n       * Provides direct access to the sample data for reading and writing.\n       */\n      __publicField(this, "_vector");\n      /**\n       * Current read position (frame index).\n       * @remarks\n       * Indicates the logical start of readable data within the buffer.\n       */\n      __publicField(this, "_position");\n      /**\n       * Number of frames currently stored.\n       * @remarks\n       * Represents the number of complete stereo frames available for reading.\n       */\n      __publicField(this, "_frameCount");\n      this._buffer = new ArrayBuffer(0, {\n        maxByteLength: maxFrames * BYTES_PER_FRAME\n      });\n      this._vector = new Float32Array(this._buffer);\n      this._position = 0;\n      this._frameCount = 0;\n    }\n    /**\n     * Returns the Float32Array view of the buffer.\n     * @returns The Float32Array containing the sample data.\n     */\n    get vector() {\n      return this._vector;\n    }\n    /**\n     * Returns the current read position (frame index).\n     * @returns The current frame index for reading.\n     */\n    get position() {\n      return this._position;\n    }\n    /**\n     * Returns the start sample index for reading.\n     * @returns The sample index corresponding to the start of readable data.\n     */\n    get startIndex() {\n      return this._position * 2;\n    }\n    /**\n     * Returns the number of frames currently stored.\n     * @returns The number of complete frames available for reading.\n     */\n    get frameCount() {\n      return this._frameCount;\n    }\n    /**\n     * Returns the end sample index for reading.\n     * @returns The sample index corresponding to the end of readable data.\n     */\n    get endIndex() {\n      return (this._position + this._frameCount) * 2;\n    }\n    /**\n     * Clears the buffer and resets position and frame count.\n     * @remarks\n     * Fills the buffer with zeros and resets all internal state.\n     */\n    clear() {\n      this._vector.fill(0);\n      this._position = 0;\n      this._frameCount = 0;\n    }\n    /**\n     * Adds empty frames to the buffer.\n     * @param numFrames Number of frames to add.\n     */\n    put(numFrames) {\n      this._frameCount += numFrames;\n    }\n    /**\n     * Adds samples to the buffer from a Float32Array.\n     * @param samples Source samples (interleaved stereo).\n     * @param position Start frame index in source.\n     * @param numFrames Number of frames to copy (default: all available).\n     * @remarks\n     * Automatically grows the buffer if needed. Only complete frames are appended.\n     */\n    putSamples(samples, position = 0, numFrames = 0) {\n      const sourceOffset = position * 2;\n      if (!(numFrames >= 0) || numFrames === 0) {\n        numFrames = (samples.length - sourceOffset) / 2;\n      }\n      const numSamples = numFrames * 2;\n      this.ensureCapacity(numFrames + this._frameCount);\n      const destOffset = this.endIndex;\n      this._vector.set(samples.subarray(sourceOffset, sourceOffset + numSamples), destOffset);\n      this._frameCount += numFrames;\n    }\n    /**\n     * Adds samples from another FifoSampleBuffer.\n     * @param buffer Source buffer.\n     * @param position Start frame index in source buffer.\n     * @param numFrames Number of frames to copy (default: all available).\n     */\n    putBuffer(buffer, position = 0, numFrames = 0) {\n      if (!(numFrames >= 0) || numFrames === 0) {\n        numFrames = buffer.frameCount - position;\n      }\n      this.putSamples(buffer.vector, buffer.position + position, numFrames);\n    }\n    /**\n     * Advances the read position and reduces frame count.\n     * @param numFrames Number of frames to receive (default: all available).\n     * @remarks\n     * Consumed frames are no longer available for reading.\n     */\n    receive(numFrames) {\n      if (numFrames === void 0 || !(numFrames >= 0) || numFrames > this._frameCount) {\n        numFrames = this._frameCount;\n      }\n      this._frameCount -= numFrames;\n      this._position += numFrames;\n    }\n    /**\n     * Copies and receives samples into an output array.\n     * @param output Destination Float32Array.\n     * @param numFrames Number of frames to copy and receive.\n     * @remarks\n     * Advances the read position after copying.\n     */\n    receiveSamples(output, numFrames = 0) {\n      const numSamples = numFrames * 2;\n      const sourceOffset = this.startIndex;\n      output.set(this._vector.subarray(sourceOffset, sourceOffset + numSamples));\n      this.receive(numFrames);\n    }\n    /**\n     * Extracts samples into an output array without advancing position.\n     * @param output Destination Float32Array.\n     * @param position Start frame index in buffer.\n     * @param numFrames Number of frames to extract.\n     */\n    extract(output, position = 0, numFrames = 0) {\n      const sourceOffset = this.startIndex + position * 2;\n      const numSamples = numFrames * 2;\n      output.set(this._vector.subarray(sourceOffset, sourceOffset + numSamples));\n    }\n    /**\n     * Ensures the buffer has capacity for at least numFrames.\n     * @param numFrames Minimum number of frames required.\n     * @remarks\n     * Grows the buffer if needed, preserving all readable frames in order.\n     */\n    ensureCapacity(numFrames = 0) {\n      const minLength = Math.floor(numFrames * SAMPLES_PER_FRAME);\n      if (this._vector.length < minLength) {\n        const newByteLength = minLength * BYTES_PER_SAMPLE;\n        if (newByteLength <= this._buffer.maxByteLength) {\n          this.rewind();\n          this._buffer.resize(newByteLength);\n          this._vector = new Float32Array(this._buffer);\n        } else {\n          const newMaxBytes = newByteLength * 2;\n          const newBuffer = new ArrayBuffer(newByteLength, {\n            maxByteLength: newMaxBytes\n          });\n          const newVector = new Float32Array(newBuffer);\n          newVector.set(this._vector.subarray(this.startIndex, this.endIndex));\n          this._buffer = newBuffer;\n          this._vector = newVector;\n          this._position = 0;\n        }\n      } else {\n        this.rewind();\n      }\n    }\n    /**\n     * Ensures buffer has capacity for additional frames.\n     * @param numFrames Number of additional frames required.\n     */\n    ensureAdditionalCapacity(numFrames = 0) {\n      this.ensureCapacity(this._frameCount + numFrames);\n    }\n    /**\n     * Moves all unread samples to the start of the buffer.\n     * @remarks\n     * Compacts the buffer so that all unread samples are at the beginning, freeing space for new data.\n     */\n    rewind() {\n      if (this._position > 0) {\n        this._vector.set(this._vector.subarray(this.startIndex, this.endIndex));\n        this._position = 0;\n      }\n    }\n  };\n\n  // node_modules/@soundtouchjs/core/.dist/Stretch.js\n  var FifoStretchBufferAdapter = class {\n    constructor() {\n      __publicField(this, "buffer");\n      __publicField(this, "fallbackBuffer");\n      __publicField(this, "fallbackScratch");\n      this.buffer = null;\n      this.fallbackBuffer = new FifoSampleBuffer();\n      this.fallbackScratch = new Float32Array(0);\n    }\n    /**\n     * @param buffer Source buffer to expose through FIFO-style reads.\n     */\n    setBuffer(buffer) {\n      if (buffer instanceof FifoSampleBuffer) {\n        this.buffer = buffer;\n        return;\n      }\n      const frameCount = buffer.frameCount;\n      if (frameCount > 0) {\n        const sampleCount = frameCount * 2;\n        if (this.fallbackScratch.length < sampleCount) {\n          this.fallbackScratch = new Float32Array(sampleCount);\n        }\n        buffer.extract(this.fallbackScratch, 0, frameCount);\n        this.fallbackBuffer.clear();\n        this.fallbackBuffer.putSamples(this.fallbackScratch, 0, frameCount);\n        buffer.receive(frameCount);\n      } else {\n        this.fallbackBuffer.clear();\n      }\n      this.buffer = this.fallbackBuffer;\n    }\n    /**\n     * Returns the currently bound FIFO buffer.\n     * @throws Error when `setBuffer` has not been called yet.\n     */\n    getBoundBuffer() {\n      if (this.buffer === null) {\n        throw new Error("buffer is not set");\n      }\n      return this.buffer;\n    }\n    get frameCount() {\n      return this.getBoundBuffer().frameCount;\n    }\n    get startIndex() {\n      return this.getBoundBuffer().startIndex;\n    }\n    readSample(sampleIndex) {\n      const boundBuffer = this.getBoundBuffer();\n      const start = boundBuffer.startIndex;\n      const end = start + boundBuffer.frameCount * 2;\n      if (sampleIndex < start || sampleIndex >= end) {\n        return 0;\n      }\n      return boundBuffer.vector[sampleIndex];\n    }\n    readSubarray(start, end) {\n      return this.getBoundBuffer().vector.subarray(start, end);\n    }\n    receive(numFrames) {\n      this.getBoundBuffer().receive(numFrames);\n    }\n    receiveSamples(output, numFrames) {\n      this.getBoundBuffer().receiveSamples(output, numFrames);\n    }\n  };\n  var GenericStretchWriteBufferAdapter = class {\n    constructor() {\n      __publicField(this, "buffer");\n      this.buffer = null;\n    }\n    setOutputBuffer(buffer) {\n      this.buffer = buffer;\n    }\n    /**\n     * Returns the currently bound output buffer.\n     * @throws Error when `setOutputBuffer` has not been called.\n     */\n    getBoundBuffer() {\n      if (this.buffer === null) {\n        throw new Error("output buffer is not set");\n      }\n      return this.buffer;\n    }\n    appendSamples(samples, numFrames) {\n      this.getBoundBuffer().putSamples(samples, 0, numFrames);\n    }\n    putFrom(source, position, numFrames) {\n      const sourceStart = source.startIndex + position * 2;\n      const sourceEnd = sourceStart + numFrames * 2;\n      const chunk = source.readSubarray(sourceStart, sourceEnd);\n      this.getBoundBuffer().putSamples(chunk, 0, numFrames);\n    }\n  };\n  var createFifoStretchInputBufferAdapter = () => new FifoStretchBufferAdapter();\n  var USE_AUTO_SEQUENCE_LEN = 0;\n  var DEFAULT_SEQUENCE_MS = USE_AUTO_SEQUENCE_LEN;\n  var USE_AUTO_SEEKWINDOW_LEN = 0;\n  var DEFAULT_SEEKWINDOW_MS = USE_AUTO_SEEKWINDOW_LEN;\n  var DEFAULT_OVERLAP_MS = 8;\n  var AUTOSEQ_TEMPO_LOW = 0.25;\n  var AUTOSEQ_TEMPO_TOP = 4;\n  var AUTOSEQ_AT_MIN = 125;\n  var AUTOSEQ_AT_MAX = 50;\n  var AUTOSEQ_K = (AUTOSEQ_AT_MAX - AUTOSEQ_AT_MIN) / (AUTOSEQ_TEMPO_TOP - AUTOSEQ_TEMPO_LOW);\n  var AUTOSEQ_C = AUTOSEQ_AT_MIN - AUTOSEQ_K * AUTOSEQ_TEMPO_LOW;\n  var AUTOSEEK_AT_MIN = 25;\n  var AUTOSEEK_AT_MAX = 15;\n  var AUTOSEEK_K = (AUTOSEEK_AT_MAX - AUTOSEEK_AT_MIN) / (AUTOSEQ_TEMPO_TOP - AUTOSEQ_TEMPO_LOW);\n  var AUTOSEEK_C = AUTOSEEK_AT_MIN - AUTOSEEK_K * AUTOSEQ_TEMPO_LOW;\n  var NORMALIZED_CORRELATION_EPSILON = 1e-12;\n  var QUICK_SEEK_FALLBACK_THRESHOLD = 256;\n  var QUICK_SEEK_MIN_VALID_CANDIDATES = 8;\n  var Stretch = class _Stretch extends AbstractSamplePipe {\n    /**\n     * Creates a Stretch instance.\n     * @param options Constructor options.\n     */\n    constructor({ sampleRate = 44100, createBuffers = false, inputBufferAdapterFactory = createFifoStretchInputBufferAdapter, sampleBufferFactory = () => new FifoSampleBuffer() } = {}) {\n      super({\n        createBuffers,\n        inputBufferFactory: sampleBufferFactory,\n        outputBufferFactory: sampleBufferFactory\n      });\n      __publicField(this, "inputBufferAdapterFactory");\n      __publicField(this, "sampleBufferFactory");\n      __publicField(this, "inputBufferAdapter");\n      __publicField(this, "outputBufferAdapter");\n      __publicField(this, "overlapScratch");\n      __publicField(this, "_quickSeek");\n      __publicField(this, "midBufferDirty");\n      __publicField(this, "midBuffer");\n      __publicField(this, "refMidBuffer");\n      __publicField(this, "refMidBufferEnergy");\n      __publicField(this, "overlapLength");\n      __publicField(this, "autoSeqSetting");\n      __publicField(this, "autoSeekSetting");\n      __publicField(this, "_tempo");\n      __publicField(this, "sampleRate");\n      __publicField(this, "_overlapMs");\n      __publicField(this, "sequenceMs");\n      __publicField(this, "seekWindowMs");\n      __publicField(this, "seekWindowLength");\n      __publicField(this, "seekLength");\n      __publicField(this, "nominalSkip");\n      __publicField(this, "skipFract");\n      __publicField(this, "sampleReq");\n      this.inputBufferAdapterFactory = inputBufferAdapterFactory;\n      this.sampleBufferFactory = sampleBufferFactory;\n      this.inputBufferAdapter = inputBufferAdapterFactory();\n      this.outputBufferAdapter = new GenericStretchWriteBufferAdapter();\n      this.overlapScratch = new Float32Array(0);\n      this._quickSeek = true;\n      this.midBufferDirty = true;\n      this.midBuffer = null;\n      this.refMidBufferEnergy = 0;\n      this.overlapLength = 0;\n      this.autoSeqSetting = true;\n      this.autoSeekSetting = true;\n      this._tempo = 1;\n      this.setParameters(sampleRate, DEFAULT_SEQUENCE_MS, DEFAULT_SEEKWINDOW_MS, DEFAULT_OVERLAP_MS);\n    }\n    clear() {\n      super.clear();\n      this.clearMidBuffer();\n    }\n    clearMidBuffer() {\n      this.midBufferDirty = true;\n      if (this.midBuffer) {\n        this.midBuffer.fill(0);\n      }\n      if (this.refMidBuffer) {\n        this.refMidBuffer.fill(0);\n      }\n      this.skipFract = 0;\n    }\n    setParameters(sampleRate, sequenceMs, seekWindowMs, overlapMs) {\n      if (sampleRate > 0) {\n        this.sampleRate = sampleRate;\n      }\n      if (overlapMs > 0) {\n        this._overlapMs = overlapMs;\n      }\n      if (sequenceMs > 0) {\n        this.sequenceMs = sequenceMs;\n        this.autoSeqSetting = false;\n      } else {\n        this.autoSeqSetting = true;\n      }\n      if (seekWindowMs > 0) {\n        this.seekWindowMs = seekWindowMs;\n        this.autoSeekSetting = false;\n      } else {\n        this.autoSeekSetting = true;\n      }\n      this.calculateSequenceParameters();\n      this.calculateOverlapLength(this._overlapMs);\n      this.updateTempoDerivedState();\n    }\n    set tempo(newTempo) {\n      this._tempo = newTempo;\n      this.updateTempoDerivedState();\n    }\n    get tempo() {\n      return this._tempo;\n    }\n    get inputChunkSize() {\n      return this.sampleReq;\n    }\n    get outputChunkSize() {\n      return this.overlapLength + Math.max(0, this.seekWindowLength - 2 * this.overlapLength);\n    }\n    calculateOverlapLength(overlapInMsec = 0) {\n      let newOvl = this.sampleRate * overlapInMsec / 1e3;\n      newOvl = newOvl < 16 ? 16 : newOvl;\n      newOvl -= newOvl % 8;\n      if (newOvl === this.overlapLength && this.midBuffer !== null) {\n        return;\n      }\n      this.overlapLength = newOvl;\n      const needed = this.overlapLength * 2;\n      if (!this.refMidBuffer || this.refMidBuffer.length < needed) {\n        this.refMidBuffer = new Float32Array(needed);\n      }\n      if (!this.midBuffer || this.midBuffer.length < needed) {\n        this.midBuffer = new Float32Array(needed);\n      }\n    }\n    checkLimits(x, mi, ma) {\n      return x < mi ? mi : x > ma ? ma : x;\n    }\n    calculateSequenceParameters() {\n      if (this.autoSeqSetting) {\n        let seq = AUTOSEQ_C + AUTOSEQ_K * this._tempo;\n        seq = this.checkLimits(seq, AUTOSEQ_AT_MAX, AUTOSEQ_AT_MIN);\n        this.sequenceMs = Math.floor(seq + 0.5);\n      }\n      if (this.autoSeekSetting) {\n        let seek = AUTOSEEK_C + AUTOSEEK_K * this._tempo;\n        seek = this.checkLimits(seek, AUTOSEEK_AT_MAX, AUTOSEEK_AT_MIN);\n        this.seekWindowMs = Math.floor(seek + 0.5);\n      }\n      this.seekWindowLength = Math.floor(this.sampleRate * this.sequenceMs / 1e3);\n      this.seekLength = Math.floor(this.sampleRate * this.seekWindowMs / 1e3);\n      this.normalizeWindowInvariants();\n    }\n    normalizeWindowInvariants() {\n      this.seekLength = Math.max(1, this.seekLength);\n      this.seekWindowLength = Math.max(this.seekWindowLength, this.overlapLength);\n    }\n    updateTempoDerivedState() {\n      this.calculateSequenceParameters();\n      this.nominalSkip = this._tempo * (this.seekWindowLength - this.overlapLength);\n      this.skipFract = 0;\n      const intskip = Math.floor(this.nominalSkip + 0.5);\n      this.sampleReq = Math.max(intskip + this.overlapLength, this.seekWindowLength) + this.seekLength;\n    }\n    /**\n     * Whether the fast multi-pass seek algorithm is active.\n     * @returns `true` if quick seek is enabled (default); `false` for exhaustive search.\n     */\n    get quickSeek() {\n      return this._quickSeek;\n    }\n    set quickSeek(enable) {\n      this._quickSeek = enable;\n    }\n    /**\n     * Current overlap crossfade length in milliseconds.\n     * @returns The overlap period used at the current sample rate.\n     */\n    get overlapMs() {\n      return this._overlapMs;\n    }\n    /**\n     * Sets the overlap crossfade length and recalculates derived parameters.\n     * @param ms Overlap period in milliseconds (must be > 0).\n     */\n    set overlapMs(ms) {\n      if (ms > 0) {\n        this._overlapMs = ms;\n        this.calculateOverlapLength(this._overlapMs);\n        this.calculateSequenceParameters();\n        this.updateTempoDerivedState();\n      }\n    }\n    /**\n     * Applies a partial set of WSOLA timing parameters.\n     *\n     * @remarks\n     * Only the provided fields are updated; omitted fields remain unchanged.\n     * Pass `sequenceMs: 0` or `seekWindowMs: 0` to switch that dimension back to auto-calculation.\n     *\n     * @param params Partial set of WSOLA timing parameters to apply.\n     *\n     * @example\n     * stretch.setStretchParameters({ overlapMs: 12, quickSeek: false });\n     */\n    setStretchParameters(params) {\n      if (params.quickSeek !== void 0) {\n        this._quickSeek = params.quickSeek;\n      }\n      let needsRecalc = false;\n      if (params.sequenceMs !== void 0) {\n        if (params.sequenceMs > 0) {\n          this.sequenceMs = params.sequenceMs;\n          this.autoSeqSetting = false;\n        } else {\n          this.autoSeqSetting = true;\n        }\n        needsRecalc = true;\n      }\n      if (params.seekWindowMs !== void 0) {\n        if (params.seekWindowMs > 0) {\n          this.seekWindowMs = params.seekWindowMs;\n          this.autoSeekSetting = false;\n        } else {\n          this.autoSeekSetting = true;\n        }\n        needsRecalc = true;\n      }\n      if (params.overlapMs !== void 0 && params.overlapMs > 0) {\n        this._overlapMs = params.overlapMs;\n        this.calculateOverlapLength(this._overlapMs);\n        needsRecalc = true;\n      }\n      if (needsRecalc) {\n        this.calculateSequenceParameters();\n        this.updateTempoDerivedState();\n      }\n    }\n    clone() {\n      const result = new _Stretch({\n        createBuffers: false,\n        inputBufferAdapterFactory: this.inputBufferAdapterFactory,\n        sampleBufferFactory: this.sampleBufferFactory\n      });\n      result.tempo = this._tempo;\n      result.setParameters(this.sampleRate, this.sequenceMs, this.seekWindowMs, this._overlapMs);\n      return result;\n    }\n    seekBestOverlapPosition(inputBuffer) {\n      const resolvedInputBuffer = inputBuffer ?? this.getInputBufferAdapter();\n      if (!this._quickSeek || this.seekLength <= QUICK_SEEK_FALLBACK_THRESHOLD) {\n        return this.seekBestOverlapPositionStereo(resolvedInputBuffer);\n      }\n      return this.seekBestOverlapPositionStereoQuick(resolvedInputBuffer);\n    }\n    seekBestOverlapPositionStereo(inputBuffer) {\n      let bestOffset;\n      let bestCorrelation;\n      let correlation;\n      this.preCalculateCorrelationReferenceStereo();\n      bestOffset = 0;\n      bestCorrelation = -Infinity;\n      for (let i = 0; i < this.seekLength; i++) {\n        correlation = this.calculateCrossCorrelationStereo(2 * i, this.refMidBuffer, inputBuffer);\n        if (correlation > bestCorrelation) {\n          bestCorrelation = correlation;\n          bestOffset = i;\n        }\n      }\n      return bestOffset;\n    }\n    seekBestOverlapPositionStereoQuick(inputBuffer) {\n      let bestOffset;\n      let bestCorrelation;\n      let correlation;\n      let correlationOffset;\n      let tempOffset;\n      let evaluatedCandidates;\n      this.preCalculateCorrelationReferenceStereo();\n      bestCorrelation = this.calculateCrossCorrelationStereo(0, this.refMidBuffer, inputBuffer);\n      evaluatedCandidates = 1;\n      bestOffset = 0;\n      correlationOffset = 0;\n      for (let scanCount = 0; scanCount < 4; scanCount++) {\n        let previousTempOffset = Number.MIN_SAFE_INTEGER;\n        const scanOffsets = this.getQuickScanOffsets(scanCount);\n        for (const scanOffset of scanOffsets) {\n          tempOffset = correlationOffset + scanOffset;\n          if (tempOffset === previousTempOffset) {\n            continue;\n          }\n          previousTempOffset = tempOffset;\n          if (tempOffset < 0) {\n            continue;\n          }\n          if (tempOffset >= this.seekLength) {\n            continue;\n          }\n          correlation = this.calculateCrossCorrelationStereo(2 * tempOffset, this.refMidBuffer, inputBuffer);\n          evaluatedCandidates++;\n          if (correlation > bestCorrelation) {\n            bestCorrelation = correlation;\n            bestOffset = tempOffset;\n          }\n        }\n        correlationOffset = bestOffset;\n      }\n      if (evaluatedCandidates < QUICK_SEEK_MIN_VALID_CANDIDATES) {\n        return this.seekBestOverlapPositionStereo(inputBuffer);\n      }\n      return bestOffset;\n    }\n    getQuickScanOffsets(stage) {\n      const maxOffset = Math.max(1, this.seekLength - 1);\n      if (stage === 0) {\n        return this.generateFractionalScanOffsets(maxOffset, 2, 1, 14, 24);\n      }\n      if (stage === 1) {\n        return this.generateSymmetricScanOffsets(maxOffset, 0.2);\n      }\n      if (stage === 2) {\n        return this.generateSymmetricScanOffsets(maxOffset, 0.06);\n      }\n      return this.generateSymmetricScanOffsets(maxOffset, 0.015);\n    }\n    generateFractionalScanOffsets(maxOffset, startNumerator, stepNumerator, denominator, steps) {\n      const offsets = [];\n      const seen = /* @__PURE__ */ new Set();\n      const safeDenominator = Math.max(1, denominator);\n      const safeSteps = Math.max(1, steps);\n      for (let i = 0; i < safeSteps; i++) {\n        const numerator = startNumerator + i * stepNumerator;\n        const value = Math.round(maxOffset * numerator / safeDenominator);\n        if (value <= 0 || value >= this.seekLength || seen.has(value)) {\n          continue;\n        }\n        seen.add(value);\n        offsets.push(value);\n      }\n      return offsets;\n    }\n    generateSymmetricScanOffsets(maxOffset, spanRatio) {\n      const span = Math.max(1, Math.round(maxOffset * spanRatio));\n      const scales = [1, 0.75, 0.5, 0.25];\n      const negative = [];\n      const positive = [];\n      const seen = /* @__PURE__ */ new Set();\n      for (const scale of scales) {\n        const magnitude = Math.max(1, Math.round(span * scale));\n        const neg = -magnitude;\n        const pos = magnitude;\n        if (!seen.has(neg)) {\n          seen.add(neg);\n          negative.push(neg);\n        }\n        if (!seen.has(pos)) {\n          seen.add(pos);\n          positive.push(pos);\n        }\n      }\n      return negative.concat(positive);\n    }\n    preCalculateCorrelationReferenceStereo() {\n      let energy = 0;\n      for (let i = 0; i < this.overlapLength; i++) {\n        const temp = i * (this.overlapLength - i);\n        const ctx = i * 2;\n        const left = this.midBuffer[ctx] * temp;\n        const right = this.midBuffer[ctx + 1] * temp;\n        this.refMidBuffer[ctx] = left;\n        this.refMidBuffer[ctx + 1] = right;\n        energy += left * left + right * right;\n      }\n      this.refMidBufferEnergy = energy;\n    }\n    calculateCrossCorrelationStereo(mixingPos, compare, inputBuffer) {\n      mixingPos += inputBuffer.startIndex;\n      let dot = 0;\n      let sourceEnergy = 0;\n      const calcLength = 2 * this.overlapLength;\n      const source = inputBuffer.readSubarray(mixingPos, mixingPos + calcLength);\n      for (let i = 0; i < calcLength; i += 2) {\n        const sourceLeft = i < source.length ? source[i] : 0;\n        const sourceRight = i + 1 < source.length ? source[i + 1] : 0;\n        const compareLeft = compare[i];\n        const compareRight = compare[i + 1];\n        dot += sourceLeft * compareLeft + sourceRight * compareRight;\n        sourceEnergy += sourceLeft * sourceLeft + sourceRight * sourceRight;\n      }\n      if (sourceEnergy <= NORMALIZED_CORRELATION_EPSILON || this.refMidBufferEnergy <= NORMALIZED_CORRELATION_EPSILON) {\n        return -1;\n      }\n      return dot / Math.sqrt(sourceEnergy * this.refMidBufferEnergy);\n    }\n    overlapStereo(inputPosition, inputBuffer, outputBuffer) {\n      inputPosition += inputBuffer.startIndex;\n      const overlapSamples = this.overlapLength * 2;\n      if (this.overlapScratch.length < overlapSamples) {\n        this.overlapScratch = new Float32Array(overlapSamples);\n      }\n      const output = this.overlapScratch;\n      const input = inputBuffer.readSubarray(inputPosition, inputPosition + overlapSamples);\n      const frameScale = 1 / this.overlapLength;\n      for (let i = 0; i < this.overlapLength; i++) {\n        const tempFrame = (this.overlapLength - i) * frameScale;\n        const fi = i * frameScale;\n        const ctx = 2 * i;\n        const inputLeft = ctx < input.length ? input[ctx] : 0;\n        const inputRight = ctx + 1 < input.length ? input[ctx + 1] : 0;\n        output[ctx] = inputLeft * fi + this.midBuffer[ctx] * tempFrame;\n        output[ctx + 1] = inputRight * fi + this.midBuffer[ctx + 1] * tempFrame;\n      }\n      outputBuffer.appendSamples(output, this.overlapLength);\n    }\n    process() {\n      const inputBuffer = this.getInputBufferAdapter();\n      const outputBuffer = this.getOutputBufferAdapter();\n      if (!this.bootstrapMidBuffer(inputBuffer)) {\n        return;\n      }\n      while (inputBuffer.frameCount >= this.sampleReq) {\n        this.processOneWindow(inputBuffer, outputBuffer);\n      }\n    }\n    bootstrapMidBuffer(inputBuffer) {\n      if (!this.midBufferDirty) {\n        return true;\n      }\n      if (inputBuffer.frameCount < this.overlapLength) {\n        return false;\n      }\n      const needed = this.overlapLength * 2;\n      if (!this.midBuffer || this.midBuffer.length < needed) {\n        this.midBuffer = new Float32Array(needed);\n      }\n      inputBuffer.receiveSamples(this.midBuffer, this.overlapLength);\n      this.midBufferDirty = false;\n      return true;\n    }\n    processOneWindow(inputBuffer, outputBuffer) {\n      const offset = this.seekBestOverlapPosition(inputBuffer);\n      this.overlapStereo(2 * Math.floor(offset), inputBuffer, outputBuffer);\n      const middleFrames = this.seekWindowLength - 2 * this.overlapLength;\n      if (middleFrames > 0) {\n        outputBuffer.putFrom(inputBuffer, offset + this.overlapLength, middleFrames);\n      }\n      this.captureOverlapHistory(offset, inputBuffer);\n      this.advanceInputByNominalSkip(inputBuffer);\n    }\n    captureOverlapHistory(offset, inputBuffer) {\n      const start = inputBuffer.startIndex + 2 * (offset + this.seekWindowLength - this.overlapLength);\n      this.midBuffer.set(inputBuffer.readSubarray(start, start + 2 * this.overlapLength));\n    }\n    advanceInputByNominalSkip(inputBuffer) {\n      this.skipFract += this.nominalSkip;\n      const overlapSkip = Math.floor(this.skipFract);\n      this.skipFract -= overlapSkip;\n      inputBuffer.receive(overlapSkip);\n    }\n    getInputBufferAdapter() {\n      if (this._inputBuffer === null) {\n        throw new Error("inputBuffer is not set");\n      }\n      this.inputBufferAdapter.setBuffer(this._inputBuffer);\n      return this.inputBufferAdapter;\n    }\n    getOutputBufferAdapter() {\n      if (this._outputBuffer === null) {\n        throw new Error("outputBuffer is not set");\n      }\n      this.outputBufferAdapter.setOutputBuffer(this._outputBuffer);\n      return this.outputBufferAdapter;\n    }\n  };\n\n  // src/panel/player/tempo-processing.js\n  var BLOCK_FRAMES = 8192;\n  var OVERLAP_MS = 8;\n  function createTempoProcessor({ rate, sampleRate, channels }) {\n    if (!Number.isFinite(rate) || rate < 0.75 || rate > 3) throw new RangeError("无效的保调倍率");\n    if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new RangeError("无效的采样率");\n    if (channels !== 1 && channels !== 2) throw new RangeError("保调仅支持单声道或双声道");\n    const stretch = new Stretch({ createBuffers: true, sampleRate });\n    stretch.setStretchParameters({ sequenceMs: 50, seekWindowMs: 15, overlapMs: OVERLAP_MS, quickSeek: true });\n    stretch.tempo = rate;\n    const input = new Float32Array(BLOCK_FRAMES * 2);\n    const output = new Float32Array(BLOCK_FRAMES * 2);\n    let received = 0;\n    let emitted = 0;\n    let finished = false;\n    return {\n      append(planes, final = false) {\n        if (finished) throw new Error("保调流已经结束");\n        if (!Array.isArray(planes) || planes.length !== channels) throw new TypeError("声道平面不完整");\n        const frames = planes[0]?.length;\n        if (!Number.isSafeInteger(frames) || planes.some((plane) => !(plane instanceof Float32Array) || plane.length !== frames)) {\n          throw new TypeError("保调输入必须是等长 Float32 声道平面");\n        }\n        received += frames;\n        const expected = Math.round(received / rate);\n        const blocks = [];\n        let count = 0;\n        const process = (size) => {\n          stretch.inputBuffer.putSamples(input, 0, size);\n          stretch.process();\n          while (stretch.outputBuffer.frameCount > 0 && emitted < expected) {\n            const size2 = Math.min(BLOCK_FRAMES, stretch.outputBuffer.frameCount, expected - emitted);\n            stretch.outputBuffer.receiveSamples(output, size2);\n            const block = Array.from({ length: channels }, () => new Float32Array(size2));\n            for (let i = 0; i < size2; i++) {\n              for (let c = 0; c < channels; c++) {\n                const value = output[i * 2 + c];\n                if (!Number.isFinite(value)) throw new Error("保调产生了无效音频样本");\n                block[c][i] = value;\n              }\n            }\n            blocks.push(block);\n            emitted += size2;\n            count += size2;\n          }\n        };\n        for (let offset2 = 0; offset2 < frames; offset2 += BLOCK_FRAMES) {\n          const size = Math.min(BLOCK_FRAMES, frames - offset2);\n          for (let i = 0; i < size; i++) {\n            const left = planes[0][offset2 + i];\n            const right = planes[channels === 1 ? 0 : 1][offset2 + i];\n            if (!Number.isFinite(left) || !Number.isFinite(right)) throw new TypeError("保调输入含无效音频样本");\n            input[i * 2] = left;\n            input[i * 2 + 1] = right;\n          }\n          process(size);\n        }\n        if (final) {\n          const budget = Math.ceil(stretch.inputChunkSize + rate * stretch.outputChunkSize + sampleRate * OVERLAP_MS / 1e3);\n          input.fill(0);\n          for (let padded = 0; padded < budget && emitted < expected; padded += BLOCK_FRAMES) {\n            process(Math.min(BLOCK_FRAMES, budget - padded));\n          }\n          if (emitted !== expected) throw new Error("保调尾部未能排空");\n          finished = true;\n        }\n        const result = Array.from({ length: channels }, () => new Float32Array(count));\n        let offset = 0;\n        for (const block of blocks) {\n          for (let c = 0; c < channels; c++) result[c].set(block[c], offset);\n          offset += block[0].length;\n        }\n        return { planes: result, frameCount: count, final, rate, sampleRate, channels };\n      }\n    };\n  }\n\n  // src/panel/player/tempo-worker.js\n  var processor = null;\n  self.onmessage = (event) => {\n    try {\n      processor ?? (processor = createTempoProcessor(event.data));\n      const result = processor.append(event.data.planes, event.data.final === true);\n      self.postMessage({ type: "chunk", ...result }, result.planes.map((plane) => plane.buffer));\n      if (result.final) self.close();\n    } catch (error) {\n      self.postMessage({ type: "error", message: error?.message || String(error) });\n      self.close();\n    }\n  };\n})();\n' : "";
function createTempoStreamRenderer({ rate, sampleRate, channels }) {
  let worker = null;
  let url = null;
  let pending = null;
  let destroyed = false;
  const release = () => {
    if (worker) {
      worker.onmessage = worker.onerror = worker.onmessageerror = null;
      worker.terminate();
      worker = null;
    }
    if (url) URL.revokeObjectURL(url);
    url = null;
  };
  const settle = (error, result) => {
    const job = pending;
    if (!job) return;
    pending = null;
    clearTimeout(job.timer);
    if (error || result?.final) {
      destroyed = true;
      release();
    }
    if (error) job.reject(error);
    else job.resolve(result);
  };
  return {
    append(planes, final = false) {
      if (destroyed) return Promise.reject(new DOMException("保调流已取消", "AbortError"));
      if (pending) return Promise.reject(new Error("保调块必须顺序提交"));
      return new Promise((resolve, reject) => {
        pending = { resolve, reject, timer: setTimeout(() => settle(new Error("保调处理超时")), 6e4) };
        try {
          if (!worker) {
            if (!WORKER_SOURCE) throw new Error("缺少内嵌保调 Worker，请重新构建插件");
            url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
            worker = new Worker(url);
            worker.onmessage = ({ data }) => {
              if (data?.type === "error") {
                settle(new Error(data.message));
                return;
              }
              if (data?.type !== "chunk" || data.rate !== rate || data.sampleRate !== sampleRate || data.channels !== channels || !Number.isSafeInteger(data.frameCount) || data.frameCount < 0 || !Array.isArray(data.planes) || data.planes.length !== channels || data.planes.some((plane) => !(plane instanceof Float32Array) || plane.length !== data.frameCount)) {
                settle(new Error("保调 Worker 返回无效音频格式"));
                return;
              }
              settle(null, data);
            };
            worker.onerror = (event) => {
              event.preventDefault();
              settle(new Error(event.message || "保调 Worker 失败"));
            };
            worker.onmessageerror = () => settle(new Error("保调音频无法反序列化"));
          }
          worker.postMessage({ rate, sampleRate, channels, planes, final }, planes.map((plane) => plane.buffer));
        } catch (error) {
          settle(error);
        }
      });
    },
    destroy() {
      destroyed = true;
      settle(new DOMException("保调流已取消", "AbortError"));
      release();
    }
  };
}

// src/panel/player/stream-audio.js
var MAX_PCM_BYTES = 128 * 1024 * 1024;
var DECODE_QUEUE_LIMIT = 64;
var AHEAD_SECONDS = 3;
var START_AHEAD_SECONDS = 1;
function createStreamingAudio({ track, onError, onStateChange = () => {
}, createRenderer = createTempoStreamRenderer }) {
  if (!track || typeof AudioDecoder !== "function" || typeof AudioContext !== "function") return null;
  let sampleRate = Number(track.sampleRate) || 44100;
  const channels = Math.max(1, Number(track.channels) || 2);
  const context = new AudioContext({ sampleRate });
  context.addEventListener("statechange", onStateChange);
  const gain = context.createGain();
  gain.connect(context.destination);
  const pcm = [];
  const encoded = [];
  let totalFrames = 0;
  let formatReady = false;
  let skip = Math.round(Math.max(0, Number(track.mediaTime) || 0) / (Number(track.timescale) || sampleRate) * sampleRate);
  let inputDone = false;
  let decodedDone = false;
  let flushing = false;
  let pumping = false;
  let disposed = false;
  let failed = false;
  let session = null;
  const error = (reason) => {
    if (disposed || failed) return;
    failed = true;
    onError(reason);
  };
  const decoder = new AudioDecoder({
    output(data) {
      try {
        if (disposed || failed) return;
        if (!formatReady) {
          if (!(data.sampleRate > 0)) throw new Error("音频解码采样率无效");
          if (sampleRate !== data.sampleRate) cancel();
          sampleRate = data.sampleRate;
          skip = Math.round(Math.max(0, Number(track.mediaTime) || 0) / (Number(track.timescale) || sampleRate) * sampleRate);
          formatReady = true;
        }
        if (data.sampleRate !== sampleRate) throw new Error("播放过程中音频采样率发生变化");
        const drop = Math.min(skip, data.numberOfFrames);
        skip -= drop;
        const size = data.numberOfFrames - drop;
        if (!size) return;
        if ((totalFrames + size) * channels * 4 > MAX_PCM_BYTES) throw new Error("本集音频超出本机内存上限");
        const planes = Array.from({ length: channels }, (_, channel) => {
          const plane = new Float32Array(data.numberOfFrames);
          data.copyTo(plane, { planeIndex: Math.min(channel, data.numberOfChannels - 1), format: "f32-planar" });
          return drop ? plane.slice(drop) : plane;
        });
        pcm.push({ start: totalFrames, size, planes });
        totalFrames += size;
        pumpOutput();
      } catch (reason) {
        error(reason);
      } finally {
        data.close();
      }
    },
    error
  });
  const pumpDecode = () => {
    if (disposed || failed || pumping || flushing) return;
    pumping = true;
    try {
      while (encoded.length && decoder.decodeQueueSize < DECODE_QUEUE_LIMIT) {
        const sample = encoded.shift();
        decoder.decode(new EncodedAudioChunk({ type: "key", timestamp: sample.ctsUs, duration: sample.durationUs, data: sample.data }));
      }
      if (inputDone && !encoded.length) {
        flushing = true;
        void decoder.flush().then(() => {
          if (disposed || failed) return;
          decodedDone = true;
          decoder.close();
          pumpOutput();
        }).catch(error);
      }
    } catch (reason) {
      error(reason);
    } finally {
      pumping = false;
    }
  };
  decoder.ondequeue = pumpDecode;
  try {
    decoder.configure({
      codec: track.codec,
      sampleRate,
      numberOfChannels: channels,
      ...track.description?.byteLength ? { description: track.description } : {}
    });
  } catch (reason) {
    decoder.close();
    void context.close().catch(() => {
    });
    throw reason;
  }
  const readPcm = (target, count) => {
    const planes = Array.from({ length: channels }, () => new Float32Array(count));
    let copied = 0;
    while (copied < count) {
      const chunk = pcm[target.index];
      if (!chunk) throw new Error("音频缓冲区不完整");
      const offset = target.cursor + copied - chunk.start;
      if (offset >= chunk.size) {
        target.index++;
        continue;
      }
      const size = Math.min(count - copied, chunk.size - offset);
      for (let c = 0; c < channels; c++) planes[c].set(chunk.planes[c].subarray(offset, offset + size), copied);
      copied += size;
    }
    target.cursor += count;
    return planes;
  };
  const schedule = (target) => {
    if (session !== target || target.when === null || target.missed) return;
    while (target.queue.length) {
      const when = target.when + target.scheduled / sampleRate;
      if (when < context.currentTime - 5e-3) {
        target.missed = true;
        return;
      }
      const buffer = target.queue.shift();
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = 1;
      source.connect(target.gain);
      target.sources.add(source);
      source.onended = () => {
        source.disconnect();
        target.sources.delete(source);
        if (target.cancelled && !target.sources.size) target.gain.disconnect();
        if (session === target) pumpOutput();
      };
      source.start(when);
      target.scheduled += buffer.length;
    }
  };
  const accept = (target, result) => {
    if (disposed || session !== target) return;
    target.busy = false;
    target.final = result.final;
    const length = result.planes[0].length;
    if (length) {
      const buffer = context.createBuffer(channels, length, sampleRate);
      for (let c = 0; c < channels; c++) buffer.copyToChannel(result.planes[c], c);
      target.queue.push(buffer);
      target.produced += length;
    }
    schedule(target);
  };
  function pumpOutput() {
    const target = session;
    if (!target || disposed || failed || target.busy || target.final || target.missed) return;
    try {
      const elapsed = target.when === null ? 0 : Math.max(0, context.currentTime - target.when);
      while (!target.busy && !target.final && !target.missed && target.produced / sampleRate - elapsed < AHEAD_SECONDS) {
        const available = Math.max(0, totalFrames - target.cursor);
        if (!decodedDone && available < sampleRate / 4) break;
        const count = Math.min(available, sampleRate);
        const planes = readPcm(target, count);
        const final = decodedDone && target.cursor >= totalFrames;
        if (target.rate === 1) accept(target, { planes, final });
        else {
          target.renderer ?? (target.renderer = createRenderer({ rate: target.rate, sampleRate, channels }));
          target.busy = true;
          void target.renderer.append(planes, final).then((result) => {
            try {
              accept(target, result);
              pumpOutput();
            } catch (reason) {
              error(reason);
            }
          }).catch((reason) => {
            if (session === target && reason?.name !== "AbortError") error(reason);
          });
        }
      }
    } catch (reason) {
      error(reason);
    }
  }
  const cancel = () => {
    const target = session;
    session = null;
    if (!target) return;
    target.renderer?.destroy();
    target.cancelled = true;
    const now = context.currentTime;
    let end = now;
    if (!disposed && context.state === "running" && target.sources.size) {
      target.gain.gain.cancelAndHoldAtTime(now);
      target.gain.gain.linearRampToValueAtTime(0, now + 5e-3);
      end += 5e-3;
    }
    for (const source of target.sources) {
      try {
        source.stop(end);
      } catch {
      }
      if (end === now) source.disconnect();
    }
    if (end === now || !target.sources.size) {
      target.sources.clear();
      target.gain.disconnect();
    }
    target.queue.length = 0;
  };
  return {
    context,
    append(samples) {
      if (!disposed && !inputDone) {
        for (const sample of samples) encoded.push(sample);
        pumpDecode();
      }
    },
    finish() {
      if (!disposed) {
        inputDone = true;
        pumpDecode();
      }
    },
    get bufferedMs() {
      return totalFrames / sampleRate * 1e3;
    },
    get complete() {
      return decodedDone;
    },
    get scheduledEndMs() {
      return session ? session.startMs + session.scheduled / sampleRate * session.rate * 1e3 : 0;
    },
    get ended() {
      return decodedDone && (!session || session.final && !session.queue.length);
    },
    get missed() {
      return session?.missed === true;
    },
    prepare(at, rate) {
      if (disposed || failed) return false;
      if (decodedDone && at >= totalFrames / sampleRate * 1e3) return true;
      if (!session || session.startMs !== at || session.rate !== rate) {
        cancel();
        const cursor = Math.floor(at / 1e3 * sampleRate);
        const index = pcm.findIndex((chunk) => chunk.start + chunk.size > cursor);
        const sessionGain = context.createGain();
        sessionGain.connect(gain);
        session = {
          startMs: at,
          rate,
          cursor,
          index: index < 0 ? pcm.length : index,
          produced: 0,
          scheduled: 0,
          queue: [],
          sources: /* @__PURE__ */ new Set(),
          gain: sessionGain,
          when: null,
          missed: false,
          busy: false,
          final: false,
          renderer: null
        };
      }
      pumpOutput();
      return Boolean(session && (session.produced >= sampleRate * START_AHEAD_SECONDS || session.final && session.produced > 0));
    },
    start(when) {
      if (!session || !session.produced) return false;
      session.when = when;
      session.gain.gain.setValueAtTime(0, when);
      session.gain.gain.linearRampToValueAtTime(1, when + 5e-3);
      schedule(session);
      return true;
    },
    update() {
      if (session && session.when !== null) {
        pumpOutput();
        if (session) schedule(session);
      }
    },
    setVolume(value) {
      gain.gain.value = value;
    },
    cancel,
    destroy() {
      if (disposed) return;
      disposed = true;
      cancel();
      try {
        decoder.close();
      } catch {
      }
      context.removeEventListener("statechange", onStateChange);
      void context.close().catch(() => {
      });
      gain.disconnect();
      pcm.length = encoded.length = 0;
    }
  };
}

// src/panel/player/segments.js
async function* readSegments({ rpc, episodeId, quality, count, cancelled, concurrency = 3 }) {
  const pending = /* @__PURE__ */ new Map();
  let next = 1;
  const fill = () => {
    while (!cancelled() && next <= count && pending.size < concurrency) {
      const seq = next++;
      pending.set(seq, Promise.resolve().then(() => cancelled() ? null : rpc.getStreamSegment(episodeId, quality, seq)).then((payload) => ({ payload }), (error) => ({ error })));
    }
  };
  fill();
  for (let seq = 1; seq <= count; seq += 1) {
    if (cancelled()) return;
    const result = await pending.get(seq);
    if (cancelled()) return;
    pending.delete(seq);
    if (result.error) throw result.error;
    const bytes = decodeBase64(result.payload?.base64);
    if (!bytes.length) throw new PanelError("PROTOCOL", `分片 ${seq} 内容为空`);
    yield { seq, bytes };
    fill();
  }
}

// src/panel/player/webcodecs-play.js
var MAX_DECODE_PER_TICK = 16;
var MAX_BUFFERED_FRAMES = 40;
var MAX_VIDEO_LAG_US = 1e5;
var RESUME_AHEAD_MS = 400;
var SOURCE_AHEAD_MS = 3e3;
var AUDIO_START_DELAY_SECONDS = 0.06;
var MAX_LOCAL_SEGMENTS = LIMITS.localSegmentsMax;
var createWebCodecsPlayer = ({ canvas, getRpc, onState = () => {
}, onProgress = () => {
}, log = () => {
} }) => {
  const ctx = canvas.getContext("2d", { alpha: false });
  let disposed = false;
  let track = null;
  let decodeConfig = null;
  let samples = [];
  let decoder = null;
  let nextIndex = 0;
  const frames = /* @__PURE__ */ new Map();
  const videoFrameEnds = /* @__PURE__ */ new Map();
  let firstVideoTimeUs = 0;
  let rafId = 0;
  let anchored = false;
  let anchorWall = 0;
  let anchorTimeMs = 0;
  let playing = false;
  let playbackRate = 1;
  let lastEmitAt = 0;
  let lastDrawnTs = -1;
  let lastDrawnEndUs = -1;
  let decoderFlushing = false;
  let decoderFlushed = false;
  let inputComplete = false;
  let pendingVideoTarget = null;
  let settleLoad = null;
  let audioTrack = null;
  let audioCtx = null;
  let audio = null;
  let audioClock = null;
  let audioClockActive = false;
  let volumeLevel = 1;
  let previewing = false;
  const state = {
    phase: "idle",
    timeMs: 0,
    durationMs: 0,
    playbackRate: 1,
    buffering: false,
    width: 0,
    height: 0,
    decoded: 0,
    buffered: 0,
    bufferedEndMs: 0,
    downloadComplete: false,
    dropped: 0,
    output: 0,
    picked: 0,
    decoderState: "",
    drawError: "",
    error: ""
  };
  const emit = (force) => {
    if (disposed) return;
    const now = Date.now();
    if (!force && now - lastEmitAt < 400) return;
    lastEmitAt = now;
    state.buffered = frames.size;
    state.timeMs = currentMs();
    state.decoderState = decoder ? decoder.state : "none";
    try {
      onState({ ...state });
    } catch {
    }
  };
  const audioMediaMs = (contextTime) => {
    if (!audioClock) return anchorTimeMs;
    return audioClock.mediaMs + Math.max(0, contextTime - audioClock.contextTime) * audioClock.rate * 1e3;
  };
  const audibleContextTime = () => {
    const now = audioCtx.currentTime;
    const stamp = audioCtx.getOutputTimestamp?.();
    if (stamp?.contextTime > 0 && stamp.performanceTime > 0) {
      const elapsed = audioCtx.state === "running" ? Math.max(0, performance.now() - stamp.performanceTime) / 1e3 : 0;
      return Math.min(now, stamp.contextTime + elapsed);
    }
    const latency = Math.max(0, Number(audioCtx.baseLatency) || 0) + Math.max(0, Number(audioCtx.outputLatency) || 0);
    return Math.max(0, now - latency);
  };
  const currentMs = () => {
    if (!anchored || !playing || state.buffering) return anchorTimeMs;
    if (audioClockActive && audioCtx) {
      return Math.min(state.durationMs, audio?.ended ? Infinity : audio.scheduledEndMs, audioMediaMs(audibleContextTime()));
    }
    return Math.min(state.durationMs, anchorTimeMs + Math.max(0, performance.now() - anchorWall) * playbackRate);
  };
  const clearFrames = () => {
    lastDrawnTs = -1;
    lastDrawnEndUs = -1;
    for (const frame of frames.values()) {
      try {
        frame.close();
      } catch {
      }
    }
    frames.clear();
  };
  const fail = (error) => {
    if (disposed || state.phase === "error") return;
    anchorTimeMs = currentMs();
    playing = false;
    previewing = false;
    state.buffering = false;
    stopLoop();
    stopAudio();
    state.error = String(error?.message || error).slice(0, 120);
    state.phase = "error";
    settleLoad?.(error);
    log(`[wvc] 播放失败：${state.error}`);
    emit(true);
  };
  const ensureDecoder = () => {
    if (decoder && decoder.state === "configured") return decoder;
    const nextDecoder = new VideoDecoder({
      output: (frame) => {
        if (disposed || decoder !== nextDecoder) {
          frame.close();
          return;
        }
        state.output += 1;
        frames.get(frame.timestamp)?.close();
        frames.set(frame.timestamp, frame);
      },
      error: (error) => {
        if (decoder === nextDecoder) fail(error);
      }
    });
    decoder = nextDecoder;
    decoder.configure(decodeConfig);
    return decoder;
  };
  const resetVideoAt = (targetMs) => {
    clearFrames();
    try {
      decoder?.close();
    } catch {
    }
    decoder = null;
    decoderFlushing = false;
    decoderFlushed = false;
    nextIndex = 0;
    pendingVideoTarget = !inputComplete && targetMs >= state.bufferedEndMs ? targetMs : null;
    for (let index = 0; index < samples.length; index += 1) {
      if (samples[index].key && samples[index].ctsUs <= targetMs * 1e3) nextIndex = index;
    }
  };
  const pump = () => {
    if (disposed || state.phase === "error" || !decodeConfig || decoderFlushing || decoderFlushed) return;
    if (pendingVideoTarget !== null) {
      if (!inputComplete && pendingVideoTarget >= state.bufferedEndMs) return;
      resetVideoAt(pendingVideoTarget);
    }
    if (!samples.length) return;
    const dec = ensureDecoder();
    let count = 0;
    while (nextIndex < samples.length && count < MAX_DECODE_PER_TICK) {
      if (frames.size + dec.decodeQueueSize >= MAX_BUFFERED_FRAMES) break;
      const sample = samples[nextIndex];
      dec.decode(
        new EncodedVideoChunk({
          type: sample.key ? "key" : "delta",
          timestamp: sample.ctsUs,
          duration: sample.durationUs,
          data: sample.data
        })
      );
      nextIndex += 1;
      state.decoded += 1;
      count += 1;
    }
    if (inputComplete && nextIndex === samples.length) {
      decoderFlushing = true;
      void dec.flush().then(() => {
        if (disposed || decoder !== dec) return;
        decoderFlushing = false;
        decoderFlushed = true;
      }).catch((error) => {
        if (!disposed && decoder === dec) fail(error);
      });
    }
  };
  const dropFrame = (timestamp) => {
    const frame = frames.get(timestamp);
    if (!frame) return;
    try {
      frame.close();
    } catch {
    }
    frames.delete(timestamp);
  };
  const frameEndUs = (frame) => videoFrameEnds.get(frame.timestamp) ?? frame.timestamp + (Number(frame.duration) || samples[0]?.durationUs || 1);
  const draw = (timeMs) => {
    if (!track) return;
    const nowUs = Math.max(timeMs * 1e3, firstVideoTimeUs);
    let pick = -1;
    for (const timestamp of frames.keys()) {
      if (timestamp > lastDrawnTs && timestamp <= nowUs && timestamp > pick) pick = timestamp;
    }
    if (pick >= 0) {
      const frame = frames.get(pick);
      try {
        ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
        lastDrawnTs = pick;
        lastDrawnEndUs = frameEndUs(frame);
        state.picked += 1;
      } catch (error) {
        state.drawError = String(error?.message || error).slice(0, 90);
        throw error;
      }
    }
    for (const timestamp of [...frames.keys()]) {
      if (timestamp <= lastDrawnTs) {
        if (timestamp !== pick) state.dropped += 1;
        dropFrame(timestamp);
      }
    }
  };
  const videoCovers = (timeMs) => lastDrawnTs >= 0 && lastDrawnEndUs + 1e3 >= timeMs * 1e3;
  const readyToResume = (timeMs) => {
    if (!videoCovers(timeMs)) return false;
    const sourceTarget = Math.min(state.durationMs, timeMs + SOURCE_AHEAD_MS * playbackRate);
    if (!inputComplete && state.bufferedEndMs + 1 < sourceTarget) return false;
    const targetUs = Math.min(state.durationMs, timeMs + RESUME_AHEAD_MS * playbackRate) * 1e3;
    let endUs = lastDrawnEndUs;
    let coveredFrames = 0;
    for (const timestamp of [...frames.keys()].sort((a, b) => a - b)) {
      if (timestamp > endUs + 1e3) break;
      endUs = Math.max(endUs, frameEndUs(frames.get(timestamp)));
      coveredFrames += 1;
    }
    return endUs + 1e3 >= targetUs || coveredFrames >= MAX_BUFFERED_FRAMES - 2;
  };
  const tick = () => {
    rafId = 0;
    if (disposed || state.phase === "error" || !playing && !previewing) return;
    try {
      const at = currentMs();
      draw(at);
      pump();
      audio?.update();
      if (playing) {
        const videoBehind = lastDrawnTs < 0 || at * 1e3 > lastDrawnEndUs + MAX_VIDEO_LAG_US;
        const tailPending = at >= state.durationMs && !videoCovers(at);
        const audioBehind = audioClockActive && (audio.missed || !audio.ended && at >= audio.scheduledEndMs);
        if (!state.buffering && (videoBehind || tailPending || audioBehind)) {
          anchorTimeMs = at;
          state.buffering = true;
          stopAudio();
        }
        if (state.buffering) {
          const audioReady = !audio || audio.prepare(at, playbackRate);
          if (audioReady && readyToResume(at)) startAudio(at);
        }
        if (inputComplete && !state.buffering && at >= state.durationMs) {
          playing = false;
          anchorTimeMs = state.durationMs;
          state.phase = "ended";
          stopAudio();
          emit(true);
          return;
        }
      } else if (videoCovers(at)) {
        previewing = false;
      }
      emit(false);
      if (playing || previewing) rafId = requestAnimationFrame(tick);
    } catch (error) {
      fail(error);
    }
  };
  const stopAudio = () => {
    audio?.cancel();
    audioClockActive = false;
    audioClock = null;
  };
  const startAudio = (fromMs) => {
    const at = Math.max(0, Math.min(Number(fromMs) || 0, state.durationMs));
    anchorTimeMs = at;
    anchorWall = performance.now();
    if (disposed || !playing) return;
    if (!audio || audio.complete && at >= audio.bufferedMs || at >= state.durationMs) {
      state.buffering = false;
      return;
    }
    void audioCtx.resume().catch(() => {
    });
    if (audioCtx.state !== "running") {
      state.buffering = false;
      return;
    }
    const quantum = 128 / audioCtx.sampleRate;
    const when = Math.ceil((audioCtx.currentTime + AUDIO_START_DELAY_SECONDS) / quantum) * quantum;
    if (!audio.start(when)) return;
    audioClock = { contextTime: when, mediaMs: at, rate: playbackRate };
    audioClockActive = true;
    state.buffering = false;
    emit(true);
  };
  const setPlaybackRate = (value) => {
    const next = Number(value);
    if (disposed || !PLAYBACK_RATES.includes(next) || next === playbackRate) return playbackRate;
    const at = currentMs();
    stopAudio();
    anchorTimeMs = at;
    anchorWall = performance.now();
    playbackRate = next;
    state.playbackRate = next;
    state.buffering = playing;
    emit(true);
    return playbackRate;
  };
  const syncAudioState = () => {
    if (disposed || !audioCtx) return;
    if (audioCtx.state === "running") {
      if (playing && !state.buffering && !audioClockActive) {
        const at2 = currentMs();
        stopAudio();
        anchorTimeMs = at2;
        state.buffering = true;
      }
      return;
    }
    if (!audioClockActive) return;
    const at = currentMs();
    stopAudio();
    anchorTimeMs = at;
    anchorWall = performance.now();
  };
  const resumeAudio = () => {
    if (disposed || !audioCtx || audioCtx.state === "running") return;
    void audioCtx.resume().catch(() => {
    });
  };
  const stopLoop = () => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  };
  const load = async ({ episodeId, quality, segmentCount, initPayload: preparedInit, durationMs = 0, resumeMs = 0 }) => {
    if (disposed) return;
    const startedAt = performance.now();
    const rpc = getRpc();
    state.phase = "loading";
    state.error = "";
    emit(true);
    const initPayload = preparedInit || await rpc.getStreamInit(episodeId, quality);
    if (disposed) return;
    const initBytes = decodeBase64(initPayload?.base64);
    if (!initBytes.length) throw new PanelError("PROTOCOL", "init 段为空");
    const parsed = parseMp4(initBytes);
    track = parsed.video;
    audioTrack = parsed.audio;
    if (!track) throw new PanelError("PROTOCOL", "init 段没有视频轨");
    const declared = Math.floor(Number(segmentCount) || 0);
    if (declared <= 0) throw new PanelError("PROTOCOL", "服务端未返回分片数量");
    if (declared > MAX_LOCAL_SEGMENTS) throw new PanelError("SEGMENT_LIMIT", "本集分段数量超过本机解码上限 " + MAX_LOCAL_SEGMENTS);
    state.durationMs = Math.max(0, Number(durationMs) || parsed.durationMs || 0);
    if (!state.durationMs) throw new PanelError("PROTOCOL", "服务端未返回有效时长");
    canvas.width = track.width || 854;
    canvas.height = track.height || 480;
    state.width = canvas.width;
    state.height = canvas.height;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    decodeConfig = {
      codec: track.codec,
      description: track.description,
      codedWidth: canvas.width,
      codedHeight: canvas.height,
      hardwareAcceleration: "prefer-hardware"
    };
    anchorTimeMs = Math.max(0, Math.min(Number(resumeMs) || 0, state.durationMs));
    anchored = true;
    audio = createStreamingAudio({ track: audioTrack, onError: fail, onStateChange: syncAudioState });
    audioCtx = audio?.context || null;
    audio?.setVolume(volumeLevel);
    resetVideoAt(anchorTimeMs);
    const ready = new Promise((resolve, reject) => {
      settleLoad = (error) => {
        settleLoad = null;
        if (error) reject(error);
        else resolve();
      };
    });
    const consume = async () => {
      for await (const { seq, bytes } of readSegments({
        rpc,
        episodeId,
        quality,
        count: declared,
        cancelled: () => disposed || state.phase === "error"
      })) {
        const buckets = parseSegment(bytes, parsed.tracks, parsed.trex);
        const shift = Number(track.mediaTime) || 0;
        for (const sample of buckets.get(track.id) || []) {
          samples.push({
            ctsUs: toMicros(Math.max(0, sample.time + sample.cts - shift), track.timescale),
            durationUs: toMicros(sample.duration, track.timescale),
            key: sample.key,
            data: bytes.subarray(sample.offset, sample.offset + sample.size)
          });
        }
        inputComplete = seq === declared;
        state.downloadComplete = inputComplete;
        const timestamps = [...new Set(samples.map((sample) => sample.ctsUs))].sort((a, b) => a - b);
        firstVideoTimeUs = timestamps[0] || 0;
        const endUs = samples.reduce((end, sample) => Math.max(end, sample.ctsUs + sample.durationUs), 0);
        state.bufferedEndMs = endUs / 1e3;
        if (inputComplete) {
          if (!samples.length) throw new PanelError("PROTOCOL", "没有解析到视频样本");
          state.durationMs = Math.round(endUs / 1e3);
          anchorTimeMs = Math.min(anchorTimeMs, state.durationMs);
        }
        timestamps.forEach((timestamp, index) => videoFrameEnds.set(timestamp, timestamps[index + 1] ?? endUs));
        if (lastDrawnTs >= 0) lastDrawnEndUs = videoFrameEnds.get(lastDrawnTs) ?? lastDrawnEndUs;
        if (audioTrack) audio?.append((buckets.get(audioTrack.id) || []).map((sample) => ({
          ctsUs: toMicros(sample.time, audioTrack.timescale),
          durationUs: toMicros(sample.duration, audioTrack.timescale),
          data: bytes.subarray(sample.offset, sample.offset + sample.size)
        })));
        if (inputComplete) audio?.finish();
        if (disposed || state.phase === "error") return;
        if (state.phase === "loading" && samples.length) {
          resetVideoAt(anchorTimeMs);
          state.phase = "ready";
          previewing = true;
          pump();
          rafId = requestAnimationFrame(tick);
          log("[wvc] 首段就绪 " + track.codec + " 准备=" + Math.round(performance.now() - startedAt) + "ms");
          settleLoad?.();
        } else if (playing || previewing) pump();
        onProgress("seg " + seq + "/" + declared + ": " + bytes.length + "B");
        emit(true);
      }
    };
    void consume().catch((error) => {
      if (!disposed) fail(error);
    });
    return ready;
  };
  const play = () => {
    if (disposed || !decodeConfig || state.phase === "loading" || state.phase === "error" || playing) return;
    if (state.phase === "ended") seek(0);
    anchorTimeMs = currentMs();
    anchorWall = performance.now();
    playing = true;
    previewing = false;
    state.phase = "playing";
    state.buffering = true;
    resumeAudio();
    stopLoop();
    rafId = requestAnimationFrame(tick);
    emit(true);
  };
  const pause = () => {
    if (disposed || !decodeConfig || state.phase === "loading" || state.phase === "error") return;
    anchorTimeMs = currentMs();
    playing = false;
    state.buffering = false;
    stopAudio();
    state.phase = "paused";
    stopLoop();
    previewing = !videoCovers(anchorTimeMs);
    if (previewing) rafId = requestAnimationFrame(tick);
    emit(true);
  };
  const seek = (ms) => {
    if (disposed || !decodeConfig || state.phase === "loading" || state.phase === "error") return;
    const target = Math.max(0, Math.min(Number(ms) || 0, state.durationMs));
    stopLoop();
    stopAudio();
    resetVideoAt(target);
    anchorTimeMs = target;
    anchorWall = performance.now();
    anchored = true;
    state.error = "";
    state.buffering = playing;
    previewing = !playing;
    state.phase = playing ? "playing" : "paused";
    rafId = requestAnimationFrame(tick);
    emit(true);
  };
  const destroy = () => {
    if (disposed) return;
    anchorTimeMs = currentMs();
    disposed = true;
    playing = false;
    previewing = false;
    state.buffering = false;
    stopLoop();
    stopAudio();
    settleLoad?.();
    audio?.destroy();
    audio = null;
    audioCtx = null;
    clearFrames();
    videoFrameEnds.clear();
    try {
      decoder?.close();
    } catch {
    }
    decoder = null;
    samples = [];
    state.phase = "disposed";
  };
  const setVolume = (value) => {
    volumeLevel = Math.max(0, Math.min(1, Number(value) || 0));
    audio?.setVolume(volumeLevel);
    return volumeLevel;
  };
  return {
    load,
    play,
    pause,
    seek,
    setPlaybackRate,
    setVolume,
    destroy,
    resumeAudio,
    getState: () => ({ ...state, timeMs: currentMs(), volume: volumeLevel })
  };
};

// src/panel/player/prefetch.js
function createNextPrefetch({ getRpc, now = Date.now, makeToken = () => globalThis.crypto.randomUUID() }) {
  let lease = null;
  let disposed = false;
  let current = "";
  const attempts = /* @__PURE__ */ new Map();
  const handoffs = /* @__PURE__ */ new Set();
  const release = (entry) => {
    if (!entry || entry.released) return;
    entry.released = true;
    Promise.resolve().then(() => entry.rpc.cancelPrefetch(entry.token)).catch(() => {
    });
  };
  const cancel = () => {
    release(lease);
    lease = null;
  };
  return {
    cancel,
    activate(episodeId, quality) {
      const key = `${episodeId}:${quality}`;
      if (current !== key) {
        current = key;
        attempts.clear();
      }
      const matching = lease?.key === key ? lease : null;
      if (matching) {
        lease = null;
        handoffs.add(matching);
      } else cancel();
      return () => {
        if (matching) {
          handoffs.delete(matching);
          release(matching);
        }
      };
    },
    update({ episodeId, next, quality, playing, buffering, timeMs, durationMs, playbackRate = 1, enabled = true }) {
      if (disposed) return;
      const eligible = enabled && playing && !buffering && next?.id && next.playable !== false && next.id !== episodeId && durationMs > 0 && timeMs >= 5e3 && timeMs >= durationMs * 0.6 && (durationMs - timeMs) / Math.max(0.5, playbackRate) <= 3e4 && timeMs < durationMs;
      if (!eligible) {
        cancel();
        return;
      }
      const key = `${next.id}:${quality}`;
      if (lease?.key === key) return;
      cancel();
      const attempt = attempts.get(key);
      if (attempt && (attempt.count >= 2 || now() - attempt.at < 5e3)) return;
      const rpc = getRpc();
      if (!rpc?.prefetchStream || !rpc?.cancelPrefetch) return;
      const entry = { key, token: makeToken(), rpc, released: false };
      lease = entry;
      attempts.set(key, { count: (attempt?.count || 0) + 1, at: now() });
      Promise.resolve().then(() => entry.released ? null : rpc.prefetchStream(next.id, quality, entry.token)).then((result) => {
        if (result?.accepted !== true && lease === entry) cancel();
      }).catch(() => {
        if (lease === entry) cancel();
      });
    },
    destroy() {
      disposed = true;
      cancel();
      for (const entry of handoffs) release(entry);
      handoffs.clear();
      attempts.clear();
    }
  };
}

// src/panel/player/controller.js
var HIDE_DELAY_MS = 2600;
var SEEK_STEP_SECONDS = 5;
var VOLUME_STEP = 0.05;
var RESUME_JUMP_TOLERANCE_MS = 2e3;
var qualityRank = (quality) => {
  const index = QUALITY_OPTIONS.indexOf(String(quality || ""));
  return index < 0 ? -1 : QUALITY_OPTIONS.length - index;
};
var make = (tag, className) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
};
function createPlayer(slot, initialProps) {
  const props = { ...initialProps || {} };
  const t = (key, values) => typeof props.t === "function" ? props.t(key, values) : key;
  const notify = (kind, text) => {
    try {
      props.notify?.(kind, text);
    } catch {
    }
  };
  const log = (...args) => {
    try {
      props.log?.(...args);
    } catch {
    }
  };
  let disposed = false;
  const prefetch = createNextPrefetch({ getRpc: () => props.rpc });
  let state = { state: MSE_STATE.IDLE, quality: "", info: null, appended: 0, segmentCount: 0 };
  let playing = false;
  let waiting = false;
  let autoPlayPending = false;
  let userPaused = false;
  let desiredQuality = QUALITY_OPTIONS.includes(props.quality) ? props.quality : DEFAULT_QUALITY;
  const savedPlayback = normalizePlaybackPrefs(props);
  let desiredPlaybackRate = savedPlayback.playbackRate;
  let overlayKind = "";
  let dragging = false;
  let fill = false;
  let fillMarker = null;
  let mini = false;
  let miniMarker = null;
  let miniWindow = normalizeMiniWindow(props.miniWindow);
  let miniInteraction = null;
  let miniSaveTimer = 0;
  let miniHideTimer = 0;
  let miniHidden = false;
  let miniResumePlayback = false;
  let idleTimer = 0;
  let dropdownOpen = false;
  let lastReportAt = 0;
  let lastReportedMs = Math.max(0, Number(props.positionMs) || 0);
  const recentReports = [];
  const rememberReport = (ms) => {
    const now = Date.now();
    recentReports.push({ ms, at: now });
    while (recentReports.length && now - recentReports[0].at > 15e3) recentReports.shift();
    if (recentReports.length > 60) recentReports.shift();
  };
  const wasReportedRecently = (ms) => recentReports.some((item) => Math.abs(item.ms - ms) <= 1500 && Date.now() - item.at <= 15e3);
  let lastNoticeKey = "";
  let lastSeekAt = 0;
  let downloading = false;
  let suppressPauseReport = false;
  let pendingOverlayActions = null;
  let downloadActionNode = null;
  let lastActivityAt = Date.now();
  let stallReported = false;
  const root = make("div", "hg-player");
  root.tabIndex = 0;
  root.setAttribute("role", "region");
  const miniBar = make("div", "hg-mini-bar");
  const miniTitle = make("span", "hg-mini-title");
  const miniAutoHide = make("label", "hg-mini-autohide");
  const miniAutoHideInput = document.createElement("input");
  miniAutoHideInput.type = "checkbox";
  miniAutoHideInput.className = "hg-toggle";
  miniAutoHideInput.setAttribute("role", "switch");
  miniAutoHideInput.checked = miniWindow.autoHide;
  miniAutoHideInput.addEventListener("change", () => {
    adoptMiniWindow({ ...miniWindow, autoHide: miniAutoHideInput.checked });
    props.onMiniWindowChange?.({ ...miniWindow });
  });
  const miniAutoHideText = make("span", "hg-mini-autohide-text");
  miniAutoHide.append(miniAutoHideInput, miniAutoHideText);
  const miniOpacityInput = document.createElement("input");
  miniOpacityInput.type = "range";
  miniOpacityInput.className = "hg-mini-opacity";
  miniOpacityInput.min = "0.05";
  miniOpacityInput.max = "1";
  miniOpacityInput.step = "0.01";
  miniOpacityInput.value = String(miniWindow.opacity);
  miniOpacityInput.addEventListener("input", () => setMiniOpacity(Number(miniOpacityInput.value)));
  const miniOpacityValue = make("span", "hg-mini-opacity-value");
  miniBar.append(miniTitle, miniAutoHide, miniOpacityInput, miniOpacityValue);
  const miniResize = make("div", "hg-mini-resize");
  miniResize.setAttribute("aria-hidden", "true");
  const miniRestore = make("button", "hg-mini-restore");
  miniRestore.type = "button";
  miniRestore.hidden = true;
  miniRestore.append(icon("mini", 16));
  const view = make("div", "hg-player-view");
  const video = document.createElement("video");
  video.className = "hg-player-video";
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.preload = "auto";
  video.volume = savedPlayback.volume;
  video.muted = savedPlayback.muted;
  video.defaultPlaybackRate = desiredPlaybackRate;
  video.playbackRate = desiredPlaybackRate;
  let wvc = null;
  let endedReported = false;
  const canDecodeLocally = () => typeof VideoDecoder !== "undefined" && typeof AudioDecoder !== "undefined";
  let wvcBlocked = false;
  let wvcSeq = 0;
  let wvcQuality = QUALITY_OPTIONS.includes(props.quality) ? props.quality : DEFAULT_QUALITY;
  const canvas = document.createElement("canvas");
  canvas.className = "hg-player-video";
  canvas.hidden = true;
  canvas.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!wvc) return;
    wvc.resumeAudio?.();
    if (wvc.getState().phase === "playing") {
      userPaused = true;
      autoPlayPending = false;
      wvc.pause();
      playing = false;
      report(true);
    } else safePlay();
  });
  const loading = make("div", "hg-player-loading");
  loading.hidden = true;
  const loadingSpinner = make("span", "hg-player-spinner");
  const loadingText = make("span", "hg-player-loading-text");
  loading.append(loadingSpinner, loadingText);
  const bigPlay = make("button", "hg-player-bigplay");
  bigPlay.type = "button";
  bigPlay.hidden = true;
  bigPlay.append(icon("play", 22));
  const overlay = make("div", "hg-player-overlay");
  overlay.hidden = true;
  const card = make("div", "hg-player-card");
  const cardTitle = make("div", "hg-player-card-title");
  const cardText = make("div", "hg-player-card-text");
  const cardHint = make("div", "hg-player-card-hint");
  const cardActions = make("div", "hg-player-card-actions");
  card.append(cardTitle, cardText, cardHint, cardActions);
  overlay.append(card);
  overlay.addEventListener("click", (event) => event.stopPropagation());
  const noticePane = make("div", "hg-player-debug");
  noticePane.hidden = true;
  const showNotice = (lines) => {
    const text = (Array.isArray(lines) ? lines : [lines]).filter(Boolean).slice(0, 3).join("\n");
    noticePane.textContent = text;
    noticePane.hidden = !text;
  };
  const hideNotice = () => {
    noticePane.hidden = true;
    noticePane.textContent = "";
  };
  view.append(video, canvas, loading, bigPlay, overlay, noticePane);
  const controls = make("div", "hg-player-controls");
  const progress = make("div", "hg-player-progress");
  progress.setAttribute("role", "slider");
  progress.setAttribute("tabindex", "-1");
  const track = make("div", "hg-player-track");
  const buffered = make("div", "hg-player-buffered");
  const hoverFill = make("div", "hg-player-hover");
  const played = make("div", "hg-player-played");
  track.append(buffered, hoverFill, played);
  const thumb = make("div", "hg-player-thumb");
  const tip = make("div", "hg-player-tip");
  tip.hidden = true;
  progress.append(track, thumb, tip);
  const bar = make("div", "hg-player-bar");
  const button = (name, onClick, className) => {
    const node = make("button", className || "hg-player-btn");
    node.type = "button";
    node.append(icon(name, 16));
    node.addEventListener("click", (event) => {
      event.stopPropagation();
      onClick();
      showControls();
    });
    return node;
  };
  const playBtn = button("play", () => togglePlay());
  const nextBtn = button("next", () => nextEpisode());
  const timeLabel = make("span", "hg-player-time");
  const spacer = make("span", "hg-player-spacer");
  const muteBtn = button("volume", () => toggleMute());
  const volume = document.createElement("input");
  volume.type = "range";
  volume.className = "hg-player-volume";
  volume.min = "0";
  volume.max = "1";
  volume.step = "0.01";
  volume.value = "1";
  volume.addEventListener("input", () => setVolume(Number(volume.value)));
  volume.addEventListener("change", () => showControls());
  const onSelectOpen = (open) => {
    dropdownOpen = open;
    if (open) cancelMiniHide();
    else if (!disposed && !root.matches(":hover")) scheduleMiniHide();
    showControls();
  };
  const qualityControl = createSelect({
    className: "hg-player-select hg-player-quality",
    value: desiredQuality,
    options: QUALITY_OPTIONS.map((value) => ({ value, label: value })),
    onChange: (value) => setQuality(value, true),
    onOpenChange: onSelectOpen
  });
  const qualitySelect = qualityControl.element;
  const speedControl = createSelect({
    className: "hg-player-select hg-player-speed",
    value: desiredPlaybackRate,
    options: PLAYBACK_RATES.map((value) => ({ value, label: `${value}x` })),
    onChange: (value) => setSpeed(value, true),
    onOpenChange: onSelectOpen
  });
  const speedSelect = speedControl.element;
  const pipBtn = button("pip", () => void togglePip());
  pipBtn.classList.add("hg-player-pip");
  const miniBtn = button("mini", () => toggleMini());
  miniBtn.classList.add("hg-player-mini-toggle");
  const fillBtn = button("expand", () => toggleFill());
  const miniExitBtn = button("restore", () => exitMini(), "hg-player-btn hg-mini-exit");
  miniBar.append(miniExitBtn);
  bar.append(playBtn, nextBtn, timeLabel, spacer, muteBtn, volume, qualitySelect, speedSelect, pipBtn, miniBtn, fillBtn);
  controls.append(progress, bar);
  root.append(miniBar, view, controls, miniResize);
  if (slot) slot.replaceChildren(root);
  const engine = createMseEngine({
    video,
    getRpc: () => props.rpc,
    log,
    onState: (snapshot) => handleEngineState(snapshot),
    onError: (error) => {
      try {
        props.onError?.(error);
      } catch {
      }
    }
  });
  const durationOf = () => {
    if (wvc) {
      const ms = Number(wvc.getState().durationMs) || 0;
      if (ms > 0) return ms / 1e3;
    }
    const fromVideo = Number(video.duration);
    if (Number.isFinite(fromVideo) && fromVideo > 0) return fromVideo;
    const fromInfo = (state.info?.durationMs || 0) / 1e3;
    return Number.isFinite(fromInfo) && fromInfo > 0 ? fromInfo : 0;
  };
  const currentMs = () => {
    if (wvc) return Math.round(Number(wvc.getState().timeMs) || 0);
    const value = Number(video.currentTime);
    return Number.isFinite(value) && value > 0 ? Math.round(value * 1e3) : 0;
  };
  const currentQuality = () => wvc ? wvcQuality : state.quality || props.quality || DEFAULT_QUALITY;
  const currentPlaybackRate = () => Number(wvc ? wvc.getState().playbackRate : video.playbackRate) || 1;
  const hasNext = () => {
    const list = Array.isArray(props.episodes) ? props.episodes : [];
    const next = list[props.episodeIndex + 1];
    return !!next && next.playable !== false;
  };
  const setButtonIcon = (node, name) => {
    node.replaceChildren(icon(name, 16));
  };
  const applyLabels = () => {
    root.setAttribute("aria-label", t("player.region"));
    playBtn.title = t("player.playPause");
    playBtn.setAttribute("aria-label", playing ? t("player.pause") : t("player.play"));
    nextBtn.title = hasNext() ? t("player.next") : t("player.lastEpisode");
    nextBtn.setAttribute("aria-label", t("player.next"));
    muteBtn.title = video.muted ? t("player.unmute") : t("player.mute");
    muteBtn.setAttribute("aria-label", muteBtn.title);
    volume.setAttribute("aria-label", t("player.volume"));
    qualityControl.update({ title: t("player.quality"), ariaLabel: t("player.quality") });
    syncSpeed();
    pipBtn.title = t("player.pip");
    pipBtn.setAttribute("aria-label", t("player.pip"));
    fillBtn.title = fill ? t("player.exitFill") : t("player.fill");
    fillBtn.setAttribute("aria-label", fillBtn.title);
    syncMiniButton();
    syncMiniAppearance();
    progress.setAttribute("aria-label", t("player.seek"));
    bigPlay.title = t("player.play");
    bigPlay.setAttribute("aria-label", t("player.play"));
  };
  const setOverlay = (kind, { title, text, hint, actions }) => {
    hideNotice();
    overlayKind = kind;
    overlay.hidden = false;
    cardTitle.textContent = title || "";
    cardText.textContent = text || "";
    cardHint.textContent = hint || "";
    cardHint.hidden = !hint;
    pendingOverlayActions = Array.isArray(actions) ? actions : [];
    renderOverlayActions();
    updateLoading();
    updateBigPlay();
    showControls();
  };
  const renderOverlayActions = () => {
    const actions = pendingOverlayActions || [];
    downloadActionNode = null;
    const nodes = actions.map((action) => {
      const node = make("button", `hg-player-action${action.primary ? " is-primary" : ""}`);
      node.type = "button";
      node.textContent = action.label;
      if (action.disabled) node.disabled = true;
      if (action.kind === "download") downloadActionNode = node;
      node.addEventListener("click", (event) => {
        event.stopPropagation();
        try {
          action.onClick?.();
        } catch (error) {
          log("[player] 覆盖层动作失败", String(error?.message || error));
        }
      });
      return node;
    });
    cardActions.replaceChildren(...nodes);
    cardActions.hidden = nodes.length === 0;
  };
  const hideOverlay = () => {
    if (!overlayKind) return;
    overlayKind = "";
    overlay.hidden = true;
    pendingOverlayActions = null;
    updateLoading();
    updateBigPlay();
    showControls();
  };
  const describePlaybackError = (error) => {
    const code = String(error?.code || "");
    if (code === "PLAYBACK_STALL") {
      return { message: t("player.stalled"), hint: t("player.errorHint") };
    }
    if (code.startsWith("MEDIA_") || code === "PLAYER_ERROR" || code === "ABORTED") {
      return { message: t("player.segmentFailed"), hint: t("player.errorHint") };
    }
    const info = describeError(t, error);
    return { message: info.message, hint: info.hint || t("player.errorHint") };
  };
  const report = (force) => {
    if (disposed) return;
    if (wvc) {
      if (["idle", "loading", "error"].includes(wvc.getState().phase)) return;
    } else if (video.readyState < 1) return;
    const now = Date.now();
    if (!force && now - lastReportAt < 1e3) return;
    lastReportAt = now;
    const positionMs = currentMs();
    lastReportedMs = positionMs;
    rememberReport(positionMs);
    try {
      props.onProgress?.({
        episodeIndex: props.episodeIndex,
        episodeId: props.episode?.id,
        positionMs,
        durationMs: Math.round(durationOf() * 1e3),
        flush: force === true
      });
    } catch (error) {
      log("[player] onProgress 回调异常", String(error?.message || error));
    }
  };
  const safePlay = () => {
    if (disposed) return;
    if (overlayKind === "degraded" || overlayKind === "error" || overlayKind === "notice") return;
    userPaused = false;
    if (wvc) {
      wvc.play();
      playing = wvc.getState().phase === "playing";
      syncPlayButton();
      updateBigPlay();
      return;
    }
    let promise = null;
    try {
      promise = video.play();
    } catch (error) {
      log("[player] play 调用失败", String(error?.message || error));
    }
    if (promise && typeof promise.catch === "function") {
      promise.catch((error) => {
        updateBigPlay();
        if (error?.name === "NotAllowedError") notify("info", t("player.autoplayBlocked"));
        else log("[player] play 被拒绝", String(error?.message || error));
      });
    }
  };
  const togglePlay = () => {
    if (overlayKind === "degraded" || overlayKind === "error" || overlayKind === "notice") return;
    if (wvc) {
      if (wvc.getState().phase === "playing") {
        userPaused = true;
        autoPlayPending = false;
        wvc.pause();
        playing = false;
        report(true);
      } else {
        safePlay();
        return;
      }
      syncPlayButton();
      updateBigPlay();
      return;
    }
    if (video.paused || video.ended) {
      safePlay();
    } else {
      userPaused = true;
      autoPlayPending = false;
      video.pause();
    }
  };
  const replay = () => {
    hideOverlay();
    userPaused = false;
    if (wvc) {
      wvc.seek(0);
      wvc.play();
      playing = true;
      syncPlayButton();
      updateBigPlay();
      return;
    }
    try {
      video.currentTime = 0;
    } catch {
    }
    safePlay();
  };
  function nextEpisode() {
    if (!hasNext()) {
      notify("info", t("player.lastEpisode"));
      return;
    }
    try {
      props.onSelectEpisode?.(props.episodeIndex + 1);
    } catch (error) {
      log("[player] 切集回调异常", String(error?.message || error));
    }
  }
  function syncPrefetch() {
    const snapshot = wvc?.getState();
    const enabled = props.autoNext !== false && !disposed && !miniHidden && !document.hidden;
    if ((snapshot?.phase === "ended" || !wvc && video.ended) && enabled && hasNext()) return;
    prefetch.update({
      episodeId: props.episode?.id,
      next: props.episodes?.[props.episodeIndex + 1],
      quality: wvc ? wvcQuality : currentQuality(),
      enabled: enabled && !overlayKind,
      playing: snapshot ? snapshot.phase === "playing" : playing && !video.ended,
      buffering: snapshot ? snapshot.buffering || !(snapshot.output > 0) : waiting || state.state !== MSE_STATE.READY,
      timeMs: currentMs(),
      durationMs: durationOf() * 1e3,
      playbackRate: currentPlaybackRate()
    });
  }
  const seekTo = (seconds, options = {}) => {
    const duration = durationOf();
    if (!(duration > 0)) return;
    const target = clamp(seconds, 0, Math.max(0, duration - 0.05));
    if (wvc) {
      wvc.seek(Math.round(target * 1e3));
      syncTime();
      syncProgressBar();
      if (!options.silent) report(true);
      return;
    }
    try {
      video.currentTime = target;
    } catch {
      return;
    }
    syncTime();
    syncProgressBar();
    if (!options.silent) report(true);
  };
  const seekBy = (delta) => seekTo(currentMs() / 1e3 + delta);
  const setVolume = (value) => {
    const next = clamp(value, 0, 1);
    video.volume = next;
    video.muted = next <= 1e-3;
    if (wvc) wvc.setVolume(next);
    syncVolume();
    props.onPlaybackPrefsChange?.({ volume: video.volume, muted: video.muted });
  };
  const toggleMute = () => {
    video.muted = !video.muted;
    if (!video.muted && video.volume <= 1e-3) video.volume = 0.5;
    if (wvc) wvc.setVolume(video.muted ? 0 : video.volume);
    syncVolume();
    props.onPlaybackPrefsChange?.({ volume: video.volume, muted: video.muted });
  };
  const applyVideoPlaybackRate = () => {
    video.preservesPitch = true;
    if (video.defaultPlaybackRate !== desiredPlaybackRate) video.defaultPlaybackRate = desiredPlaybackRate;
    if (video.playbackRate !== desiredPlaybackRate) video.playbackRate = desiredPlaybackRate;
  };
  const setSpeed = (value, persist = false) => {
    if (disposed) return;
    const next = Number(value);
    if (!PLAYBACK_RATES.includes(next)) {
      syncSpeed();
      return;
    }
    desiredPlaybackRate = next;
    if (wvc) desiredPlaybackRate = wvc.setPlaybackRate(next);
    applyVideoPlaybackRate();
    syncSpeed();
    showControls();
    if (persist) props.onPlaybackPrefsChange?.({ playbackRate: desiredPlaybackRate });
  };
  const cycleSpeed = (direction) => {
    const current = currentPlaybackRate();
    let index = 0;
    let best = Number.POSITIVE_INFINITY;
    PLAYBACK_RATES.forEach((speed, position) => {
      const distance = Math.abs(speed - current);
      if (distance < best) {
        best = distance;
        index = position;
      }
    });
    const next = PLAYBACK_RATES[clamp(index + direction, 0, PLAYBACK_RATES.length - 1)];
    setSpeed(next, true);
  };
  const setQuality = (quality, persist) => {
    const next = String(quality || "");
    if (!next) return;
    desiredQuality = next;
    if (persist) props.onQualityChange?.(next);
    if (canDecodeLocally() && !wvcBlocked) {
      const positionMs = Math.max(0, Math.round(currentMs()));
      wvcQuality = next;
      syncQualitySelect();
      userPaused = false;
      autoPlayPending = true;
      lastNoticeKey = "";
      if (qualityRank(next) >= qualityRank("540p")) notify("info", t("player.qualityHeavy"));
      void playWebCodecs({ quality: next, resumeMs: positionMs });
      return;
    }
    if (next === state.quality) {
      if (state.state === MSE_STATE.DEGRADED || state.state === MSE_STATE.ERROR) retryPlayback();
      else syncQualitySelect();
      return;
    }
    userPaused = false;
    autoPlayPending = true;
    lastNoticeKey = "";
    void engine.switchQuality(next);
  };
  const retryPlayback = () => {
    userPaused = false;
    autoPlayPending = true;
    lastNoticeKey = "";
    void engine.retry();
  };
  const togglePip = async () => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (typeof video.requestPictureInPicture === "function") {
        await video.requestPictureInPicture();
      }
    } catch (error) {
      notify("error", t("player.pipFailed"));
      log("[player] 画中画失败", String(error?.message || error));
    }
  };
  const miniStage = () => slot?.closest?.(".hg-player-stage") || null;
  const saveMiniWindowSoon = () => {
    if (miniSaveTimer) clearTimeout(miniSaveTimer);
    miniSaveTimer = setTimeout(() => {
      miniSaveTimer = 0;
      if (disposed) return;
      try {
        props.onMiniWindowChange?.({ ...miniWindow });
      } catch (error) {
        log("[player] 小窗偏好保存失败", String(error?.message || error));
      }
    }, 180);
  };
  const applyMiniGeometry = () => {
    if (!mini) return;
    const viewportWidth = window.innerWidth || 1200;
    const viewportHeight = window.innerHeight || 800;
    const width = clamp(miniWindow.width, 240, Math.max(240, viewportWidth - 16));
    const height = clamp(miniWindow.height, 360, Math.max(360, viewportHeight - 16));
    const fallbackX = Math.max(8, viewportWidth - width - 24);
    const fallbackY = 52;
    const x = clamp(Number.isFinite(miniWindow.x) ? miniWindow.x : fallbackX, 8, Math.max(8, viewportWidth - width - 8));
    const y = clamp(Number.isFinite(miniWindow.y) ? miniWindow.y : fallbackY, 8, Math.max(8, viewportHeight - height - 8));
    miniWindow = { ...miniWindow, x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
    root.style.left = `${Math.round(x)}px`;
    root.style.top = `${Math.round(y)}px`;
    root.style.width = `${Math.round(width)}px`;
    root.style.height = `${Math.round(height)}px`;
    root.style.right = "auto";
    root.style.bottom = "auto";
    miniRestore.style.left = `${Math.round(x)}px`;
    miniRestore.style.top = `${Math.round(y)}px`;
  };
  const syncMiniButton = () => {
    setButtonIcon(miniBtn, mini ? "restore" : "mini");
    miniBtn.classList.toggle("is-active", mini);
    miniBtn.title = mini ? t("player.exitMini") : t("player.mini");
    miniBtn.setAttribute("aria-label", miniBtn.title);
  };
  const syncMiniAppearance = () => {
    root.style.setProperty("--hg-mini-opacity", String(miniWindow.opacity));
    miniAutoHideInput.checked = miniWindow.autoHide;
    miniAutoHide.title = t("settings.miniAutoHide");
    miniAutoHideInput.setAttribute("aria-label", t("settings.miniAutoHide"));
    miniAutoHideText.textContent = t("player.autoHide");
    miniOpacityInput.value = String(miniWindow.opacity);
    miniOpacityValue.textContent = `${Math.round(miniWindow.opacity * 100)}%`;
    miniOpacityInput.title = `${t("player.opacity")} · ${t("player.opacityWheelTip")}`;
    miniOpacityInput.setAttribute("aria-label", t("player.opacity"));
    miniExitBtn.title = t("player.exitMini");
    miniExitBtn.setAttribute("aria-label", miniExitBtn.title);
    miniRestore.title = t("player.showMini");
    miniRestore.setAttribute("aria-label", miniRestore.title);
    const title = props.series?.title || t("player.mini");
    const number = props.episode?.number;
    miniTitle.textContent = number == null ? title : `${title} · ${t("unit.episodeShort", { number })}`;
    miniTitle.title = miniTitle.textContent;
    const stage = miniStage();
    if (mini && stage) stage.setAttribute("data-mini-label", t("player.miniActive"));
    applyMiniGeometry();
  };
  const setMiniOpacity = (value) => {
    const next = normalizeMiniWindow({ ...miniWindow, opacity: value });
    const changed = next.opacity !== miniWindow.opacity;
    miniWindow = next;
    syncMiniAppearance();
    if (changed) saveMiniWindowSoon();
  };
  const cancelMiniHide = () => {
    if (!miniHideTimer) return;
    clearTimeout(miniHideTimer);
    miniHideTimer = 0;
  };
  const showMiniWindow = () => {
    const shouldResume = miniResumePlayback && !userPaused && !disposed;
    const shouldRestoreFocus = miniHidden && document.activeElement === miniRestore;
    miniResumePlayback = false;
    cancelMiniHide();
    miniHidden = false;
    root.inert = false;
    root.classList.remove("is-mini-hidden");
    miniRestore.hidden = true;
    if (shouldRestoreFocus) {
      try {
        root.focus({ preventScroll: true });
      } catch {
      }
    }
    if (shouldResume) safePlay();
  };
  const hideMiniWindow = () => {
    if (!mini || miniHidden || !miniWindow.autoHide || dropdownOpen) return;
    cancelMiniHide();
    const shouldMoveFocus = root.contains(document.activeElement);
    miniHidden = true;
    const phase = wvc?.getState().phase || "";
    const activePlayback = wvc ? phase === "playing" : !video.paused && !video.ended;
    const pendingPlayback = autoPlayPending && (!wvc || phase === "idle" || phase === "loading" || phase === "ready");
    miniResumePlayback = Boolean(!userPaused && (activePlayback || pendingPlayback));
    root.classList.add("is-mini-hidden");
    root.inert = true;
    if (miniResumePlayback && wvc) {
      wvc.pause();
      playing = false;
      syncPlayButton();
      updateBigPlay();
      report(true);
    } else if (miniResumePlayback && !video.paused) {
      video.pause();
    }
    if (miniRestore.parentNode !== document.body) document.body.appendChild(miniRestore);
    applyMiniGeometry();
    miniRestore.hidden = false;
    if (shouldMoveFocus) {
      try {
        miniRestore.focus({ preventScroll: true });
      } catch {
      }
    }
  };
  const scheduleMiniHide = () => {
    cancelMiniHide();
    if (!mini || miniHidden || !miniWindow.autoHide) return;
    miniHideTimer = setTimeout(() => {
      miniHideTimer = 0;
      if (!mini || miniInteraction || dragging || dropdownOpen) return;
      hideMiniWindow();
    }, 0);
  };
  const adoptMiniWindow = (value) => {
    const next = normalizeMiniWindow(value);
    if (JSON.stringify(next) === JSON.stringify(miniWindow)) return;
    miniWindow = next;
    syncMiniAppearance();
    if (!next.autoHide) showMiniWindow();
  };
  const onMiniViewportResize = () => applyMiniGeometry();
  root.addEventListener("mouseenter", cancelMiniHide);
  root.addEventListener("mouseleave", scheduleMiniHide);
  miniRestore.addEventListener("mouseenter", showMiniWindow);
  miniRestore.addEventListener("click", () => {
    showMiniWindow();
    try {
      root.focus({ preventScroll: true });
    } catch {
    }
  });
  const startMiniInteraction = (kind, event) => {
    if (!mini || event.button !== 0) return;
    if (kind === "move" && event.target?.closest?.("button, input, select, label")) return;
    const rect = root.getBoundingClientRect();
    miniInteraction = {
      kind,
      pointerId: event.pointerId,
      target: event.currentTarget,
      startX: event.clientX,
      startY: event.clientY,
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
    }
    event.preventDefault();
    event.stopPropagation();
  };
  const moveMiniInteraction = (event) => {
    const interaction = miniInteraction;
    if (!interaction || event.pointerId !== interaction.pointerId) return;
    const deltaX = event.clientX - interaction.startX;
    const deltaY = event.clientY - interaction.startY;
    if (interaction.kind === "move") {
      miniWindow = { ...miniWindow, x: interaction.x + deltaX, y: interaction.y + deltaY };
    } else {
      miniWindow = { ...miniWindow, width: interaction.width + deltaX, height: interaction.height + deltaY };
    }
    applyMiniGeometry();
    event.preventDefault();
  };
  const finishMiniInteraction = (event) => {
    const interaction = miniInteraction;
    if (!interaction || event.pointerId !== interaction.pointerId) return;
    miniInteraction = null;
    try {
      interaction.target.releasePointerCapture(event.pointerId);
    } catch {
    }
    saveMiniWindowSoon();
  };
  miniBar.addEventListener("pointerdown", (event) => startMiniInteraction("move", event));
  miniResize.addEventListener("pointerdown", (event) => startMiniInteraction("resize", event));
  for (const target of [miniBar, miniResize]) {
    target.addEventListener("pointermove", moveMiniInteraction);
    target.addEventListener("pointerup", finishMiniInteraction);
    target.addEventListener("pointercancel", finishMiniInteraction);
  }
  root.addEventListener(
    "wheel",
    (event) => {
      if (!mini || !event.altKey) return;
      event.preventDefault();
      event.stopPropagation();
      setMiniOpacity(miniWindow.opacity + (event.deltaY < 0 ? 0.05 : -0.05));
    },
    { passive: false }
  );
  const onDocumentKey = (event) => {
    if (event.defaultPrevented) return;
    if (!fill && !mini) return;
    if (event.key === "Escape") {
      event.preventDefault();
      if (fill) exitFill();
      else exitMini();
    }
  };
  const enterMini = () => {
    if (mini || !root.parentNode) return;
    if (fill) exitFill();
    if (!root.parentNode) return;
    mini = true;
    showMiniWindow();
    miniMarker = document.createComment("hg-player-mini");
    root.parentNode.insertBefore(miniMarker, root);
    document.body.appendChild(root);
    document.body.appendChild(miniRestore);
    root.classList.add("is-mini");
    miniStage()?.classList.add("is-mini-active");
    document.addEventListener("keydown", onDocumentKey);
    window.addEventListener("resize", onMiniViewportResize);
    syncMiniButton();
    syncMiniAppearance();
    try {
      root.focus({ preventScroll: true });
    } catch {
    }
    props.onMiniChange?.(true);
  };
  const exitMini = () => {
    if (!mini) return;
    mini = false;
    showMiniWindow();
    miniRestore.remove();
    miniInteraction = null;
    document.removeEventListener("keydown", onDocumentKey);
    window.removeEventListener("resize", onMiniViewportResize);
    root.classList.remove("is-mini");
    for (const property of ["left", "top", "width", "height", "right", "bottom"]) root.style.removeProperty(property);
    const stage = miniStage();
    stage?.classList.remove("is-mini-active");
    stage?.removeAttribute("data-mini-label");
    if (miniMarker?.parentNode) miniMarker.parentNode.insertBefore(root, miniMarker);
    else if (slot && !slot.contains(root)) slot.appendChild(root);
    miniMarker?.remove();
    miniMarker = null;
    syncMiniButton();
    syncMiniAppearance();
    props.onMiniChange?.(false);
  };
  const toggleMini = () => {
    if (mini) exitMini();
    else enterMini();
  };
  const enterFill = () => {
    if (fill || !root.parentNode) return;
    if (mini) exitMini();
    if (!root.parentNode) return;
    fill = true;
    fillMarker = document.createComment("hg-player-fill");
    root.parentNode.insertBefore(fillMarker, root);
    document.body.appendChild(root);
    root.classList.add("is-fill");
    document.addEventListener("keydown", onDocumentKey);
    syncFillButton();
    try {
      root.focus({ preventScroll: true });
    } catch {
    }
  };
  const exitFill = () => {
    if (!fill) return;
    fill = false;
    document.removeEventListener("keydown", onDocumentKey);
    root.classList.remove("is-fill");
    if (fillMarker && fillMarker.parentNode) fillMarker.parentNode.insertBefore(root, fillMarker);
    else if (slot && !slot.contains(root)) slot.appendChild(root);
    if (fillMarker) fillMarker.remove();
    fillMarker = null;
    syncFillButton();
  };
  const toggleFill = () => {
    if (fill) exitFill();
    else enterFill();
  };
  const syncFillButton = () => {
    setButtonIcon(fillBtn, fill ? "collapse" : "expand");
    fillBtn.title = fill ? t("player.exitFill") : t("player.fill");
    fillBtn.setAttribute("aria-label", fillBtn.title);
  };
  const syncPlayButton = () => {
    setButtonIcon(playBtn, playing ? "pause" : "play");
    playBtn.title = playing ? t("player.pause") : t("player.play");
    playBtn.setAttribute("aria-label", playBtn.title);
  };
  const syncTime = () => {
    const duration = durationOf();
    timeLabel.textContent = `${formatClock(currentMs())} / ${formatClock(duration * 1e3)}`;
  };
  const syncBuffered = () => {
    if (wvc) {
      const snapshot = wvc.getState();
      const end = snapshot.downloadComplete ? snapshot.durationMs : snapshot.bufferedEndMs;
      if (end > 0 && snapshot.durationMs > 0) {
        const node = make("span", "hg-player-buffered-range");
        node.style.left = "0%";
        node.style.width = `${clamp(end / snapshot.durationMs * 100, 0, 100)}%`;
        buffered.replaceChildren(node);
      } else buffered.replaceChildren();
      return;
    }
    const duration = durationOf();
    const ranges = video.buffered;
    const nodes = [];
    if (duration > 0 && ranges) {
      for (let index = 0; index < ranges.length; index += 1) {
        const start = ranges.start(index);
        const end = ranges.end(index);
        const node = make("span", "hg-player-buffered-range");
        node.style.left = `${clamp(start / duration * 100, 0, 100)}%`;
        node.style.width = `${clamp((end - start) / duration * 100, 0, 100)}%`;
        nodes.push(node);
      }
    }
    buffered.replaceChildren(...nodes);
  };
  const syncProgressBar = () => {
    const duration = durationOf();
    const time = clamp(currentMs() / 1e3, 0, duration || 0);
    const percent = duration > 0 ? time / duration * 100 : 0;
    played.style.width = `${percent}%`;
    thumb.style.left = `${percent}%`;
    progress.setAttribute("aria-valuemin", "0");
    progress.setAttribute("aria-valuemax", String(Math.max(0, Math.round(duration))));
    progress.setAttribute("aria-valuenow", String(Math.round(time)));
    progress.setAttribute("aria-valuetext", `${formatClock(time * 1e3)} / ${formatClock(duration * 1e3)}`);
    syncTime();
    syncBuffered();
  };
  const syncVolume = () => {
    const muted = video.muted || video.volume <= 1e-3;
    setButtonIcon(muteBtn, muted ? "mute" : "volume");
    muteBtn.title = muted ? t("player.unmute") : t("player.mute");
    muteBtn.setAttribute("aria-label", muteBtn.title);
    volume.value = muted ? "0" : String(video.volume);
  };
  const syncSpeed = () => {
    speedControl.update({ value: currentPlaybackRate(), title: t("player.speed"), ariaLabel: t("player.speed") });
  };
  const syncQualitySelect = () => {
    const candidate = wvc ? wvcQuality : state.quality || desiredQuality || DEFAULT_QUALITY;
    const quality = QUALITY_OPTIONS.includes(candidate) ? candidate : desiredQuality;
    if (qualitySelect.value !== quality) qualityControl.update({ value: quality });
  };
  const updateNextButton = () => {
    const enabled = hasNext();
    nextBtn.disabled = !enabled;
    nextBtn.title = enabled ? t("player.next") : t("player.lastEpisode");
  };
  const updateLoading = () => {
    if (disposed) return;
    let busy = false;
    let textKey = "player.loading";
    if (wvc) {
      const snapshot = wvc.getState();
      const phase = snapshot.phase;
      const fetching = phase === "idle" || phase === "loading";
      const firstFramePending = phase === "ready" || phase === "playing" && !(Number(snapshot.output) > 0);
      const buffering = phase === "playing" && snapshot.buffering;
      busy = fetching || firstFramePending || buffering;
      textKey = fetching ? "player.loading" : "player.buffering";
    } else {
      const phase = state.state;
      const initial = phase === MSE_STATE.PROBING || phase === MSE_STATE.OPENING;
      const appending = phase === MSE_STATE.BUFFERING || phase === MSE_STATE.RECOVERING;
      const stalled = waiting && (phase === MSE_STATE.READY || phase === MSE_STATE.BUFFERING);
      busy = initial || appending && (state.appended || 0) === 0 || stalled;
      textKey = initial ? "player.loading" : "player.buffering";
    }
    loading.hidden = !busy || Boolean(overlayKind);
    if (!busy) return;
    loadingText.textContent = t(textKey);
  };
  const updateBigPlay = () => {
    if (disposed) return;
    if (wvc) {
      const phase = wvc.getState().phase;
      const show2 = phase === "paused" || phase === "ended";
      bigPlay.hidden = Boolean(overlayKind) || !show2;
      return;
    }
    const ready = (state.appended || 0) > 0 || state.state === MSE_STATE.ENDED;
    const show = !overlayKind && !waiting && ready && video.paused;
    bigPlay.hidden = !show;
  };
  const showControls = () => {
    if (disposed) return;
    root.classList.remove("is-idle");
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = 0;
    }
    if (!playing || overlayKind || dragging || dropdownOpen) return;
    idleTimer = setTimeout(() => {
      idleTimer = 0;
      if (!disposed && playing && !dragging && !overlayKind && !dropdownOpen) root.classList.add("is-idle");
    }, HIDE_DELAY_MS);
  };
  function handleEngineState(snapshot) {
    if (disposed) return;
    const previousAppended = state.appended || 0;
    const previousPhase = state.state;
    state = snapshot;
    if ((snapshot.appended || 0) !== previousAppended || snapshot.state !== previousPhase) {
      lastActivityAt = Date.now();
      stallReported = false;
    }
    syncQualitySelect();
    syncPlayButton();
    syncProgressBar();
    updateNextButton();
    if (snapshot.state === MSE_STATE.DEGRADED) {
      showDegraded(snapshot);
    } else if (snapshot.state === MSE_STATE.ERROR) {
      showError(snapshot.error);
    } else if (snapshot.state === MSE_STATE.READY) {
      hideNotice();
      if (overlayKind === "degraded" || overlayKind === "error" || overlayKind === "notice") hideOverlay();
      if (snapshot.reason === "quality") {
        const key = `quality:${snapshot.quality}`;
        if (lastNoticeKey !== key) {
          lastNoticeKey = key;
          if (snapshot.resumeClamped) notify("info", t("player.resumeClamped"));
          else notify("success", t("player.qualitySwitched", { quality: snapshot.quality }));
        }
      } else if (snapshot.resumeClamped && lastNoticeKey !== "resume-clamped") {
        lastNoticeKey = "resume-clamped";
        notify("info", t("player.resumeClamped"));
      }
      if (autoPlayPending && !userPaused && video.paused) {
        autoPlayPending = false;
        safePlay();
      }
    } else if (snapshot.state === MSE_STATE.ENDED) {
    } else if (snapshot.state === MSE_STATE.PROBING) {
      if (snapshot.mode === "local") showTranscoding(snapshot);
      else if (overlayKind === "degraded" || overlayKind === "error" || overlayKind === "notice") hideOverlay();
    } else if (snapshot.state === MSE_STATE.BUFFERING && snapshot.mode === "local") {
      showTranscoding(snapshot);
    }
    updateLoading();
    updateBigPlay();
    showControls();
  }
  const DEGRADE_REASONS = {
    "no-mse": "无 MSE",
    codec: "编码不被接受",
    "add-source-buffer": "SourceBuffer 被拒",
    "src-not-supported": "解码器拒绝该流",
    decode: "解码失败"
  };
  const showDegraded = (snapshot) => {
    const codec = snapshot.codecLabel || "HEVC";
    const reason = snapshot.degradedReason ? DEGRADE_REASONS[snapshot.degradedReason] || "" : "";
    const actions = [
      {
        label: t("player.playDirect"),
        kind: "direct",
        primary: true,
        // 用户主动重试：清掉当前集的失败标记，重新走一遍本机解码。
        onClick: () => {
          wvcBlocked = false;
          void playWebCodecs();
        }
      },
      {
        label: t("player.transcode"),
        onClick: () => playTranscoded(snapshot)
      },
      { label: t("player.download"), kind: "download", onClick: () => void downloadEpisode() },
      { label: t("player.copyAddress"), onClick: () => void copyAddress() },
      { label: t("player.retry"), onClick: () => retryPlayback() }
    ];
    setOverlay("degraded", {
      title: t("player.unsupportedTitle"),
      text: t("player.unsupportedHint", { codec }),
      hint: [
        snapshot.info?.definition ? t("player.actualQuality", { quality: snapshot.info.definition }) : "",
        reason ? `降级原因：${reason}` : ""
      ].filter(Boolean).join(" · "),
      actions
    });
  };
  const playTranscoded = (snapshot) => {
    const episodeId = snapshot?.episodeId || state.episodeId;
    if (!episodeId) return;
    void engine.loadLocal({
      episodeId,
      quality: snapshot?.quality || state.quality || props.quality,
      resumeMs: snapshot?.resumeAppliedMs || 0,
      autoplay: true,
      reason: "transcode"
    });
  };
  const showTranscoding = (snapshot) => {
    const percent = Math.max(
      Number(snapshot.transcodeProgress) || 0,
      Number(snapshot.transcode?.progress) || 0
    );
    setOverlay("notice", {
      title: t("player.transcodingTitle"),
      text: t("player.transcodingHint", { percent: Math.round(percent) }),
      hint: snapshot.info?.definition ? t("player.actualQuality", { quality: snapshot.info.definition }) : "",
      actions: []
    });
  };
  const showError = (error) => {
    const info = describePlaybackError(error);
    const current = currentQuality();
    const actions = [
      {
        label: t("player.playDirect"),
        kind: "direct",
        primary: true,
        // 用户主动重试：清掉当前集的失败标记，重新走一遍本机解码。
        onClick: () => {
          wvcBlocked = false;
          void playWebCodecs();
        }
      },
      { label: t("player.retry"), onClick: () => retryPlayback() }
    ];
    for (const quality of ["360p", "480p"]) {
      if (quality === current) continue;
      actions.push({ label: t("player.switchTo", { quality }), onClick: () => setQuality(quality, true) });
    }
    setOverlay("error", {
      title: t("player.errorTitle"),
      text: info.message,
      hint: info.hint,
      actions
    });
  };
  const copyAddress = async () => {
    const episode = props.episode;
    if (!episode?.id) {
      notify("error", t("player.addressUnavailable"));
      return;
    }
    const port = Number(props.rpc?.getState?.().port) || 0;
    if (!port) {
      notify("error", t("player.addressUnavailable"));
      return;
    }
    const quality = currentQuality();
    const address = `http://127.0.0.1:${port}/stream/info?episodeId=${encodeURIComponent(episode.id)}&quality=${encodeURIComponent(quality)}`;
    const ok = await copyText(address);
    notify(ok ? "success" : "error", ok ? t("player.copyDone") : t("player.copyFailed"));
  };
  const downloadEpisode = async () => {
    if (downloading || disposed) return;
    const episode = props.episode;
    const quality = currentQuality();
    const total = state.info?.segmentCount || 0;
    if (!episode?.id || !total) {
      notify("error", t("player.downloadFailed", { error: t("player.addressUnavailable") }));
      return;
    }
    downloading = true;
    if (downloadActionNode) {
      downloadActionNode.disabled = true;
      downloadActionNode.textContent = t("player.downloading", { done: 0, total });
    }
    notify("info", t("player.downloading", { done: 0, total }));
    try {
      const initPayload = await props.rpc.getStreamInit(episode.id, quality);
      const parts = [decodeBase64(initPayload?.base64)];
      for (let seq = 1; seq <= total; seq += 1) {
        if (disposed) return;
        const payload = await props.rpc.getStreamSegment(episode.id, quality, seq);
        parts.push(decodeBase64(payload?.base64));
        if (downloadActionNode) downloadActionNode.textContent = t("player.downloading", { done: seq, total });
      }
      const blob = new Blob(parts, { type: "video/mp4" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${safeFileName(props.series?.title || "episode")}-${episode.number ?? props.episodeIndex + 1}.mp4`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => {
        try {
          URL.revokeObjectURL(url);
        } catch {
        }
      }, 6e4);
      notify("success", t("player.downloadDone"));
    } catch (error) {
      notify("error", t("player.downloadFailed", { error: String(error?.message || error) }));
      log("[player] 下载失败", String(error?.message || error));
    } finally {
      downloading = false;
      if (downloadActionNode) {
        downloadActionNode.disabled = false;
        downloadActionNode.textContent = t("player.download");
      }
    }
  };
  const timeFromClientX = (clientX) => {
    const rect = track.getBoundingClientRect();
    if (!(rect.width > 0)) return 0;
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    return ratio * durationOf();
  };
  const showHover = (seconds) => {
    const duration = durationOf();
    if (!(duration > 0)) return;
    const ratio = clamp(seconds / duration, 0, 1);
    hoverFill.style.width = `${ratio * 100}%`;
    tip.hidden = false;
    tip.textContent = formatClock(seconds * 1e3);
    tip.style.left = `${clamp(ratio * 100, 4, 96)}%`;
  };
  const clearHover = () => {
    hoverFill.style.width = "0%";
    tip.hidden = true;
  };
  progress.addEventListener("pointerdown", (event) => {
    if (!(durationOf() > 0)) return;
    event.preventDefault();
    event.stopPropagation();
    dragging = true;
    progress.classList.add("is-dragging");
    try {
      progress.setPointerCapture(event.pointerId);
    } catch {
    }
    try {
      root.focus({ preventScroll: true });
    } catch {
    }
    showControls();
    const seconds = timeFromClientX(event.clientX);
    showHover(seconds);
    seekTo(seconds, { silent: true });
  });
  progress.addEventListener("pointermove", (event) => {
    const seconds = timeFromClientX(event.clientX);
    showHover(seconds);
    if (!dragging) return;
    const now = Date.now();
    if (now - lastSeekAt < 120) return;
    lastSeekAt = now;
    seekTo(seconds, { silent: true });
  });
  const finishDrag = (event) => {
    if (!dragging) return;
    dragging = false;
    progress.classList.remove("is-dragging");
    try {
      progress.releasePointerCapture(event.pointerId);
    } catch {
    }
    const seconds = timeFromClientX(event.clientX);
    seekTo(seconds);
    if (!playing) updateBigPlay();
    showControls();
  };
  progress.addEventListener("pointerup", finishDrag);
  progress.addEventListener("pointercancel", finishDrag);
  progress.addEventListener("pointerleave", () => {
    if (!dragging) clearHover();
  });
  let clickTimer = 0;
  const onViewClick = () => {
    if (clickTimer) return;
    clickTimer = setTimeout(() => {
      clickTimer = 0;
      togglePlay();
    }, 220);
  };
  const onViewDoubleClick = () => {
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = 0;
    }
    toggleFill();
  };
  view.addEventListener("click", onViewClick);
  view.addEventListener("dblclick", onViewDoubleClick);
  view.addEventListener("pointerdown", () => {
    if (document.activeElement !== root) {
      try {
        root.focus({ preventScroll: true });
      } catch {
      }
    }
  });
  bigPlay.addEventListener("click", (event) => {
    event.stopPropagation();
    safePlay();
  });
  const onKeyDown = (event) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const key = event.key;
    if (miniHidden) {
      if (key === " " || key === "Spacebar" || key === "Enter" || key === "k" || key === "K") event.preventDefault();
      return;
    }
    const target = event.target;
    const tagName = target && target.tagName ? String(target.tagName).toLowerCase() : "";
    if (tagName === "select" || tagName === "input" || tagName === "textarea" || target?.closest?.('[role="combobox"]')) return;
    const onButton = target && typeof target.closest === "function" && target.closest("button");
    if (onButton && (key === " " || key === "Spacebar" || key === "Enter")) return;
    if (key === " " || key === "Spacebar" || key === "k" || key === "K") {
      event.preventDefault();
      togglePlay();
    } else if (key === "ArrowLeft") {
      event.preventDefault();
      seekBy(-SEEK_STEP_SECONDS);
    } else if (key === "ArrowRight") {
      event.preventDefault();
      seekBy(SEEK_STEP_SECONDS);
    } else if (key === "ArrowUp") {
      event.preventDefault();
      setVolume((Number(video.volume) || 0) + VOLUME_STEP);
    } else if (key === "ArrowDown") {
      event.preventDefault();
      setVolume((Number(video.volume) || 0) - VOLUME_STEP);
    } else if (key === "m" || key === "M") {
      event.preventDefault();
      toggleMute();
    } else if (key === "f" || key === "F") {
      event.preventDefault();
      toggleFill();
    } else if (key === "Escape") {
      if (fill || mini) {
        event.preventDefault();
        if (fill) exitFill();
        else exitMini();
      }
    } else if (key === "n" || key === "N") {
      event.preventDefault();
      nextEpisode();
    } else if (key === "<" || key === ">") {
      event.preventDefault();
      cycleSpeed(key === "<" ? -1 : 1);
    } else {
      return;
    }
    showControls();
  };
  root.addEventListener("keydown", onKeyDown);
  root.addEventListener("pointermove", () => showControls());
  root.addEventListener("pointerdown", () => {
    wvc?.resumeAudio?.();
    showControls();
  });
  root.addEventListener("mouseleave", () => {
    if (playing && !dragging && !overlayKind && !dropdownOpen) root.classList.add("is-idle");
  });
  video.addEventListener("play", () => {
    playing = true;
    userPaused = false;
    autoPlayPending = false;
    suppressPauseReport = false;
    syncPlayButton();
    updateBigPlay();
    showControls();
  });
  video.addEventListener("playing", () => {
    playing = true;
    waiting = false;
    updateLoading();
    updateBigPlay();
    syncPlayButton();
    showControls();
  });
  video.addEventListener("pause", () => {
    playing = false;
    waiting = false;
    syncPlayButton();
    updateLoading();
    updateBigPlay();
    showControls();
    if (suppressPauseReport) suppressPauseReport = false;
    else report(true);
  });
  video.addEventListener("waiting", () => {
    waiting = true;
    updateLoading();
    showControls();
  });
  video.addEventListener("canplay", () => {
    waiting = false;
    updateLoading();
    updateBigPlay();
  });
  video.addEventListener("timeupdate", () => {
    syncProgressBar();
    report(false);
  });
  video.addEventListener("durationchange", () => {
    syncProgressBar();
  });
  video.addEventListener("progress", () => syncBuffered());
  video.addEventListener("seeked", () => {
    syncProgressBar();
    report(true);
    updateBigPlay();
  });
  video.addEventListener("volumechange", () => syncVolume());
  video.addEventListener("ratechange", () => {
    if (disposed || wvc) return;
    applyVideoPlaybackRate();
    syncSpeed();
  });
  const handleEnded = () => {
    if (disposed) return;
    playing = false;
    waiting = false;
    syncPlayButton();
    updateLoading();
    updateBigPlay();
    report(true);
    const durationMs = Math.round(durationOf() * 1e3);
    try {
      props.onEnded?.({ episodeIndex: props.episodeIndex, episodeId: props.episode?.id, durationMs });
    } catch (error) {
      log("[player] onEnded 回调异常", String(error?.message || error));
    }
    const actions = [{ label: t("player.replay"), primary: true, onClick: replay }];
    if (hasNext()) actions.push({ label: t("player.nextEpisode"), onClick: nextEpisode });
    setOverlay("ended", {
      title: t("player.ended"),
      text: hasNext() ? t("player.endedNext") : t("player.endedLast"),
      hint: "",
      actions
    });
  };
  video.addEventListener("ended", handleEnded);
  const stopWebCodecs = () => {
    wvcSeq += 1;
    const hadPlayer = Boolean(wvc);
    if (wvc) {
      try {
        wvc.destroy();
      } catch {
      }
      wvc = null;
    }
    if (canvas) {
      canvas.hidden = true;
      canvas.style.display = "";
    }
    video.style.visibility = "";
    if (hadPlayer) {
      playing = false;
      applyVideoPlaybackRate();
      syncPlayButton();
      syncSpeed();
    }
    syncQualitySelect();
  };
  const fallbackFromWebCodecs = () => {
    if (wvcBlocked) return;
    report(true);
    const reportedMs = Math.max(0, Number(lastReportedMs) || 0);
    wvcBlocked = true;
    const episodeId = props.episode?.id || state.episodeId || "";
    stopWebCodecs();
    showNotice([t("player.decodeFailed"), t("player.fallbackCompatible")]);
    if (disposed || !episodeId) return;
    const loadOptions = {
      episodeId,
      quality: props.quality || DEFAULT_QUALITY,
      resumeMs: reportedMs > 0 ? reportedMs : Math.max(0, Number(props.positionMs) || 0),
      autoplay: true,
      reason: "initial"
    };
    const releasePrefetch = prefetch.activate(loadOptions.episodeId, loadOptions.quality);
    void engine.load(loadOptions).finally(releasePrefetch);
  };
  const playWebCodecs = async (options) => {
    if (!canDecodeLocally()) {
      wvcBlocked = true;
      showNotice([t("player.decodeFailed")]);
      return;
    }
    let player = null;
    stopWebCodecs();
    engine.stop();
    const seq = wvcSeq;
    endedReported = false;
    hideNotice();
    try {
      const episodeId = props.episode?.id || state.episodeId || "";
      if (!episodeId) return;
      const quality = options?.quality || wvcQuality || DEFAULT_QUALITY;
      const resumeMs = Number.isFinite(options?.resumeMs) ? Math.max(0, options.resumeMs) : Math.max(0, Number(props.positionMs) || 0);
      const releasePrefetch = prefetch.activate(episodeId, quality);
      const [info, initPayload] = await Promise.all([
        props.rpc.getStreamInfo(episodeId, quality),
        props.rpc.getStreamInit(episodeId, quality)
      ]).finally(releasePrefetch);
      const segmentCount = Number(info?.segmentCount) || 0;
      const actualQuality = String(info?.definition || "");
      if (seq !== wvcSeq || disposed) return;
      if (actualQuality) {
        wvcQuality = actualQuality;
        syncQualitySelect();
      }
      hideOverlay();
      loading.hidden = false;
      loadingText.textContent = t("player.loading");
      try {
        video.pause();
      } catch {
      }
      video.style.visibility = "hidden";
      canvas.hidden = false;
      canvas.style.display = "block";
      canvas.width = 854;
      canvas.height = 480;
      player = createWebCodecsPlayer({
        canvas,
        getRpc: () => props.rpc,
        log,
        onState: (snapshot) => {
          if (wvc !== player) return;
          if (snapshot.phase === "error" && snapshot.error) {
            log("[wvc] 解码失败", snapshot.error);
            fallbackFromWebCodecs();
            return;
          }
          const active = snapshot.phase === "playing";
          if (active) {
            autoPlayPending = false;
            endedReported = false;
          }
          if (playing !== active) {
            playing = active;
            syncPlayButton();
          }
          if (snapshot.phase === "ended" && !endedReported) {
            endedReported = true;
            handleEnded();
          }
          syncSpeed();
          updateBigPlay();
          updateLoading();
          syncPrefetch();
        }
      });
      wvc = player;
      player.setVolume(video.muted ? 0 : video.volume);
      setSpeed(desiredPlaybackRate);
      syncQualitySelect();
      updateBigPlay();
      updateLoading();
      await player.load({
        episodeId,
        quality,
        segmentCount,
        durationMs: info.durationMs,
        initPayload,
        resumeMs
      });
      if (seq !== wvcSeq || wvc !== player) return;
      setSpeed(desiredPlaybackRate);
      if (miniHidden || userPaused) {
        player.pause();
        return;
      }
      player.play();
    } catch (error) {
      if (seq !== wvcSeq || wvc !== player) return;
      log("[wvc] 载入失败", String(error?.message || error));
      if (error?.code === "SEGMENT_LIMIT") {
        stopWebCodecs();
        setOverlay("notice", {
          title: t("player.errorTitle"),
          text: String(error.message || t("player.decodeFailed")),
          hint: "",
          actions: []
        });
        return;
      }
      fallbackFromWebCodecs();
    }
  };
  const loadEpisode = () => {
    stopWebCodecs();
    if (disposed) return;
    wvcBlocked = false;
    hideOverlay();
    hideNotice();
    lastNoticeKey = "";
    lastReportedMs = Math.max(0, Number(props.positionMs) || 0);
    desiredQuality = props.quality || DEFAULT_QUALITY;
    const episode = props.episode;
    if (!episode?.id) {
      setOverlay("notice", { title: t("player.errorTitle"), text: t("player.noEpisode"), hint: "", actions: [] });
      return;
    }
    if (episode.playable === false) {
      setOverlay("notice", { title: t("player.errorTitle"), text: t("player.unplayable"), hint: "", actions: [] });
      return;
    }
    userPaused = false;
    autoPlayPending = true;
    updateNextButton();
    const loadOptions = {
      episodeId: episode.id,
      quality: props.quality || DEFAULT_QUALITY,
      resumeMs: Math.max(0, Number(props.positionMs) || 0),
      autoplay: true,
      reason: "initial"
    };
    if (canDecodeLocally() && !wvcBlocked) {
      void playWebCodecs();
      return;
    }
    const releasePrefetch = prefetch.activate(loadOptions.episodeId, loadOptions.quality);
    void engine.load(loadOptions).finally(releasePrefetch);
  };
  const applyProps = (next) => {
    const prev = {
      episodeId: props.episode?.id || "",
      episodeIndex: props.episodeIndex,
      seriesTitle: props.series?.title || "",
      quality: props.quality || "",
      locale: props.locale || "",
      positionMs: Number(props.positionMs) || 0,
      playbackRate: props.playbackRate,
      volume: props.volume,
      muted: props.muted,
      seekRequest: props.seekRequest
    };
    const episodeChanged = (next?.episode?.id || "") !== prev.episodeId;
    if (episodeChanged) {
      suppressPauseReport = true;
      setTimeout(() => {
        suppressPauseReport = false;
      }, 1e3);
    }
    Object.assign(props, next);
    if (props.autoNext === false) prefetch.cancel();
    const playback = normalizePlaybackPrefs(props);
    if (props.playbackRate !== prev.playbackRate && playback.playbackRate !== desiredPlaybackRate) {
      setSpeed(playback.playbackRate);
    }
    if (props.volume !== prev.volume || props.muted !== prev.muted) {
      video.volume = playback.volume;
      video.muted = playback.muted;
      if (wvc) wvc.setVolume(video.muted ? 0 : video.volume);
      syncVolume();
    }
    if (next.miniWindow) adoptMiniWindow(next.miniWindow);
    if ((next.locale || "") !== prev.locale) applyLabels();
    else if (episodeChanged || (props.series?.title || "") !== prev.seriesTitle) syncMiniAppearance();
    const nextEpisodeId = props.episode?.id || "";
    if (nextEpisodeId !== prev.episodeId) {
      loadEpisode();
      return;
    }
    if (props.episodeIndex !== prev.episodeIndex) updateNextButton();
    if (props.seekRequest !== prev.seekRequest && durationOf() > 0) {
      if (["degraded", "error", "notice"].includes(overlayKind)) return;
      seekTo(Math.max(0, Number(props.positionMs) || 0) / 1e3);
      hideOverlay();
      safePlay();
      return;
    }
    const nextQuality = props.quality || "";
    if (nextQuality && nextQuality !== prev.quality && nextQuality !== desiredQuality) {
      if (wvc && wvcQuality === nextQuality) {
        desiredQuality = nextQuality;
        syncQualitySelect();
      } else {
        setQuality(nextQuality, false);
      }
    }
    const nextPosition = Number(props.positionMs) || 0;
    if (nextPosition > 0 && Math.abs(nextPosition - prev.positionMs) > RESUME_JUMP_TOLERANCE_MS && Math.abs(nextPosition - lastReportedMs) > RESUME_JUMP_TOLERANCE_MS && Math.abs(nextPosition - currentMs()) > RESUME_JUMP_TOLERANCE_MS && !wasReportedRecently(nextPosition) && durationOf() > 0) {
      seekTo(nextPosition / 1e3);
      notify("info", t("player.resumeJump", { time: formatClock(nextPosition) }));
    }
  };
  applyLabels();
  syncQualitySelect();
  syncVolume();
  syncSpeed();
  updateNextButton();
  syncProgressBar();
  if (typeof video.requestPictureInPicture !== "function") pipBtn.hidden = true;
  loadEpisode();
  const progressTimer = setInterval(() => {
    if (!disposed) syncPrefetch();
    if (disposed || !wvc || dragging) return;
    syncProgressBar();
    if (wvc.getState().phase === "playing") report(false);
  }, 500);
  document.addEventListener("visibilitychange", syncPrefetch);
  const watchdog = setInterval(() => {
    if (disposed || stallReported || overlayKind || wvc) return;
    const phase = state.state;
    if (phase !== MSE_STATE.BUFFERING && phase !== MSE_STATE.RECOVERING) return;
    if (Date.now() - lastActivityAt < 45e3) return;
    stallReported = true;
    log("[player] 拉流超时，停止等待并给出重试入口");
    showError({ code: "PLAYBACK_STALL" });
  }, 5e3);
  return {
    update(next) {
      if (disposed || !next) return;
      applyProps(next);
    },
    destroy() {
      if (disposed) return;
      report(true);
      disposed = true;
      prefetch.destroy();
      document.removeEventListener("visibilitychange", syncPrefetch);
      qualityControl.destroy();
      speedControl.destroy();
      try {
        exitMini();
      } catch {
      }
      try {
        exitFill();
      } catch {
      }
      document.removeEventListener("keydown", onDocumentKey);
      window.removeEventListener("resize", onMiniViewportResize);
      if (miniSaveTimer) {
        clearTimeout(miniSaveTimer);
        miniSaveTimer = 0;
      }
      cancelMiniHide();
      miniRestore.remove();
      clearInterval(watchdog);
      clearInterval(progressTimer);
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = 0;
      }
      if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = 0;
      }
      try {
        engine.destroy();
      } catch (error) {
        log("[player] 引擎销毁失败", String(error?.message || error));
      }
      try {
        wvc?.destroy();
        wvc = null;
      } catch {
      }
      try {
        video.pause();
        video.removeAttribute("src");
        video.load();
      } catch {
      }
      root.remove();
      if (slot) slot.replaceChildren();
    }
  };
}

// src/panel/player.js
var PLAYER_SLOT_ID = "hg-player-slot";
function renderPlayer(slot, initialProps) {
  if (!slot || typeof document === "undefined") {
    return { update: () => {
    }, destroy: () => {
    } };
  }
  try {
    return createPlayer(slot, initialProps);
  } catch (error) {
    const box = document.createElement("div");
    box.className = "hg-player-fatal";
    box.textContent = String(error?.message || error);
    slot.replaceChildren(box);
    return {
      update: () => {
      },
      destroy: () => {
        slot.replaceChildren();
      }
    };
  }
}
function PlayerMount(props) {
  const React = getReact();
  const slotRef = React.useRef(null);
  const handleRef = React.useRef(null);
  const handlersRef = React.useRef({});
  handlersRef.current = {
    onProgress: props.onProgress,
    onEnded: props.onEnded,
    onSelectEpisode: props.onSelectEpisode,
    onError: props.onError,
    onMiniChange: props.onMiniChange
  };
  const buildProps = () => ({
    api: props.ctx.api,
    rpc: props.ctx.rpc,
    t: props.ctx.t,
    locale: props.ctx.locale,
    notify: props.ctx.notify,
    log: props.ctx.log,
    quality: props.ctx.prefs?.quality || "720p",
    playbackRate: props.ctx.prefs?.playbackRate,
    volume: props.ctx.prefs?.volume,
    muted: props.ctx.prefs?.muted,
    autoNext: props.ctx.prefs?.autoNext,
    miniWindow: props.ctx.prefs?.miniWindow,
    series: props.series,
    episodes: props.episodes,
    episodeIndex: props.episodeIndex,
    episode: props.episodes?.[props.episodeIndex] || null,
    positionMs: props.positionMs,
    seekRequest: props.seekRequest,
    onQualityChange: (quality) => props.ctx.updatePrefs?.({ quality }),
    onMiniWindowChange: (miniWindow) => props.ctx.updatePrefs?.({ miniWindow }),
    onPlaybackPrefsChange: (patch) => props.ctx.updatePrefs?.(patch),
    onProgress: (state) => handlersRef.current.onProgress?.(state),
    onEnded: (state) => handlersRef.current.onEnded?.(state),
    onSelectEpisode: (index) => handlersRef.current.onSelectEpisode?.(index),
    onError: (error) => handlersRef.current.onError?.(error),
    onMiniChange: (active) => handlersRef.current.onMiniChange?.(active)
  });
  React.useEffect(() => {
    const slot = slotRef.current;
    if (!slot) return void 0;
    handleRef.current = renderPlayer(slot, buildProps());
    return () => {
      const handle = handleRef.current;
      handleRef.current = null;
      try {
        if (typeof handle === "function") handle();
        else handle?.destroy?.();
      } finally {
        slot.replaceChildren();
      }
    };
  }, [props.series?.id]);
  React.useEffect(() => {
    handleRef.current?.update?.(buildProps());
  });
  return h(
    "div",
    { className: "hg-player-stage" },
    h("div", {
      id: PLAYER_SLOT_ID,
      ref: slotRef,
      className: "hg-player-slot",
      "data-series-id": props.series?.id || "",
      "data-episode-id": props.episodes?.[props.episodeIndex]?.id || ""
    })
  );
}

// src/panel/ui/episode-picker.js
var GROUP_SIZE = 30;
var revealActiveGroup = (strip) => {
  const active = strip?.querySelector('[aria-pressed="true"]');
  if (!active || !strip.clientWidth) return;
  const left = active.offsetLeft;
  const right = left + active.offsetWidth;
  if (left < strip.scrollLeft) strip.scrollLeft = left;
  else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = right - strip.clientWidth;
};
function EpisodePicker({ ctx, episodes, selectedIndex, historyEntry, onSelectEpisode }) {
  const React = getReact();
  const t = ctx.t;
  const groupCount = Math.ceil(episodes.length / GROUP_SIZE);
  const currentGroup = Math.max(0, Math.min(Math.floor(selectedIndex / GROUP_SIZE), groupCount - 1));
  const [groupIndex, setGroupIndex] = React.useState(currentGroup);
  const stripRef = React.useRef(null);
  const activeGroup = Math.max(0, Math.min(groupIndex, groupCount - 1));
  const startIndex = activeGroup * GROUP_SIZE;
  React.useLayoutEffect(() => {
    setGroupIndex(currentGroup);
  }, [selectedIndex, currentGroup]);
  React.useLayoutEffect(() => {
    revealActiveGroup(stripRef.current);
  }, [activeGroup, groupCount]);
  return h(
    "div",
    { className: "hg-episode-picker" },
    groupCount > 1 ? h(
      "div",
      { className: "hg-episode-nav" },
      h(
        "div",
        { className: "hg-episode-groups", ref: stripRef, role: "group", "aria-label": t("detail.episodeGroups") },
        Array.from({ length: groupCount }, (_, index) => {
          const start = episodes[index * GROUP_SIZE].number;
          const end = episodes[Math.min((index + 1) * GROUP_SIZE, episodes.length) - 1].number;
          return h(
            "button",
            {
              key: index,
              type: "button",
              className: "hg-episode-group",
              "aria-pressed": index === activeGroup,
              "aria-label": start === end ? t("unit.episodeShort", { number: start }) : t("detail.episodeRange", { start, end }),
              onClick: () => setGroupIndex(index)
            },
            start === end ? String(start) : `${start}–${end}`
          );
        })
      ),
      h(
        "button",
        {
          type: "button",
          className: "hg-linkbtn hg-episode-locate",
          onClick: () => {
            setGroupIndex(currentGroup);
            if (activeGroup === currentGroup) revealActiveGroup(stripRef.current);
          }
        },
        t("detail.backToCurrent")
      )
    ) : null,
    h(
      "div",
      { className: "hg-episodes" },
      episodes.slice(startIndex, startIndex + GROUP_SIZE).map((episode, offset) => {
        const index = startIndex + offset;
        const record = getEpisodeProgress(historyEntry, episode, index);
        const watched = record?.completed === true;
        const partial = !watched && record?.positionMs > 0;
        const current = index === selectedIndex;
        const label = episode.title || t("unit.episodeShort", { number: episode.number });
        const titleText = [
          label,
          watched ? t("detail.watched") : "",
          partial ? t("detail.partialAt", { time: formatDuration(record.positionMs) }) : "",
          episode.playable ? "" : t("detail.unplayable")
        ].filter(Boolean).join(" · ");
        return h(
          "button",
          {
            key: episode.id || `${index}`,
            type: "button",
            className: `hg-ep${watched ? " is-watched" : ""}${partial ? " is-partial" : ""}${current ? " is-current" : ""}`,
            disabled: !episode.playable,
            "aria-current": current ? "true" : void 0,
            title: titleText,
            onClick: () => onSelectEpisode(index)
          },
          h("span", { className: "hg-ep-num" }, String(episode.number)),
          episode.title ? h("span", { className: "hg-ep-name" }, episode.title) : null,
          watched || partial ? h("span", { className: "hg-ep-status" }, watched ? "✓" : formatDuration(record.positionMs)) : null,
          current ? h("span", { className: "hg-sr-only" }, t("detail.current")) : null
        );
      })
    )
  );
}

// src/panel/pages/watchlist.js
var seedOf = (entry) => ({ id: entry.seriesId, title: entry.title, cover: entry.cover });
var STATUS_ICONS = { planned: "Bookmark", watching: "Play", completed: "Check" };
function StatusBadges({ ctx, value, disabled, onChange, title }) {
  return h("div", {
    className: "hg-watch-statuses",
    role: "group",
    "aria-busy": Boolean(disabled),
    "aria-label": `${ctx.t("watchlist.status")} · ${title || ctx.t("unit.untitled")}`
  }, WATCH_STATUSES.map((status) => h("button", {
    key: status,
    type: "button",
    disabled,
    className: `hg-watch-status-badge${value === status ? " is-active" : ""}`,
    "data-status": status,
    "aria-pressed": value === status,
    onClick: () => {
      if (!disabled && status !== value) onChange(status);
    }
  }, h(Icon, { ctx, name: STATUS_ICONS[status], size: 11 }), ctx.t(`watchlist.${status}`))));
}
function WatchlistControls({ ctx, series, hasProgress }) {
  const React = getReact();
  const [entry, setEntry] = React.useState(null);
  const [busy, setBusy] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [reload, setReload] = React.useState(0);
  const sequence = React.useRef(0);
  const busyRef = React.useRef(false);
  React.useEffect(() => {
    const seq = ++sequence.current;
    setBusy(true);
    readWatchlist(ctx.api).then((list) => {
      if (seq !== sequence.current) return;
      setEntry(list.find((item) => item.seriesId === series.id) || null);
      setError(null);
    }).catch((err) => {
      if (seq === sequence.current) setError(err);
    }).finally(() => {
      if (seq === sequence.current) setBusy(false);
    });
    return () => {
      sequence.current += 1;
    };
  }, [ctx.api, series.id, ctx.watchlistVersion, reload]);
  const change = async (status) => {
    if (busyRef.current || busy) return;
    busyRef.current = true;
    setBusy(true);
    const seq = ++sequence.current;
    try {
      const list = status === null ? await removeWatchlistEntry(ctx.api, series.id) : await saveWatchlistEntry(ctx.api, {
        seriesId: series.id,
        title: series.title,
        cover: series.cover,
        count: series.count,
        status
      });
      if (seq === sequence.current) setEntry(list.find((item) => item.seriesId === series.id) || null);
      ctx.bumpWatchlist();
    } catch (err) {
      if (seq === sequence.current) ctx.notify("error", ctx.t("watchlist.saveFailed"));
      ctx.log?.("[watchlist] 保存失败", String(err?.message || err));
    } finally {
      busyRef.current = false;
      if (seq === sequence.current) setBusy(false);
    }
  };
  if (error) return h(ErrorNotice, { ctx, error, compact: true, onRetry: () => setReload((value) => value + 1) });
  return h(
    "div",
    { className: "hg-watch-actions" },
    h(
      "button",
      {
        type: "button",
        className: `hg-btn${entry ? " is-saved" : ""}`,
        disabled: busy,
        "aria-pressed": Boolean(entry),
        onClick: () => void change(entry ? null : hasProgress ? "watching" : "planned")
      },
      h(Icon, { ctx, name: entry ? "BookmarkCheck" : "Bookmark", size: 14 }),
      ctx.t(entry ? "watchlist.saved" : "watchlist.add")
    ),
    entry ? h(StatusBadges, {
      ctx,
      title: series.title,
      value: entry.status,
      disabled: busy,
      onChange: (status) => void change(status)
    }) : null
  );
}
function WatchlistPage({ ctx, active, historyVersion, watchlistVersion }) {
  const React = getReact();
  const t = ctx.t;
  const [list, setList] = React.useState([]);
  const [history, setHistory] = React.useState([]);
  const [filter, setFilter] = React.useState("all");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [reload, setReload] = React.useState(0);
  const sequence = React.useRef(0);
  const busyRef = React.useRef(false);
  React.useEffect(() => {
    if (!active) return void 0;
    const seq = ++sequence.current;
    setLoading(true);
    Promise.all([readWatchlist(ctx.api), readHistory(ctx.api)]).then(([saved, records]) => {
      if (seq !== sequence.current) return;
      setList(saved);
      setHistory(records);
      setError(null);
    }).catch((err) => {
      if (seq === sequence.current) setError(err);
    }).finally(() => {
      if (seq === sequence.current) setLoading(false);
    });
    return () => {
      sequence.current += 1;
    };
  }, [ctx.api, active, historyVersion, watchlistVersion, reload]);
  const change = async (entry, status) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const seq = ++sequence.current;
    try {
      const saved = status === null ? await removeWatchlistEntry(ctx.api, entry.seriesId) : await saveWatchlistEntry(ctx.api, { ...entry, status });
      if (seq === sequence.current) {
        setList(saved);
        setLoading(false);
        setError(null);
      }
      ctx.bumpWatchlist();
    } catch (err) {
      if (seq === sequence.current) ctx.notify("error", t("watchlist.saveFailed"));
      ctx.log?.("[watchlist] 保存失败", String(err?.message || err));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const visible = list.filter((entry) => filter === "all" || entry.status === filter);
  return h(
    "div",
    { className: "hg-page hg-watchlist" },
    h(
      "div",
      { className: "hg-page-head" },
      h("div", { className: "hg-page-title" }, t("watchlist.heading")),
      loading ? h(Spinner, { label: t("watchlist.loading") }) : h("span", { className: "hg-count" }, String(list.length))
    ),
    h(
      "div",
      { className: "hg-scroll" },
      error ? h(ErrorNotice, { ctx, error, onRetry: () => setReload((value) => value + 1) }) : null,
      h(
        "div",
        { className: "hg-watch-filters", role: "group", "aria-label": t("watchlist.filter") },
        ["all", ...WATCH_STATUSES].map((status) => h("button", {
          key: status,
          type: "button",
          className: `hg-watch-filter${filter === status ? " is-active" : ""}`,
          "aria-pressed": filter === status,
          onClick: () => setFilter(status)
        }, t(`watchlist.${status}`), h("span", { className: "hg-count" }, String(
          status === "all" ? list.length : list.filter((entry) => entry.status === status).length
        ))))
      ),
      !loading && !error && visible.length === 0 ? h(EmptyState, {
        ctx,
        icon: "Bookmark",
        title: t(list.length ? "watchlist.filterEmpty" : "watchlist.empty"),
        hint: t("watchlist.emptyHint"),
        action: h("button", { type: "button", className: "hg-btn", onClick: () => ctx.openTab("discover") }, t("action.browse"))
      }) : null,
      h("div", { className: "hg-watch-list" }, visible.map((entry) => {
        const record = history.find((item) => item.seriesId === entry.seriesId);
        return h(
          "article",
          { key: entry.seriesId, className: "hg-watch-card" },
          h(
            "button",
            { type: "button", className: "hg-history-main", onClick: () => ctx.openSeries(seedOf(entry)) },
            h(Cover, { ctx, path: entry.cover, className: "hg-history-cover" }),
            h(
              "span",
              { className: "hg-history-text" },
              h("span", { className: "hg-history-title" }, entry.title || t("unit.untitled")),
              h("span", { className: "hg-history-meta" }, record ? t("detail.continueAt", {
                number: record.episodeNumber,
                time: formatDuration(record.positionMs)
              }) : entry.count ? t("unit.episodes", { count: entry.count }) : t(`watchlist.${entry.status}`))
            )
          ),
          h(
            "div",
            { className: "hg-watch-card-actions" },
            h(StatusBadges, { ctx, title: entry.title, value: entry.status, disabled: busy, onChange: (status) => void change(entry, status) }),
            h("button", {
              type: "button",
              className: "hg-linkbtn",
              disabled: busy,
              "aria-label": `${t("watchlist.remove")} · ${entry.title}`,
              onClick: () => void change(entry, null)
            }, t("watchlist.remove"))
          )
        );
      }))
    )
  );
}

// src/panel/pages/detail.js
var normalizeEpisodes = (page) => {
  const rows = Array.isArray(page?.items) ? page.items : [];
  const list = [];
  rows.forEach((row, index) => {
    if (!row || row[0] == null) return;
    const id = String(row[0]);
    if (!id) return;
    const number = Number.isFinite(Number(row[1])) ? Number(row[1]) : index + 1;
    list.push({
      id,
      number,
      playable: Number(row[2]) === 1,
      title: typeof row[3] === "string" ? row[3] : ""
    });
  });
  return list;
};
function DetailPage({ ctx, seed, onBack }) {
  const React = getReact();
  const t = ctx.t;
  const rpc = ctx.rpc;
  const api = ctx.api;
  const seriesId = seed?.id ? String(seed.id) : "";
  const [state, setState] = React.useState({
    status: "loading",
    error: null,
    series: null,
    episodes: [],
    episodesError: null,
    truncated: false,
    total: 0
  });
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [positionMs, setPositionMs] = React.useState(0);
  const [seekRequest, setSeekRequest] = React.useState(0);
  const [historyEntry, setHistoryEntry] = React.useState(null);
  const [expanded, setExpanded] = React.useState(false);
  const seqRef = React.useRef(0);
  const aliveRef = React.useRef(true);
  const seriesRef = React.useRef(null);
  const episodesRef = React.useRef([]);
  const selectedRef = React.useRef(0);
  const positionRef = React.useRef(0);
  const durationRef = React.useRef(0);
  const historyRef = React.useRef(null);
  const progressRef = React.useRef(/* @__PURE__ */ new Map());
  const watchingCheckRef = React.useRef(null);
  const lastSaveRef = React.useRef(0);
  const pendingSaveRef = React.useRef(null);
  const flushTimerRef = React.useRef(0);
  const persistRef = React.useRef(null);
  React.useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = 0;
      }
      const pending = pendingSaveRef.current;
      pendingSaveRef.current = null;
      if (pending) void persistRef.current?.(pending.index, pending.position, { durationMs: pending.durationMs });
    };
  }, []);
  React.useEffect(() => {
    seriesRef.current = state.series;
    episodesRef.current = state.episodes;
  }, [state.series, state.episodes]);
  React.useEffect(() => {
    selectedRef.current = selectedIndex;
  }, [selectedIndex]);
  const load = React.useCallback(async () => {
    const seq = seqRef.current + 1;
    seqRef.current = seq;
    setState((prev) => ({ ...prev, status: "loading", error: null }));
    if (!seriesId) {
      const error = new Error(t("detail.missingId"));
      error.code = "MISSING_ID";
      setState({
        status: "error",
        error,
        series: null,
        episodes: [],
        episodesError: null,
        truncated: false,
        total: 0
      });
      return;
    }
    try {
      const [series2, episodesResult, historyList] = await Promise.all([
        rpc.getSeries(seriesId),
        rpc.getEpisodes(seriesId).then((page) => ({ ok: true, page })).catch((error) => ({ ok: false, error })),
        readHistory(api).catch(() => [])
      ]);
      if (seq !== seqRef.current || !aliveRef.current) return;
      const episodes2 = episodesResult.ok ? normalizeEpisodes(episodesResult.page) : [];
      const entry = Array.isArray(historyList) ? historyList.find((item) => item.seriesId === seriesId) || null : null;
      const resumed = resumeEpisodeIndex(entry, episodes2);
      const record = getEpisodeProgress(entry, episodes2[resumed], resumed);
      const position = resumePosition(record);
      seriesRef.current = series2;
      episodesRef.current = episodes2;
      historyRef.current = entry;
      selectedRef.current = resumed;
      positionRef.current = position;
      durationRef.current = record?.durationMs || 0;
      setState({
        status: "idle",
        error: null,
        series: series2,
        episodes: episodes2,
        episodesError: episodesResult.ok ? null : episodesResult.error,
        truncated: episodesResult.ok ? episodesResult.page?.truncated === true : false,
        total: episodesResult.ok ? Number(episodesResult.page?.total) || episodes2.length : 0
      });
      setSelectedIndex(resumed);
      setPositionMs(position);
      setHistoryEntry(entry);
    } catch (error) {
      if (seq !== seqRef.current || !aliveRef.current) return;
      setState({
        status: "error",
        error,
        series: null,
        episodes: [],
        episodesError: null,
        truncated: false,
        total: 0
      });
    }
  }, [api, rpc, seriesId, t]);
  React.useEffect(() => {
    void load();
  }, [load]);
  const persist = React.useCallback(
    async (index, position, extra = {}) => {
      const series2 = seriesRef.current;
      const episode = episodesRef.current[index];
      if (!series2 || !episode) return;
      try {
        const list = await upsertHistory(api, {
          seriesId: series2.id,
          title: series2.title,
          cover: series2.cover,
          episodeIndex: index,
          episodeId: episode.id,
          episodeNumber: episode.number,
          positionMs: position,
          ...extra
        });
        const entry = list.find((item) => item.seriesId === series2.id) || null;
        historyRef.current = entry;
        if (aliveRef.current) setHistoryEntry(entry);
        ctx.bumpHistory();
      } catch (error) {
        ctx.notify("error", t("detail.recordFailed"));
        ctx.log?.("[detail] 写历史失败", String(error?.message || error));
      }
    },
    [ctx, t]
  );
  persistRef.current = persist;
  const selectEpisode = React.useCallback(
    (index, position) => {
      const episodes2 = episodesRef.current;
      if (!Number.isInteger(index) || index < 0 || index >= episodes2.length) return;
      if (!episodes2[index].playable) {
        ctx.notify("info", t("detail.unplayable"));
        return;
      }
      const saved = progressRef.current.get(episodes2[index].id) || getEpisodeProgress(historyRef.current, episodes2[index], index);
      const nextPosition = position == null ? resumePosition(saved) : Math.max(0, Math.floor(Number(position) || 0));
      const pending = pendingSaveRef.current;
      if (pending) void persistRef.current?.(pending.index, pending.position, { durationMs: pending.durationMs });
      pendingSaveRef.current = null;
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = 0;
      }
      selectedRef.current = index;
      positionRef.current = nextPosition;
      durationRef.current = saved?.durationMs || 0;
      setSelectedIndex(index);
      setPositionMs(nextPosition);
      setSeekRequest((value) => value + 1);
      void persist(index, nextPosition, { durationMs: durationRef.current });
    },
    [ctx, persist, t]
  );
  const handleProgress = React.useCallback(
    (payload) => {
      const episodes2 = episodesRef.current;
      const index = Number.isInteger(payload?.episodeIndex) ? payload.episodeIndex : selectedRef.current;
      if (index < 0 || index >= episodes2.length || index !== selectedRef.current) return;
      if (payload?.episodeId && payload.episodeId !== episodes2[index].id) return;
      const position = Math.max(0, Math.floor(Number(payload?.positionMs) || 0));
      const durationMs = Math.max(0, Math.floor(Number(payload?.durationMs) || 0));
      if (!durationMs) return;
      positionRef.current = position;
      durationRef.current = durationMs;
      if (aliveRef.current) setPositionMs(position);
      const old = progressRef.current.get(episodes2[index].id) || getEpisodeProgress(historyRef.current, episodes2[index], index);
      progressRef.current.set(episodes2[index].id, { ...old, positionMs: position, durationMs });
      if (position > 0 && watchingCheckRef.current !== ctx.watchlistVersion) {
        watchingCheckRef.current = ctx.watchlistVersion;
        markWatching(api, seriesId).then((changed) => {
          if (changed) ctx.bumpWatchlist();
        }).catch((error) => {
          watchingCheckRef.current = null;
          ctx.log?.("[watchlist] 更新状态失败", String(error?.message || error));
        });
      }
      const apply = (targetIndex, targetPosition, duration) => {
        void persistRef.current?.(targetIndex, targetPosition, { durationMs: duration });
      };
      const now = Date.now();
      const elapsed = now - lastSaveRef.current;
      if (elapsed >= 5e3 || payload?.flush || !aliveRef.current) {
        lastSaveRef.current = now;
        pendingSaveRef.current = null;
        if (flushTimerRef.current) {
          clearTimeout(flushTimerRef.current);
          flushTimerRef.current = 0;
        }
        apply(index, position, durationMs);
        return;
      }
      pendingSaveRef.current = { index, position, durationMs };
      if (flushTimerRef.current) return;
      flushTimerRef.current = setTimeout(() => {
        flushTimerRef.current = 0;
        const pending = pendingSaveRef.current;
        pendingSaveRef.current = null;
        if (!pending || !aliveRef.current) return;
        lastSaveRef.current = Date.now();
        apply(pending.index, pending.position, pending.durationMs);
      }, 5e3 - elapsed);
    },
    [api, seriesId, ctx]
  );
  const handleEnded = React.useCallback(
    (payload) => {
      const episodes2 = episodesRef.current;
      const index = Number.isInteger(payload?.episodeIndex) ? payload.episodeIndex : selectedRef.current;
      if (index !== selectedRef.current || !episodes2[index]) return;
      if (payload?.episodeId && payload.episodeId !== episodes2[index].id) return;
      const duration = Number(payload?.durationMs);
      const endPosition = Number.isFinite(duration) && duration > 0 ? Math.floor(duration) : positionRef.current;
      pendingSaveRef.current = null;
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      flushTimerRef.current = 0;
      progressRef.current.set(episodes2[index].id, { positionMs: endPosition, durationMs: endPosition, completed: true });
      void persist(index, endPosition, { durationMs: endPosition, completed: true });
      const next = index + 1;
      if (ctx.prefs?.autoNext !== false && episodes2[next]?.playable) {
        selectEpisode(next, 0);
      }
    },
    [persist, selectEpisode, ctx.prefs?.autoNext]
  );
  const handlePlayerError = React.useCallback(
    (error) => {
      const info = describeError(t, error);
      ctx.notify("error", info.message);
    },
    [ctx, t]
  );
  const retryEpisodes = async () => {
    if (!seriesId) return;
    try {
      const page = await rpc.getEpisodes(seriesId);
      if (!aliveRef.current) return;
      const episodes2 = normalizeEpisodes(page);
      setState((prev) => ({
        ...prev,
        episodes: episodes2,
        episodesError: null,
        truncated: page?.truncated === true,
        total: Number(page?.total) || episodes2.length
      }));
    } catch (error) {
      if (!aliveRef.current) return;
      setState((prev) => ({ ...prev, episodesError: error }));
    }
  };
  const series = state.series;
  const episodes = state.episodes;
  const description = series?.description || "";
  const canExpand = description.length > 140;
  const resumeIndex = resumeEpisodeIndex(historyEntry, episodes);
  const historyEpisode = episodes[resumeIndex];
  const resumeRecord = getEpisodeProgress(historyEntry, historyEpisode, resumeIndex);
  const resumeNumber = historyEpisode?.number ?? (historyEntry ? historyEntry.episodeIndex + 1 : 1);
  const tags = Array.isArray(series?.tags) ? series.tags : [];
  const meta = [];
  if (series?.count != null) meta.push(t("unit.episodes", { count: series.count }));
  else if (episodes.length > 0) meta.push(t("unit.episodes", { count: episodes.length }));
  if (series?.category) meta.push(String(series.category));
  if (series?.rightText) meta.push(String(series.rightText));
  const topTitle = series?.title || seed?.title || t("detail.loading");
  return h(
    "div",
    { className: "hg-page hg-detail" },
    h(
      "div",
      { className: "hg-detail-bar" },
      h(
        "button",
        {
          type: "button",
          className: "hg-iconbtn",
          title: t("action.back"),
          "aria-label": t("action.back"),
          onClick: onBack
        },
        h(Icon, { ctx, name: "ChevronLeft", size: 16 })
      ),
      h("div", { className: "hg-detail-bar-title", title: topTitle }, topTitle)
    ),
    h(
      "div",
      { className: "hg-scroll" },
      state.status === "loading" ? h(
        "div",
        { className: "hg-detail-loading" },
        h("div", { className: "hg-skeleton hg-skeleton-player" }),
        h("div", { className: "hg-skeleton hg-skeleton-line" }),
        h("div", { className: "hg-skeleton hg-skeleton-line short" }),
        h("div", { className: "hg-skeleton hg-skeleton-line" })
      ) : null,
      state.status === "error" && state.error ? h(ErrorNotice, { ctx, error: state.error, onRetry: () => void load() }) : null,
      state.status === "idle" && series ? h(
        "div",
        { className: "hg-detail-body" },
        episodes.length > 0 ? h(PlayerMount, {
          ctx,
          series,
          episodes,
          episodeIndex: selectedIndex,
          positionMs,
          seekRequest,
          onProgress: handleProgress,
          onEnded: handleEnded,
          onSelectEpisode: (index) => selectEpisode(index),
          onError: handlePlayerError,
          onMiniChange: ctx.onMiniChange
        }) : null,
        h(
          "div",
          { className: "hg-detail-head" },
          h(Cover, { ctx, path: series.cover, className: "hg-detail-cover" }),
          h(
            "div",
            { className: "hg-detail-info" },
            h("h2", { className: "hg-detail-title" }, series.title || t("unit.untitled")),
            meta.length > 0 ? h("div", { className: "hg-meta" }, meta.join(" · ")) : null,
            tags.length > 0 ? h(
              "div",
              { className: "hg-tags" },
              tags.map(
                (tag, index) => h("span", { key: `${tag}-${index}`, className: "hg-tag" }, tag)
              )
            ) : null
          )
        ),
        h(WatchlistControls, { ctx, series, hasProgress: historyEntry?.episodes?.some((entry) => entry.positionMs > 0) }),
        h(
          "button",
          {
            type: "button",
            className: "hg-btn primary hg-continue",
            disabled: episodes.length === 0,
            onClick: () => selectEpisode(
              resumeIndex,
              resumePosition(resumeRecord)
            )
          },
          h(
            "span",
            { className: "hg-continue-main" },
            historyEntry ? t("detail.continue") : t("detail.start")
          ),
          historyEntry ? h(
            "span",
            { className: "hg-continue-meta" },
            t("detail.continueAt", {
              number: resumeNumber,
              time: formatDuration(historyEntry.positionMs)
            })
          ) : null
        ),
        h(
          "section",
          { className: "hg-section" },
          h("div", { className: "hg-sec-head" }, h("span", null, t("detail.description"))),
          description ? h(
            "div",
            { className: `hg-desc${canExpand && !expanded ? " is-clamped" : ""}` },
            description
          ) : h("div", { className: "hg-muted" }, t("detail.noDescription")),
          canExpand ? h(
            "button",
            {
              type: "button",
              className: "hg-linkbtn",
              onClick: () => setExpanded((value) => !value)
            },
            expanded ? t("detail.collapse") : t("detail.expand")
          ) : null
        ),
        h(
          "section",
          { className: "hg-section" },
          h(
            "div",
            { className: "hg-sec-head" },
            h("span", null, t("detail.episodes")),
            episodes.length > 0 ? h("span", { className: "hg-count" }, t("unit.episodes", { count: episodes.length })) : null
          ),
          state.episodesError ? h(
            "div",
            { className: "hg-inline-error" },
            h("span", null, t("detail.episodesFailed")),
            h("button", { type: "button", className: "hg-linkbtn", onClick: () => void retryEpisodes() }, t("action.retry"))
          ) : null,
          state.truncated ? h("div", { className: "hg-hint" }, t("detail.truncated", { count: episodes.length })) : null,
          episodes.length > 0 ? h(EpisodePicker, { key: seriesId, ctx, episodes, selectedIndex, historyEntry, onSelectEpisode: selectEpisode }) : !state.episodesError ? h("div", { className: "hg-muted" }, t("detail.noEpisodes")) : null
        )
      ) : null
    )
  );
}

// src/panel/pages/history.js
function HistoryPage({ ctx, active, historyVersion }) {
  const React = getReact();
  const t = ctx.t;
  const api = ctx.api;
  const [list, setList] = React.useState([]);
  const [status, setStatus] = React.useState("loading");
  const [error, setError] = React.useState(null);
  const [pendingDelete, setPendingDelete] = React.useState(null);
  const [confirmClear, setConfirmClear] = React.useState(false);
  const aliveRef = React.useRef(true);
  const deleteTimerRef = React.useRef(null);
  const clearTimerRef = React.useRef(null);
  React.useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    };
  }, []);
  const load = React.useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const next = await readHistory(api);
      if (!aliveRef.current) return;
      setList(next);
      setStatus("idle");
    } catch (loadError) {
      if (!aliveRef.current) return;
      setError(loadError);
      setStatus("error");
    }
  }, [api]);
  React.useEffect(() => {
    if (!active) return;
    void load();
  }, [active, historyVersion, load]);
  const askDelete = (seriesId) => {
    if (deleteTimerRef.current) {
      clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = null;
    }
    if (pendingDelete === seriesId) {
      setPendingDelete(null);
      removeHistory(api, seriesId).then((next) => {
        if (!aliveRef.current) return;
        setList(next);
        ctx.bumpHistory();
        ctx.notify("success", t("history.removed"));
      }).catch((deleteError) => {
        if (!aliveRef.current) return;
        ctx.notify("error", describeError(t, deleteError).message);
      });
      return;
    }
    setPendingDelete(seriesId);
    deleteTimerRef.current = setTimeout(() => {
      deleteTimerRef.current = null;
      if (aliveRef.current) setPendingDelete(null);
    }, 3e3);
  };
  const askClear = () => {
    if (clearTimerRef.current) {
      clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
    if (!confirmClear) {
      setConfirmClear(true);
      clearTimerRef.current = setTimeout(() => {
        clearTimerRef.current = null;
        if (aliveRef.current) setConfirmClear(false);
      }, 4e3);
      return;
    }
    setConfirmClear(false);
    clearHistory(api).then(() => {
      if (!aliveRef.current) return;
      setList([]);
      ctx.bumpHistory();
      ctx.notify("success", t("history.cleared"));
    }).catch((clearError) => {
      if (!aliveRef.current) return;
      ctx.notify("error", describeError(t, clearError).message);
    });
  };
  return h(
    "div",
    { className: "hg-page hg-history" },
    h(
      "div",
      { className: "hg-page-head" },
      h("div", { className: "hg-page-title" }, t("history.heading")),
      status === "loading" && list.length > 0 ? h(Spinner, { label: t("history.heading") }) : null,
      list.length > 0 ? h(
        "button",
        {
          type: "button",
          className: `hg-linkbtn${confirmClear ? " is-danger" : ""}`,
          onClick: askClear
        },
        confirmClear ? t("history.clearConfirm") : t("history.clear")
      ) : null
    ),
    h(
      "div",
      { className: "hg-scroll" },
      status === "loading" && list.length === 0 ? h(
        "div",
        { className: "hg-history-skeleton" },
        Array.from(
          { length: 3 },
          (_, index) => h(
            "div",
            { key: `history-skeleton-${index}`, className: "hg-skeleton-row" },
            h("div", { className: "hg-skeleton hg-skeleton-thumb" }),
            h(
              "div",
              { className: "hg-skeleton-row-main" },
              h("div", { className: "hg-skeleton hg-skeleton-line" }),
              h("div", { className: "hg-skeleton hg-skeleton-line short" })
            )
          )
        )
      ) : null,
      status === "error" && error ? h(ErrorNotice, { ctx, error, onRetry: () => void load() }) : null,
      status !== "error" && status !== "loading" && list.length === 0 ? h(EmptyState, {
        ctx,
        icon: "History",
        title: t("history.empty"),
        hint: t("history.emptyHint"),
        action: h(
          "button",
          { type: "button", className: "hg-btn", onClick: () => ctx.openTab("discover") },
          t("action.browse")
        )
      }) : null,
      list.length > 0 ? h(
        "div",
        { className: "hg-history-list" },
        list.map((entry) => {
          const confirming = pendingDelete === entry.seriesId;
          return h(
            "div",
            { className: "hg-history-row", key: entry.seriesId },
            h(
              "button",
              {
                type: "button",
                className: "hg-history-main",
                onClick: () => ctx.openSeries({
                  id: entry.seriesId,
                  title: entry.title,
                  cover: entry.cover
                })
              },
              h(Cover, { ctx, path: entry.cover, className: "hg-history-cover" }),
              h(
                "div",
                { className: "hg-history-text" },
                h("div", { className: "hg-history-title" }, entry.title || t("unit.untitled")),
                h(
                  "div",
                  { className: "hg-history-meta" },
                  t("history.lastWatched", {
                    number: entry.episodeNumber,
                    time: formatDuration(entry.positionMs)
                  })
                )
              ),
              h(
                "div",
                { className: "hg-history-time" },
                formatDateTime(entry.updatedAt, ctx.locale)
              )
            ),
            h(
              "button",
              {
                type: "button",
                className: `hg-iconbtn danger${confirming ? " is-confirming" : ""}`,
                title: confirming ? t("history.confirmRemove") : t("history.remove"),
                "aria-label": confirming ? t("history.confirmRemove") : t("history.remove"),
                onClick: () => askDelete(entry.seriesId)
              },
              confirming ? h("span", { className: "hg-confirm-text" }, t("history.confirmRemove")) : h(Icon, { ctx, name: "Trash2", size: 14 })
            )
          );
        })
      ) : null
    )
  );
}

// src/panel/pages/settings.js
function SettingsPage({ ctx, active }) {
  const React = getReact();
  const t = ctx.t;
  const rpc = ctx.rpc;
  const [healthState, setHealthState] = React.useState({ status: "loading", data: null, error: null });
  const [clearing, setClearing] = React.useState(false);
  const [confirmClear, setConfirmClear] = React.useState(false);
  const [cacheMessage, setCacheMessage] = React.useState(null);
  const healthSeqRef = React.useRef(0);
  const healthBusyRef = React.useRef(false);
  const clearTimerRef = React.useRef(null);
  React.useEffect(
    () => () => {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    },
    []
  );
  const refreshHealth = React.useCallback(async () => {
    if (healthBusyRef.current) return;
    healthBusyRef.current = true;
    const seq = healthSeqRef.current + 1;
    healthSeqRef.current = seq;
    setHealthState((prev) => ({ ...prev, status: "loading", error: null }));
    try {
      const data = await rpc.health();
      if (seq !== healthSeqRef.current) return;
      setHealthState({ status: "ok", data, error: null });
    } catch (error) {
      if (seq !== healthSeqRef.current) return;
      setHealthState({ status: "error", data: null, error });
    } finally {
      healthBusyRef.current = false;
    }
  }, [rpc]);
  React.useEffect(() => {
    if (!active) return;
    void refreshHealth();
  }, [active, refreshHealth]);
  const askClearCache = async () => {
    if (clearTimerRef.current) {
      clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
    if (!confirmClear) {
      setConfirmClear(true);
      clearTimerRef.current = setTimeout(() => {
        clearTimerRef.current = null;
        setConfirmClear(false);
      }, 4e3);
      return;
    }
    setConfirmClear(false);
    setClearing(true);
    setCacheMessage(null);
    try {
      const result = await rpc.clearCache();
      const removed = Number(result?.removed);
      setCacheMessage({
        kind: "success",
        text: Number.isFinite(removed) ? t("settings.cacheClearedCount", { count: removed }) : t("settings.cacheCleared")
      });
    } catch (error) {
      if (error?.code === "NOT_FOUND" || error?.code === "METHOD_NOT_ALLOWED") {
        setCacheMessage({ kind: "warn", text: t("settings.cacheUnsupported") });
      } else {
        setCacheMessage({
          kind: "error",
          text: t("settings.cacheFailed", { error: describeError(t, error).message })
        });
      }
    } finally {
      setClearing(false);
    }
  };
  const health = healthState.data;
  const quality = ctx.prefs?.quality || "720p";
  const miniWindow = ctx.prefs?.miniWindow || {};
  const miniOpacity = Math.round((Number(miniWindow.opacity) || 0.92) * 100);
  const patchMiniWindow = (patch) => ctx.updatePrefs({ miniWindow: { ...miniWindow, ...patch } });
  return h(
    "div",
    { className: "hg-page hg-settings" },
    h("div", { className: "hg-page-head" }, h("div", { className: "hg-page-title" }, t("settings.heading"))),
    h(
      "div",
      { className: "hg-scroll" },
      h(
        "section",
        { className: "hg-card-panel" },
        h(
          "div",
          { className: "hg-sec-head" },
          h("span", null, t("settings.playback")),
          h(Icon, { ctx, name: "SlidersHorizontal", size: 14 })
        ),
        h(
          "div",
          { className: "hg-field" },
          h("label", { className: "hg-field-label", htmlFor: "hg-quality" }, t("settings.quality")),
          h(Select, {
            id: "hg-quality",
            value: quality,
            active,
            ariaLabel: t("settings.quality"),
            onChange: (value) => ctx.updatePrefs({ quality: value }),
            options: QUALITY_OPTIONS.map((value) => ({ value, label: value }))
          })
        ),
        h("div", { className: "hg-hint" }, t("settings.qualityHint")),
        h(
          "div",
          { className: "hg-field" },
          h("label", { className: "hg-field-label", htmlFor: "hg-playback-rate" }, t("player.speed")),
          h(Select, {
            id: "hg-playback-rate",
            value: ctx.prefs.playbackRate,
            active,
            ariaLabel: t("player.speed"),
            onChange: (value) => ctx.updatePrefs({ playbackRate: Number(value) }),
            options: PLAYBACK_RATES.map((value) => ({ value, label: `${value}x` }))
          })
        ),
        h(
          "div",
          { className: "hg-field hg-range-field" },
          h("label", { className: "hg-field-label", htmlFor: "hg-volume" }, t("player.volume")),
          h(
            "div",
            { className: "hg-range-control" },
            h("input", {
              id: "hg-volume",
              className: "hg-range",
              type: "range",
              min: 0,
              max: 100,
              step: 1,
              value: Math.round(ctx.prefs.volume * 100),
              onChange: (event) => ctx.updatePrefs({ volume: Number(event.target.value) / 100 })
            }),
            h("span", { className: "hg-range-value" }, `${Math.round(ctx.prefs.volume * 100)}%`)
          )
        ),
        h(
          "div",
          { className: "hg-field" },
          h("label", { className: "hg-field-label", htmlFor: "hg-muted" }, t("player.mute")),
          h("input", {
            id: "hg-muted",
            className: "hg-toggle",
            type: "checkbox",
            role: "switch",
            checked: ctx.prefs.muted,
            onChange: (event) => ctx.updatePrefs({ muted: event.target.checked })
          })
        ),
        h(
          "div",
          { className: "hg-field" },
          h("label", { className: "hg-field-label", htmlFor: "hg-auto-next" }, t("settings.autoNext")),
          h("input", {
            id: "hg-auto-next",
            className: "hg-toggle",
            type: "checkbox",
            role: "switch",
            checked: ctx.prefs.autoNext,
            onChange: (event) => ctx.updatePrefs({ autoNext: event.target.checked })
          })
        ),
        h("div", { className: "hg-hint" }, t("settings.playbackRemembered")),
        h(
          "div",
          { className: "hg-field hg-range-field" },
          h("label", { className: "hg-field-label", htmlFor: "hg-mini-opacity" }, t("settings.miniOpacity")),
          h(
            "div",
            { className: "hg-range-control" },
            h("input", {
              id: "hg-mini-opacity",
              className: "hg-range",
              type: "range",
              min: 5,
              max: 100,
              step: 1,
              value: miniOpacity,
              onChange: (event) => patchMiniWindow({ opacity: Number(event.target.value) / 100 })
            }),
            h("span", { className: "hg-range-value" }, `${miniOpacity}%`)
          )
        ),
        h("div", { className: "hg-hint" }, t("settings.miniOpacityHint")),
        h(
          "div",
          { className: "hg-field" },
          h("label", { className: "hg-field-label", htmlFor: "hg-mini-autohide" }, t("settings.miniAutoHide")),
          h("input", {
            id: "hg-mini-autohide",
            className: "hg-toggle",
            type: "checkbox",
            role: "switch",
            checked: miniWindow.autoHide === true,
            onChange: (event) => patchMiniWindow({ autoHide: event.target.checked })
          })
        ),
        h("div", { className: "hg-hint" }, t("settings.miniAutoHideHint"))
      ),
      h(
        "section",
        { className: "hg-card-panel" },
        h(
          "div",
          { className: "hg-sec-head" },
          h("span", null, t("settings.cache")),
          h(Icon, { ctx, name: "Database", size: 14 })
        ),
        h("div", { className: "hg-hint" }, t("settings.cacheHint")),
        h(
          "button",
          {
            type: "button",
            className: `hg-btn${confirmClear ? " danger" : ""}`,
            disabled: clearing,
            onClick: () => void askClearCache()
          },
          clearing ? h(Spinner, { label: t("settings.clearCache") }) : null,
          clearing ? t("settings.clearCache") : confirmClear ? t("settings.clearCacheConfirm") : t("settings.clearCache")
        ),
        cacheMessage ? h(
          "div",
          { className: `hg-callout is-${cacheMessage.kind}` },
          cacheMessage.text
        ) : null
      ),
      h(
        "section",
        { className: "hg-card-panel" },
        h(
          "div",
          { className: "hg-sec-head" },
          h("span", null, t("settings.status")),
          h(
            "span",
            { className: `hg-status-dot${health ? " is-online" : ""}` },
            health ? t("settings.running") : t("settings.notRunning")
          )
        ),
        h("div", { className: "hg-hint" }, t("settings.statusHint")),
        healthState.status === "error" && healthState.error ? h(
          "div",
          { className: "hg-health-error" },
          h(ErrorNotice, {
            ctx,
            error: healthState.error,
            compact: true,
            onRetry: () => void refreshHealth()
          }),
          h("div", { className: "hg-hint" }, t("settings.unavailableHint"))
        ) : null,
        healthState.status === "loading" && !health ? h(
          "div",
          { className: "hg-loading-line" },
          h(Spinner, { label: t("settings.status") }),
          h("span", null, t("settings.status"))
        ) : null,
        health ? h(
          "div",
          { className: "hg-kv" },
          h("div", { className: "hg-kv-row" }, h("span", null, t("settings.port")), h("code", null, `127.0.0.1:${health.port ?? "?"}`)),
          h("div", { className: "hg-kv-row" }, h("span", null, t("settings.version")), h("code", null, String(health.version ?? "?"))),
          h("div", { className: "hg-kv-row" }, h("span", null, t("settings.pid")), h("code", null, String(health.pid ?? "?"))),
          h("div", { className: "hg-kv-row" }, h("span", null, t("settings.uptime")), h("code", null, formatUptime(health.uptimeMs))),
          h(
            "div",
            { className: "hg-kv-row" },
            h("span", null, t("settings.sdk")),
            h(
              "code",
              null,
              health.sdk?.ready ? t("settings.sdkReady") : t("settings.sdkIdle")
            )
          ),
          health.sdk?.lastError ? h(
            "div",
            { className: "hg-kv-row" },
            h("span", null, t("settings.sdkLastError")),
            h("code", null, String(health.sdk.lastError))
          ) : null
        ) : null,
        h(
          "button",
          {
            type: "button",
            className: "hg-btn",
            disabled: healthState.status === "loading",
            onClick: () => void refreshHealth()
          },
          healthState.status === "loading" ? h(Spinner, { label: t("settings.recheck") }) : null,
          t("settings.recheck")
        )
      ),
      h(
        "section",
        { className: "hg-card-panel" },
        h("div", { className: "hg-sec-head" }, h("span", null, t("settings.about"))),
        h("div", { className: "hg-about-version" }, `${ctx.api?.name || "Hongguo Shorts"} · v${ctx.api?.version || "?"}`),
        h("div", { className: "hg-hint" }, t("settings.aboutText"))
      )
    )
  );
}

// src/panel/main.js
var TABS = [
  { id: "discover", icon: "Sparkles", labelKey: "tab.discover" },
  { id: "search", icon: "Search", labelKey: "tab.search" },
  { id: "watchlist", icon: "Bookmark", labelKey: "tab.watchlist" },
  { id: "history", icon: "History", labelKey: "tab.history" },
  { id: "settings", icon: "Settings", labelKey: "tab.settings" }
];
var NOTICE_ICONS = { success: "CircleCheck", error: "CircleAlert", info: "Info" };
var getHostReact = (api) => api && api.ui && api.ui.React || typeof window !== "undefined" && window.SnowAppPlugin && window.SnowAppPlugin.React || null;
function PanelApp({ api, React, locale }) {
  const translator = React.useMemo(() => createTranslator(api, locale), [api, locale]);
  const t = translator.t;
  const resolvedLocale = translator.locale;
  const log = React.useCallback(
    (...args) => {
      try {
        api?.log?.(...args);
      } catch {
      }
    },
    [api]
  );
  const rpc = React.useMemo(() => createRpc(api, { log }), [api, log]);
  const cover = React.useMemo(() => createCoverStore(rpc, { log }), [rpc, log]);
  const [boot, setBoot] = React.useState({ status: "loading", error: null, health: null });
  const [activeTab, setActiveTab] = React.useState("discover");
  const [route, setRoute] = React.useState(null);
  const [detailVisible, setDetailVisible] = React.useState(false);
  const [miniActive, setMiniActive] = React.useState(false);
  const [visited, setVisited] = React.useState(() => ({ discover: true }));
  const [prefs, setPrefs] = React.useState(() => normalizePrefs(null));
  const [historyVersion, setHistoryVersion] = React.useState(0);
  const [watchlistVersion, setWatchlistVersion] = React.useState(0);
  const [notices, setNotices] = React.useState([]);
  const prefsRef = React.useRef(prefs);
  const aliveRef = React.useRef(true);
  const bootSeqRef = React.useRef(0);
  const routeSeqRef = React.useRef(0);
  const noticeTimersRef = React.useRef(/* @__PURE__ */ new Map());
  React.useEffect(() => {
    if (typeof document === "undefined") return void 0;
    const pluginId = api?.id || "com.snow.hongguo";
    if (document.querySelector(`style[data-snow-plugin="${pluginId}"]`)) {
      for (const node of document.querySelectorAll("style[data-hg-fallback]")) node.remove();
      return void 0;
    }
    if (document.querySelector("style[data-hg-fallback]")) return void 0;
    let disposed = false;
    (async () => {
      try {
        const dataUrl = await api?.assets?.resolve?.("style.css");
        if (disposed || typeof dataUrl !== "string" || !dataUrl.includes(";base64,")) return;
        if (document.querySelector(`style[data-snow-plugin="${pluginId}"]`)) return;
        const binary = atob(dataUrl.slice(dataUrl.indexOf(";base64,") + 8));
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        const style = document.createElement("style");
        style.dataset.hgFallback = "1";
        style.textContent = new TextDecoder().decode(bytes);
        document.head.appendChild(style);
        log("[panel] 清单未注入样式，已使用 style.css 兜底");
      } catch (error) {
        log("[panel] 样式兜底注入失败", String(error?.message || error));
      }
    })();
    return () => {
      disposed = true;
    };
  }, [api, log]);
  React.useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);
  React.useEffect(() => {
    aliveRef.current = true;
    const timers = noticeTimersRef.current;
    return () => {
      aliveRef.current = false;
      cover.dispose();
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, [cover]);
  const notify = React.useCallback((kind, text) => {
    if (!aliveRef.current) return;
    const id = `notice-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setNotices((list) => [...list.slice(-2), { id, kind: kind || "info", text: String(text || "") }]);
    const timer = setTimeout(() => {
      noticeTimersRef.current.delete(id);
      if (!aliveRef.current) return;
      setNotices((list) => list.filter((item) => item.id !== id));
    }, 4e3);
    noticeTimersRef.current.set(id, timer);
  }, []);
  const updatePrefs = React.useCallback(
    (patch) => {
      const next = normalizePrefs({ ...prefsRef.current, ...patch });
      prefsRef.current = next;
      setPrefs(next);
      writePrefs(api, next).catch((error) => {
        notify("error", t("settings.saveFailed", { error: String(error?.message || error) }));
      });
    },
    [api, notify, t]
  );
  const startBoot = React.useCallback(() => {
    const seq = bootSeqRef.current + 1;
    bootSeqRef.current = seq;
    setBoot({ status: "loading", error: null, health: null });
    Promise.all([rpc.ensureReady(), readPrefs(api).catch((error) => {
      log("[panel] 读取播放偏好失败", String(error?.message || error));
      notify("error", t("settings.loadFailed"));
      return normalizePrefs({ muted: true });
    })]).then(([health, savedPrefs]) => {
      if (!aliveRef.current || seq !== bootSeqRef.current) return;
      prefsRef.current = savedPrefs;
      setPrefs(savedPrefs);
      setBoot({ status: "ready", error: null, health });
    }).catch((error) => {
      if (!aliveRef.current || seq !== bootSeqRef.current) return;
      setBoot({ status: "failed", error, health: null });
    });
  }, [rpc, api, log, notify, t]);
  React.useEffect(() => {
    startBoot();
  }, [startBoot]);
  const ctx = React.useMemo(
    () => ({
      api,
      rpc,
      t,
      locale: resolvedLocale,
      cover,
      prefs,
      updatePrefs,
      notify,
      log,
      bumpHistory: () => {
        if (aliveRef.current) setHistoryVersion((value) => value + 1);
      },
      bumpWatchlist: () => {
        if (aliveRef.current) setWatchlistVersion((value) => value + 1);
      },
      watchlistVersion,
      onMiniChange: (active) => {
        setMiniActive(active);
        if (!active) setDetailVisible(true);
      },
      openSeries: (seed) => {
        if (!seed || !seed.id) return;
        routeSeqRef.current += 1;
        setRoute({ id: String(seed.id), seed, instance: routeSeqRef.current });
        setMiniActive(false);
        setDetailVisible(true);
      },
      openTab: (id) => {
        setActiveTab(id);
        setVisited((prev) => prev[id] ? prev : { ...prev, [id]: true });
        if (miniActive) {
          setDetailVisible(false);
          return;
        }
        setRoute(null);
        setDetailVisible(false);
      }
    }),
    [api, rpc, t, resolvedLocale, cover, prefs, updatePrefs, notify, log, miniActive, watchlistVersion]
  );
  const ErrorBoundary = React.useMemo(() => {
    class Boundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
      }
      static getDerivedStateFromError(error) {
        return { error };
      }
      componentDidCatch(error, info) {
        log("[panel] render error", String(error?.message || error), String(info?.componentStack || ""));
      }
      componentDidUpdate(prevProps) {
        if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
          this.setState({ error: null });
        }
      }
      render() {
        if (this.state.error) {
          return h(
            "div",
            { className: "hg-panel hg-boot" },
            h("div", { className: "hg-boot-title" }, t("error.renderTitle")),
            h("div", { className: "hg-boot-text" }, String(this.state.error?.message || this.state.error)),
            h(
              "button",
              { type: "button", className: "hg-btn primary", onClick: () => this.setState({ error: null }) },
              t("error.retryPanel")
            )
          );
        }
        return this.props.children;
      }
    }
    return Boundary;
  }, [log, t]);
  if (boot.status === "loading") {
    return h(
      "div",
      { className: "hg-panel" },
      h(
        "div",
        { className: "hg-boot" },
        h(Spinner, { label: t("boot.loading") }),
        h("div", { className: "hg-boot-title" }, t("plugin.title")),
        h("div", { className: "hg-boot-text" }, t("boot.loading"))
      )
    );
  }
  if (boot.status === "failed") {
    const info = describeError(t, boot.error);
    return h(
      "div",
      { className: "hg-panel" },
      h(
        "div",
        { className: "hg-boot" },
        h("div", { className: "hg-boot-icon" }, h(Icon, { ctx, name: "ServerOff", size: 24 })),
        h("div", { className: "hg-boot-title" }, t("boot.failedTitle")),
        h("div", { className: "hg-boot-text" }, info.message),
        h("div", { className: "hg-boot-hint" }, t("boot.failedHint")),
        boot.error?.message ? h("code", { className: "hg-boot-detail" }, String(boot.error.message)) : null,
        h(
          "button",
          { type: "button", className: "hg-btn primary", onClick: startBoot },
          t("boot.retry")
        )
      )
    );
  }
  const covered = Boolean(route && detailVisible);
  const tabPanes = h(
    "div",
    {
      className: `hg-tabpanes${covered ? " is-covered" : ""}`,
      "aria-hidden": covered ? "true" : void 0
    },
    visited.discover ? h(
      "div",
      { className: "hg-tabpane", hidden: activeTab !== "discover" },
      h(DiscoveryPage, { ctx, active: activeTab === "discover" && !covered })
    ) : null,
    visited.search ? h(
      "div",
      { className: "hg-tabpane", hidden: activeTab !== "search" },
      h(SearchPage, { ctx, active: activeTab === "search" && !covered })
    ) : null,
    visited.watchlist ? h(
      "div",
      { className: "hg-tabpane", hidden: activeTab !== "watchlist" },
      h(WatchlistPage, { ctx, active: activeTab === "watchlist" && !covered, historyVersion, watchlistVersion })
    ) : null,
    visited.history ? h(
      "div",
      { className: "hg-tabpane", hidden: activeTab !== "history" },
      h(HistoryPage, { ctx, active: activeTab === "history", historyVersion })
    ) : null,
    visited.settings ? h(
      "div",
      { className: "hg-tabpane", hidden: activeTab !== "settings" },
      h(SettingsPage, { ctx, active: activeTab === "settings" })
    ) : null
  );
  const detailLayer = route ? h(
    "div",
    {
      className: "hg-detail-layer",
      hidden: !detailVisible,
      "aria-hidden": !detailVisible ? "true" : void 0
    },
    h(DetailPage, {
      key: `${route.id}:${route.instance || 0}`,
      ctx,
      seed: route.seed,
      onBack: () => {
        setRoute(null);
        setDetailVisible(false);
        setMiniActive(false);
      }
    })
  ) : null;
  return h(
    "div",
    { className: "hg-panel" },
    h(
      "header",
      { className: "hg-head" },
      h("div", { className: "hg-head-mark" }, h(Icon, { ctx, name: "Film", size: 16 })),
      h(
        "div",
        { className: "hg-head-text" },
        h("div", { className: "hg-head-title" }, t("plugin.title")),
        h(
          "div",
          { className: "hg-head-sub" },
          t("app.subtitle")
        )
      ),
      h("span", { className: "hg-head-dot", title: t("settings.running") })
    ),
    h(
      "main",
      { className: "hg-body" },
      h(
        ErrorBoundary,
        { resetKey: route ? `detail:${route.id}` : `tab:${activeTab}` },
        tabPanes,
        detailLayer
      )
    ),
    notices.length > 0 ? h(
      "div",
      { className: "hg-notices" },
      notices.map(
        (notice) => h(
          "div",
          { key: notice.id, className: `hg-notice is-${notice.kind}`, role: "status" },
          h(Icon, { ctx, name: NOTICE_ICONS[notice.kind] || "Info", size: 13 }),
          h("span", null, notice.text)
        )
      )
    ) : null,
    h(
      "nav",
      { className: "hg-tabs", role: "tablist" },
      TABS.map((tab) => {
        const selected = activeTab === tab.id;
        return h(
          "button",
          {
            key: tab.id,
            type: "button",
            role: "tab",
            "aria-selected": selected,
            className: `hg-tab${selected ? " is-active" : ""}`,
            onClick: () => ctx.openTab(tab.id)
          },
          h(Icon, { ctx, name: tab.icon, size: 16 }),
          h("span", { className: "hg-tab-label" }, t(tab.labelKey))
        );
      })
    )
  );
}
function Panel(props) {
  const api = props?.api;
  const React = getHostReact(api);
  if (!React) return null;
  bindReact(React);
  return React.createElement(PanelApp, {
    api,
    React,
    locale: props?.locale,
    panelId: props?.panelId,
    isActive: props?.isActive
  });
}
export {
  PLAYER_SLOT_ID,
  PlayerMount,
  Panel as default,
  renderPlayer
};
