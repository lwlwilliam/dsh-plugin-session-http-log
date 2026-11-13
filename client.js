window.__ModuleLoader__.load({
  id: '@local/dsh-plugin-session-http-log',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Tab 类型标识：与模块加载器 id 及 dsh.client 条目名一致。 */
    const PLUGIN_ID = '@local/dsh-plugin-session-http-log'
    /** 本面板所有可见文案所属的 locale 命名空间。 */
    const NS = 'dsh-plugin-session-http-log'
    /** 右侧边栏的 Tab 类型判别值。 */
    const KIND = 'dsh-plugin-session-http-log'
    /** Host 路由的文档相对前缀（无前导斜杠：挂载路径不属于本插件）。 */
    const ROUTE = 'api/dsh-plugin-session-http-log'
    /** 面板挂载且自动刷新开启时的列表刷新间隔。 */
    const POLL_INTERVAL_MS = 1200
    /** “所有会话总大小”的扫描限频：目录扫描比列表轮询贵，放慢到 8 秒一次；
     *  但它始终挂在列表轮询的同一拍上取，两个数字才不会错位。 */
    const USAGE_POLL_INTERVAL_MS = 8000
    /** 服务端列表上限；面板不会请求更多。 */
    const LIST_LIMIT = 500
    /** 复制按钮保留“已复制”/“复制失败”反馈的时长。 */
    const COPY_FEEDBACK_MS = 1600
    /** HAR 导出按钮提供的下载文件名。 */
    const HAR_FILENAME = 'dsh-plugin-session-http-log.har'
    /** 超过该大小的报文仅显示原始内容：格式化会卡住面板。 */
    const MAX_PRETTY_CHARS = 1024 * 1024
    /** 本面板语言覆盖的 localStorage 键。 */
    const LANG_STORAGE_KEY = 'dsh-plugin-session-http-log:lang'
    /** 定位时列表行闪烁提示的时长。 */
    const FLASH_MS = 600

    // ---------------------------------------------------------------------
    // 本地化文案。扁平键；所有可见字符串都经过 `t`。
    // ---------------------------------------------------------------------
    const en = {
      'tab.title': 'Session HTTP log',
      'tab.description': 'Inspect the raw HTTP requests and responses this session made.',
      'view.tab': 'HTTP log',
      'header.count': '{count} requests',
      'header.filteredCount': '{shown} of {total}',
      'header.autoRefresh': 'Auto refresh',
      'header.refresh': 'Refresh',
      'header.clear': 'Clear',
      'header.clearAll': 'Clear all',
      'header.clearAllTitle': 'Clear all session HTTP logs',
      'header.clearConfirm': 'Clear every captured exchange for this session?',
      'header.clearAllConfirm': 'Delete the HTTP capture files for ALL sessions? This cannot be undone.',
      'header.clearConfirmYes': 'Confirm clear',
      'header.clearAllConfirmYes': 'Delete all captures',
      'header.cancel': 'Cancel',
      'header.clearing': 'Clearing…',
      'header.clearingAll': 'Clearing all…',
      'header.export': 'Export HAR',
      'header.exporting': 'Exporting…',
      'filter.placeholder': 'Filter by method, URL, status or model',
      'list.loading': 'Loading requests…',
      'list.empty': 'No HTTP requests recorded for this session yet.',
      'list.emptyFiltered': 'No requests match this filter.',
      'list.error': 'Could not load requests: {message}',
      'list.retry': 'Retry',
      'row.pending': 'pending',
      'row.error': 'error',
      'detail.selectHint': 'Select a request to inspect its raw exchange.',
      'detail.loading': 'Loading record…',
      'detail.bodyLoading': 'Loading body…',
      'detail.bodyError': 'Could not load body: {message}',
      'detail.error': 'Could not load record: {message}',
      'detail.overview': 'Overview',
      'detail.requestHeaders': 'Request headers',
      'detail.requestBody': 'Request body',
      'detail.responseHeaders': 'Response headers',
      'detail.responseBody': 'Response body',
      'detail.errorLine': 'Error',
      'detail.noHeaders': 'No headers captured',
      'detail.noBody': 'No body captured',
      'detail.raw': 'Raw',
      'detail.pretty': 'Pretty',
      'detail.base64Note': 'Binary body captured as base64 text.',
      'detail.pending': 'In flight…',
      'detail.method': 'Method',
      'detail.url': 'URL',
      'detail.status': 'Status',
      'detail.duration': 'Duration',
      'detail.started': 'Started',
      'detail.kind': 'Kind',
      'detail.model': 'Model',
      'detail.requestSize': 'Request size',
      'detail.responseSize': 'Response size',
      'detail.totalSize': 'Total size',
      'detail.contentType': 'Content type',
      'detail.locate': 'Locate in list',
      'detail.locateTitle': 'Scroll the request list to this record',
      'badge.truncated': 'truncated',
      'badge.base64': 'base64',
      'action.copyUrl': 'Copy URL',
      'action.copyHeaders': 'Copy headers',
      'action.copyBody': 'Copy body',
      'action.copyCurl': 'Copy as cURL',
      'action.copied': 'Copied',
      'action.copyFailed': 'Copy failed',
      'action.dismiss': 'Dismiss',
      'state.noSession': 'No session selected.',
      'lang.switchToEnglish': 'Switch to English',
      'lang.switchToChinese': 'Switch to Chinese',
      'lang.enShort': 'EN',
      'lang.zhShort': '中',
      'row.expand': 'Expand request details',
      'row.collapse': 'Collapse request details',
      'row.sizePair': '↑{request} ↓{response}',
      'row.sizeTooltip': 'Request body: {request}\nResponse body: {response}',
      'section.expand': 'Expand section',
      'section.collapse': 'Collapse section',
      'header.space': '{memory} occupied',
      'header.spaceTooltip': 'Memory estimate: {memory} / per-turn cap {memoryLimit}\nOn disk: {disk} / turn-file cap {fileLimit}\nDirectory: {dir}',
      'header.allSessions': 'All {size}',
      'header.allSessionsTooltip': 'All session captures on disk across workspaces (incl. .jsonl.idx): {size}\n{files} files / {sessions} sessions\nGlobal cap: {limit}\nDirectory: {dir}',
      'header.noLimit': 'no cap',
      'header.retention': 'Only the latest turn is kept. Turn file cap: {limit}; captures not updated for {hours}h are removed by the hourly cleanup, and archived-session captures are removed when archiving succeeds.',
      'header.retentionTitle': 'A new turn clears the previous turn for this session. The turn file is capped; files idle for the retention window are removed by the hourly cleanup, and captures for a session are deleted as soon as it is archived. Other sessions are handled independently; the Open folder and Clear actions remain available.',
      'header.spaceUninstallNote': 'Uninstalling the plugin does not delete this directory.',
      'header.notPersisted': 'not persisted',
      'header.openFolder': 'Open folder',
      'header.openFolderTitle': 'Open the records directory and select this session\'s .jsonl log when the file manager supports it; the .idx index sits next to it (uninstalling the plugin does not delete its data)',
      'header.opening': 'Opening…',
      'header.opened': 'Opened',
      'error.reveal': 'Could not open the data directory: {message}',
      'error.export': 'HAR export failed: {message}',
      'error.clear': 'Clear failed: {message}',
      'error.clearAll': 'Could not clear all captures: {message}',
    }
    const zh = {
      'tab.title': '会话 HTTP 记录',
      'tab.description': '查看当前会话发出的原始 HTTP 请求与响应报文。',
      'view.tab': 'HTTP 记录',
      'header.count': '{count} 条请求',
      'header.filteredCount': '{shown} / {total} 条',
      'header.autoRefresh': '自动刷新',
      'header.refresh': '刷新',
      'header.clear': '清空',
      'header.clearAll': '清空全部',
      'header.clearAllTitle': '清空所有会话 HTTP 记录',
      'header.clearConfirm': '确定清空当前会话的全部记录？',
      'header.clearAllConfirm': '确定删除所有会话的 HTTP 抓包文件？此操作不可恢复。',
      'header.clearConfirmYes': '确认清空',
      'header.clearAllConfirmYes': '清空全部记录',
      'header.cancel': '取消',
      'header.clearing': '清空中…',
      'header.clearingAll': '正在清空全部…',
      'header.export': '导出 HAR',
      'header.exporting': '导出中…',
      'filter.placeholder': '按方法、URL、状态或模型筛选',
      'list.loading': '正在加载请求…',
      'list.empty': '当前会话暂无 HTTP 请求记录。',
      'list.emptyFiltered': '没有匹配筛选条件的请求。',
      'list.error': '加载请求失败：{message}',
      'list.retry': '重试',
      'row.pending': '进行中…',
      'row.error': '错误',
      'detail.selectHint': '选择一条请求以查看原始报文。',
      'detail.loading': '正在加载记录…',
      'detail.bodyLoading': '正在加载报文…',
      'detail.bodyError': '加载报文失败：{message}',
      'detail.error': '加载记录失败：{message}',
      'detail.overview': '概览',
      'detail.requestHeaders': '请求头',
      'detail.requestBody': '请求体',
      'detail.responseHeaders': '响应头',
      'detail.responseBody': '响应体',
      'detail.errorLine': '错误',
      'detail.noHeaders': '未捕获到头部',
      'detail.noBody': '未捕获到报文',
      'detail.raw': '原始',
      'detail.pretty': '格式化',
      'detail.base64Note': '二进制报文以 base64 文本保存。',
      'detail.pending': '进行中…',
      'detail.method': '方法',
      'detail.url': 'URL',
      'detail.status': '状态',
      'detail.duration': '耗时',
      'detail.started': '开始时间',
      'detail.kind': '类型',
      'detail.model': '模型',
      'detail.requestSize': '请求大小',
      'detail.responseSize': '响应大小',
      'detail.totalSize': '合计大小',
      'detail.contentType': '内容类型',
      'detail.locate': '定位',
      'detail.locateTitle': '在请求列表中定位此记录',
      'badge.truncated': '已截断',
      'badge.base64': 'base64',
      'action.copyUrl': '复制 URL',
      'action.copyHeaders': '复制头部',
      'action.copyBody': '复制报文',
      'action.copyCurl': '复制为 cURL',
      'action.copied': '已复制',
      'action.copyFailed': '复制失败',
      'action.dismiss': '关闭',
      'state.noSession': '未选择会话。',
      'lang.switchToEnglish': '切换为英文',
      'lang.switchToChinese': '切换为中文',
      'lang.enShort': 'EN',
      'lang.zhShort': '中',
      'row.expand': '展开请求详情',
      'row.collapse': '收起请求详情',
      'row.sizePair': '↑{request} ↓{response}',
      'row.sizeTooltip': '请求体：{request}\n响应体：{response}',
      'section.expand': '展开此区块',
      'section.collapse': '收起此区块',
      'header.space': '占用 {memory}',
      'header.spaceTooltip': '内存估算：{memory} / 每轮上限 {memoryLimit}\n磁盘：{disk} / 单轮文件上限 {fileLimit}\n目录：{dir}',
      'header.allSessions': '全部 {size}',
      'header.allSessionsTooltip': '所有工作区的会话抓包文件（含 .jsonl.idx 索引）：{size}\n{files} 个文件 / {sessions} 个会话\n全局上限：{limit}\n目录：{dir}',
      'header.noLimit': '不限',
      'header.retention': '仅保留最新一轮：单轮文件上限 {limit}；超过 {hours} 小时未更新会在每小时清理中删除，会话归档成功后抓包会立即删除。',
      'header.retentionTitle': '同一会话进入新一轮时会清空上一轮记录；单轮文件达到上限时只保留最近记录。超过保留时长未更新的文件由每小时清理删除，会话归档成功后其抓包会立即删除；其它会话独立处理。打开目录与清空功能始终保留。',
      'header.spaceUninstallNote': '卸载插件不会删除该目录。',
      'header.notPersisted': '未持久化',
      'header.openFolder': '打开目录',
      'header.openFolderTitle': '打开记录保存目录，并尽量选中本会话的 .jsonl 日志（索引 .jsonl.idx 与它同目录；文件管理器需支持；卸载插件不会自动删除该目录数据）',
      'header.opening': '正在打开…',
      'header.opened': '已打开',
      'error.reveal': '打开数据目录失败：{message}',
      'error.export': '导出 HAR 失败：{message}',
      'error.clear': '清空失败：{message}',
      'error.clearAll': '清空全部抓包失败：{message}',
    }

    // ---------------------------------------------------------------------
    // 样式。仅使用文档列出的 --dsw-alias-* 主题令牌；面板在
    // 狭窄的右侧边栏中也可自适应（任何地方都不使用固定宽度）。
    // ---------------------------------------------------------------------
    const CSS = [
      '.shl-root{display:flex;flex-direction:column;flex:1 1 auto;min-width:0;min-height:0;height:100%;box-sizing:border-box;overflow:hidden;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.45}',
      '.shl-root *,.shl-root *::before,.shl-root *::after{box-sizing:border-box}',
      '.shl-header{display:flex;flex-direction:column;gap:6px;padding:8px 10px 7px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);min-width:0}',
      '.shl-title-row{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}',
      '.shl-title-actions{margin-left:auto;display:flex;align-items:center;gap:6px;flex:0 0 auto}',
      '.shl-global-clear{color:var(--dsw-alias-label-secondary);border-color:transparent;background:transparent;padding:1px 6px;font-size:11px}',
      '.shl-global-clear:hover{color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-overlay)}',
      '.shl-global-clear:focus-visible{outline:2px solid var(--dsw-alias-state-error-primary);outline-offset:1px}',
      '.shl-title{flex:0 1 auto;min-width:0;font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.shl-count{flex:0 0 auto;color:var(--dsw-alias-label-secondary);font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.shl-toolbar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0}',
      '.shl-check{display:inline-flex;align-items:center;gap:4px;color:var(--dsw-alias-label-secondary);font-size:12px;white-space:nowrap;cursor:pointer;user-select:none}',
      '.shl-check input{margin:0;accent-color:var(--dsw-alias-brand-primary)}',
      '.shl-lang{margin-left:auto;flex:0 0 auto;appearance:none;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:1.6;padding:0 8px;cursor:pointer;white-space:nowrap}',
      '.shl-lang:hover{background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary)}',
      '.shl-lang:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.shl-lang[aria-pressed="true"]{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}',
      '.shl-btn{appearance:none;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);padding:2px 8px;font:inherit;font-size:12px;line-height:1.6;white-space:nowrap;cursor:pointer}',
      '.shl-btn:hover{background:var(--dsw-alias-bg-overlay)}',
      '.shl-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.shl-btn:disabled{opacity:.55;cursor:default}',
      '.shl-btn-ghost{border-color:transparent;background:transparent;color:var(--dsw-alias-label-secondary);padding:1px 6px}',
      '.shl-btn-ghost:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}',
      '.shl-btn-danger{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}',
      '.shl-btn-danger:hover{background:var(--dsw-alias-bg-overlay)}',
      '.shl-retention{font-size:12px;font-weight:700;line-height:1.45;color:var(--dsw-alias-state-warn-primary);overflow-wrap:anywhere;padding:0 1px}',
      '.shl-filter{width:100%;min-width:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:3px 8px;font:inherit;font-size:12px}',
      '.shl-filter::placeholder{color:var(--dsw-alias-label-secondary)}',
      '.shl-filter:focus{outline:none;border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary)}',
      '.shl-banner{display:flex;align-items:flex-start;gap:8px;padding:5px 8px;border-radius:6px;font-size:12px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);min-width:0}',
      '.shl-banner-text{flex:1 1 auto;min-width:0;overflow-wrap:anywhere}',
      '.shl-banner-error{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}',
      '.shl-list{flex:1 1 0;min-height:96px;overflow:auto;overscroll-behavior:contain;min-width:0;background:var(--dsw-alias-bg-base)}',
      '.shl-row{display:flex;flex-wrap:wrap;align-items:center;gap:3px 8px;width:100%;min-width:0;padding:5px 10px;border:0;border-bottom:1px solid var(--dsw-alias-border-l1);border-left:3px solid transparent;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;transition:background-color .12s ease}',
      '.shl-row:hover{background:var(--dsw-alias-bg-layer-1)}',
      '.shl-row:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}',
      '.shl-row[data-selected="true"]{background:var(--dsw-alias-bg-overlay);border-left-color:var(--dsw-alias-brand-primary);box-shadow:inset 0 0 0 1px var(--dsw-alias-brand-primary)}',
      '@keyframes shl-flash{0%{box-shadow:inset 0 0 0 2px var(--dsw-alias-brand-primary)}100%{box-shadow:inset 0 0 0 2px transparent}}',
      '.shl-row-flash{animation:shl-flash 600ms ease-out}',
      '.shl-row-main{display:flex;align-items:center;gap:6px;flex:1 1 140px;min-width:0}',
      '.shl-row-meta{display:flex;align-items:center;gap:8px;flex:0 0 auto;color:var(--dsw-alias-label-secondary);font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.shl-path{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}',
      '.shl-chip{display:inline-flex;align-items:center;border-radius:4px;padding:0 5px;border:1px solid transparent;font-size:11px;font-weight:600;line-height:1.6;white-space:nowrap;font-variant-numeric:tabular-nums}',
      '.shl-chip-method{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);border-color:var(--dsw-alias-border-l1);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.03em}',
      '.shl-chip-status{background:transparent}',
      '.shl-chip-tone-2{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}',
      '.shl-chip-tone-3{color:var(--dsw-alias-state-idle-primary);border-color:var(--dsw-alias-state-idle-primary)}',
      '.shl-chip-tone-4{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}',
      '.shl-chip-tone-5{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}',
      '.shl-chip-tone-error{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}',
      '.shl-chip-tone-pending{color:var(--dsw-alias-state-idle-primary);border-color:var(--dsw-alias-border-l2);border-style:dashed}',
      '.shl-chip-tone-idle{color:var(--dsw-alias-label-secondary);border-color:var(--dsw-alias-border-l2)}',
      '.shl-chevron{flex:0 0 auto;color:var(--dsw-alias-label-secondary);transition:transform .15s ease}',
      '.shl-chevron-open{transform:rotate(90deg)}',
      '.shl-row:hover .shl-chevron,.shl-section-toggle:hover .shl-chevron{color:var(--dsw-alias-label-primary)}',
      '.shl-row[data-selected="true"] .shl-path{color:var(--dsw-alias-label-primary);font-weight:600}',
      '.shl-row[data-selected="true"] .shl-chevron{color:var(--dsw-alias-brand-primary)}',
      '.shl-space{flex:0 0 auto;color:var(--dsw-alias-label-secondary);font-size:12px;white-space:nowrap;font-variant-numeric:tabular-nums}',
      '.shl-all-size{flex:0 0 auto;color:var(--dsw-alias-label-secondary);font-size:11px;white-space:nowrap;font-variant-numeric:tabular-nums}',
      '.shl-section-toggle{display:inline-flex;align-items:center;gap:5px;min-width:0;padding:0;border:0;border-radius:4px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}',
      '.shl-section-toggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      '.shl-section-body{display:flex;flex-direction:column;gap:4px;min-width:0}',
      '@media (prefers-reduced-motion: reduce){.shl-chevron{transition:none}.shl-row{transition:none}.shl-row-flash{animation:none}}',
      '.shl-split{display:flex;flex-direction:column;flex:1 1 0;min-height:0;min-width:0}',
      '.shl-page{height:100%;min-height:0}',
      '.shl-page .shl-split{flex-direction:row}',
      '.shl-page .shl-list{flex:0 0 clamp(260px,38%,520px);min-height:0;border-right:1px solid var(--dsw-alias-border-l1)}',
      '.shl-page .shl-detail{flex:1 1 0;border-top:0;border-left:2px solid var(--dsw-alias-border-l2)}',
      '.shl-detail{flex:1.25 1 0;min-height:0;min-width:0;overflow:auto;overscroll-behavior:contain;border-top:2px solid var(--dsw-alias-border-l2);padding:8px 10px 16px;display:flex;flex-direction:column;gap:12px;background:var(--dsw-alias-bg-layer-1)}',
      '.shl-detail-toolbar{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0;margin:-8px -10px 0;padding:6px 10px;background:var(--dsw-alias-bg-layer-1);border-bottom:1px solid var(--dsw-alias-border-l2);box-shadow:0 4px 8px -6px var(--dsw-alias-border-l2)}',
      '.shl-detail-ident{display:flex;align-items:center;gap:6px;flex:1 1 160px;min-width:0}',
      '.shl-detail-path{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;color:var(--dsw-alias-label-primary)}',
      '.shl-locate{flex:0 0 auto}',
      '.shl-section{display:flex;flex-direction:column;gap:4px;min-width:0}',
      '.shl-section-head{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0}',
      '.shl-section-title{flex:0 0 auto;font-weight:600;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}',
      '.shl-section-tools{display:flex;align-items:center;gap:2px;flex:0 0 auto;margin-left:auto;flex-wrap:wrap;justify-content:flex-end}',
      '.shl-overview{display:grid;grid-template-columns:auto minmax(0,1fr);gap:2px 10px;font-size:12px;min-width:0}',
      '.shl-ov-label{color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.shl-ov-value{min-width:0;overflow-wrap:anywhere}',
      '.shl-ov-inline{display:flex;align-items:flex-start;gap:6px;min-width:0}',
      '.shl-ov-inline .shl-mono{flex:1 1 auto;min-width:0;overflow-wrap:anywhere}',
      '.shl-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}',
      '.shl-kv-wrap{max-height:180px;overflow:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-base)}',
      '.shl-kv{width:100%;border-collapse:collapse;table-layout:fixed;font-size:11.5px}',
      '.shl-kv td{padding:2px 6px;border-bottom:1px solid var(--dsw-alias-border-l1);vertical-align:top;overflow-wrap:anywhere;word-break:break-word}',
      '.shl-kv tr:last-child td{border-bottom:0}',
      '.shl-kv td:first-child{width:38%;color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}',
      '.shl-kv td:last-child{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}',
      '.shl-pre{margin:0;padding:8px;max-height:260px;overflow:auto;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}',
      '.shl-muted{color:var(--dsw-alias-label-secondary);font-size:12px}',
      '.shl-badge{display:inline-flex;align-items:center;border-radius:4px;padding:0 5px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);font-size:10.5px;line-height:1.7;white-space:nowrap}',
      '.shl-badge-warn{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}',
      '.shl-error-line{color:var(--dsw-alias-state-error-primary);font-size:12px;overflow-wrap:anywhere}',
      '.shl-state{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:22px 12px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:12px;min-width:0}',
      '.shl-state-error{color:var(--dsw-alias-state-error-primary)}',
      '.shl-spinner{width:14px;height:14px;border-radius:50%;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);animation:shl-spin .8s linear infinite}',
      '@keyframes shl-spin{to{transform:rotate(360deg)}}',
      '@media (prefers-reduced-motion: reduce){.shl-spinner{animation-duration:2.4s}}',
    ].join('\n')

    // ---------------------------------------------------------------------
    // 纯辅助函数（事件处理器之外不访问 DOM）。
    // ---------------------------------------------------------------------
    function pad2(value) {
      return value < 10 ? '0' + String(value) : String(value)
    }

    function formatClock(ms) {
      if (typeof ms !== 'number' || !isFinite(ms)) return '—'
      const date = new Date(ms)
      if (isNaN(date.getTime())) return '—'
      return pad2(date.getHours()) + ':' + pad2(date.getMinutes()) + ':' + pad2(date.getSeconds())
    }

    function formatDateTime(ms) {
      if (typeof ms !== 'number' || !isFinite(ms)) return '—'
      const date = new Date(ms)
      if (isNaN(date.getTime())) return '—'
      return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()) + ' ' + formatClock(ms)
    }

    function formatDuration(ms) {
      if (typeof ms !== 'number' || !isFinite(ms)) return '—'
      if (ms < 1000) return String(Math.round(ms)) + ' ms'
      return (ms / 1000).toFixed(2) + ' s'
    }

    function formatBytes(bytes) {
      if (typeof bytes !== 'number' || !isFinite(bytes) || bytes < 0) return '—'
      if (bytes < 1024) return String(bytes) + ' B'
      const kb = bytes / 1024
      if (kb < 1024) return kb.toFixed(kb < 10 ? 1 : 0) + ' KB'
      return (kb / 1024).toFixed(1) + ' MB'
    }

    /** 把毫秒保留时长格式化为 UI 使用的整小时数。 */
    function formatRetentionHours(ms) {
      if (typeof ms !== 'number' || !isFinite(ms) || ms <= 0) return '24'
      return String(Math.max(1, Math.round(ms / (60 * 60 * 1000))))
    }

    /** URL 末尾的路径片段，用于紧凑的列表行。 */
    function shortPath(url) {
      if (typeof url !== 'string' || url.length === 0) return '—'
      try {
        const base = typeof window !== 'undefined' && window.location ? window.location.href : 'http://localhost/'
        const parsed = new URL(url, base)
        const segments = parsed.pathname.split('/').filter(Boolean)
        const tail = segments.slice(-2).join('/')
        const suffix = parsed.search ? '?…' : ''
        return tail ? '/' + tail + suffix : parsed.pathname || '/'
      } catch (error) {
        return url.length > 60 ? url.slice(0, 57) + '…' : url
      }
    }

    function statusTone(status) {
      if (status == null) return 'pending'
      if (status >= 500) return '5'
      if (status >= 400) return '4'
      if (status >= 300) return '3'
      if (status >= 200) return '2'
      return 'idle'
    }

    function statusChipClass(tone) {
      return 'shl-chip shl-chip-status shl-chip-tone-' + tone
    }

    function isPending(record) {
      return record != null && record.status == null && record.error == null
    }

    function statusLabelOf(record, t) {
      if (record == null) return '—'
      if (record.status != null) {
        return record.statusText ? String(record.status) + ' ' + record.statusText : String(record.status)
      }
      return record.error != null ? t('row.error') : t('row.pending')
    }

    function errorMessage(error) {
      if (error == null) return 'unknown error'
      if (typeof error === 'string') return error
      if (typeof error.message === 'string' && error.message.length > 0) return error.message
      return String(error)
    }

    function isAbortError(error) {
      return error != null && (error.name === 'AbortError' || error.code === 20)
    }

    function mimeEssence(mimeType) {
      if (typeof mimeType !== 'string') return ''
      const essence = mimeType.split(';')[0].trim()
      return essence
    }

    function headersToText(headers) {
      const list = Array.isArray(headers) ? headers : []
      return list.map((pair) => String(pair[0]) + ': ' + String(pair[1])).join('\n')
    }

    function looksJson(text, mimeType) {
      if (typeof text !== 'string' || text.length === 0) return false
      const mime = typeof mimeType === 'string' ? mimeType.toLowerCase() : ''
      if (mime.indexOf('json') !== -1) return true
      const first = text.trimStart().charAt(0)
      return first === '{' || first === '['
    }

    function tryPrettyJson(text) {
      if (typeof text !== 'string' || text.length > MAX_PRETTY_CHARS) return null
      try {
        return JSON.stringify(JSON.parse(text), null, 2)
      } catch (error) {
        return null
      }
    }

    function shellQuote(value) {
      return "'" + String(value == null ? '' : value).replace(/'/g, "'\\''") + "'"
    }

    /** 将捕获的请求还原为可执行的 cURL 命令。 */
    function buildCurl(record) {
      if (record == null) return ''
      const lines = ['curl ' + shellQuote(record.url)]
      if (typeof record.method === 'string' && record.method.length > 0) lines.push('  -X ' + record.method)
      const headers = Array.isArray(record.requestHeaders) ? record.requestHeaders : []
      for (const pair of headers) {
        if (!Array.isArray(pair)) continue
        const name = String(pair[0] == null ? '' : pair[0])
        if (name === '') continue
        if (/^(host|content-length|connection)$/i.test(name)) continue
        lines.push('  -H ' + shellQuote(name + ': ' + String(pair[1] == null ? '' : pair[1])))
      }
      if (typeof record.requestBody === 'string') {
        if (record.requestBodyEncoding === 'base64') {
          lines.push('  --data-binary ' + shellQuote('[base64] ' + record.requestBody))
        } else {
          lines.push('  --data-binary ' + shellQuote(record.requestBody))
        }
      }
      return lines.join(' \\\n')
    }

    async function writeClipboard(text) {
      const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined
      if (clipboard == null || typeof clipboard.writeText !== 'function') throw new Error('Clipboard API unavailable')
      await clipboard.writeText(String(text == null ? '' : text))
    }

    /** 读取已保存的面板语言覆盖；无效或存储不可用时返回 null。 */
    function readStoredLang() {
      try {
        const value = typeof localStorage !== 'undefined' ? localStorage.getItem(LANG_STORAGE_KEY) : null
        return value === 'zh' || value === 'en' ? value : null
      } catch (error) {
        return null
      }
    }

    /** 持久化面板语言覆盖；存储不可用时静默忽略（本次切换仍然生效）。 */
    function writeStoredLang(lang) {
      try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(LANG_STORAGE_KEY, lang)
      } catch (error) {
        // 忽略：localStorage 可能被禁用或已满
      }
    }

    /** 应用当前语言（zh* → zh，其余 → en）；读取失败时回退到 en。 */
    function appLocaleLang(ctx) {
      try {
        const snapshot = typeof ctx.locale.getLocale === 'function' ? ctx.locale.getLocale() : undefined
        const active = snapshot != null && typeof snapshot.active === 'string' ? snapshot.active : ''
        return active.toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en'
      } catch (error) {
        return 'en'
      }
    }

    /** 用本地字典翻译一个键，保持与 locale.translate 一致的 `{name}` 插值行为。 */
    function localTranslate(lang, key, params) {
      const dict = lang === 'zh' ? zh : en
      let template = dict[key]
      if (template == null) template = en[key]
      if (template == null) template = key
      if (!params) return template
      return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
    }

    /**
     * 解析 slot 注入参数：真实运行时传入 sessionId 字符串；
     * 也兼容传入 `{ sessionId }` 绑定对象的调用方式（防御性）。
     */
    function injectedSessionId(value) {
      if (typeof value === 'string') return value
      if (value != null && typeof value === 'object' && typeof value.sessionId === 'string') return value.sessionId
      return ''
    }

    /** 构造绑定到指定语言的本地翻译函数。 */
    function makeLocalT(lang) {
      return function localT(key, params) {
        return localTranslate(lang, key, params)
      }
    }

    // ---------------------------------------------------------------------
    // Host 路由访问。URL 均为文档相对：挂载路径属于
    // shell，因此绝不手工拼接。
    // ---------------------------------------------------------------------
    function recordsUrl(sessionId) {
      const query = new URLSearchParams()
      query.set('sessionId', sessionId)
      query.set('limit', String(LIST_LIMIT))
      return ROUTE + '/records?' + query.toString()
    }

    function recordUrl(sessionId, id, part) {
      const query = new URLSearchParams()
      query.set('sessionId', sessionId)
      query.set('id', String(id))
      if (typeof part === 'string' && part !== '') query.set('part', part)
      return ROUTE + '/record?' + query.toString()
    }

    function harUrl(sessionId) {
      const query = new URLSearchParams()
      query.set('sessionId', sessionId)
      return ROUTE + '/har?' + query.toString()
    }

    async function readJsonResponse(response) {
      const text = await response.text()
      let payload = null
      if (text) {
        try {
          payload = JSON.parse(text)
        } catch (error) {
          payload = null
        }
      }
      if (!response.ok) {
        const message = payload != null && typeof payload.error === 'string' ? payload.error : 'HTTP ' + String(response.status)
        throw new Error(message)
      }
      if (payload == null || typeof payload !== 'object') throw new Error('Malformed server response')
      return payload
    }

    async function fetchRecords(sessionId, signal, etag) {
      const headers = { accept: 'application/json' }
      if (typeof etag === 'string' && etag !== '') headers['if-none-match'] = etag
      const response = await fetch(recordsUrl(sessionId), {
        method: 'GET',
        credentials: 'same-origin',
        headers,
        signal,
      })
      if (response.status === 304) return null
      const payload = await readJsonResponse(response)
      return {
        etag: typeof response.headers.get('etag') === 'string' ? response.headers.get('etag') : '',
        records: Array.isArray(payload.records) ? payload.records : [],
        total: typeof payload.total === 'number' ? payload.total : 0,
        totalBytes: typeof payload.totalBytes === 'number' && isFinite(payload.totalBytes) ? payload.totalBytes : 0,
        fileBytes: typeof payload.fileBytes === 'number' && isFinite(payload.fileBytes) ? payload.fileBytes : null,
        dir: typeof payload.dir === 'string' ? payload.dir : '',
        persist: payload.persist === true,
        maxLogFileBytes: typeof payload.maxLogFileBytes === 'number' && isFinite(payload.maxLogFileBytes) && payload.maxLogFileBytes > 0
          ? payload.maxLogFileBytes
          : 0,
        retentionMs: typeof payload.retentionMs === 'number' && isFinite(payload.retentionMs) && payload.retentionMs > 0
          ? payload.retentionMs
          : 60 * 60 * 1000,
      }
    }

    async function fetchUsage(signal) {
      const response = await fetch(ROUTE + '/usage', {
        method: 'GET',
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
        signal,
      })
      const payload = await readJsonResponse(response)
      return {
        bytes: typeof payload.bytes === 'number' && isFinite(payload.bytes) && payload.bytes > 0 ? payload.bytes : 0,
        files: typeof payload.files === 'number' && isFinite(payload.files) && payload.files > 0 ? payload.files : 0,
        sessions: typeof payload.sessions === 'number' && isFinite(payload.sessions) && payload.sessions > 0 ? payload.sessions : 0,
        dir: typeof payload.dir === 'string' ? payload.dir : '',
        persist: payload.persist === true,
        maxTotalBytes: typeof payload.maxTotalBytes === 'number' && isFinite(payload.maxTotalBytes) && payload.maxTotalBytes > 0
          ? payload.maxTotalBytes
          : 0,
      }
    }

    async function fetchRecord(sessionId, id, signal, part = 'meta') {
      const response = await fetch(recordUrl(sessionId, id, part), {
        method: 'GET',
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
        signal,
      })
      const payload = await readJsonResponse(response)
      if (payload.record == null || typeof payload.record !== 'object') throw new Error('Malformed record response')
      return payload.record
    }

    async function fetchRecordBody(sessionId, id, side, signal) {
      const part = side === 'request' ? 'requestBody' : 'responseBody'
      const response = await fetch(recordUrl(sessionId, id, part), {
        method: 'GET',
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
        signal,
      })
      const payload = await readJsonResponse(response)
      if (payload.part == null || typeof payload.part !== 'object') throw new Error('Malformed record body response')
      return payload.part
    }

    async function postClear(sessionId, signal) {
      const response = await fetch(ROUTE + '/clear', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId }),
        signal,
      })
      return readJsonResponse(response)
    }

    async function postClearAll(signal) {
      const response = await fetch(ROUTE + '/clear-all', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
        signal,
      })
      return readJsonResponse(response)
    }

    // ---------------------------------------------------------------------
    // 小型展示组件。
    // ---------------------------------------------------------------------
    function Spinner() {
      return h('span', { className: 'shl-spinner', 'aria-hidden': 'true' })
    }

    function Badge(props) {
      return h('span', { className: 'shl-badge' + (props.warn === true ? ' shl-badge-warn' : ''), title: props.title }, props.children)
    }

    /** 带短暂本地化反馈的复制到剪贴板按钮。 */
    function CopyButton(props) {
      const t = props.t
      const [state, setState] = React.useState('idle')
      const timerRef = React.useRef(null)

      React.useEffect(() => () => {
        if (timerRef.current != null) window.clearTimeout(timerRef.current)
      }, [])

      const onClick = async () => {
        let text = ''
        try {
          text = typeof props.getText === 'function' ? props.getText() : String(props.getText == null ? '' : props.getText)
        } catch (error) {
          text = ''
        }
        let next = 'copied'
        try {
          await writeClipboard(text)
        } catch (error) {
          next = 'failed'
        }
        setState(next)
        if (timerRef.current != null) window.clearTimeout(timerRef.current)
        timerRef.current = window.setTimeout(() => setState('idle'), COPY_FEEDBACK_MS)
      }

      const label = state === 'copied' ? t('action.copied') : state === 'failed' ? t('action.copyFailed') : props.label
      return h('button', {
        type: 'button',
        className: 'shl-btn shl-btn-ghost',
        title: props.label,
        'aria-live': 'polite',
        onClick,
      }, label)
    }

    /** 表示可展开状态的箭头；展开时旋转。 */
    function Chevron(props) {
      return h('svg', {
        className: 'shl-chevron' + (props.expanded === true ? ' shl-chevron-open' : ''),
        viewBox: '0 0 12 12',
        width: '12',
        height: '12',
        'aria-hidden': 'true',
        focusable: 'false',
      }, h('path', {
        d: 'M4.5 2.5 8 6l-3.5 3.5',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: '1.4',
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }))
    }

    /** 头部可切换正文的详情区块；可通过 defaultExpanded 控制初始状态。 */
    function DetailSection(props) {
      const t = props.t
      const [expanded, setExpanded] = React.useState(props.defaultExpanded !== false)
      const action = expanded ? t('section.collapse') : t('section.expand')
      const tools = props.tools
      const hasTools = tools != null && (!Array.isArray(tools) || tools.length > 0)
      return h('section', { className: 'shl-section' },
        h('div', { className: 'shl-section-head' },
          h('button', {
            type: 'button',
            className: 'shl-section-toggle',
            'aria-expanded': expanded,
            'aria-label': action + ': ' + props.title,
            title: action,
            onClick: () => setExpanded((value) => !value),
          },
            h(Chevron, { expanded }),
            h('span', { className: 'shl-section-title' }, props.title),
            props.badges),
          hasTools ? h('div', { className: 'shl-section-tools' }, tools) : null),
        expanded ? h('div', { className: 'shl-section-body' }, props.children) : null)
    }

    function HeadersSection(props) {
      const t = props.t
      const headers = Array.isArray(props.headers) ? props.headers : []
      const tools = []
      if (props.tools != null) tools.push(props.tools)
      if (headers.length > 0) {
        tools.push(h(CopyButton, { key: 'copy-headers', getText: () => headersToText(headers), label: t('action.copyHeaders'), t }))
      }
      return h(DetailSection, { title: props.title, t, tools, defaultExpanded: props.defaultExpanded === true },
        headers.length === 0
          ? h('div', { className: 'shl-muted' }, t('detail.noHeaders'))
          : h('div', { className: 'shl-kv-wrap' },
            h('table', { className: 'shl-kv' },
              h('tbody', null, headers.map((pair, index) => h('tr', { key: index },
                h('td', null, String(pair[0])),
                h('td', null, String(pair[1]))))))))
    }

    /** 展开后才挂载的 body 内容；挂载时按需请求，避免详情首屏携带大报文。 */
    function BodyContent(props) {
      const t = props.t
      const [error, setError] = React.useState(null)
      const [loading, setLoading] = React.useState(false)
      const [nonce, setNonce] = React.useState(0)
      const loadRef = React.useRef(props.loadBody)
      loadRef.current = props.loadBody

      React.useEffect(() => {
        if (props.part != null || typeof props.body === 'string' || typeof loadRef.current !== 'function') return undefined
        const controller = new AbortController()
        let cancelled = false
        setLoading(true)
        setError(null)
        Promise.resolve(loadRef.current(controller.signal)).then(
          (part) => {
            if (cancelled) return
            props.onLoaded(part)
            setLoading(false)
          },
          (caught) => {
            if (cancelled || isAbortError(caught)) return
            setError(errorMessage(caught))
            setLoading(false)
          },
        )
        return () => {
          cancelled = true
          controller.abort()
        }
      }, [props.recordId, props.side, props.version, nonce])

      const text = typeof props.body === 'string'
        ? props.body
        : (props.part != null && typeof props.part.body === 'string' ? props.part.body : null)
      if (loading) {
        return h('div', { className: 'shl-state' }, h(Spinner, null), h('span', null, t('detail.bodyLoading')))
      }
      if (error != null) {
        return h('div', { className: 'shl-state shl-state-error' },
          h('span', null, t('detail.bodyError', { message: error })),
          h('button', { type: 'button', className: 'shl-btn', onClick: () => setNonce((value) => value + 1) }, t('list.retry')))
      }
      if (props.part != null && typeof props.part.body !== 'string') {
        return h('div', { className: 'shl-muted' }, t('detail.noBody'))
      }
      if (text == null && props.part == null) {
        return h('div', { className: 'shl-state' }, h('span', null, t('detail.bodyLoading')))
      }
      return null
    }

    /** 单条捕获的报文：默认折叠，展开后才按需加载 body。 */
    function BodySection(props) {
      const t = props.t
      const [pretty, setPretty] = React.useState(false)
      const [part, setPart] = React.useState(null)
      const staticBody = typeof props.body === 'string' ? props.body : null
      const text = staticBody != null ? staticBody : (part != null && typeof part.body === 'string' ? part.body : null)
      const encoding = part != null && typeof part.encoding === 'string' ? part.encoding : props.encoding
      const truncated = part != null ? part.truncated === true : props.truncated === true
      const mimeType = part != null && typeof part.mimeType === 'string' ? part.mimeType : props.mimeType
      const isBase64 = encoding === 'base64'

      React.useEffect(() => {
        setPretty(false)
        setPart(null)
      }, [props.recordId, props.side, props.version])

      const prettyText = React.useMemo(() => {
        if (isBase64 || text == null) return null
        if (!looksJson(text, mimeType)) return null
        return tryPrettyJson(text)
      }, [isBase64, text, mimeType])

      const shown = pretty && prettyText != null ? prettyText : text
      const mime = mimeEssence(mimeType)
      const badges = []
      if (truncated === true) badges.push(h(Badge, { key: 'truncated', warn: true }, t('badge.truncated')))
      if (isBase64) badges.push(h(Badge, { key: 'base64' }, t('badge.base64')))
      if (mime !== '') badges.push(h(Badge, { key: 'mime', title: mimeType }, mime))
      const tools = []
      if (prettyText != null) {
        tools.push(h('button', {
          key: 'toggle',
          type: 'button',
          className: 'shl-btn shl-btn-ghost',
          'aria-pressed': pretty,
          onClick: () => setPretty((value) => !value),
        }, pretty ? t('detail.raw') : t('detail.pretty')))
      }
      if (text != null) tools.push(h(CopyButton, { key: 'copy-body', getText: () => text, label: t('action.copyBody'), t }))
      return h(DetailSection, { title: props.title, t, badges, tools, defaultExpanded: false },
        h(BodyContent, {
          body: staticBody,
          part,
          recordId: props.recordId,
          side: props.side,
          version: props.version,
          loadBody: props.loadBody,
          onLoaded: setPart,
          t,
        }),
        text != null && shown != null
          ? h('pre', { key: 'body', className: 'shl-pre' }, shown)
          : null,
        isBase64 ? h('div', { key: 'note', className: 'shl-muted' }, t('detail.base64Note')) : null)
    }

    /** 请求列表的一行。最新在前的顺序由列表所有者决定。 */
    function RecordRow(props) {
      const t = props.t
      const record = props.record
      const selected = props.selected === true
      const tone = record.error != null && record.status == null ? 'error' : statusTone(record.status)
      const pending = isPending(record)
      const requestSize = formatBytes(record.requestBytes)
      const responseSize = formatBytes(record.responseBytes)
      const sizeText = pending && (Number(record.requestBytes) || 0) === 0
        ? '—'
        : t('row.sizePair', {
          request: requestSize,
          response: pending ? '—' : responseSize,
        })
      const modelLine = typeof record.model === 'string' && record.model.length > 0
        ? '\n' + t('detail.model') + ': ' + record.model
        : ''
      const errorLine = typeof record.error === 'string' && record.error.length > 0
        ? '\n' + t('detail.errorLine') + ': ' + record.error
        : ''
      const tooltip = (typeof record.url === 'string' && record.url.length > 0 ? record.url : String(record.method || '')) + modelLine + errorLine
      return h('button', {
        type: 'button',
        className: 'shl-row' + (props.flashing === true ? ' shl-row-flash' : ''),
        ref: (element) => props.setRowRef(record.id, element),
        'data-selected': selected ? 'true' : 'false',
        'data-record-id': String(record.id),
        'aria-pressed': selected,
        'aria-expanded': selected,
        'aria-label': selected ? t('row.collapse') : t('row.expand'),
        title: tooltip,
        onClick: () => props.onSelect(record.id),
      },
        h(Chevron, { expanded: selected }),
        h('span', { className: 'shl-row-main' },
          h('span', { className: 'shl-chip shl-chip-method' }, typeof record.method === 'string' ? record.method : '—'),
          h('span', { className: 'shl-path', title: typeof record.url === 'string' ? record.url : '' }, shortPath(record.url)),
          h('span', { className: statusChipClass(tone) }, statusLabelOf(record, t))),
        h('span', { className: 'shl-row-meta' },
          h('span', { title: t('detail.duration') }, formatDuration(record.durationMs)),
          h('span', { title: t('row.sizeTooltip', { request: requestSize, response: responseSize }) }, sizeText),
          h('span', { title: t('detail.started') }, formatClock(record.startedAt))))
    }

    function OverviewRow(props) {
      return h(React.Fragment, null,
        h('div', { className: 'shl-ov-label' }, props.label),
        h('div', { className: 'shl-ov-value' }, props.children))
    }

    /** 选中记录的完整详情。 */
    function RecordDetail(props) {
      const t = props.t
      const record = props.record
      const sessionId = typeof props.sessionId === 'string' ? props.sessionId : ''

      if (record == null) {
        if (props.error != null) {
          return h('div', { className: 'shl-state shl-state-error' },
            h('span', null, t('detail.error', { message: props.error })),
            h('button', { type: 'button', className: 'shl-btn', onClick: props.onRetry }, t('list.retry')))
        }
        if (props.loading) {
          return h('div', { className: 'shl-state' }, h(Spinner, null), h('span', null, t('detail.loading')))
        }
        return h('div', { className: 'shl-state' }, h('span', null, t('detail.selectHint')))
      }

      const tone = record.error != null && record.status == null ? 'error' : statusTone(record.status)
      const pending = isPending(record)
      const statusText = statusLabelOf(record, t)
      const requestSize = formatBytes(record.requestBytes)
      const responseSize = formatBytes(record.responseBytes)
      const totalSize = formatBytes((Number(record.requestBytes) || 0) + (Number(record.responseBytes) || 0))
      const recordVersion = [
        record.id,
        record.status,
        record.completedAt,
        record.requestBytes,
        record.responseBytes,
      ].join(':')

      return h(React.Fragment, null,
        props.error != null
          ? h('div', { className: 'shl-banner shl-banner-error' },
            h('span', { className: 'shl-banner-text' }, t('detail.error', { message: props.error })),
            h('button', { type: 'button', className: 'shl-btn shl-btn-ghost', onClick: props.onRetry }, t('list.retry')))
          : null,
        h(DetailSection, { title: t('detail.overview'), t },
          h('div', { className: 'shl-overview' },
            h(OverviewRow, { key: 'method', label: t('detail.method') },
              h('span', { className: 'shl-chip shl-chip-method' }, typeof record.method === 'string' ? record.method : '—')),
            h(OverviewRow, { key: 'status', label: t('detail.status') },
              h('span', { className: 'shl-ov-inline' },
                h('span', { className: statusChipClass(tone) }, statusText),
                pending ? h(Badge, null, t('detail.pending')) : null)),
            h(OverviewRow, { key: 'url', label: t('detail.url') },
              h('span', { className: 'shl-ov-inline' },
                h('span', { className: 'shl-mono' }, typeof record.url === 'string' ? record.url : '—'),
                h(CopyButton, { getText: () => (typeof record.url === 'string' ? record.url : ''), label: t('action.copyUrl'), t }))),
            h(OverviewRow, { key: 'duration', label: t('detail.duration') }, formatDuration(record.durationMs)),
            h(OverviewRow, { key: 'started', label: t('detail.started') }, formatDateTime(record.startedAt)),
            h(OverviewRow, { key: 'kind', label: t('detail.kind') }, typeof record.kind === 'string' && record.kind !== '' ? record.kind : '—'),
            typeof record.model === 'string' && record.model !== ''
              ? h(OverviewRow, { key: 'model', label: t('detail.model') }, record.model)
              : null,
            h(OverviewRow, { key: 'requestSize', label: t('detail.requestSize') }, requestSize),
            h(OverviewRow, { key: 'responseSize', label: t('detail.responseSize') }, responseSize),
            h(OverviewRow, { key: 'totalSize', label: t('detail.totalSize') }, totalSize),
            mimeEssence(record.responseMimeType) !== ''
              ? h(OverviewRow, { key: 'contentType', label: t('detail.contentType') }, mimeEssence(record.responseMimeType))
              : null)),
        record.error != null
          ? h('section', { className: 'shl-section' },
            h('div', { className: 'shl-section-head' },
              h('span', { className: 'shl-section-title' }, t('detail.errorLine'))),
            h('div', { className: 'shl-error-line' }, String(record.error)))
          : null,
        h(HeadersSection, {
          title: t('detail.requestHeaders'),
          headers: record.requestHeaders,
          t,
          tools: h(CopyButton, { key: 'curl', getText: () => buildCurl(record), label: t('action.copyCurl'), t }),
        }),
        h(BodySection, {
          title: t('detail.requestBody'),
          recordId: record.id,
          side: 'request',
          version: recordVersion,
          body: typeof record.requestBody === 'string' ? record.requestBody : null,
          encoding: record.requestBodyEncoding,
          truncated: record.requestTruncated === true,
          mimeType: Array.isArray(record.requestHeaders) ? headerValue(record.requestHeaders, 'content-type') : '',
          loadBody: (signal) => fetchRecordBody(sessionId, record.id, 'request', signal),
          t,
        }),
        h(HeadersSection, {
          title: t('detail.responseHeaders'),
          headers: record.responseHeaders,
          defaultExpanded: false,
          t,
        }),
        h(BodySection, {
          title: t('detail.responseBody'),
          recordId: record.id,
          side: 'response',
          version: recordVersion,
          body: typeof record.responseBody === 'string' ? record.responseBody : null,
          encoding: record.responseBodyEncoding,
          truncated: record.responseTruncated === true,
          mimeType: record.responseMimeType,
          loadBody: (signal) => fetchRecordBody(sessionId, record.id, 'response', signal),
          t,
        }))
    }

    function headerValue(headers, wanted) {
      if (!Array.isArray(headers)) return ''
      const lower = wanted.toLowerCase()
      for (const pair of headers) {
        if (Array.isArray(pair) && String(pair[0]).toLowerCase() === lower) return String(pair[1])
      }
      return ''
    }

    // ---------------------------------------------------------------------
    // 数据 Hook：挂载期间轮询，绝不重叠，卸载/切换时中止。
    // ---------------------------------------------------------------------
    function useFeed(sessionId, autoRefresh, active) {
      const [records, setRecords] = React.useState([])
      const [total, setTotal] = React.useState(0)
      const [totalBytes, setTotalBytes] = React.useState(0)
      const [fileBytes, setFileBytes] = React.useState(null)
      const [dir, setDir] = React.useState('')
      const [persist, setPersist] = React.useState(false)
      const [maxLogFileBytes, setMaxLogFileBytes] = React.useState(0)
      const [retentionMs, setRetentionMs] = React.useState(60 * 60 * 1000)
      const [loading, setLoading] = React.useState(true)
      const [error, setError] = React.useState(null)
      const [nonce, setNonce] = React.useState(0)
      const [usage, setUsage] = React.useState({
        bytes: 0,
        files: 0,
        sessions: 0,
        dir: '',
        persist: false,
        maxTotalBytes: 0,
        loaded: false,
      })
      const etagRef = React.useRef('')
      /** 上次取磁盘总量的时刻；用来把目录扫描限频到 USAGE_POLL_INTERVAL_MS。 */
      const usageAtRef = React.useRef(0)

      React.useEffect(() => {
        etagRef.current = ''
        usageAtRef.current = 0
        if (active !== true) {
          setLoading(false)
          return undefined
        }
        // 没有选中会话时也要取磁盘总量，但不再轮询会话记录。
        const recordsEnabled = sessionId !== ''
        if (recordsEnabled) setLoading(true)
        else setLoading(false)
        const controller = new AbortController()
        let cancelled = false
        let busy = false
        let timer = null
        etagRef.current = ''

        const isHidden = () =>
          typeof document !== 'undefined' && document.visibilityState === 'hidden'
        const stopTimer = () => {
          if (timer != null) {
            window.clearInterval(timer)
            timer = null
          }
        }
        const startTimer = () => {
          if (autoRefresh && timer == null && !isHidden()) timer = window.setInterval(tick, POLL_INTERVAL_MS)
        }

        /**
         * 一拍采样：会话记录与磁盘总量在这里一起取，两个数字才可比。
         * 目录扫描比列表贵，所以限频到 USAGE_POLL_INTERVAL_MS；刷新/清空后
         * 该时刻会归零，下一次 tick 立即重取。
         */
        const tick = async () => {
          if (busy || cancelled || isHidden()) return
          busy = true
          const wantUsage = Date.now() - usageAtRef.current >= USAGE_POLL_INTERVAL_MS
          if (wantUsage) usageAtRef.current = Date.now()
          try {
            const [recordsResult, usageResult] = await Promise.allSettled([
              recordsEnabled
                ? fetchRecords(sessionId, controller.signal, etagRef.current)
                : Promise.resolve(null),
              wantUsage ? fetchUsage(controller.signal) : Promise.resolve(null),
            ])
            if (cancelled) return
            // 磁盘总量仅用于展示：失败或中止都保留上一次结果，不影响列表错误提示。
            if (usageResult.status === 'fulfilled' && usageResult.value !== null) {
              setUsage({ ...usageResult.value, loaded: true })
            }
            if (!recordsEnabled) return
            if (recordsResult.status === 'rejected') throw recordsResult.reason
            const snapshot = recordsResult.value
            if (snapshot === null) return
            etagRef.current = snapshot.etag
            setRecords(snapshot.records)
            setTotal(snapshot.total)
            setTotalBytes(snapshot.totalBytes)
            setFileBytes(snapshot.fileBytes)
            setDir(snapshot.dir)
            setPersist(snapshot.persist)
            setMaxLogFileBytes(snapshot.maxLogFileBytes)
            setRetentionMs(snapshot.retentionMs)
            setError(null)
          } catch (caught) {
            if (cancelled || isAbortError(caught)) return
            setError(errorMessage(caught))
          } finally {
            busy = false
            if (!cancelled && recordsEnabled) setLoading(false)
          }
        }

        const onVisibilityChange = () => {
          if (isHidden()) {
            stopTimer()
          } else {
            void tick()
            startTimer()
          }
        }
        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
          document.addEventListener('visibilitychange', onVisibilityChange)
        }
        void tick()
        startTimer()
        return () => {
          cancelled = true
          stopTimer()
          if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
            document.removeEventListener('visibilitychange', onVisibilityChange)
          }
          controller.abort()
        }
      }, [sessionId, autoRefresh, active, nonce])

      return {
        records,
        total,
        totalBytes,
        fileBytes,
        dir,
        persist,
        maxLogFileBytes,
        retentionMs,
        loading,
        error,
        usage,
        refresh: () => setNonce((value) => value + 1),
      }
    }

    function useDetail(sessionId, recordId, pollWhilePending) {
      const [record, setRecord] = React.useState(null)
      const [loading, setLoading] = React.useState(false)
      const [error, setError] = React.useState(null)
      const [nonce, setNonce] = React.useState(0)
      const loadedIdRef = React.useRef(null)

      React.useEffect(() => {
        if (sessionId === '' || recordId == null) {
          loadedIdRef.current = null
          setRecord(null)
          setLoading(false)
          setError(null)
          return undefined
        }
        if (loadedIdRef.current !== recordId) {
          loadedIdRef.current = recordId
          setRecord(null)
          setLoading(true)
          setError(null)
        }
        const controller = new AbortController()
        let cancelled = false
        let busy = false
        let timer = null

        const isHidden = () =>
          typeof document !== 'undefined' && document.visibilityState === 'hidden'
        const stopTimer = () => {
          if (timer != null) {
            window.clearInterval(timer)
            timer = null
          }
        }
        const startTimer = () => {
          if (pollWhilePending && timer == null && !isHidden()) timer = window.setInterval(tick, POLL_INTERVAL_MS)
        }

        const tick = async () => {
          if (busy || cancelled || isHidden()) return
          busy = true
          try {
            const fetched = await fetchRecord(sessionId, recordId, controller.signal, 'meta')
            if (cancelled) return
            setRecord(fetched)
            setError(null)
          } catch (caught) {
            if (cancelled || isAbortError(caught)) return
            setError(errorMessage(caught))
          } finally {
            busy = false
            if (!cancelled) setLoading(false)
          }
        }

        const onVisibilityChange = () => {
          if (isHidden()) {
            stopTimer()
          } else {
            void tick()
            startTimer()
          }
        }
        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
          document.addEventListener('visibilitychange', onVisibilityChange)
        }
        void tick()
        startTimer()
        return () => {
          cancelled = true
          stopTimer()
          if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
            document.removeEventListener('visibilitychange', onVisibilityChange)
          }
          controller.abort()
        }
      }, [sessionId, recordId, pollWhilePending, nonce])

      return {
        record,
        loading,
        error,
        retry: () => setNonce((value) => value + 1),
      }
    }

    // ---------------------------------------------------------------------
    // 面板主体。
    // ---------------------------------------------------------------------
    function Panel(props) {
      const t = props.t
      const sessionId = props.sessionId
      // 'panel' = 右侧边栏（纵向布局）；'page' = 主区域标签页（横向宽布局）。
      const variant = props.variant === 'page' ? 'page' : 'panel'
      const rootRef = React.useRef(null)
      const [inViewport, setInViewport] = React.useState(true)
      const [documentVisible, setDocumentVisible] = React.useState(
        typeof document === 'undefined' || document.visibilityState !== 'hidden',
      )

      React.useEffect(() => {
        if (typeof IntersectionObserver === 'undefined' || rootRef.current == null) return undefined
        const observer = new IntersectionObserver((entries) => {
          setInViewport(entries.some((entry) => entry.isIntersecting))
        }, { threshold: 0 })
        observer.observe(rootRef.current)
        return () => observer.disconnect()
      }, [])

      React.useEffect(() => {
        if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return undefined
        const update = () => setDocumentVisible(document.visibilityState !== 'hidden')
        document.addEventListener('visibilitychange', update)
        return () => document.removeEventListener('visibilitychange', update)
      }, [])

      const active = inViewport && documentVisible
      const [autoRefresh, setAutoRefresh] = React.useState(true)
      const [filter, setFilter] = React.useState('')
      const [selectedId, setSelectedId] = React.useState(null)
      const [confirmClear, setConfirmClear] = React.useState(false)
      const [confirmClearAll, setConfirmClearAll] = React.useState(false)
      const [clearing, setClearing] = React.useState(false)
      const [clearingAll, setClearingAll] = React.useState(false)
      const [exporting, setExporting] = React.useState(false)
      const [revealing, setRevealing] = React.useState(false)
      const [revealFeedback, setRevealFeedback] = React.useState('idle')
      const [actionError, setActionError] = React.useState(null)
      const revealTimerRef = React.useRef(null)
      const flashTimerRef = React.useRef(null)
      const listRef = React.useRef(null)
      const detailRef = React.useRef(null)
      const rowRefs = React.useRef(null)
      if (rowRefs.current == null) rowRefs.current = new Map()
      const setRowRefRef = React.useRef(null)
      if (setRowRefRef.current == null) {
        // 稳定的行元素登记函数：列表行把自身 DOM 节点按记录 id 登记到 rowRefs。
        setRowRefRef.current = (id, element) => {
          const map = rowRefs.current
          if (map == null) return
          if (element == null) map.delete(id)
          else map.set(id, element)
        }
      }
      const setRowRef = setRowRefRef.current
      const [flashId, setFlashId] = React.useState(null)

      React.useEffect(() => () => {
        if (revealTimerRef.current != null) window.clearTimeout(revealTimerRef.current)
        if (flashTimerRef.current != null) window.clearTimeout(flashTimerRef.current)
      }, [])

      const feed = useFeed(sessionId, autoRefresh, active)
      // 磁盘总量与列表来自同一拍采样，两个数字才可比。
      const usage = feed.usage

      const selectedSummary = React.useMemo(
        () => feed.records.find((record) => record.id === selectedId) || null,
        [feed.records, selectedId],
      )
      const pendingSelected = selectedSummary != null && isPending(selectedSummary)
      const detail = useDetail(sessionId, active ? selectedId : null, pendingSelected && autoRefresh && active)
      const selectedRecord = detail.record != null && detail.record.id === selectedId ? detail.record : null

      // 选中记录变化时：把对应的列表行滚入视野，并让详情区域回到顶部。
      React.useEffect(() => {
        if (selectedId == null) return
        const list = listRef.current
        const row = rowRefs.current == null ? null : rowRefs.current.get(selectedId)
        if (list != null && row != null && typeof row.scrollIntoView === 'function') {
          row.scrollIntoView({ block: 'nearest' })
        }
        if (detailRef.current != null) detailRef.current.scrollTop = 0
      }, [selectedId])

      // 丢弃已消失记录的选中状态（其他 Tab 清空、容量淘汰等）。
      React.useEffect(() => {
        if (selectedId == null || feed.loading) return
        if (!feed.records.some((record) => record.id === selectedId)) setSelectedId(null)
      }, [feed.records, feed.loading, selectedId])

      // 最新在前：Host 按最旧 → 最新返回，展示时反转。
      const filtered = React.useMemo(() => {
        const query = filter.trim().toLowerCase()
        const matched = query === ''
          ? feed.records
          : feed.records.filter((record) => matchesFilter(record, query))
        return matched.slice().reverse()
      }, [feed.records, filter])

      // 页面/标签切换后不再渲染隐藏面板：详情正文组件卸载、请求被 abort，
      // 只保留一个轻量根节点供 IntersectionObserver 检测重新可见。
      if (!active) {
        return h('div', {
          className: variant === 'page' ? 'shl-root shl-page' : 'shl-root',
          ref: rootRef,
          'aria-hidden': 'true',
        })
      }

      const countLabel = filter.trim() !== ''
        ? t('header.filteredCount', { shown: String(filtered.length), total: String(feed.total) })
        : t('header.count', { count: String(feed.total) })

      // 整个 Session 的预计存储大小；Host 未提供时隐藏。
      const memoryText = feed.totalBytes > 0 ? formatBytes(feed.totalBytes) : ''
      const showSpace = memoryText !== ''
      const spaceTooltip = showSpace
        ? t('header.spaceTooltip', {
          memory: memoryText,
          memoryLimit: formatBytes(feed.maxTurnBytes),
          disk: feed.fileBytes != null ? formatBytes(feed.fileBytes) : t('header.notPersisted'),
          fileLimit: formatBytes(feed.maxLogFileBytes),
          dir: feed.dir !== '' ? feed.dir : '—',
        }) + '\n' + t('header.spaceUninstallNote')
        : undefined

      // 所有会话的磁盘占用（“清空全部”旁边的数字）；未持久化时隐藏。
      const showAllSessions = usage.loaded && usage.persist
      const allSessionsTooltip = showAllSessions
        ? t('header.allSessionsTooltip', {
          size: formatBytes(usage.bytes),
          files: String(usage.files),
          sessions: String(usage.sessions),
          limit: usage.maxTotalBytes > 0 ? formatBytes(usage.maxTotalBytes) : t('header.noLimit'),
          dir: usage.dir !== '' ? usage.dir : '—',
        })
        : undefined

      const langSwitchLabel = props.lang === 'zh' ? t('lang.switchToEnglish') : t('lang.switchToChinese')
      const otherLangLabel = props.lang === 'zh' ? t('lang.enShort') : t('lang.zhShort')

      // 详情工具栏展示的身份信息：优先使用详情记录，回退到列表摘要。
      const expandedRecord = selectedRecord != null ? selectedRecord : selectedSummary
      const expandedTone = expandedRecord == null
        ? 'idle'
        : (expandedRecord.error != null && expandedRecord.status == null ? 'error' : statusTone(expandedRecord.status))
      const expandedStatus = expandedRecord == null ? '' : statusLabelOf(expandedRecord, t)

      // 定位：把列表行滚到可视区中央、聚焦并短暂闪烁。
      const handleLocate = () => {
        if (selectedId == null || rowRefs.current == null) return
        const row = rowRefs.current.get(selectedId)
        if (row == null) return
        if (typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'center' })
        if (typeof row.focus === 'function') row.focus({ preventScroll: true })
        setFlashId(selectedId)
        if (flashTimerRef.current != null) window.clearTimeout(flashTimerRef.current)
        flashTimerRef.current = window.setTimeout(() => setFlashId(null), FLASH_MS)
      }

      const handleRefresh = () => {
        setActionError(null)
        // refresh 会重取会话记录，并在同一拍重新扫描磁盘总量。
        feed.refresh()
        // 详情是独立请求；手动刷新不应让它保持陈旧。
        if (selectedId != null) detail.retry()
      }

      const handleClear = async () => {
        setClearing(true)
        setActionError(null)
        try {
          await postClear(sessionId)
          setConfirmClear(false)
          setSelectedId(null)
          feed.refresh()
        } catch (caught) {
          setActionError(t('error.clear', { message: errorMessage(caught) }))
        } finally {
          setClearing(false)
        }
      }

      const handleClearAll = async () => {
        setClearingAll(true)
        setActionError(null)
        try {
          await postClearAll()
          setConfirmClearAll(false)
          setSelectedId(null)
          feed.refresh()
        } catch (caught) {
          setActionError(t('error.clearAll', { message: errorMessage(caught) }))
        } finally {
          setClearingAll(false)
        }
      }

      const handleExport = async () => {
        setExporting(true)
        setActionError(null)
        try {
          const response = await fetch(harUrl(sessionId), { method: 'GET', credentials: 'same-origin' })
          if (!response.ok) throw new Error('HTTP ' + String(response.status))
          const blob = await response.blob()
          const objectUrl = URL.createObjectURL(blob)
          const anchor = document.createElement('a')
          anchor.href = objectUrl
          anchor.download = HAR_FILENAME
          anchor.rel = 'noopener'
          anchor.style.display = 'none'
          // <html> 下的临时宿主（绝不使用 body 元素）：部分浏览器
          // 需要在程序化下载点击前将 anchor 连接进文档。
          document.documentElement.appendChild(anchor)
          try {
            anchor.click()
          } finally {
            anchor.remove()
          }
          window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10000)
        } catch (caught) {
          setActionError(t('error.export', { message: errorMessage(caught) }))
        } finally {
          setExporting(false)
        }
      }

      const handleReveal = async () => {
        setRevealing(true)
        setActionError(null)
        try {
          const response = await fetch(ROUTE + '/reveal', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { accept: 'application/json', 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId }),
          })
          await readJsonResponse(response)
          setRevealFeedback('opened')
          if (revealTimerRef.current != null) window.clearTimeout(revealTimerRef.current)
          revealTimerRef.current = window.setTimeout(() => setRevealFeedback('idle'), COPY_FEEDBACK_MS)
        } catch (caught) {
          setActionError(t('error.reveal', { message: errorMessage(caught) }))
        } finally {
          setRevealing(false)
        }
      }

      let listContent = null
      if (feed.loading && feed.records.length === 0) {
        listContent = h('div', { className: 'shl-state' }, h(Spinner, null), h('span', null, t('list.loading')))
      } else if (feed.error != null && feed.records.length === 0) {
        listContent = h('div', { className: 'shl-state shl-state-error' },
          h('span', null, t('list.error', { message: feed.error })),
          h('button', { type: 'button', className: 'shl-btn', onClick: handleRefresh }, t('list.retry')))
      } else if (filtered.length === 0) {
        listContent = h('div', { className: 'shl-state' },
          h('span', null, feed.records.length === 0 ? t('list.empty') : t('list.emptyFiltered')))
      } else {
        listContent = filtered.map((record) => h(RecordRow, {
          key: String(record.id),
          record,
          selected: record.id === selectedId,
          flashing: record.id === flashId,
          setRowRef,
          onSelect: (id) => setSelectedId((previous) => (previous === id ? null : id)),
          t,
        }))
      }

      return h('div', {
        className: variant === 'page' ? 'shl-root shl-page' : 'shl-root',
        ref: rootRef,
      },
        h('style', { key: 'styles' }, CSS),
        h('header', { className: 'shl-header' },
          h('div', { className: 'shl-title-row' },
            variant === 'panel'
              ? h('span', { className: 'shl-title', title: t('tab.title') }, t('tab.title'))
              : null,
            h('span', { className: 'shl-count' }, countLabel),
            showSpace
              ? h('span', { className: 'shl-space', title: spaceTooltip }, t('header.space', { memory: memoryText }))
              : null,
            h('div', { className: 'shl-title-actions' },
              showAllSessions
                ? h('span', {
                  className: 'shl-all-size',
                  title: allSessionsTooltip,
                }, t('header.allSessions', { size: formatBytes(usage.bytes) }))
                : null,
              h('button', {
                type: 'button',
                className: 'shl-btn shl-btn-ghost shl-global-clear',
                onClick: () => {
                  setConfirmClear(false)
                  setConfirmClearAll((value) => !value)
                },
                'aria-expanded': confirmClearAll,
                title: t('header.clearAllTitle'),
                'aria-label': t('header.clearAllTitle'),
              }, t('header.clearAll')),
              h('button', {
                type: 'button',
                className: 'shl-lang',
                'aria-pressed': props.hasOverride === true,
                'aria-label': langSwitchLabel,
                title: langSwitchLabel,
                onClick: props.onToggleLang,
              }, otherLangLabel))),
          h('div', { className: 'shl-toolbar' },
            h('label', { className: 'shl-check' },
              h('input', {
                type: 'checkbox',
                checked: autoRefresh,
                onChange: (event) => setAutoRefresh(event.currentTarget.checked),
              }),
              t('header.autoRefresh')),
            h('button', { type: 'button', className: 'shl-btn', onClick: handleRefresh }, t('header.refresh')),
            h('button', {
              type: 'button',
              className: 'shl-btn',
              onClick: () => {
                setConfirmClearAll(false)
                setConfirmClear((value) => !value)
              },
              'aria-expanded': confirmClear,
            }, t('header.clear')),
            h('button', { type: 'button', className: 'shl-btn', onClick: handleExport, disabled: exporting },
              exporting ? t('header.exporting') : t('header.export')),
            h('button', {
              type: 'button',
              className: 'shl-btn',
              onClick: handleReveal,
              disabled: revealing,
              title: t('header.openFolderTitle'),
              'aria-label': t('header.openFolderTitle'),
            }, revealing ? t('header.opening') : revealFeedback === 'opened' ? t('header.opened') : t('header.openFolder'))),
          feed.persist && feed.maxLogFileBytes > 0
            ? h('div', {
              className: 'shl-retention',
              role: 'note',
              title: t('header.retentionTitle'),
            }, t('header.retention', {
              limit: formatBytes(feed.maxLogFileBytes),
              hours: formatRetentionHours(feed.retentionMs),
            }))
            : null,
          confirmClear
            ? h('div', { className: 'shl-banner' },
              h('span', { className: 'shl-banner-text' }, t('header.clearConfirm')),
              h('button', { type: 'button', className: 'shl-btn shl-btn-danger', onClick: handleClear, disabled: clearing },
                clearing ? t('header.clearing') : t('header.clearConfirmYes')),
              h('button', { type: 'button', className: 'shl-btn', onClick: () => setConfirmClear(false), disabled: clearing },
                t('header.cancel')))
            : null,
          confirmClearAll
            ? h('div', { className: 'shl-banner' },
              h('span', { className: 'shl-banner-text' }, t('header.clearAllConfirm')),
              h('button', { type: 'button', className: 'shl-btn shl-btn-danger', onClick: handleClearAll, disabled: clearingAll },
                clearingAll ? t('header.clearingAll') : t('header.clearAllConfirmYes')),
              h('button', { type: 'button', className: 'shl-btn', onClick: () => setConfirmClearAll(false), disabled: clearingAll },
                t('header.cancel')))
            : null,
          actionError != null
            ? h('div', { className: 'shl-banner shl-banner-error' },
              h('span', { className: 'shl-banner-text' }, actionError),
              h('button', { type: 'button', className: 'shl-btn shl-btn-ghost', onClick: () => setActionError(null) },
                t('action.dismiss')))
            : null,
          h('input', {
            className: 'shl-filter',
            type: 'search',
            value: filter,
            placeholder: t('filter.placeholder'),
            'aria-label': t('filter.placeholder'),
            onChange: (event) => setFilter(event.currentTarget.value),
          })),
        feed.error != null && feed.records.length > 0
          ? h('div', { className: 'shl-banner shl-banner-error' },
            h('span', { className: 'shl-banner-text' }, t('list.error', { message: feed.error })),
            h('button', { type: 'button', className: 'shl-btn shl-btn-ghost', onClick: handleRefresh }, t('list.retry')))
          : null,
        h('div', { className: 'shl-split' },
          h('div', { className: 'shl-list', ref: listRef }, listContent),
          feed.records.length > 0 || selectedId != null
            ? h('div', { className: 'shl-detail', ref: detailRef },
            selectedId != null
              ? h('div', { className: 'shl-detail-toolbar' },
                h('span', { className: 'shl-detail-ident' },
                  h('span', { className: 'shl-chip shl-chip-method' },
                    expandedRecord != null && typeof expandedRecord.method === 'string' ? expandedRecord.method : '—'),
                  h('span', {
                    className: 'shl-detail-path',
                    title: expandedRecord != null && typeof expandedRecord.url === 'string' ? expandedRecord.url : '',
                  }, shortPath(expandedRecord == null ? '' : expandedRecord.url)),
                  expandedRecord != null ? h('span', { className: statusChipClass(expandedTone) }, expandedStatus) : null),
                h('button', {
                  type: 'button',
                  className: 'shl-btn shl-btn-ghost shl-locate',
                  title: t('detail.locateTitle'),
                  'aria-label': t('detail.locateTitle'),
                  onClick: handleLocate,
                }, t('detail.locate')))
              : null,
            h(RecordDetail, {
              // 以记录 id 作为 key：区块展开与报文切换状态随记录重置。
              key: selectedId == null ? 'none' : String(selectedId),
              sessionId,
              record: selectedRecord != null ? selectedRecord : selectedSummary,
              // 新选中的记录尚无详情：将该空档视为加载中，
              // 避免闪现一帧“选择一条请求”的提示。
              loading: selectedId != null && (detail.loading || (selectedRecord == null && detail.error == null)),
              error: detail.error,
              onRetry: detail.retry,
              t,
            }))
          : null))
    }

    function matchesFilter(record, query) {
      const values = [
        record.method,
        record.url,
        record.status == null ? 'pending' : String(record.status),
        record.statusText,
        record.model,
        record.kind,
        record.error,
      ]
      for (const value of values) {
        if (typeof value === 'string' && value.toLowerCase().indexOf(query) !== -1) return true
      }
      return false
    }

    /** 构建绑定到 Session 的视图；`t` 在没有本地覆盖时回退到闭包绑定。 */
    function createView(ctx, defaultVariant) {
      const boundT = ctx.locale.bind(NS)
      return function SessionHttpLogView(props) {
        const slotT = typeof props.t === 'function' ? props.t : boundT
        const [overrideLang, setOverrideLang] = React.useState(readStoredLang)
        const lang = overrideLang !== null ? overrideLang : appLocaleLang(ctx)
        const localT = React.useMemo(() => makeLocalT(lang), [lang])
        // 有本地覆盖时整个面板使用本地字典；否则跟随应用的 locale 绑定。
        const t = overrideLang !== null ? localT : slotT
        const toggleLang = () => {
          const next = lang === 'zh' ? 'en' : 'zh'
          writeStoredLang(next)
          setOverrideLang(next)
        }
        const sessionId = typeof props.sessionId === 'string' ? props.sessionId : ''
        const variant = props.variant === 'page' || props.variant === 'panel' ? props.variant : defaultVariant
        if (sessionId === '') {
          // 没有 Session 时没有头部语言按钮，沿用现有的绑定翻译。
          return h('div', { className: 'shl-root' },
            h('style', null, CSS),
            h('div', { className: 'shl-state' }, h('span', null, slotT('state.noSession'))))
        }
        return h(Panel, {
          key: sessionId,
          sessionId,
          t,
          lang,
          variant,
          hasOverride: overrideLang !== null,
          onToggleLang: toggleLang,
        })
      }
    }

    // ---------------------------------------------------------------------
    // 插件入口。工厂阶段无副作用：所有注册都在
    // apply 中完成，并由 ctx.effect / fiber 负责释放。
    // ---------------------------------------------------------------------
    return {
      inject: ['slots', 'locale', 'sidebarRightTabs'],
      apply(ctx) {
        const t = ctx.locale.bind(NS)

        ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'dsh-plugin-session-http-log: dictionaries')

        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: PLUGIN_ID,
          kind: KIND,
          keepMounted: true,
          title: () => t('tab.title'),
          guide: [{
            id: 'open',
            order: 65,
            title: () => t('tab.title'),
            description: () => t('tab.description'),
          }],
        }), 'dsh-plugin-session-http-log: sidebar tab')

        const View = createView(ctx, 'panel')
        ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: PLUGIN_ID,
          locale: NS,
          inject: (sessionId) => ({ sessionId: injectedSessionId(sessionId) }),
        }, View))

        // 主区域会话标签行入口：与右侧边栏共用 Panel，页面变体使用横向宽布局。
        const PageView = createView(ctx, 'page')
        ctx.slots.inject('conversation.view', () => ctx.slots.register({
          name: 'conversation.view',
          id: KIND,
          order: 50,
          locale: NS,
          label: () => t('view.tab'),
          inject: (sessionId) => ({ sessionId: injectedSessionId(sessionId), variant: 'page' }),
        }, PageView))
      },
    }
  },
})
