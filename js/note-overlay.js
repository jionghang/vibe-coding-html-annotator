/**
 * note-overlay.js - 页面元素注释工具
 * 通过在HTML header中引入此脚本，为页面添加右侧注释侧栏
 *
 * 使用方式：
 * <script src="./js/note-overlay.js"></script>
 *
 * 数据存储：在线时读写 /api/text-annotations（写入文件），离线时降级为静态 JSON 只读
 */
(function() {
    if (window.__noteOverlayStarted) return;
    window.__noteOverlayStarted = true;
    'use strict';

    // file:// 协议（直接双击打开 HTML）下浏览器禁止网页读取本地 JSON，批注功能无法启用，提示后退出。
    if (window.location.protocol === 'file:') {
        const showFileTip = function() {
            if (document.getElementById('note-overlay-file-tip')) return;
            const tip = document.createElement('div');
            tip.id = 'note-overlay-file-tip';
            tip.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999999;background:#FDF6EC;border-bottom:1px solid #FAECD8;color:#E6A23C;font:13px/1.6 "Helvetica Neue",Helvetica,"PingFang SC","Microsoft YaHei",Arial,sans-serif;padding:10px 16px;text-align:center;box-sizing:border-box;';
            tip.textContent = '当前页面是直接双击打开的（file:// 协议），浏览器安全策略禁止读取本地数据文件，批注功能无法启用。请通过本地服务（npm start 或 start.bat）或任意静态 HTTP 服务访问本页面。';
            document.body.appendChild(tip);
        };
        if (document.body) showFileTip();
        else document.addEventListener('DOMContentLoaded', showFileTip);
        return;
    }

    // 脚本/数据加载较慢时先隐藏原始页面，避免页面以未缩放布局闪现。
    const startupVisibility = document.body && document.body.style.visibility;
    if (document.body) document.body.style.visibility = 'hidden';

    const TEXT_ANNOTATIONS_FILE = 'data/text-annotations.json';
    const TEXT_ANNOTATIONS_API = '/api/text-annotations';
    const STATUS_ANNOTATIONS_FILE = 'data/status-annotations.json';
    const STATUS_ANNOTATIONS_API = '/api/status-annotations';
    const HIGHLIGHT_CLASS = 'note-overlay-highlight';
    const CLICK_HIGHLIGHT_CLASS = 'note-overlay-click-highlight';
    const SELECTED_CLASS = 'note-overlay-selected';
    const MARKER_CLASS = 'note-overlay-marker';
    const OPEN_KEY = 'note_overlay_sidebar_open';
    const LAYOUT_KEY = 'note_overlay_layout_mode'; // compress | scale
    const WIDTH_KEY = 'note_overlay_sidebar_width'; // 永久有效
    const CARD_HEIGHT_KEY = 'note_overlay_card_height'; // 卡片等高设置，永久有效
    const OPEN_TTL = 7 * 24 * 3600 * 1000; // 展开状态缓存 7 天
    const MARKER_IDLE = 3000; // 鼠标不动 3 秒后序号渐出

    // 主色（Element UI 蓝，用于大部分 UI）
    const ACCENT = '#409EFF';
    const ACCENT_DARK = '#337ecc';
    const ACCENT_LIGHT = '#ecf5ff';
    // 选择元素框与页面序号标记（橙红色）
    const SELECT_ACCENT = '#FF5722';
    const SELECT_ACCENT_LIGHT = '#FFF3EC';
    const MARKER_ACCENT = '#F59E0B';

    // Element UI 配色（中性）
    const COLORS = {
        primary: '#409EFF',
        primaryLight: '#ecf5ff',
        primaryDark: '#337ecc',
        success: '#67C23A',
        warning: '#E6A23C',
        danger: '#F56C6C',
        info: '#909399',
        textPrimary: '#303133',
        textRegular: '#606266',
        textSecondary: '#909399',
        borderBase: '#DCDFE6',
        borderLight: '#E4E7ED',
        borderLighter: '#EBEEF5',
        bgPage: '#F5F7FA',
        bgWhite: '#FFFFFF'
    };

    let isWritable = false;
    let selectMode = false;
    let notes = [];
    let statusNotes = [];
    let activeTab = 'text';
    let selectedElement = null;
    let modalNoteId = null;
    let modalEditing = false;
    let modalDirectEdit = false;
    let draftContent = '';
    let draftSelectors = [];
    let markerTimer = null;
    let markersReady = true;
    let pendingDeleteId = null;
    let pendingDeleteType = 'text';
    let pendingDeleteIndex = -1;
    let statusEditingId = null;
    let statusSelectingId = null;
    let textSelectingId = null;
    let activeLinkNoteId = null;
    let activeStatusId = null;
    let statusSnapshot = null;
    let markerLayoutObserver = null;
    let markerMutationObserver = null;

    // 内联 SVG 图标（不用 emoji）
    const ICONS = {
        edit: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 1.5l3 3L5 14l-3.8.8L2 11z"/></svg>',
        del: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M2.5 4h11M6.5 2.5h3M4 4l.8 9a1 1 0 0 0 1 .9h4.4a1 1 0 0 0 1-.9L12 4M6.5 6.5v4M9.5 6.5v4"/></svg>',
        zoom: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6V2h4M14 10v4h-4M2 2l5 5M14 14L9 9"/></svg>',
        close: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M3 3l10 10M13 3L3 13"/></svg>',
        bold: '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M4 2h5.2A3.3 3.3 0 0 1 12 4.6 3.2 3.2 0 0 1 10 7.6 3.6 3.6 0 0 1 12.4 11a3.7 3.7 0 0 1-3.6 3H4zM6 5v2.2h2.7a1.2 1.2 0 0 0 0-2.2zm0 4.3V13h2.9a1.2 1.2 0 0 0 0-2.4z"/></svg>',
        italic: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M6 2h6M4 14h6M9.5 2L6.5 14"/></svg>',
        underline: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M4 2v5a4 4 0 0 0 8 0V2M2.5 13.5h11"/></svg>',
        strike: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M4 2v3M12 2v3M4 12.5V14M12 12.5V14M2 8h12"/></svg>',
        ul: '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><circle cx="2.5" cy="4" r="1.1"/><circle cx="2.5" cy="8" r="1.1"/><circle cx="2.5" cy="12" r="1.1"/><path d="M6 3.8h7.5v1.4H6zM6 7.3h7.5v1.4H6zM6 10.8h7.5v1.4H6z"/></svg>',
        ol: '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M2.2 3.5h1v1h-.6V3.9H2zM2 5.2h1.8v.5l-1 1h1v.5H2v-.5l1-1V5.5H2zM6 3.8h7.5v1.4H6zM6 7.3h7.5v1.4H6zM6 10.8h7.5v1.4H6z"/></svg>',
        table: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M2 3.5h12v9H2zM2 6.5h12M6.5 3.5v9M11 3.5v9"/></svg>',
        cursor: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 2.5l7 5.5-4 .5 2 4.5-2.5 1-2-4.5L5 13z"/></svg>',
        plus: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>',
        compress: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M10 6V2h4M6 10v4H2M14 2L8 8M2 14l6-6"/></svg>',
        scale: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6V2h4M14 10v4h-4M2 2l5 5M14 14L9 9"/></svg>',
        heightFull: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v12M5 5l3-3 3 3M5 11l3 3 3-3"/></svg>',
        heightEq: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v12M5 5l3 3 3-3M5 11l3-3 3 3"/></svg>',
        prev: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3L5 8l5 5"/></svg>',
        next: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5"/></svg>',
        restore: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a5 5 0 1 1 1.2 4.1M3 3v4h4"/></svg>',
        play: '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M5 3.2v9.6a.8.8 0 0 0 1.2.7l7-4.8a.8.8 0 0 0 0-1.4l-7-4.8A.8.8 0 0 0 5 3.2z"/></svg>',
        check: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.3l3.1 3.1L13 4.8"/></svg>',
        save: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2.5h8l2 2v9H3zM5 2.5v4h5v-4M5 13.5v-4h6v4"/></svg>',
        hide: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4zM6.5 8a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0zM2 2l12 12"/></svg>'
        ,link: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M6.2 9.8l3.6-3.6M5.1 11.9l-1.2 1.2a2.3 2.3 0 0 1-3.2-3.2l2.7-2.7a2.3 2.3 0 0 1 3.2 0M10.9 4.1l1.2-1.2a2.3 2.3 0 0 1 3.2 3.2l-2.7 2.7a2.3 2.3 0 0 1-3.2 0"/></svg>',
        unlink: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M6.2 9.8l3.6-3.6M5.1 11.9l-1.2 1.2a2.3 2.3 0 0 1-3.2-3.2l2.7-2.7M10.9 4.1l1.2-1.2a2.3 2.3 0 0 1 3.2 3.2l-2.7 2.7M2 2l12 12"/></svg>'
        ,addRow: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2 5h12M2 10h12M8 2v12M5 2h6v12H5zM11 13v-3M9.5 11.5h3"/></svg>'
        ,delRow: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2 5h12M2 10h12M8 2v12M5 2h6v12H5zM10 11h3"/></svg>'
        ,addCol: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M5 2v12M10 2v12M2 8h12M2 5h12v6H2zM13 2v3M11.5 3.5h3"/></svg>'
        ,delCol: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M5 2v12M10 2v12M2 8h12M2 5h12v6H2zM11 3.5h3"/></svg>'
    };

    // 获取当前页面文件名
    function getPageFilename() {
        const url = window.location.pathname;
        const parts = url.split('/');
        return parts[parts.length - 1] || 'index.html';
    }

    // 侧栏宽度：可拖拽调整，永久缓存
    function getSidebarWidth() {
        try {
            const w = parseInt(localStorage.getItem(WIDTH_KEY), 10);
            if (w && w >= 240 && w <= 900) return Math.min(w, window.innerWidth - 120);
        } catch (e) {}
        return window.innerWidth <= 768 ? 280 : 320;
    }

    function setSidebarVar() {
        const w = getSidebarWidth();
        document.documentElement.style.setProperty('--note-overlay-sbw', w + 'px');
        return w;
    }

    // 创建样式
    function injectStyles() {
        if (document.getElementById('note-overlay-styles')) return;
        const style = document.createElement('style');
        style.id = 'note-overlay-styles';
        style.textContent = `
            :root { --note-overlay-sbw: 320px; }
            /* 全局布局：右侧栏与页面并列，左右独立滚动 */
            html, body {
                margin: 0;
                padding: 0;
                height: 100%;
                overflow: visible;
            }
            body {
                display: flex;
                min-height: 100vh;
            }
            #note-overlay-main {
                flex: 1;
                min-width: 0;
                height: 100vh;
                overflow-y: auto;
                overflow-x: hidden;
            }
            #note-overlay-main-inner {
                transform-origin: top left;
            }
            #note-overlay-preview-frame { position: relative; margin: 0; background: transparent; border: 0; box-shadow: none; overflow: visible; z-index: 0; }
            #note-overlay-preview-frame.note-overlay-preview-active { margin: 24px auto; background: #fff; border: 1px solid #dfe6ef; border-radius: 14px; box-shadow: 0 14px 34px rgba(25,42,70,.14); overflow-y: auto; overflow-x: hidden; isolation: isolate; transform: translateZ(0); }
            #note-overlay-preview-frame.note-overlay-preview-active .site-header {
                position: sticky !important;
                top: 0 !important;
                z-index: 1000 !important;
            }
            #note-overlay-main { position: relative; z-index: 0; }
            #note-overlay-sidebar {
                width: var(--note-overlay-sbw);
                flex-shrink: 0;
                height: 100vh;
                position: sticky;
                top: 0;
                align-self: flex-start;
                background: ${COLORS.bgWhite};
                border-left: 1px solid ${COLORS.borderBase};
                display: none;
                flex-direction: column;
                font-family: 'Helvetica Neue', Helvetica, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', Arial, sans-serif;
                font-size: 14px;
                color: ${COLORS.textRegular};
                z-index: 999999;
                border-radius: 6px 0 0 6px;
                overflow-y: auto;
                overflow-x: hidden;
            }
            #note-overlay-sidebar.open {
                display: flex;
            }
            #note-overlay-toolbar, #note-overlay-status {
                flex-shrink: 0;
            }

            /* 侧栏宽度拖拽条 */
            #note-overlay-resizer {
                position: fixed;
                top: 0;
                bottom: 0;
                width: 8px;
                left: calc(100% - var(--note-overlay-sbw) - 4px);
                cursor: col-resize;
                z-index: 999998;
                display: none;
            }
            #note-overlay-resizer.show { display: block; }
            #note-overlay-resizer:hover, #note-overlay-resizer.active {
                background: rgba(64, 158, 255, 0.30);
            }

            /* 切换按钮（注释） */
            #note-overlay-toggle {
                position: fixed;
                top: 108px;
                right: 0;
                transform: none;
                width: 32px;
                height: 64px;
                background: ${ACCENT};
                color: #fff;
                border: none;
                border-radius: 4px 0 0 4px;
                cursor: pointer;
                z-index: 999998;
                font-size: 13px;
                font-weight: 500;
                writing-mode: vertical-rl;
                letter-spacing: 2px;
                transition: right 0.3s ease, background 0.2s;
                font-family: inherit;
            }
            #note-overlay-toggle:hover {
                background: ${ACCENT_DARK};
            }
            #note-overlay-toggle.shifted {
                right: var(--note-overlay-sbw);
            }

            /* 布局模式切换按钮（随展开按钮一起移动） */
            #note-overlay-mode-btn {
                position: fixed;
                top: 180px;
                right: 0;
                width: 32px;
                height: 32px;
                background: #fff;
                color: ${COLORS.textSecondary};
                border: 1px solid ${COLORS.borderBase};
                border-radius: 4px 0 0 4px;
                cursor: pointer;
                z-index: 999998;
                transition: right 0.3s ease, color 0.2s, border-color 0.2s;
                font-family: inherit;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 0;
            }
            #note-overlay-mode-btn:hover {
                color: ${ACCENT};
                border-color: ${ACCENT};
            }
            #note-overlay-mode-btn.shifted {
                right: var(--note-overlay-sbw);
            }

            /* 注释数徽标（折叠时显示，15 秒弹跳一次） */
            #note-overlay-badge {
                position: fixed;
                right: 22px;
                top: 100px;
                min-width: 20px;
                height: 20px;
                padding: 0 6px;
                border-radius: 10px;
                background: #ef5350;
                color: #fff;
                font-size: 12px;
                font-weight: 600;
                line-height: 20px;
                text-align: center;
                z-index: 999998;
                box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
                display: none;
                pointer-events: none;
                box-sizing: border-box;
            }
            #note-overlay-badge.show {
                display: block;
                animation: note-overlay-bounce 2s linear infinite;
            }
            @keyframes note-overlay-bounce {
                0%   { transform: translateY(-14px) scale(0.6); opacity: 0; }
                3%   { transform: translateY(3px) scale(1.2); opacity: 1; }
                5%   { transform: translateY(-2px) scale(0.97); opacity: 1; }
                7%   { transform: translateY(0) scale(1); opacity: 1; }
                100% { transform: translateY(0) scale(1); opacity: 1; }
            }

            /* 工具栏 */
            .note-overlay-toolbar {
                padding: 6px 10px;
                border-bottom: 1px solid ${COLORS.borderLighter};
                display: flex;
                gap: 5px;
                flex-wrap: wrap;
                background: ${COLORS.bgPage};
            }
            .note-overlay-tabs { display:flex; gap:3px; width:100%; box-sizing:border-box; padding:4px; background:#f3f6fa; border-bottom:1px solid ${COLORS.borderLighter}; }
            .note-overlay-tab { position:relative; flex:1; min-width:0; border:0; border-radius:6px; background:transparent; padding:7px 6px; color:${COLORS.textSecondary}; cursor:pointer; font:inherit; transition:color .15s,background .15s,box-shadow .15s; }
            .note-overlay-tab:hover { color:${COLORS.textRegular}; background:rgba(255,255,255,.65); }
            .note-overlay-tab.active { color:${ACCENT}; font-weight:600; background:#fff; box-shadow:0 1px 4px rgba(25,42,70,.12); }
            .note-overlay-tab-badge { display:none; min-width:16px; height:16px; margin-left:3px; padding:0 4px; border-radius:9px; background:#ef5350; color:#fff; font-size:10px; line-height:16px; text-align:center; vertical-align:middle; transform:translateY(-1px); }
            .note-overlay-tab-badge.show { display:inline-block; }
            .note-overlay-toolbar .note-overlay-btn {
                width: 34px;
                height: 34px;
                padding: 0;
                border-radius: 8px;
                justify-content: center;
            }

            /* 按钮 */
            .note-overlay-btn {
                height: 30px;
                padding: 0 12px;
                border: 1px solid ${COLORS.borderBase};
                border-radius: 3px;
                font-size: 13px;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.15s;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 4px;
                background: ${COLORS.bgWhite};
                color: ${COLORS.textRegular};
                line-height: 1;
                font-family: inherit;
            }
            .note-overlay-btn:hover {
                color: ${COLORS.primary};
                border-color: ${COLORS.primaryLight};
                background: ${COLORS.primaryLight};
            }
            .note-overlay-btn-primary {
                background: ${ACCENT};
                border-color: ${ACCENT};
                color: #fff;
            }
            .note-overlay-btn-primary:hover {
                background: ${ACCENT_DARK};
                border-color: ${ACCENT_DARK};
                color: #fff;
            }
            .note-overlay-btn-primary.active {
                background: ${ACCENT_DARK};
                border-color: ${ACCENT_DARK};
            }
            .note-overlay-btn-success {
                background: ${COLORS.success};
                border-color: ${COLORS.success};
                color: #fff;
            }
            .note-overlay-btn-success:hover {
                background: #5daf34;
                border-color: #5daf34;
                color: #fff;
            }
            .note-overlay-btn-text {
                border: none;
                background: transparent;
                color: ${COLORS.textSecondary};
                padding: 4px;
                height: auto;
                width: 24px;
                border-radius: 3px;
            }
            .note-overlay-btn-text:hover {
                color: ${ACCENT};
                background: ${ACCENT_LIGHT};
                border: none;
            }
            .note-overlay-btn.active {
                box-shadow: 0 0 0 2px rgba(64, 158, 255, 0.35);
            }

            /* 列表区域 */
            #note-overlay-list {
                flex: 1;
                min-height: 0;
                overflow-y: auto;
                padding: 12px;
                background: ${COLORS.bgPage};
            }
            .note-overlay-empty {
                text-align: center;
                color: ${COLORS.textSecondary};
                padding: 40px 16px;
                font-size: 13px;
                background: ${COLORS.bgWhite};
                border-radius: 4px;
                border: 1px dashed ${COLORS.borderBase};
            }

            /* 注释卡片：圆角弥散阴影，现代轻盈 */
            .note-overlay-card {
                background: ${COLORS.bgWhite};
                border: 1px solid ${COLORS.borderLighter};
                border-radius: 10px;
                padding: 14px 12px 10px;
                margin-bottom: 12px;
                position: relative;
                transition: box-shadow 0.2s ease, border-color 0.2s ease, transform 0.2s ease, opacity 0.2s ease;
                cursor: pointer;
                box-shadow: 0 1px 2px rgba(31, 45, 61, 0.04), 0 4px 12px rgba(31, 45, 61, 0.04);
            }
            .note-overlay-card:hover {
                box-shadow: 0 2px 4px rgba(31, 45, 61, 0.06), 0 10px 24px rgba(31, 45, 61, 0.10);
                border-color: ${COLORS.borderLight};
                transform: translateY(-1px);
            }
            .note-overlay-card.dragging {
                opacity: 0.35;
                transform: scale(0.98);
            }
            .note-overlay-card.drag-shift-down { transform: translateY(var(--note-overlay-drag-shift, 0px)); }
            .note-overlay-card.drag-shift-up { transform: translateY(calc(var(--note-overlay-drag-shift, 0px) * -1)); }
            .note-overlay-card.drop-before::before, .note-overlay-card.drop-after::after {
                content: '';
                position: absolute;
                left: 8px;
                right: 8px;
                height: 2px;
                background: ${ACCENT};
                border-radius: 1px;
            }
            .note-overlay-card.drop-before::before { top: -7px; }
            .note-overlay-card.drop-after::after { bottom: -7px; }
            .note-overlay-card-active {
                border-color: rgba(64,158,255,.62);
                box-shadow: 0 7px 21px rgba(64,158,255,.18);
            }

            /* 拖拽手柄：顶部居中短横线，悬浮显示 */
            .note-overlay-card-drag {
                position: absolute;
                top: 4px;
                left: 50%;
                transform: translateX(-50%);
                width: 30px;
                height: 4px;
                border-radius: 2px;
                background: #c8d0da;
                opacity: 0;
                cursor: grab;
                z-index: 3;
                transition: opacity 0.15s;
            }
            .note-overlay-card:hover .note-overlay-card-drag { opacity: 1; }
            .note-overlay-card-drag:active { cursor: grabbing; }

            /* 拖拽幽灵卡片（跟随鼠标） */
            .note-overlay-ghost {
                position: fixed;
                z-index: 9999996;
                pointer-events: none;
                opacity: 0.92;
                transform: rotate(3deg);
                box-shadow: 0 12px 32px rgba(0, 0, 0, 0.22);
                border-radius: 10px;
                background: #fff;
                padding: 14px 12px 10px;
                border: 1px solid ${COLORS.borderLighter};
                font-family: 'Helvetica Neue', Helvetica, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', Arial, sans-serif;
                font-size: 12px;
                color: ${COLORS.textRegular};
                line-height: 1.5;
                overflow: visible;
            }

            .note-overlay-card-header {
                display: flex;
                align-items: center;
                gap: 6px;
                margin-bottom: 5px;
                position: relative;
            }
            .note-overlay-card-number {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 16px;
                height: 16px;
                border-radius: 50%;
                background: ${MARKER_ACCENT};
                color: #fff;
                font-size: 10px;
                font-weight: 600;
                flex-shrink: 0;
                line-height: 1;
            }
            .note-overlay-card-actions {
                display: flex;
                gap: 2px;
                opacity: 0;
                transition: opacity 0.15s;
                margin-left: auto;
            }
            .note-overlay-card:hover .note-overlay-card-actions {
                opacity: 1;
            }
            .note-overlay-card-content {
                font-size: 12px;
                color: ${COLORS.textRegular};
                line-height: 1.5;
                word-break: break-word;
            }
            .note-overlay-status-divider { height: 1px; background: ${COLORS.borderLighter}; margin: 9px 0 8px; }
            .note-overlay-status-elements { margin-top: 8px; }
            .note-overlay-status-element { display:flex; align-items:center; justify-content:space-between; gap:6px; padding:5px 6px; border-bottom:1px solid ${COLORS.borderLighter}; color:${COLORS.textRegular}; font-size:11px; }
            .note-overlay-status-element span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
            .note-overlay-status-empty { color:${COLORS.textSecondary}; font-size:11px; }
            .note-overlay-status-actions { display:flex; justify-content:space-between; gap:6px; margin-top:10px; }
            .note-overlay-status-card [contenteditable="true"] { outline:0; border:0; border-radius:3px; background:transparent; box-shadow:inset 0 -1px 0 ${ACCENT}; padding:2px 4px; }
            .note-overlay-status-card [contenteditable="true"]:focus { outline:0; background:${ACCENT_LIGHT}; box-shadow:inset 0 -2px 0 ${ACCENT}; }
            .note-overlay-status-card .note-overlay-status-actions { opacity:0; pointer-events:none; transition:opacity .15s; }
            .note-overlay-status-card:hover .note-overlay-status-actions { opacity:1; pointer-events:auto; }
            .note-overlay-status-actions .note-overlay-btn { width:26px; height:26px; padding:0; border-radius:5px; }
            .note-overlay-toolbar-right { margin-left:auto; }
            .note-overlay-status-element .note-overlay-btn { opacity:0; pointer-events:none; }
            .note-overlay-status-element:hover .note-overlay-btn { opacity:1; pointer-events:auto; }
            .note-overlay-card-content p { margin: 0 0 4px; }
            .note-overlay-card-content ul,
            .note-overlay-card-content ol {
                margin: 4px 0;
                padding-left: 20px;
                list-style-position: inside;
                overflow-wrap: anywhere;
            }
            .note-overlay-card-content table { border-collapse: collapse; margin: 4px 0; max-width: 100%; }
            .note-overlay-card-content table, .note-overlay-card-content td, .note-overlay-card-content th {
                border: 1px solid ${COLORS.borderBase};
                padding: 3px 6px;
                font-size: 12px;
            }

            /* 等高模式：卡片等高，内容截断 */
            #note-overlay-list.note-overlay-eq .note-overlay-card {
                height: 118px;
                overflow: visible;
            }
            #note-overlay-list.note-overlay-eq .note-overlay-card-content { overflow: hidden; }
            #note-overlay-list.note-overlay-eq .note-overlay-card-content {
                max-height: 72px;
                overflow: hidden;
            }

            /* 元素上的注释序号标记（橙色，渐出） */
            .note-overlay-marker {
                position: absolute;
                width: 18px;
                height: 18px;
                box-sizing: border-box;
                border-radius: 50%;
                background: ${MARKER_ACCENT};
                color: #fff;
                font-size: 10px;
                font-weight: 600;
                display: flex;
                align-items: center;
                justify-content: center;
                pointer-events: auto;
                cursor: pointer;
                z-index: 999990;
                box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
                opacity: 1;
                transition: opacity 0.4s ease;
            }
            .note-overlay-marker { border: 0; box-shadow: 0 3px 10px rgba(25,42,70,.22); font-weight: 700; transition: opacity .3s ease, transform .18s ease, box-shadow .18s ease; }
            .note-overlay-marker:hover { transform: scale(1.18) !important; box-shadow: 0 5px 14px rgba(25,42,70,.3); }
            .note-overlay-marker.fade-out {
                opacity: 0;
                pointer-events: none;
            }
            @keyframes note-overlay-marker-fade-in {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            .note-overlay-marker.marker-fade-in {
                animation: note-overlay-marker-fade-in .35s ease both;
            }
            .note-overlay-marker-active {
                background: ${ACCENT};
                box-shadow: 0 0 0 4px rgba(64,158,255,.24), 0 4px 12px rgba(25,42,70,.3);
            }

            /* 高亮与选中样式（选择元素框为橙红） */
            .note-overlay-highlight {
                outline: 2px solid ${SELECT_ACCENT} !important;
                outline-offset: 1px;
                background: ${SELECT_ACCENT_LIGHT} !important;
            }
            .note-overlay-click-highlight {
                outline: 2px solid ${ACCENT} !important;
                outline-offset: 2px;
                box-shadow: 0 0 0 3px rgba(64,158,255,.18) !important;
            }
            .note-overlay-card.note-overlay-click-highlight {
                outline: 0 !important;
                border-color: rgba(64,158,255,.68);
                background: transparent;
                box-shadow: 0 0 0 1px rgba(64,158,255,.16), 0 8px 24px rgba(64,158,255,.20) !important;
            }
            .note-overlay-selected {
                outline: 2px solid ${SELECT_ACCENT} !important;
                outline-offset: 1px;
                background: ${SELECT_ACCENT_LIGHT} !important;
                box-shadow: 0 0 0 4px rgba(255, 87, 34, 0.25) !important;
            }

            /* 状态栏 */
            #note-overlay-status {
                font-size: 12px;
                color: ${COLORS.textSecondary};
                padding: 8px 16px;
                text-align: center;
                background: ${COLORS.bgWhite};
                border-top: 0;
            }

            /* 大窗（无遮罩，可拖拽位置、可调整大小） */
            .note-overlay-modal {
                position: fixed;
                z-index: 9999999;
                display: none;
            }
            .note-overlay-modal.open { display: block; }
            .note-overlay-modal-box {
                width: 680px;
                min-width: 520px;
                min-height: 380px;
                max-height: 90vh;
                background: #fff;
                border-radius: 10px;
                box-shadow: 0 10px 40px rgba(0, 0, 0, 0.25);
                display: flex;
                flex-direction: column;
                font-family: 'Helvetica Neue', Helvetica, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', Arial, sans-serif;
                color: ${COLORS.textRegular};
                overflow: hidden;
                resize: both;
                border: 1px solid ${COLORS.borderLighter};
            }
            .note-overlay-modal-box.dragging {
                cursor: move;
                user-select: none;
                opacity: 0.97;
            }
            .note-overlay-modal-header {
                padding: 10px 12px;
                border-bottom: 1px solid ${COLORS.borderLighter};
                display: flex;
                align-items: center;
                gap: 8px;
                flex-shrink: 0;
                cursor: move;
            }
            .note-overlay-modal-title {
                font-size: 14px;
                font-weight: 600;
                color: ${COLORS.textPrimary};
                flex: 1;
                min-width: 0;
            }
            .note-overlay-modal-toolbar {
                padding: 8px 12px;
                border-bottom: 1px solid ${COLORS.borderLighter};
                display: flex;
                gap: 4px;
                flex-wrap: wrap;
                flex-shrink: 0;
                background: ${COLORS.bgPage};
            }
            .note-overlay-modal-toolbar button {
                width: 30px;
                height: 30px;
                border: 1px solid ${COLORS.borderBase};
                border-radius: 3px;
                background: #fff;
                color: ${COLORS.textRegular};
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                transition: all 0.15s;
            }
            .note-overlay-modal-toolbar button:hover {
                color: ${ACCENT};
                border-color: ${ACCENT};
            }
            .note-overlay-editor {
                padding: 14px 16px;
                overflow-y: auto;
                font-size: 14px;
                line-height: 1.6;
                color: ${COLORS.textRegular};
                flex: 1;
                outline: none;
            }
            .note-overlay-editor:focus { border: none; }
            .note-overlay-editor p { margin: 0 0 6px; }
            .note-overlay-editor ul, .note-overlay-editor ol { margin: 4px 0; padding-left: 22px; }
            .note-overlay-editor table { border-collapse: collapse; margin: 6px 0; }
            .note-overlay-editor table, .note-overlay-editor td, .note-overlay-editor th {
                border: 1px solid ${COLORS.borderBase};
                padding: 4px 8px;
            }
            .note-overlay-modal-footer {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 8px 12px;
                border-top: 1px solid ${COLORS.borderLighter};
                flex-shrink: 0;
            }
            .note-overlay-modal-nav {
                display: flex;
                gap: 4px;
            }
            .note-overlay-modal-nav .note-overlay-btn {
                padding: 0 10px;
                height: 28px;
                font-size: 12px;
            }
            .note-overlay-modal-actions {
                display: flex;
                gap: 8px;
            }

            /* 鼠标旁浮窗（注释输入 / 删除确认） */
            .note-overlay-pop {
                position: fixed;
                z-index: 9999995;
                background: #fff;
                border-radius: 10px;
                box-shadow: 0 6px 20px rgba(0, 0, 0, 0.16), 0 2px 6px rgba(0, 0, 0, 0.10);
                border: 1px solid ${COLORS.borderLighter};
                padding: 12px;
                font-family: 'Helvetica Neue', Helvetica, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', Arial, sans-serif;
                color: ${COLORS.textRegular};
                width: 280px;
                display: none;
            }
            .note-overlay-pop.show { display: block; }
            .note-overlay-pop-title-row {
                display: flex;
                align-items: center;
                gap: 6px;
                margin-bottom: 8px;
            }
            .note-overlay-pop-title {
                font-size: 13px;
                font-weight: 600;
                color: ${COLORS.textPrimary};
                flex: 1;
            }
            .note-overlay-pop-zoom {
                width: 24px;
                height: 24px;
                border: none;
                background: transparent;
                color: ${COLORS.textSecondary};
                cursor: pointer;
                border-radius: 4px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                padding: 0;
            }
            .note-overlay-pop-zoom:hover {
                color: ${ACCENT};
                background: ${ACCENT_LIGHT};
            }
            .note-overlay-pop textarea {
                width: 100%;
                box-sizing: border-box;
                min-height: 72px;
                border: 1px solid ${COLORS.borderBase};
                border-radius: 6px;
                padding: 8px 10px;
                font-size: 13px;
                font-family: inherit;
                line-height: 1.5;
                color: ${COLORS.textRegular};
                resize: vertical;
            }
            .note-overlay-pop textarea:focus {
                outline: none;
                border-color: ${ACCENT};
            }
            .note-overlay-pop-actions {
                display: flex;
                gap: 8px;
                margin-top: 8px;
                justify-content: flex-end;
            }
            .note-overlay-pop .note-overlay-btn {
                height: 28px;
                padding: 0 12px;
                font-size: 12px;
            }
            .note-overlay-link-pop { position: fixed; z-index: 9999996; display: none; gap: 2px; padding: 4px; background: #fff; border: 1px solid ${COLORS.borderLighter}; border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,.16); }
            .note-overlay-link-pop.show { display: flex; }
            .note-overlay-link-pop .note-overlay-btn { width: 26px; height: 26px; padding: 0; border: 0; background: transparent; }
            .note-overlay-link-pop .note-overlay-btn:hover { background: ${ACCENT_LIGHT}; color: ${ACCENT}; }

            /* 现代轻盈主题 */
            #note-overlay-sidebar { background: #fbfcfe; border-left-color: #e7ebf2; box-shadow: -10px 0 30px rgba(25,42,70,.06); letter-spacing: .01em; }
            /* 不改变宿主页面的 body 排版，侧栏独立悬浮 */
            body { display: block; min-height: 0; }
            #note-overlay-main { width: 100%; }
            #note-overlay-sidebar { position: fixed; right: 0; top: 0; }
            #note-overlay-sidebar.open ~ #note-overlay-main { width: calc(100% - var(--note-overlay-sbw)); }
            .note-overlay-toolbar { padding: 5px 8px; gap: 4px; background: rgba(246,248,252,.92); border-top: 0; border-bottom: 0; }
            .note-overlay-toolbar #note-overlay-height-btn { margin-left: auto; background: transparent; color: #536174; border: 0; }
            .note-overlay-toolbar #note-overlay-status-restore-btn { margin-left: auto; background: transparent; color: #536174; border: 0; }
            .note-overlay-toolbar #note-overlay-status-restore-btn:hover { background: #f1f6ff; color: #337ecc; border: 0; }
            .note-overlay-toolbar .note-overlay-btn-success, .note-overlay-toolbar .note-overlay-btn-primary { background: transparent; color: #536174; border: 0; }
            .note-overlay-toolbar .note-overlay-btn-success:hover, .note-overlay-toolbar .note-overlay-btn-primary:hover { background: #f1f6ff; color: #337ecc; border: 0; }
            .note-overlay-btn { border-color: #e2e7ef; border-radius: 7px; color: #536174; transition: transform .18s ease, box-shadow .18s ease, background .18s ease, border-color .18s ease, color .18s ease; }
            .note-overlay-btn:hover { background: #f1f6ff; border-color: #c8dcfa; box-shadow: 0 3px 10px rgba(64,158,255,.12); transform: translateY(-1px); }
            .note-overlay-btn:focus-visible, #note-overlay-toggle:focus-visible, #note-overlay-mode-btn:focus-visible { outline: 3px solid rgba(64,158,255,.28); outline-offset: 2px; }
            #note-overlay-list { padding: 14px; background: #f6f8fb; scrollbar-color: #cbd5e1 transparent; }
            .note-overlay-tabs { padding: 6px 14px; gap: 4px; background: #fbfcfe; border-bottom: 1px solid #e8edf4; }
            .note-overlay-toolbar { padding: 7px 14px; gap: 6px; background: #fbfcfe; border-bottom: 0; }
            .note-overlay-tabs { border-bottom: 0; }
            .note-overlay-empty { border-radius: 10px; border: 1px solid #e8edf4; box-shadow: 0 2px 8px rgba(25,42,70,.025); padding: 34px 16px; background: #fff; }
            .note-overlay-tab { padding: 7px 8px; }
            .note-overlay-tab.active { box-shadow: 0 3px 12px rgba(25,42,70,.14); }
            .note-overlay-status-elements { border: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
            .note-overlay-status-divider { display: none; }
            .note-overlay-status-element { border: 0; border-radius: 7px; padding: 6px 8px; background: #f8fafc; }
            .note-overlay-status-element:hover { background: #f1f6ff; }
            .note-overlay-status-actions { margin-top: 8px; }
            .note-overlay-status-enabled { border-color: #409eff; background: #fff; box-shadow: 0 0 0 1px rgba(64,158,255,.24), 0 5px 14px rgba(64,158,255,.10); }
            .note-overlay-status-enabled .note-overlay-card-number { background: ${MARKER_ACCENT}; }
            .note-overlay-status-card .note-overlay-card-header strong[data-status-title="true"] {
                min-width: 0;
                flex: 1 1 auto;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .note-overlay-status-enabled-mark {
                position: absolute;
                right: 0;
                top: 50%;
                transform: translateY(-50%);
                width: 24px;
                height: 24px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                color: #409eff;
                opacity: 1;
                transition: opacity .15s ease;
            }
            .note-overlay-status-enabled-mark svg { display: block; }
            .note-overlay-status-card .note-overlay-card-actions { position: relative; z-index: 1; }
            .note-overlay-status-readonly-actions { opacity: 1; }
            .note-overlay-status-readonly-actions:hover + .note-overlay-status-enabled-mark { opacity: 1; pointer-events: none; }
            .note-overlay-status-card .note-overlay-card-actions [data-status-action="delete"] { background: #fff; }
            .note-overlay-status-card .note-overlay-card-actions [data-status-action="delete"]:hover { background: #fff; }
            .note-overlay-status-card .note-overlay-card-actions:hover + .note-overlay-status-enabled-mark { opacity: 0; pointer-events: none; }
            .note-overlay-status-actions .note-overlay-btn-text { width: 24px; height: 24px; }
            .note-overlay-status-enable-btn { color: #6b778c; opacity: 1; }
            .note-overlay-status-enable-btn.is-enabled { color: #409eff; }
            .note-overlay-status-enable-btn:hover { color: #337ecc; background: #ecf5ff; }
            .note-overlay-card { border-color: #e8edf4; border-radius: 12px; padding: 11px 13px 11px; margin-bottom: 10px; box-shadow: 0 2px 8px rgba(25,42,70,.035); }
            .note-overlay-card:hover { border-color: #d7e3f5; box-shadow: 0 8px 22px rgba(25,42,70,.09); transform: translateY(-2px); }
            .note-overlay-card-active { border-color: rgba(100,174,246,.44); box-shadow: 0 5px 15px rgba(64,158,255,.10); }
            .note-overlay-card-pulse { animation: note-overlay-card-pulse .65s ease; }
            @keyframes note-overlay-card-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(64,158,255,0); } 35% { box-shadow: 0 0 0 5px rgba(64,158,255,.28); } }
            .note-overlay-card-content { color: #526176; line-height: 1.6; }
            #note-overlay-list.note-overlay-eq .note-overlay-card-content { overflow: hidden; }
            .note-overlay-card-number { width: 18px; height: 18px; background: ${MARKER_ACCENT}; box-shadow: 0 2px 6px rgba(245,158,11,.22); }
            #note-overlay-list.note-overlay-eq .note-overlay-card-content { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; text-overflow: ellipsis; }
            #note-overlay-list.note-overlay-eq .note-overlay-card-content { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; text-overflow: ellipsis; }
            .note-overlay-btn-primary, .note-overlay-btn-primary:hover, .note-overlay-btn-primary.active { color: #fff; }
            #note-overlay-toggle { width: 34px; height: 68px; border-radius: 10px 0 0 10px; box-shadow: 0 8px 24px rgba(64,158,255,.30), 0 2px 8px rgba(25,42,70,.12); }
            #note-overlay-mode-btn { width: 34px; height: 34px; border-color: #e1e7ef; border-radius: 9px 0 0 9px; box-shadow: 0 8px 22px rgba(25,42,70,.16), 0 2px 7px rgba(64,158,255,.12); }
            .note-overlay-modal-box, .note-overlay-pop { border-color: #e5eaf2; border-radius: 14px; box-shadow: 0 18px 50px rgba(25,42,70,.16); }
            .note-overlay-modal-box { position: fixed; }
            .note-overlay-modal-header, .note-overlay-modal-footer { padding: 11px 14px; border: 0; }
            .note-overlay-modal-toolbar { background: #f7f9fc; border-bottom: 0; }
            .note-overlay-modal-toolbar button { border: 0; border-radius: 7px; background: transparent; box-shadow: none; }
            .note-overlay-modal-toolbar button:hover { background: #eef5ff; }
            #note-overlay-select-btn.active { background: #eef5ff; color: #337ecc; border: 0; }
            .note-overlay-modal-toolbar .note-overlay-table-btn { display: none; width: 28px; padding: 0; }
            .note-overlay-modal.editing.has-table .note-overlay-table-btn { display: inline-flex; }
            .note-overlay-modal-footer { justify-content: flex-end; }
            .note-overlay-modal.editing .note-overlay-modal-nav { display: none; }
            #note-overlay-status { background: #fbfcfe; border-top-color: #e9edf4; }
            #note-overlay-modal-actions { margin-left: auto; }
            @media (prefers-reduced-motion: reduce) { .note-overlay-btn, .note-overlay-card, #note-overlay-toggle { transition: none; } }

            @media (max-width: 768px) {
                .note-overlay-modal-box {
                    width: 92vw;
                    min-width: 0;
                }
            }
        `;
        document.head.appendChild(style);
    }

    // 创建DOM结构
    function createSidebar() {
        if (document.getElementById('note-overlay-sidebar')) return;

        // 包装原有内容：main（独立滚动）> inner（可缩放）
        const mainContent = document.createElement('div');
        mainContent.id = 'note-overlay-main';
        // 初始化期间先隐藏预览，待右栏状态和等比例布局确定后再显示，避免未缩放画布闪现。
        mainContent.style.visibility = 'hidden';
        const previewFrame = document.createElement('div');
        previewFrame.id = 'note-overlay-preview-frame';
        const mainInner = document.createElement('div');
        mainInner.id = 'note-overlay-main-inner';
        while (document.body.firstChild) {
            mainInner.appendChild(document.body.firstChild);
        }
        previewFrame.appendChild(mainInner);
        mainContent.appendChild(previewFrame);
        document.body.appendChild(mainContent);

        // header.js 可能在本脚本之后异步把页面头部插入 body；归入预览画布，避免脱离缩放与裁剪区域。
        const adoptPageNodes = () => {
            const overlayIds = new Set(['note-overlay-main', 'note-overlay-toggle', 'note-overlay-badge', 'note-overlay-mode-btn', 'note-overlay-resizer', 'note-overlay-pop', 'note-overlay-confirm-pop', 'note-overlay-link-pop', 'note-overlay-sidebar', 'note-overlay-modal']);
            Array.from(document.body.children).forEach(node => {
                if (overlayIds.has(node.id) || node === mainContent || node.parentNode !== document.body) return;
                // header.js 动态插入的站点头部必须保持页面首位，不能追加到正文末尾。
                if (node.classList && node.classList.contains('site-header')) {
                    mainInner.insertBefore(node, mainInner.firstChild);
                } else {
                    mainInner.appendChild(node);
                }
            });
        };
        setTimeout(adoptPageNodes, 0);
        setTimeout(adoptPageNodes, 300);

        // 切换按钮
        const toggleBtn = document.createElement('button');
        toggleBtn.id = 'note-overlay-toggle';
        toggleBtn.textContent = '注释';
        toggleBtn.title = '展开注释栏';
        // 数据加载完成前保持隐藏，避免无后端空页面初始化时短暂闪现。
        toggleBtn.style.display = 'none';
        document.body.appendChild(toggleBtn);

        // 注释数徽标
        const badge = document.createElement('div');
        badge.id = 'note-overlay-badge';
        document.body.appendChild(badge);

        // 布局模式切换按钮（随展开按钮一起动）
        const modeBtn = document.createElement('button');
        modeBtn.id = 'note-overlay-mode-btn';
        // 数据和当前页面注释数量确定前保持隐藏，避免切页时先显示再被折叠逻辑收起。
        modeBtn.style.display = 'none';
        document.body.appendChild(modeBtn);
        modeBtn.addEventListener('click', toggleLayoutMode);

        // 侧栏宽度拖拽条
        const resizer = document.createElement('div');
        resizer.id = 'note-overlay-resizer';
        resizer.title = '拖拽调整侧栏宽度';
        document.body.appendChild(resizer);

        // 鼠标旁浮窗：注释输入
        const pop = document.createElement('div');
        pop.id = 'note-overlay-pop';
        pop.className = 'note-overlay-pop';
        pop.innerHTML = `
            <div class="note-overlay-pop-title-row">
                <div class="note-overlay-pop-title" id="note-overlay-pop-title">添加注释</div>
                <button class="note-overlay-pop-zoom" id="note-overlay-pop-zoom" title="放大编辑">${ICONS.zoom}</button>
            </div>
            <textarea id="note-overlay-pop-textarea" placeholder="输入注释内容..."></textarea>
            <div class="note-overlay-pop-actions">
                <button class="note-overlay-btn" id="note-overlay-pop-cancel">取消</button>
                <button class="note-overlay-btn note-overlay-btn-primary" id="note-overlay-pop-submit">确定</button>
            </div>
        `;
        document.body.appendChild(pop);

        // 鼠标旁浮窗：删除确认
        const confirmPop = document.createElement('div');
        confirmPop.id = 'note-overlay-confirm-pop';
        confirmPop.className = 'note-overlay-pop';
        confirmPop.style.width = '220px';
        confirmPop.innerHTML = `
            <div class="note-overlay-pop-title">删除此注释？</div>
            <div class="note-overlay-pop-actions">
                <button class="note-overlay-btn" id="note-overlay-confirm-cancel">取消</button>
                <button class="note-overlay-btn note-overlay-btn-danger" id="note-overlay-confirm-ok">删除</button>
            </div>
        `;
        document.body.appendChild(confirmPop);

        const linkPop = document.createElement('div');
        linkPop.id = 'note-overlay-link-pop';
        linkPop.className = 'note-overlay-link-pop';
        linkPop.innerHTML = '<button class="note-overlay-btn note-overlay-btn-text" data-link-action="select" title="重新选择元素">' + ICONS.cursor + '</button><button class="note-overlay-btn note-overlay-btn-text note-overlay-link-unlink" data-link-action="unlink" title="断开元素链接">' + ICONS.unlink + '</button>';
        document.body.appendChild(linkPop);

        // 侧栏容器（无顶栏标题）
        const sidebar = document.createElement('div');
        sidebar.id = 'note-overlay-sidebar';
        sidebar.innerHTML = `
            <div class="note-overlay-tabs" id="note-overlay-tabs">
                <button class="note-overlay-tab active" data-tab="text">文本注释<span class="note-overlay-tab-badge" id="note-overlay-text-count"></span></button>
                <button class="note-overlay-tab" data-tab="status">状态注释<span class="note-overlay-tab-badge" id="note-overlay-status-count"></span></button>
            </div>
            <div class="note-overlay-toolbar" id="note-overlay-toolbar">
                <button id="note-overlay-select-btn" class="note-overlay-btn note-overlay-btn-primary" style="display:none;" title="选择元素">${ICONS.cursor}</button>
                <button id="note-overlay-add-btn" class="note-overlay-btn note-overlay-btn-success" style="display:none;" title="添加注释">${ICONS.plus}</button>
                <button id="note-overlay-status-add-btn" class="note-overlay-btn note-overlay-btn-success" style="display:none;" title="添加状态">${ICONS.plus}</button>
                <button id="note-overlay-status-restore-btn" class="note-overlay-btn note-overlay-toolbar-right" style="display:none;" title="还原状态">${ICONS.restore}</button>
                <button id="note-overlay-height-btn" class="note-overlay-btn" title="切换卡片高度">${ICONS.heightFull}</button>
            </div>
            <div id="note-overlay-list">
                <div class="note-overlay-empty">暂无注释</div>
            </div>
            <div id="note-overlay-status"></div>
        `;
        document.body.appendChild(sidebar);

        // 大窗（无遮罩，可拖拽/缩放）
        const modal = document.createElement('div');
        modal.id = 'note-overlay-modal';
        modal.className = 'note-overlay-modal';
        modal.innerHTML = `
            <div class="note-overlay-modal-box" id="note-overlay-modal-box">
                <div class="note-overlay-modal-header" id="note-overlay-modal-header">
                    <span class="note-overlay-card-number" id="note-overlay-modal-num" style="display:none;">1</span>
                    <span class="note-overlay-modal-title">注释</span>
                    <button class="note-overlay-btn" id="note-overlay-modal-edit-btn">编辑</button>
                    <button class="note-overlay-btn note-overlay-btn-text" id="note-overlay-modal-close-btn" title="关闭">${ICONS.close}</button>
                </div>
                <div class="note-overlay-modal-toolbar" id="note-overlay-modal-toolbar" style="display:none;">
                    <button data-cmd="bold" title="加粗">${ICONS.bold}</button>
                    <button data-cmd="italic" title="斜体">${ICONS.italic}</button>
                    <button data-cmd="underline" title="下划线">${ICONS.underline}</button>
                    <button data-cmd="strikeThrough" title="删除线">${ICONS.strike}</button>
                    <button data-cmd="insertUnorderedList" title="无序列表">${ICONS.ul}</button>
                    <button data-cmd="insertOrderedList" title="有序列表">${ICONS.ol}</button>
                    <button data-cmd="insertTable" title="插入表格">${ICONS.table}</button>
                    <button class="note-overlay-table-btn" data-table-cmd="addRow" title="添加行">${ICONS.addRow}</button>
                    <button class="note-overlay-table-btn" data-table-cmd="deleteRow" title="删除行">${ICONS.delRow}</button>
                    <button class="note-overlay-table-btn" data-table-cmd="addColumn" title="添加列">${ICONS.addCol}</button>
                    <button class="note-overlay-table-btn" data-table-cmd="deleteColumn" title="删除列">${ICONS.delCol}</button>
                </div>
                <div class="note-overlay-editor" id="note-overlay-editor" contenteditable="false"></div>
                <div class="note-overlay-modal-footer">
                    <div class="note-overlay-modal-nav" id="note-overlay-modal-nav">
                        <button class="note-overlay-btn" id="note-overlay-modal-prev" title="上一条">${ICONS.prev} 上一条</button>
                        <button class="note-overlay-btn" id="note-overlay-modal-next" title="下一条">下一条 ${ICONS.next}</button>
                    </div>
                    <div class="note-overlay-modal-actions" id="note-overlay-modal-actions" style="display:none;">
                        <button id="note-overlay-modal-save-btn" class="note-overlay-btn note-overlay-btn-primary">保存</button>
                        <button id="note-overlay-modal-cancel-btn" class="note-overlay-btn">取消</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // 绑定事件
        toggleBtn.addEventListener('click', toggleSidebar);
        document.getElementById('note-overlay-select-btn').addEventListener('click', toggleSelectMode);
        document.getElementById('note-overlay-add-btn').addEventListener('click', function() {
            showInputPopAt(null, '添加注释');
        });
        document.getElementById('note-overlay-status-add-btn').addEventListener('click', addStatusNote);
        document.getElementById('note-overlay-status-restore-btn').addEventListener('click', restoreActiveStatus);
        document.getElementById('note-overlay-height-btn').addEventListener('click', toggleCardHeight);
        document.addEventListener('mousedown', function(e) {
            if (!statusEditingId || e.target.closest('[data-status-field]')) return;
            saveStatusEdit(statusEditingId);
        }, true);
        document.addEventListener('mousedown', function(e) {
            const pop = document.getElementById('note-overlay-link-pop');
            if (pop && pop.classList.contains('show') && !e.target.closest('#note-overlay-link-pop') && !e.target.closest('[data-action="link"]')) hideLinkPop();
        }, true);
        document.addEventListener('mousedown', function(e) {
            const pop = document.getElementById('note-overlay-confirm-pop');
            if (pop && pop.classList.contains('show') && !e.target.closest('#note-overlay-confirm-pop')) hideConfirmPop();
        }, true);
        sidebar.querySelectorAll('.note-overlay-tab').forEach(function(tab) {
            tab.addEventListener('click', function() {
                activeTab = tab.dataset.tab;
                sidebar.querySelectorAll('.note-overlay-tab').forEach(t => t.classList.toggle('active', t === tab));
                renderNotes(true);
                updateToolbar();
            });
        });
        document.getElementById('note-overlay-pop-submit').addEventListener('click', submitNote);
        document.getElementById('note-overlay-pop-cancel').addEventListener('click', hideInputPop);
        document.getElementById('note-overlay-pop-zoom').addEventListener('click', zoomInputPop);
        document.getElementById('note-overlay-confirm-ok').addEventListener('click', confirmDelete);
        document.getElementById('note-overlay-confirm-cancel').addEventListener('click', hideConfirmPop);
        linkPop.addEventListener('click', function(e) {
            const button = e.target.closest('[data-link-action]');
            if (!button) return;
            e.stopPropagation();
            const note = notes.find(n => n.id === activeLinkNoteId);
            hideLinkPop();
            if (!note) return;
            if (button.dataset.linkAction === 'select') beginTextElementSelect(note.id);
            else unlinkTextElement(note.id);
        });
        document.getElementById('note-overlay-modal-edit-btn').addEventListener('click', function() { modalDirectEdit = false; enterModalEdit(); });
        document.getElementById('note-overlay-modal-close-btn').addEventListener('click', closeModal);
        document.getElementById('note-overlay-modal-save-btn').addEventListener('click', saveModalEdit);
        document.getElementById('note-overlay-modal-cancel-btn').addEventListener('click', closeModal);
        document.getElementById('note-overlay-modal-prev').addEventListener('click', function() { navigateModal(-1); });
        document.getElementById('note-overlay-modal-next').addEventListener('click', function() { navigateModal(1); });
        modal.querySelectorAll('[data-cmd]').forEach(btn => {
            btn.addEventListener('mousedown', function(e) {
                e.preventDefault();
                const cmd = this.dataset.cmd;
                const editor = document.getElementById('note-overlay-editor');
                editor.focus();
                if (cmd === 'insertTable') {
                    document.execCommand('insertHTML', false,
                        '<table border="1" cellpadding="4" cellspacing="0"><tr><td><br></td><td><br></td></tr><tr><td><br></td><td><br></td></tr></table>');
                } else {
                    document.execCommand(cmd, false, null);
                }
            });
        });
        modal.querySelectorAll('[data-table-cmd]').forEach(btn => {
            btn.addEventListener('mousedown', function(e) {
                e.preventDefault();
                editCurrentTableColumn(this.dataset.tableCmd);
            });
        });
        const editorForTable = document.getElementById('note-overlay-editor');
        ['mouseup', 'keyup', 'focus'].forEach(function(type) {
            editorForTable.addEventListener(type, updateTableToolbarVisibility);
        });

        // 大窗拖拽移动（按住头部）
        const header = document.getElementById('note-overlay-modal-header');
        header.addEventListener('mousedown', function(e) {
            if (e.target.closest('button')) return;
            const box = document.getElementById('note-overlay-modal-box');
            const startX = e.clientX, startY = e.clientY;
            const origLeft = box.offsetLeft, origTop = box.offsetTop;
            box.classList.add('dragging');
            function move(ev) {
                box.style.left = (origLeft + ev.clientX - startX) + 'px';
                box.style.top = (origTop + ev.clientY - startY) + 'px';
            }
            function up() {
                document.removeEventListener('mousemove', move);
                document.removeEventListener('mouseup', up);
                box.classList.remove('dragging');
            }
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
        });

        // 侧栏宽度拖拽
        resizer.addEventListener('mousedown', function(e) {
            e.preventDefault();
            const startX = e.clientX;
            const startW = getSidebarWidth();
            resizer.classList.add('active');
            function move(ev) {
                let w = startW - (ev.clientX - startX); // 向左拖变宽
                w = Math.max(240, Math.min(900, w));
                w = Math.min(w, window.innerWidth - 120);
                try { localStorage.setItem(WIDTH_KEY, w); } catch (err) {}
                setSidebarVar();
                applyLayout();
            }
            function up() {
                document.removeEventListener('mousemove', move);
                document.removeEventListener('mouseup', up);
                resizer.classList.remove('active');
            }
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
        });
    }

    // ========== 侧栏开关与缓存 ==========
    function toggleSidebar() {
        const sidebar = document.getElementById('note-overlay-sidebar');
        const open = sidebar.classList.toggle('open');
        try {
            localStorage.setItem(OPEN_KEY, JSON.stringify({ open: open, t: Date.now() }));
        } catch (e) {}
        updateToggleShift();
        applyLayout();
        renderNotes(true);
    }

    function loadOpenState() {
        try {
            const raw = localStorage.getItem(OPEN_KEY);
            if (raw) {
                const st = JSON.parse(raw);
                if (st && typeof st.open === 'boolean' && Date.now() - st.t < OPEN_TTL) {
                    return { open: st.open, valid: true };
                }
            }
        } catch (e) {}
        return { open: false, valid: false };
    }

    // 展开/折叠时，注释按钮与布局模式按钮一起移动
    function updateToggleShift() {
        const sidebar = document.getElementById('note-overlay-sidebar');
        const toggle = document.getElementById('note-overlay-toggle');
        const modeBtn = document.getElementById('note-overlay-mode-btn');
        const resizer = document.getElementById('note-overlay-resizer');
        const hasCurrentAnnotations = getCurrentPageNotes().length + getCurrentPageStatusNotes().length > 0;
        const hideToggle = !isWritable && !hasCurrentAnnotations;
        const open = sidebar.classList.contains('open');
        toggle.style.display = hideToggle ? 'none' : '';
        toggle.classList.toggle('shifted', open);
        toggle.title = open ? '折叠注释栏' : '展开注释栏';
        modeBtn.classList.toggle('shifted', open);
        modeBtn.style.display = open ? 'flex' : 'none';
        resizer.classList.toggle('show', open);
    }

    // ========== 布局模式 ==========
    function getLayoutMode() {
        try {
            const m = localStorage.getItem(LAYOUT_KEY);
            if (m === 'compress' || m === 'scale') return m;
            localStorage.setItem(LAYOUT_KEY, 'scale');
        } catch (e) {}
        return 'scale';
    }

    function setLayoutMode(m) {
        try {
            localStorage.setItem(LAYOUT_KEY, m);
        } catch (e) {}
        updateModeBtn();
        applyLayout();
    }

    function toggleLayoutMode() {
        setLayoutMode(getLayoutMode() === 'compress' ? 'scale' : 'compress');
        if (getLayoutMode() === 'scale') {
            markersReady = false;
            fadeOutMarkers();
            setTimeout(() => {
                applyLayout();
                requestAnimationFrame(() => requestAnimationFrame(() => {
                    rebuildMarkers(true);
                    restartMarkerFadeTimer();
                }));
            }, 480);
        } else {
            markersReady = true;
            rebuildMarkers(true);
            restartMarkerFadeTimer();
        }
        setStatus(getLayoutMode() === 'scale' ? '已切换为等比缩放模式' : '已切换为压宽模式');
    }

    function updateModeBtn() {
        const btn = document.getElementById('note-overlay-mode-btn');
        const scale = getLayoutMode() === 'scale';
        btn.innerHTML = scale ? ICONS.compress : ICONS.scale;
        btn.title = scale ? '切换压宽模式' : '切换等比模式';
    }

    // 应用布局：compress = 页面被压缩宽度；scale = 按窗口等比例缩小（字号同步缩放）
    function applyLayout() {
        const main = document.getElementById('note-overlay-main');
        const inner = document.getElementById('note-overlay-main-inner');
        const frame = document.getElementById('note-overlay-preview-frame');
        const sidebar = document.getElementById('note-overlay-sidebar');
        if (!main || !inner) return;

        const open = sidebar.classList.contains('open');
        const mode = getLayoutMode();
        const sw = setSidebarVar();
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        if (!open || mode === 'compress') {
            if (frame) frame.classList.remove('note-overlay-preview-active');
            main.style.flex = '1';
            main.style.width = '';
            main.style.height = '100vh';
            main.style.overflowY = 'auto';
            inner.style.width = '';
            inner.style.height = '';
            inner.style.transform = 'none';
            if (frame) { frame.style.width = ''; frame.style.height = ''; frame.style.minHeight = ''; frame.style.margin = ''; }
            main.style.paddingTop = '0';
            main.style.paddingBottom = '0';
            main.style.background = '';
            main.style.boxShadow = '';
            return;
        }

        if (frame) frame.classList.add('note-overlay-preview-active');

        // 等比缩放模式：inner 按整窗口宽度渲染，再整体缩小到剩余宽度
        const k = Math.max(0.1, Math.min(1, (vw - sw) / vw));
        main.style.flex = '0 0 auto';
        main.style.width = (vw - sw) + 'px';
        main.style.height = '100vh';
        main.style.overflowY = 'auto';
        inner.style.width = vw + 'px';
        inner.style.height = '';
        const contentH = Math.max(inner.scrollHeight, vh);
        // transform 不会改变布局尺寸，滚动范围必须同步使用缩放后的视觉高度，避免末尾出现空白。
        inner.style.height = Math.ceil(contentH * k) + 'px';
        inner.style.transform = 'scale(' + k + ')';
        inner.style.transformOrigin = 'top left';
        // 保持页面原始宽高比，缩放后上下留白并由主区域居中承载
        const previewRatioH = Math.floor((vw - sw) * vh / vw);
        const contentVisualH = Math.ceil(contentH * k);
        const previewH = Math.max(180, Math.min(previewRatioH, contentVisualH));
        main.style.height = '100vh';
        main.style.overflow = 'hidden';
        main.style.paddingTop = Math.max(0, (vh - previewH) / 2) + 'px';
        main.style.paddingBottom = Math.max(0, (vh - previewH) / 2) + 'px';
        main.style.boxSizing = 'border-box';
        if (frame) { frame.style.width = (vw - sw) + 'px'; frame.style.height = previewH + 'px'; frame.style.minHeight = '0'; frame.style.margin = '0 auto'; }
        requestAnimationFrame(() => {
            if (document.querySelector('.' + MARKER_CLASS)) refreshMarkersAfterLayout();
        });
    }

    // ========== 卡片高度模式（记忆缓存） ==========
    function getCardHeightMode() {
        try {
            const m = localStorage.getItem(CARD_HEIGHT_KEY);
            if (m === 'eq') return 'eq';
        } catch (e) {}
        return 'full';
    }

    function setCardHeightClass() {
        const list = document.getElementById('note-overlay-list');
        const btn = document.getElementById('note-overlay-height-btn');
        if (!list || !btn) return;
        const eq = getCardHeightMode() === 'eq';
        list.classList.toggle('note-overlay-eq', eq);
        btn.innerHTML = eq ? ICONS.heightEq : ICONS.heightFull;
        btn.title = eq ? '展示全部卡片' : '卡片等高展示';
    }

    function toggleCardHeight() {
        const m = getCardHeightMode() === 'eq' ? 'full' : 'eq';
        try { localStorage.setItem(CARD_HEIGHT_KEY, m); } catch (e) {}
        setCardHeightClass();
    }

    // ========== 鼠标旁浮窗（注释输入） ==========
    function positionPop(pop, clientX, clientY) {
        const rect = pop.getBoundingClientRect();
        const m = 12;
        let left = clientX + m;
        let top = clientY + m;
        if (left + rect.width > window.innerWidth - 8) {
            left = clientX - rect.width - m;
        }
        if (top + rect.height > window.innerHeight - 8) {
            top = clientY - rect.height - m;
        }
        pop.style.left = Math.max(8, left) + 'px';
        pop.style.top = Math.max(8, top) + 'px';
    }

    function showInputPopAt(clientX, clientY, title) {
        const pop = document.getElementById('note-overlay-pop');
        document.getElementById('note-overlay-pop-title').textContent = title || '添加注释';
        pop.classList.add('show');
        if (clientX != null) {
            positionPop(pop, clientX, clientY);
        } else {
            const vw = window.innerWidth, vh = window.innerHeight;
            pop.style.left = (vw - 300) + 'px';
            pop.style.top = (vh - 220) + 'px';
        }
        document.getElementById('note-overlay-pop-textarea').focus();
    }

    function hideInputPop() {
        document.getElementById('note-overlay-pop').classList.remove('show');
        document.getElementById('note-overlay-pop-textarea').value = '';
        document.getElementById('note-overlay-pop-textarea').placeholder = '输入注释内容...';
        clearSelectionHighlight();
        selectedElement = null;
        exitSelectMode();
    }

    function hideLinkPop() {
        const pop = document.getElementById('note-overlay-link-pop');
        if (pop) pop.classList.remove('show');
        activeLinkNoteId = null;
    }

    function showLinkPop(noteId, clientX, clientY) {
        const pop = document.getElementById('note-overlay-link-pop');
        if (!pop) return;
        activeLinkNoteId = noteId;
        const note = notes.find(n => n.id === noteId);
        const unlink = pop.querySelector('[data-link-action="unlink"]');
        if (unlink) unlink.style.display = note && getNoteSelectors(note).length ? '' : 'none';
        pop.classList.add('show');
        positionPop(pop, clientX, clientY);
    }

    function beginTextElementSelect(id) {
        textSelectingId = id;
        if (!selectMode) toggleSelectMode();
        const card = document.querySelector('.note-overlay-card[data-id="' + id + '"]');
        if (card) card.classList.add('note-overlay-card-active', 'note-overlay-link-selecting');
        setStatus('请选择页面元素');
    }

    async function unlinkTextElement(id) {
        const note = notes.find(n => n.id === id);
        if (!note) return;
        note.selectors = [];
        note.selector = '';
        try {
            const res = await fetch(TEXT_ANNOTATIONS_API + '/' + id, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ selectors: [], selector: '' }) });
            if (!res.ok) throw new Error('断开链接失败');
            renderNotes();
            setStatus('已断开元素链接');
        } catch (e) { setStatus(e.message); }
    }

    // 浮窗放大为大窗编辑（新建注释）
    function zoomInputPop() {
        const ta = document.getElementById('note-overlay-pop-textarea');
        draftContent = ta.value;
        draftSelectors = selectedElement ? generateSelectors(selectedElement) : [];
        document.getElementById('note-overlay-pop').classList.remove('show');
        ta.value = '';
        ta.placeholder = '输入注释内容...';
        exitSelectMode(true); // 保留元素选中高亮
        openModal(null, true);
    }

    // ========== 鼠标旁浮窗（删除确认） ==========
    function showConfirmPop(clientX, clientY) {
        const pop = document.getElementById('note-overlay-confirm-pop');
        pop.classList.add('show');
        positionPop(pop, clientX, clientY);
    }

    function hideConfirmPop() {
        document.getElementById('note-overlay-confirm-pop').classList.remove('show');
        pendingDeleteId = null;
        pendingDeleteType = 'text';
        pendingDeleteIndex = -1;
    }

    async function confirmDelete() {
        if (!pendingDeleteId) return;
        const id = pendingDeleteId;
        const type = pendingDeleteType;
        const elementIndex = pendingDeleteIndex;
        hideConfirmPop();
        if (type === 'status') {
            try { const res=await fetch(STATUS_ANNOTATIONS_API+'/'+id,{method:'DELETE'}); if(!res.ok&&res.status!==204)throw new Error('删除失败'); statusNotes=statusNotes.filter(n=>n.id!==id); if(activeStatusId===id) restoreActiveStatus(); renderNotes(); setStatus('已删除'); } catch(e) { setStatus(e.message); }
            return;
        }
        if (type === 'status-element') {
            const item=statusNotes.find(n=>n.id===id);
            if(item) { item.elements=(item.elements||[]).filter((_,i)=>i!==elementIndex); item.updated=new Date().toISOString(); try { await saveStatusList(); renderNotes(); } catch(e) { setStatus(e.message); } }
            return;
        }
        try {
            const res = await fetch(TEXT_ANNOTATIONS_API + '/' + id, { method: 'DELETE' });
            if (!res.ok && res.status !== 204) throw new Error('删除失败');
            notes = notes.filter(n => n.id !== id);
            renderNotes();
            setStatus('已删除');
        } catch (e) {
            setStatus('删除失败: ' + e.message);
        }
    }

    // ========== 选择模式 ==========
    async function saveStatusList() {
            const res = await fetch(STATUS_ANNOTATIONS_API, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(statusNotes) });
        if (!res.ok) throw new Error('状态保存失败');
    }
    async function addStatusNote() {
        if (!isWritable) return;
        const item = { statusName: '新状态', description: '', elements: [], filename: getPageFilename(), url: window.location.pathname + window.location.search + window.location.hash, created: new Date().toISOString(), updated: new Date().toISOString() };
        try { const r = await fetch(STATUS_ANNOTATIONS_API, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(item)}); if (!r.ok) throw new Error('新增失败'); statusNotes.push(await r.json()); statusEditingId = statusNotes[statusNotes.length - 1].id; renderNotes(); const card=document.querySelector('.note-overlay-status-card:last-child'); const title=card&&card.querySelector('[data-status-field="name"]'); if(title){ title.focus(); const range=document.createRange(); range.selectNodeContents(title); const selection=window.getSelection(); selection.removeAllRanges(); selection.addRange(range); } setStatus('状态已新增'); } catch(e) { setStatus(e.message); }
    }
    async function editStatusNote(id) {
        const item = statusNotes.find(n => n.id === id); if (!item || !isWritable) return;
        const name = window.prompt('状态名', item.statusName || ''); if (!name || !name.trim()) return;
        const description = window.prompt('说明（可选）', item.description || '');
        Object.assign(item, {statusName:name.trim(), description:description == null ? item.description || '' : description, updated:new Date().toISOString()});
        try { await saveStatusList(); renderNotes(); setStatus('状态已保存'); } catch(e) { setStatus(e.message); }
    }
    async function saveStatusEdit(id) {
        const card = document.querySelector('.note-overlay-status-card[data-id="' + id + '"]');
        const item = statusNotes.find(n => n.id === id); if (!card || !item) return;
        const nameField = card.querySelector('[data-status-field="name"]');
        const descriptionField = card.querySelector('[data-status-field="description"]');
        item.statusName = nameField ? nameField.textContent.trim() || '未命名状态' : item.statusName || '未命名状态';
        item.description = descriptionField ? descriptionField.textContent.trim() : '';
        item.updated = new Date().toISOString();
        try { await saveStatusList(); statusEditingId = null; renderNotes(); setStatus('状态已保存'); } catch(e) { setStatus(e.message); }
    }
    async function deleteStatusNote(id, e) {
        pendingDeleteId = id; pendingDeleteType = 'status';
        const title = document.querySelector('#note-overlay-confirm-pop .note-overlay-pop-title');
        if (title) title.textContent = '删除此状态？';
        showConfirmPop(e.clientX, e.clientY);
    }
    function beginStatusElementSelect(id) { statusSelectingId=id; toggleSelectMode(); setStatus('请选择页面元素'); }
    async function removeStatusElement(id, index, clickEvent) {
        pendingDeleteId=id; pendingDeleteType='status-element'; pendingDeleteIndex=index;
        const title=document.querySelector('#note-overlay-confirm-pop .note-overlay-pop-title'); if(title) title.textContent='解除此元素绑定？';
        showConfirmPop(clickEvent.clientX, clickEvent.clientY);
    }
    async function enableStatus(id) {
        const item=statusNotes.find(n=>n.id===id); if(!item) return;
        restoreActiveStatus(); const snapshot={}; (item.elements||[]).forEach(binding=>{const selectors=Array.isArray(binding.selectors)&&binding.selectors.length?binding.selectors:[binding.selector]; const el=tryLocateElement(selectors.filter(Boolean)); if(el){const key=binding.selector||selectors[0]; snapshot[key]={el,display:el.style.display,wasHidden:el.style.display==='none'}; el.style.setProperty('display','none','important');}});
        activeStatusId=id; statusSnapshot=snapshot; updateToolbar(); renderNotes();
    }
    function restoreActiveStatus() {
        if (!statusSnapshot) return;
        Object.keys(statusSnapshot).forEach(selector=>{const s=statusSnapshot[selector], el=s.el; if(el && el.style.getPropertyValue('display')==='none' && el.style.getPropertyPriority('display')==='important' && !s.wasHidden) { el.style.removeProperty('display'); if(s.display) el.style.display=s.display; }});
        activeStatusId=null; statusSnapshot=null; updateToolbar(); renderNotes();
    }

    async function reorderStatus(fromId, toId, pos) {
        const page = getPageFilename(), list = getCurrentPageStatusNotes(); const from=list.findIndex(n=>n.id===fromId), to=list.findIndex(n=>n.id===toId); if(from<0||to<0)return;
        const [moved]=list.splice(from,1); let at=list.findIndex(n=>n.id===toId); if(pos==='after')at++; list.splice(at,0,moved);
        statusNotes=statusNotes.filter(n=>!n.url||n.filename!==page).concat(list); renderNotes();
        try { await saveStatusList(); } catch(e) { setStatus(e.message); }
    }

    function toggleSelectMode() {
        if (!selectMode) restoreActiveStatus();
        selectMode = !selectMode;
        const btn = document.getElementById('note-overlay-select-btn');

        if (selectMode) {
            btn.classList.add('active');
            document.body.style.cursor = 'crosshair';
            document.addEventListener('mouseover', handleElementHover, true);
            document.addEventListener('mouseout', handleElementOut, true);
            document.addEventListener('click', handleElementSelect, true);
            document.addEventListener('keydown', handleEscapeKey, true);
            document.addEventListener('contextmenu', handleSelectContextMenu, true);
        } else {
            exitSelectMode();
        }
    }

    // keepSelection: 从浮窗放大到大窗时保留元素选中高亮
    function exitSelectMode(keepSelection) {
        selectMode = false;
        const btn = document.getElementById('note-overlay-select-btn');
        btn.classList.remove('active');
        document.body.style.cursor = '';
        document.removeEventListener('mouseover', handleElementHover, true);
        document.removeEventListener('mouseout', handleElementOut, true);
        document.removeEventListener('click', handleElementSelect, true);
        document.removeEventListener('keydown', handleEscapeKey, true);
        document.removeEventListener('contextmenu', handleSelectContextMenu, true);
        document.querySelectorAll('.' + HIGHLIGHT_CLASS).forEach(el => {
            el.classList.remove(HIGHLIGHT_CLASS);
        });
        document.querySelectorAll('.note-overlay-link-selecting').forEach(card => {
            card.classList.remove('note-overlay-link-selecting', 'note-overlay-card-active');
        });
        if (!keepSelection) {
            clearSelectionHighlight();
            selectedElement = null;
        }
    }

    function handleElementHover(e) {
        if (e.target.closest('#note-overlay-sidebar') || e.target.id === 'note-overlay-toggle' ||
            e.target.closest('#note-overlay-modal')) return;
        if (e.target.closest('#note-overlay-main')) {
            e.target.classList.add(HIGHLIGHT_CLASS);
        }
    }

    function handleElementOut(e) {
        e.target.classList.remove(HIGHLIGHT_CLASS);
    }

    async function handleElementSelect(e) {
        if (e.target.closest('#note-overlay-sidebar') || e.target.id === 'note-overlay-toggle' ||
            e.target.closest('#note-overlay-modal')) return;
        if (!e.target.closest('#note-overlay-main')) return;

        e.preventDefault();
        e.stopPropagation();

        clearSelectionHighlight();
        selectedElement = e.target;
        selectedElement.classList.add(SELECTED_CLASS);

        if (activeTab === 'status' && statusSelectingId) {
            const item = statusNotes.find(n => n.id === statusSelectingId);
            if (item) {
                const selectors = generateSelectors(selectedElement);
                const selector = selectors[0];
                item.elements = item.elements || [];
                if (selector && !item.elements.some(x => x.selector === selector || (Array.isArray(x.selectors) && x.selectors.indexOf(selector) >= 0))) item.elements.push({ selector, selectors, label: (selectedElement.textContent || '').trim().slice(0, 40) || selectedElement.tagName.toLowerCase(), tag: selectedElement.tagName.toLowerCase() });
                item.updated = new Date().toISOString();
                saveStatusList().then(() => { renderNotes(); setStatus('元素已绑定'); }).catch(err => setStatus(err.message));
            }
            statusSelectingId = null; hideInputPop();
            return;
        }

        if (textSelectingId) {
            const item = notes.find(n => n.id === textSelectingId);
            if (item) {
                const selectors = generateSelectors(selectedElement);
                item.selectors = selectors;
                item.filename = getPageFilename();
                item.url = window.location.pathname + window.location.search + window.location.hash;
                try {
                    const res = await fetch(TEXT_ANNOTATIONS_API + '/' + item.id, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ selectors, filename: item.filename, url: item.url }) });
                    if (!res.ok) throw new Error('重新关联失败');
                    setStatus('元素已重新关联');
                    renderNotes();
                } catch (err) { setStatus(err.message); }
            }
            textSelectingId = null;
            exitSelectMode();
            return;
        }

        showInputPopAt(e.clientX, e.clientY, '添加注释');
        const textarea = document.getElementById('note-overlay-pop-textarea');
        textarea.placeholder = '为选中的元素添加注释...';
        textarea.focus();
    }

    function clearSelectionHighlight() {
        document.querySelectorAll('.' + SELECTED_CLASS).forEach(el => {
            el.classList.remove(SELECTED_CLASS);
        });
    }

    function handleEscapeKey(e) {
        if (e.key === 'Escape') {
            exitSelectMode();
            hideInputPop();
        }
    }

    function handleSelectContextMenu(e) {
        if (!selectMode) return;
        e.preventDefault();
        e.stopPropagation();
        statusSelectingId = null;
        exitSelectMode();
    }

    // ========== 选择器生成与定位 ==========
    function generateSelectors(el) {
        const selectors = [];

        if (el.id) {
            selectors.push('#' + el.id);
        }

        const path = [];
        let current = el;
        while (current && current !== document.body && current !== document.documentElement) {
            let selector = current.tagName.toLowerCase();
            if (current.id) {
                selector = '#' + current.id;
                path.unshift(selector);
                break;
            } else {
                const parent = current.parentElement;
                if (parent) {
                    const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
                    if (siblings.length > 1) {
                        const index = siblings.indexOf(current) + 1;
                        selector += ':nth-child(' + index + ')';
                    }
                }
                if (current.className && typeof current.className === 'string') {
                    const classes = current.className.trim().split(/\s+/)
                        .filter(c => c && !c.startsWith('note-overlay-'));
                    if (classes.length > 0) {
                        selector += '.' + classes[0];
                    }
                }
            }
            path.unshift(selector);
            current = current.parentElement;
            if (path.length >= 5) break;
        }
        if (path.length > 0) {
            selectors.push(path.join(' > '));
        }

        const tagPath = [];
        current = el;
        while (current && current !== document.body && current !== document.documentElement) {
            tagPath.unshift(current.tagName.toLowerCase());
            current = current.parentElement;
            if (tagPath.length >= 6) break;
        }
        if (tagPath.length > 0) {
            selectors.push(tagPath.join(' > '));
        }

        return selectors;
    }

    function getNoteSelectors(note) {
        if (Array.isArray(note.selectors)) return note.selectors;
        if (note.selector) return [note.selector];
        if (note.path) return [note.path];
        return [];
    }

    function tryLocateElement(selectors) {
        for (const selector of selectors) {
            try {
                const el = document.querySelector(selector);
                if (el) return el;
            } catch (e) {}
        }
        return null;
    }

    // 元素相对 main-inner 的布局偏移（不受 transform 缩放影响）
    function getLayoutOffset(el, container) {
        let top = 0, left = 0;
        let cur = el;
        while (cur && cur !== container) {
            top += cur.offsetTop;
            left += cur.offsetLeft;
            cur = cur.offsetParent;
            if (!cur) break;
        }
        return { left: left, top: top };
    }

    // 等比缩放模式下序号标记的缩放系数
    function getMarkerScale() {
        const sidebar = document.getElementById('note-overlay-sidebar');
        if (!sidebar || !sidebar.classList.contains('open')) return 1;
        if (getLayoutMode() !== 'scale') return 1;
        const vw = window.innerWidth;
        return (vw - getSidebarWidth()) / vw;
    }

    // ========== 提交注释（追加到末尾） ==========
    async function submitNote() {
        const textarea = document.getElementById('note-overlay-pop-textarea');
        const content = textarea.value.trim();
        if (!content && !selectedElement) return;
        if (!isWritable) {
            setStatus('当前为只读模式，无法保存');
            return;
        }

        const selectors = selectedElement ? generateSelectors(selectedElement) : [];

        const note = {
            title: stripHtml(content).split('\n')[0] || '注释',
            content: content,
            selectors: selectors,
            filename: getPageFilename(),
            url: window.location.pathname + window.location.search + window.location.hash,
            created: new Date().toISOString()
        };

        try {
            const res = await fetch(TEXT_ANNOTATIONS_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(note)
            });
            if (!res.ok) throw new Error('保存失败');
            const saved = await res.json();
            notes.push(Object.assign({}, note, saved));
            renderNotes();
            hideInputPop();
            setStatus('添加成功');
        } catch (e) {
            setStatus('添加失败: ' + e.message);
        }
    }

    // ========== 渲染（仅当前页面，序号与顺序一致） ==========
    function getCurrentPageNotes() {
        const page = getPageFilename();
        return notes.filter(n => n.url && n.filename === page);
    }

    function getCurrentPageStatusNotes() {
        const page = getPageFilename();
        return statusNotes.filter(n => n.url && n.filename === page);
    }

    function renderNotes(preventAutoCollapse) {
        const list = document.getElementById('note-overlay-list');
        const currentPageNotes = getCurrentPageNotes();
        const currentPageStatus = getCurrentPageStatusNotes();
        const sidebar = document.getElementById('note-overlay-sidebar');
        if (!preventAutoCollapse && !isWritable && sidebar && currentPageNotes.length + currentPageStatus.length === 0 && sidebar.classList.contains('open')) {
            // 无当前页面注释时自动收起，但不改写用户之前的展开状态缓存。
            sidebar.classList.remove('open');
            updateToggleShift();
            applyLayout();
        }

        if (activeTab === 'status') {
            list.innerHTML = currentPageStatus.length ? currentPageStatus.map((n, i) => renderStatusCard(n, i + 1)).join('') : '<div class="note-overlay-empty">暂无状态注释</div>';
            const statusCount = document.getElementById('note-overlay-status-count');
            if (statusCount) { statusCount.textContent = currentPageStatus.length; statusCount.classList.toggle('show', currentPageStatus.length > 0); }
            bindCardEvents();
            updateBadge(currentPageNotes.length + currentPageStatus.length);
            return;
        }

        if (currentPageNotes.length === 0) {
            list.innerHTML = '<div class="note-overlay-empty">暂无注释</div>';
        } else {
            let html = '';
            currentPageNotes.forEach((note, index) => {
                html += renderCard(note, index + 1);
            });
            list.innerHTML = html;
        }

        bindCardEvents();
        updateBadge(currentPageNotes.length + currentPageStatus.length);
        const textCount = document.getElementById('note-overlay-text-count');
        if (textCount) { textCount.textContent = currentPageNotes.length; textCount.classList.toggle('show', currentPageNotes.length > 0); }
        const statusCount = document.getElementById('note-overlay-status-count');
        if (statusCount) { statusCount.textContent = currentPageStatus.length; statusCount.classList.toggle('show', currentPageStatus.length > 0); }
    }

    function renderStatusCard(status, number) {
        const editing = statusEditingId === status.id;
        const enabled = activeStatusId === status.id;
        const actions = isWritable ? `<div class="note-overlay-card-actions">
            ${!enabled ? `<button class="note-overlay-btn note-overlay-btn-text note-overlay-status-enable-btn" data-status-action="enable" data-id="${status.id}" title="启用状态">${ICONS.play}</button>` : ''}
            <button class="note-overlay-btn note-overlay-btn-text" data-status-action="add-element" data-id="${status.id}" title="添加可隐藏元素">${ICONS.plus}</button>
            ${!editing ? `<button class="note-overlay-btn note-overlay-btn-text" data-status-action="edit" data-id="${status.id}" title="编辑">${ICONS.edit}</button>` : ''}
            <button class="note-overlay-btn note-overlay-btn-text" data-status-action="delete" data-id="${status.id}" title="删除" style="color:${COLORS.danger};">${ICONS.del}</button>
        </div>` : (!enabled ? `<div class="note-overlay-card-actions note-overlay-status-readonly-actions">
            <button class="note-overlay-btn note-overlay-btn-text note-overlay-status-enable-btn" data-status-action="enable" data-id="${status.id}" title="启用状态">${ICONS.play}</button>
        </div>` : '');
        const elements = Array.isArray(status.elements) ? status.elements : [];
        const elementsHtml = isWritable ? `<div class="note-overlay-status-elements">${elements.length ? elements.map((el, i) => `<div class="note-overlay-status-element" data-status-id="${status.id}" data-status-index="${i}" title="点击定位元素"><span>${escapeHtml(el.label || el.tag || '页面元素')}</span><button class="note-overlay-btn note-overlay-btn-text" data-status-action="remove-element" data-id="${status.id}" data-element-index="${i}" title="删除绑定">${ICONS.del}</button></div>`).join('') : '<span class="note-overlay-status-empty">暂无绑定元素</span>'}</div>` : '';
        return `<div class="note-overlay-card note-overlay-status-card${activeStatusId === status.id ? ' note-overlay-status-enabled' : ''}" data-id="${status.id}">
            ${isWritable ? '<div class="note-overlay-card-drag" title="拖拽排序"></div>' : ''}
            <div class="note-overlay-card-header"><strong contenteditable="${editing}" data-status-field="name" data-status-title="true" data-id="${status.id}">${escapeHtml(status.statusName || '未命名状态')}</strong>${actions}${enabled ? `<span class="note-overlay-status-enabled-mark" title="当前已启用">${ICONS.check}</span>` : ''}</div>
            <div class="note-overlay-status-divider"></div>
            ${status.description || editing ? `<div class="note-overlay-card-content" contenteditable="${editing}" data-status-field="description" data-id="${status.id}">${escapeHtml(status.description || '')}</div>` : ''}
            ${elementsHtml}
        </div>`;
    }

    function renderCard(note, number) {
        const hasElementLink = getNoteSelectors(note).length > 0;
        const actionsHtml = isWritable ? `
            <div class="note-overlay-card-actions">
                <button class="note-overlay-btn note-overlay-btn-text" data-action="zoom" data-id="${note.id}" title="放大查看">${ICONS.zoom}</button>
                <button class="note-overlay-btn note-overlay-btn-text" data-action="link" data-id="${note.id}" title="元素链接">${ICONS.link}</button>
                <button class="note-overlay-btn note-overlay-btn-text" data-action="edit" data-id="${note.id}" title="编辑">${ICONS.edit}</button>
                <button class="note-overlay-btn note-overlay-btn-text" data-action="delete" data-id="${note.id}" title="删除" style="color:${COLORS.danger};">${ICONS.del}</button>
            </div>
        ` : '';

        return `
            <div class="note-overlay-card" data-id="${note.id}" ${getNoteSelectors(note).length > 0 ? 'data-has-selector="true"' : ''}>
                <div class="note-overlay-card-drag" title="拖拽排序"></div>
                <div class="note-overlay-card-header">
                    <span class="note-overlay-card-number">${number}</span>
                    ${actionsHtml}
                </div>
                <div class="note-overlay-card-content">${renderContent(note.content)}</div>
            </div>
        `;
    }

    function stripHtml(html) {
        const div = document.createElement('div');
        div.innerHTML = html || '';
        return div.textContent;
    }

    // 内容含 HTML 标签则按富文本渲染，否则转义纯文本
    function renderContent(content) {
        if (!content) return '';
        if (content.indexOf('<') !== -1 && content.indexOf('>') !== -1) {
            return content;
        }
        return escapeHtml(content);
    }

    // 根据编辑器光标所在单元格，对当前表格增加或删除列。
    function editCurrentTableColumn(action) {
        const editor = document.getElementById('note-overlay-editor');
        const selection = window.getSelection();
        const node = selection && selection.anchorNode;
        const cell = node && (node.nodeType === 1 ? node.closest('td,th') : node.parentElement && node.parentElement.closest('td,th'));
        const table = cell && cell.closest('table');
        if (!editor || !cell || !table || !editor.contains(table)) return;
        const row = cell.parentElement;
        const columnIndex = Array.prototype.indexOf.call(row.children, cell);
        const rows = table.querySelectorAll('tr');
        if (action === 'addColumn' || action === 'addRow') {
            if (action === 'addRow') {
                const newRow = document.createElement('tr');
                Array.from(row.children).forEach(function(source) {
                    const newCell = document.createElement(source.tagName === 'TH' ? 'th' : 'td');
                    newCell.innerHTML = '<br>';
                    newRow.appendChild(newCell);
                });
                row.parentElement.insertBefore(newRow, row.nextSibling);
                editor.focus();
                return;
            }
            rows.forEach(function(tr) {
                const reference = tr.children[columnIndex];
                const newCell = document.createElement(reference && reference.tagName === 'TH' ? 'th' : 'td');
                newCell.innerHTML = '<br>';
                if (reference) tr.insertBefore(newCell, reference.nextSibling);
                else tr.appendChild(newCell);
            });
        } else if (action === 'deleteColumn' || action === 'deleteRow') {
            if (action === 'deleteRow') {
                if (table.rows.length <= 1) return;
                row.remove();
                editor.focus();
                return;
            }
            if (row.children.length <= 1) return;
            rows.forEach(function(tr) {
                if (tr.children[columnIndex]) tr.removeChild(tr.children[columnIndex]);
            });
        }
        editor.focus();
    }

    function updateTableToolbarVisibility() {
        const editor = document.getElementById('note-overlay-editor');
        const modal = document.getElementById('note-overlay-modal');
        const selection = window.getSelection();
        const node = selection && selection.anchorNode;
        const cell = node && (node.nodeType === 1 ? node.closest('td,th') : node.parentElement && node.parentElement.closest('td,th'));
        modal.classList.toggle('has-table', !!(cell && editor && editor.contains(cell)));
    }

    function bindCardEvents() {
        document.querySelectorAll('.note-overlay-status-element[data-status-id]').forEach(row => row.addEventListener('click', function(e) {
            if (e.target.closest('[data-status-action]')) return;
            const status = statusNotes.find(n => n.id === this.dataset.statusId);
            const binding = status && status.elements && status.elements[Number(this.dataset.statusIndex)];
            locateStatusElement(binding, this.dataset.statusId);
        }));
        document.querySelectorAll('[data-status-field]').forEach(field => field.addEventListener('blur', async function() {
            const item=statusNotes.find(n=>n.id===this.dataset.id); if(!item)return;
            if(this.dataset.statusField==='name') item.statusName=this.textContent.trim()||'未命名状态'; else item.description=this.textContent.trim();
            item.updated=new Date().toISOString();
            try {
                await saveStatusList();
                setTimeout(() => {
                    const card = this.closest('.note-overlay-status-card');
                    const focusedField = document.activeElement && document.activeElement.closest && document.activeElement.closest('[data-status-field]');
                    if (statusEditingId === item.id && (!focusedField || !card.contains(focusedField))) {
                        statusEditingId = null;
        renderNotes();
    }
                }, 0);
            } catch(e) { setStatus(e.message); }
        }));
        document.querySelectorAll('[data-status-action]').forEach(btn => btn.addEventListener('click', function(e) {
            e.stopPropagation();
            const id = this.dataset.id, action = this.dataset.statusAction;
            if (action === 'edit' && statusEditingId !== id) { statusEditingId = id; renderNotes(); }
            if (action === 'delete') deleteStatusNote(id, e);
            if (action === 'add-element') beginStatusElementSelect(id);
            if (action === 'remove-element') removeStatusElement(id, Number(this.dataset.elementIndex), e);
            if (action === 'enable') enableStatus(id);
            if (action === 'restore') restoreActiveStatus();
        }));
        document.querySelectorAll('.note-overlay-card').forEach(card => {
            card.addEventListener('click', function(e) {
                if (e.target.closest('.note-overlay-card-actions') || e.target.closest('.note-overlay-card-drag')) return;
                const id = this.dataset.id;
                this.classList.add(CLICK_HIGHLIGHT_CLASS);
                if (this.dataset.hasSelector) {
                    if (!this.classList.contains('note-overlay-status-card')) restoreActiveStatus();
                    locateElement(id); // 点击卡片即定位
                }
            });
        });

        document.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                const action = this.dataset.action;
                const id = this.dataset.id;
                if (action === 'delete') {
                    const title = document.querySelector('#note-overlay-confirm-pop .note-overlay-pop-title');
                    if (title) title.textContent = '删除此注释？';
                    pendingDeleteType = 'text';
                    pendingDeleteId = id;
                    showConfirmPop(e.clientX, e.clientY);
                }
                else if (action === 'link') showLinkPop(id, e.clientX, e.clientY);
                else if (action === 'edit') openModal(id, true);
                else if (action === 'zoom') openModal(id, false);
            });
        });

        // 物理拖拽排序（鼠标事件，带幽灵卡片与插入指示线）
        document.querySelectorAll('.note-overlay-card-drag').forEach(handle => {
                handle.addEventListener('mousedown', function(e) {
                if (!isWritable) return;
                e.preventDefault();
                e.stopPropagation();
                const card = this.closest('.note-overlay-card');
                beginCardDrag(card, e, card.classList.contains('note-overlay-status-card'));
            });
        });
    }

    let dragState = null;

    function beginCardDrag(card, e, isStatus) {
        const rect = card.getBoundingClientRect();
        const ghost = document.createElement('div');
        ghost.className = 'note-overlay-ghost';
        ghost.innerHTML = card.innerHTML;
        ghost.style.width = rect.width + 'px';
        ghost.style.left = (e.clientX - 20) + 'px';
        ghost.style.top = (e.clientY - 14) + 'px';
        document.body.appendChild(ghost);

        card.classList.add('dragging');
        dragState = { id: card.dataset.id, ghost: ghost, card: card };

        function onMove(ev) {
            ghost.style.left = (ev.clientX - 20) + 'px';
            ghost.style.top = (ev.clientY - 14) + 'px';
            // 找鼠标下的卡片，决定插入位置
            clearDragIndicators(true);
            const under = document.elementFromPoint(ev.clientX, ev.clientY);
            const target = under && under.closest ? under.closest('.note-overlay-card') : null;
            if (target && target !== card) {
                const tr = target.getBoundingClientRect();
                const shift = card.getBoundingClientRect().height + 10;
                if (ev.clientY < tr.top + tr.height / 2) {
                    target.classList.add('drop-before');
                    shiftCards(target, card, 'down', shift);
                } else {
                    target.classList.add('drop-after');
                    shiftCards(target, card, 'up', shift);
                }
            }
        }

        function onUp() {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            const before = document.querySelector('.note-overlay-card.drop-before');
            const after = document.querySelector('.note-overlay-card.drop-after');
            const targetId = (before || after || {}).dataset ? (before || after).dataset.id : null;
            if (dragState && targetId) {
                const pos = before ? 'before' : 'after';
                if (isStatus) reorderStatus(dragState.id, targetId, pos); else reorderNotes(dragState.id, targetId, pos);
            }
            clearDragIndicators();
            if (dragState && dragState.ghost) dragState.ghost.remove();
            dragState = null;
        }

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }

    function clearDragIndicators(keepDragging) {
        document.querySelectorAll('.note-overlay-card').forEach(card => {
            if (!keepDragging) card.classList.remove('dragging');
            card.classList.remove('drop-before', 'drop-after', 'drag-shift-down', 'drag-shift-up');
            card.style.removeProperty('--note-overlay-drag-shift');
        });
    }

    function shiftCards(target, dragged, direction, shift) {
        const cards = Array.from(document.querySelectorAll('#note-overlay-list > .note-overlay-card'));
        const targetIndex = cards.indexOf(target);
        const draggedIndex = cards.indexOf(dragged);
        if (targetIndex < 0 || draggedIndex < 0) return;
        const start = direction === 'down' ? targetIndex : targetIndex + 1;
        const end = direction === 'down' ? draggedIndex - 1 : draggedIndex;
        if (start > end) return;
        cards.slice(start, end + 1).forEach(card => {
            if (card === dragged) return;
            card.style.setProperty('--note-overlay-drag-shift', shift + 'px');
            card.classList.add(direction === 'down' ? 'drag-shift-down' : 'drag-shift-up');
        });
    }

    // 拖拽排序：只调整当前页面注释的顺序，其余页面保持不变
    async function reorderNotes(fromId, toId, pos) {
        const pageNotes = getCurrentPageNotes();
        const from = pageNotes.findIndex(n => n.id === fromId);
        const to = pageNotes.findIndex(n => n.id === toId);
        if (from < 0 || to < 0) return;
        const [moved] = pageNotes.splice(from, 1);
        let insertAt = pageNotes.findIndex(n => n.id === toId);
        if (insertAt < 0) insertAt = pageNotes.length;
        if (pos === 'after') insertAt += 1;
        pageNotes.splice(insertAt, 0, moved);
        const page = getPageFilename();
        notes = notes.filter(n => n.filename && n.filename !== page).concat(pageNotes);
        renderNotes();

        if (!isWritable) return;
        try {
            const res = await fetch(TEXT_ANNOTATIONS_API, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(notes)
            });
            if (!res.ok) throw new Error('排序保存失败');
            setStatus('排序已保存');
        } catch (e) {
            setStatus(e.message);
        }
    }

    // ========== 定位 ==========
    function locateElement(id) {
        const note = notes.find(n => n.id === id);
        if (!note || getNoteSelectors(note).length === 0) {
            setStatus('无法定位元素');
            return;
        }

        const el = tryLocateElement(getNoteSelectors(note));
        if (el) {
            const card = document.querySelector('.note-overlay-card[data-id="' + id + '"]');
            const main = document.getElementById('note-overlay-main');
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            if (main) main.scrollTop = el.offsetTop - main.clientHeight / 2 + el.offsetHeight / 2;
            el.classList.add(HIGHLIGHT_CLASS);
            setTimeout(() => el.classList.remove(HIGHLIGHT_CLASS), 2000);
            el.classList.add(CLICK_HIGHLIGHT_CLASS);
            if (card) card.classList.add(CLICK_HIGHLIGHT_CLASS);
        } else {
            setStatus('元素不存在或已变化');
        }
    }

    function locateStatusElement(binding, statusId) {
        if (!binding) return;
        const selectors = Array.isArray(binding.selectors) && binding.selectors.length ? binding.selectors : [binding.selector];
        const el = tryLocateElement(selectors.filter(Boolean));
        if (!el) { setStatus('元素不存在或已变化'); return; }
        const main = document.getElementById('note-overlay-main');
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (main) main.scrollTop = el.offsetTop - main.clientHeight / 2 + el.offsetHeight / 2;
        el.classList.add(HIGHLIGHT_CLASS);
        setTimeout(() => el.classList.remove(HIGHLIGHT_CLASS), 2000);
        el.classList.add(CLICK_HIGHLIGHT_CLASS);
        const card = statusId && document.querySelector('.note-overlay-status-card[data-id="' + statusId + '"]');
        if (card) card.classList.add(CLICK_HIGHLIGHT_CLASS);
    }

    // ========== 序号标记：窗口内鼠标移动即显示，不动 3 秒渐出 ==========
    function findNoteByElement(el) {
        const currentPageNotes = getCurrentPageNotes();
        for (let i = 0; i < currentPageNotes.length; i++) {
            const note = currentPageNotes[i];
            const selectors = getNoteSelectors(note);
            if (selectors.length === 0) continue;
            const target = tryLocateElement(selectors);
            if (target && (el === target || target.contains(el))) {
                return { note: note, index: i };
            }
        }
        return null;
    }

    function showAllMarkers(reveal) {
        if (getLayoutMode() === 'scale' && !markersReady) return;
        const inner = document.getElementById('note-overlay-main-inner');
        const currentPageNotes = getCurrentPageNotes();
        // 移除已消失的
        document.querySelectorAll('.' + MARKER_CLASS).forEach(m => {
            if (!m.dataset.noteId) m.remove();
        });

        currentPageNotes.forEach((note, index) => {
            const selectors = getNoteSelectors(note);
            if (selectors.length === 0) return;
            const target = tryLocateElement(selectors);
            if (!target) return;

            let marker = document.querySelector('.' + MARKER_CLASS + '[data-note-id="' + note.id + '"]');
            if (!marker) {
                marker = document.createElement('div');
                marker.className = MARKER_CLASS;
                marker.dataset.noteId = note.id;
                // 点击序号定位右侧栏对应卡片
                marker.addEventListener('click', function(ev) {
                    ev.stopPropagation();
                    activeTab = 'text';
                    document.querySelectorAll('.note-overlay-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.tab === 'text'));
                    renderNotes();
                    updateToolbar();
                    locateCard(note.id);
                    locateElement(note.id);
                });
                document.body.appendChild(marker);
                marker.classList.add('marker-fade-in');
            }
            marker.textContent = index + 1;
            if (reveal) marker.classList.remove('fade-out');
            marker.classList.remove('note-overlay-marker-active');
            const rect = target.getBoundingClientRect();
            // 标记位于 transform 之外，直接使用页面可视坐标，避免等比例模式重复缩放造成偏移。
            const mw = 20;
            const mh = 20;
            marker.style.width = mw + 'px';
            marker.style.height = mh + 'px';
            marker.style.fontSize = '11px';
            marker.style.transform = 'none';
            marker.style.transformOrigin = 'center center';
            marker.style.position = 'fixed';
            marker.style.left = (rect.left - mw / 2) + 'px';
            marker.style.top = (rect.top - mh / 2) + 'px';
        });

        // 移除无对应元素的残留标记
        document.querySelectorAll('.' + MARKER_CLASS).forEach(m => {
            if (!currentPageNotes.some(n => n.id === m.dataset.noteId)) m.remove();
        });
    }

    function scheduleInitialMarkerRefresh() {
        // 等比例模式的序号由 init 在布局稳定后统一创建，避免初始化阶段闪出错误位置。
        if (getLayoutMode() === 'scale') return;
        [0, 100, 300, 700, 1200, 2000, 2800, 3500].forEach(delay => {
            setTimeout(() => {
                if (document.querySelector('.' + MARKER_CLASS)) refreshMarkersAfterLayout();
            }, delay);
        });
    }

    function refreshMarkersAfterLayout() {
        // 布局观察器只能移动已有序号，不能在布局未完成时创建新序号。
        if (!document.querySelector('.' + MARKER_CLASS)) return;
        showAllMarkers(false);
    }

    function rebuildMarkers(reveal) {
        document.querySelectorAll('.' + MARKER_CLASS).forEach(marker => marker.remove());
        markersReady = true;
        showAllMarkers(!!reveal);
    }

    function restartMarkerFadeTimer() {
        clearTimeout(markerTimer);
        markerTimer = setTimeout(fadeOutMarkers, MARKER_IDLE);
    }

    function observeMarkerLayout() {
        const inner = document.getElementById('note-overlay-main-inner');
        const main = document.getElementById('note-overlay-main');
        const frame = document.getElementById('note-overlay-preview-frame');
        if (!inner || typeof ResizeObserver === 'undefined') return;
        if (markerLayoutObserver) markerLayoutObserver.disconnect();
        markerLayoutObserver = new ResizeObserver(() => {
            requestAnimationFrame(() => {
                if (document.querySelector('.' + MARKER_CLASS)) refreshMarkersAfterLayout();
            });
        });
        markerLayoutObserver.observe(inner);
        if (main) markerLayoutObserver.observe(main);
        if (frame) markerLayoutObserver.observe(frame);
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(() => {
                if (document.querySelector('.' + MARKER_CLASS)) refreshMarkersAfterLayout();
            });
        }
        if (typeof MutationObserver !== 'undefined') {
            if (markerMutationObserver) markerMutationObserver.disconnect();
            let refreshQueued = false;
            markerMutationObserver = new MutationObserver(() => {
                if (refreshQueued) return;
                refreshQueued = true;
                requestAnimationFrame(() => {
                    refreshQueued = false;
                    if (document.querySelector('.' + MARKER_CLASS)) refreshMarkersAfterLayout();
                });
            });
            markerMutationObserver.observe(inner, { childList: true, subtree: true });
        }
    }

    // 点击页面序号 → 右侧栏定位并高亮对应卡片
    function locateCard(id) {
        const sidebar = document.getElementById('note-overlay-sidebar');
        if (sidebar && !sidebar.classList.contains('open')) {
            sidebar.classList.add('open');
            try { localStorage.setItem(OPEN_KEY, JSON.stringify({ open: true, t: Date.now() })); } catch (e) {}
            updateToggleShift();
            applyLayout();
        }
        const card = document.querySelector('.note-overlay-card[data-id="' + id + '"]');
        if (!card) {
            setStatus('未找到对应卡片');
            return;
        }
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.add('note-overlay-card-active');
        card.classList.add(CLICK_HIGHLIGHT_CLASS);
        card.classList.remove('note-overlay-card-pulse');
        void card.offsetWidth;
        card.classList.add('note-overlay-card-pulse');
        setTimeout(() => card.classList.remove('note-overlay-card-active'), 2200);
    }

    function clearClickHighlights() {
        document.querySelectorAll('.' + CLICK_HIGHLIGHT_CLASS).forEach(el => el.classList.remove(CLICK_HIGHLIGHT_CLASS));
    }

    document.addEventListener('click', function() {
        clearClickHighlights();
    }, true);

    function fadeOutMarkers() {
        document.querySelectorAll('.' + MARKER_CLASS).forEach(m => {
            m.classList.add('fade-out');
        });
        setTimeout(() => {
            document.querySelectorAll('.' + MARKER_CLASS + '.fade-out').forEach(m => m.remove());
        }, 450);
    }

    // 鼠标只要在浏览器窗口内移动（左栏页面 / 右栏侧栏都算）→ 显示全部序号；3 秒不动 → 渐出
    document.addEventListener('mousemove', function(e) {
        // 弹窗/浮窗内部移动不触发（大窗编辑时避免干扰）
        if (e.target.closest && (e.target.closest('#note-overlay-modal') ||
            e.target.closest('#note-overlay-pop') || e.target.closest('#note-overlay-confirm-pop'))) {
            return;
        }
        showAllMarkers(true);
        restartMarkerFadeTimer();
    }, true);

    // main 内滚动时重新定位序号标记
    window.addEventListener('load', function() {
        setTimeout(() => {
            if (getLayoutMode() !== 'scale') {
                showAllMarkers(true);
                restartMarkerFadeTimer();
            }
        }, 500);
        scheduleInitialMarkerRefresh();
    });

    // 元素悬浮时高亮对应卡片（序号对应，悬浮到右栏卡片也高亮对应页面序号）
    document.addEventListener('mouseover', function(e) {
        // 页面元素 → 高亮卡片
        if (e.target.closest && e.target.closest('#note-overlay-main')) {
            document.querySelectorAll('.note-overlay-card-active').forEach(c => c.classList.remove('note-overlay-card-active'));
            if (selectMode && textSelectingId) {
                const selectingCard = document.querySelector('.note-overlay-card[data-id="' + textSelectingId + '"]');
                if (selectingCard) selectingCard.classList.add('note-overlay-card-active', 'note-overlay-link-selecting');
            }
            const info = findNoteByElement(e.target);
            if (info) {
                const card = document.querySelector('.note-overlay-card[data-id="' + info.note.id + '"]');
                if (card) card.classList.add('note-overlay-card-active');
            }
        }
        // 卡片悬浮 → 高亮对应页面序号
        if (e.target.closest && e.target.closest('.note-overlay-card')) {
            document.querySelectorAll('.note-overlay-marker-active').forEach(m => m.classList.remove('note-overlay-marker-active'));
            const id = e.target.closest('.note-overlay-card').dataset.id;
            const marker = document.querySelector('.' + MARKER_CLASS + '[data-note-id="' + id + '"]');
            if (marker) marker.classList.add('note-overlay-marker-active');
        }
    }, true);

    // main 滚动时，序号标记跟随元素移动（滚动/缩放模式都适用）
    function repositionMarkers() {
        showAllMarkers(true);
        clearTimeout(markerTimer);
        markerTimer = setTimeout(fadeOutMarkers, MARKER_IDLE);
    }

    let markerRaf = 0;
    function scheduleMarkerReposition() {
        if (markerRaf) return;
        markerRaf = requestAnimationFrame(() => {
            markerRaf = 0;
            if (document.querySelector('.' + MARKER_CLASS)) repositionMarkers();
        });
    }

    // 序号标记跟随元素：main 滚动时重新定位（内层 transform 缩放时用 getLayoutOffset 计算布局偏移）
    function hookMainScroll() {
        const scrollEl = document.getElementById('note-overlay-main');
        if (!scrollEl) return;
        scrollEl.addEventListener('scroll', scheduleMarkerReposition, { passive: true });
        const frame = document.getElementById('note-overlay-preview-frame');
        if (frame) frame.addEventListener('scroll', scheduleMarkerReposition, { passive: true });
        window.addEventListener('scroll', scheduleMarkerReposition, { passive: true });
    }
    hookMainScroll();

    // ========== 大窗（查看 / 富文本编辑 / 新建草稿） ==========
    function openModal(id, editMode) {
        const note = id ? notes.find(n => n.id === id) : null;
        modalNoteId = id || null;
        modalEditing = false;
        modalDirectEdit = !!editMode || !id;

        const modal = document.getElementById('note-overlay-modal');
        const box = document.getElementById('note-overlay-modal-box');
        const editor = document.getElementById('note-overlay-editor');
        const toolbar = document.getElementById('note-overlay-modal-toolbar');
        const actions = document.getElementById('note-overlay-modal-actions');
        const editBtn = document.getElementById('note-overlay-modal-edit-btn');
        const num = document.getElementById('note-overlay-modal-num');
        const nav = document.getElementById('note-overlay-modal-nav');

        if (note) {
            num.textContent = getNoteIndex(id) + 1;
            num.style.display = '';
            editor.innerHTML = renderContent(note.content);
        } else {
            num.style.display = 'none';
            editor.innerHTML = draftContent || '';
        }

        editor.contentEditable = 'false';
        toolbar.style.display = 'none';
        actions.style.display = 'none';
        editBtn.style.display = isWritable ? '' : 'none';
        // 编辑内容时不需要上下条目切换按钮
        nav.style.display = editMode || !id ? 'none' : '';

        // 首次打开居中
        if (!modal.classList.contains('open')) {
            box.style.left = Math.max(20, (window.innerWidth - 680) / 2) + 'px';
            box.style.top = Math.max(20, (window.innerHeight - 480) / 2) + 'px';
        }
        modal.classList.add('open');

        modal.classList.toggle('editing', !!editMode || !id);
        if (editMode || !id) enterModalEdit();
    }

    function getNoteIndex(id) {
        const currentPageNotes = getCurrentPageNotes();
        return currentPageNotes.findIndex(n => n.id === id);
    }

    function enterModalEdit() {
        if (!isWritable) return;
        modalEditing = true;
        // 点击查看窗口中的“编辑”时，保存后回到查看状态
        document.getElementById('note-overlay-modal').classList.add('editing');
        const editor = document.getElementById('note-overlay-editor');
        const toolbar = document.getElementById('note-overlay-modal-toolbar');
        const actions = document.getElementById('note-overlay-modal-actions');
        const editBtn = document.getElementById('note-overlay-modal-edit-btn');
        toolbar.style.display = 'flex';
        actions.style.display = 'flex';
        editBtn.style.display = 'none';
        editor.contentEditable = 'true';
        editor.focus();
        updateTableToolbarVisibility();
    }

    function closeModal() {
        document.getElementById('note-overlay-modal').classList.remove('open');
        modalNoteId = null;
        modalEditing = false;
        if (draftContent !== undefined && !document.querySelector('.note-overlay-modal.open')) {
            // 取消新建草稿时清除元素选中高亮
            clearSelectionHighlight();
            selectedElement = null;
        }
        draftContent = '';
        draftSelectors = [];
        fadeOutMarkers();
    }

    async function saveModalEdit() {
        const editor = document.getElementById('note-overlay-editor');
        const content = editor.innerHTML.trim();
        if (!content) {
            setStatus('内容为空');
            return;
        }
        const title = stripHtml(content).split('\n')[0] || '注释';

        if (modalNoteId) {
            // 更新已有注释
            try {
                const res = await fetch(TEXT_ANNOTATIONS_API + '/' + modalNoteId, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content: content, title: title })
                });
                if (!res.ok) throw new Error('保存失败');
                const note = notes.find(n => n.id === modalNoteId);
                if (note) {
                    note.content = content;
                    note.title = title;
                }
                renderNotes();
                if (modalDirectEdit) {
                    closeModal();
                } else {
                    openModal(modalNoteId, false);
                }
                setStatus('已保存');
            } catch (e) {
                setStatus('保存失败: ' + e.message);
            }
        } else {
            // 新建注释（来自浮窗放大）
            if (!isWritable) {
                setStatus('当前为只读模式，无法保存');
                return;
            }
            const note = {
                title: title,
                content: content,
                selectors: draftSelectors,
                filename: getPageFilename(),
                url: window.location.pathname + window.location.search + window.location.hash,
                created: new Date().toISOString()
            };
            try {
                const res = await fetch(TEXT_ANNOTATIONS_API, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(note)
                });
                if (!res.ok) throw new Error('保存失败');
                const saved = await res.json();
                notes.push(Object.assign({}, note, saved));
                renderNotes();
                closeModal();
                setStatus('添加成功');
            } catch (e) {
                setStatus('添加失败: ' + e.message);
            }
        }
    }

    // 上一条 / 下一条
    function navigateModal(delta) {
        const pageNotes = getCurrentPageNotes();
        if (pageNotes.length === 0) return;
        let idx = pageNotes.findIndex(n => n.id === modalNoteId);
        if (idx < 0) idx = 0;
        idx = Math.min(Math.max(idx + delta, 0), pageNotes.length - 1);
        openModal(pageNotes[idx].id, false);
    }

    // ========== 徽标（折叠时显示，每 15 秒弹跳一次提醒） ==========
    function updateBadge(count) {
        const badge = document.getElementById('note-overlay-badge');
        const sidebar = document.getElementById('note-overlay-sidebar');
        if (count === 0 || sidebar.classList.contains('open')) {
            badge.classList.remove('show');
            badge.textContent = '';
            return;
        }
        badge.textContent = count;
        // 重新触发动画（移除再重加 show，保证下一次弹跳可感知）
        badge.classList.remove('show');
        void badge.offsetWidth;
        badge.classList.add('show');
    }

    // ========== 数据加载 ==========
    async function loadNotes() {
        const modeBtn = document.getElementById('note-overlay-mode-btn');
        const toggleBtn = document.getElementById('note-overlay-toggle');
        if (modeBtn) modeBtn.style.display = 'none';
        if (toggleBtn) toggleBtn.style.display = 'none';
        try {
            const res = await fetch(TEXT_ANNOTATIONS_API);
            if (res.ok) {
                const data = await res.json();
                notes = Array.isArray(data) ? data : [];
                isWritable = true;
            } else {
                throw new Error('API 不可用');
            }
        } catch (e) {
            isWritable = false;
            try {
                const staticRes = await fetch(TEXT_ANNOTATIONS_FILE + '?t=' + Date.now());
                if (staticRes.ok) {
                    const data = await staticRes.json();
                    notes = Array.isArray(data) ? data : [];
                }
            } catch (e2) {
                notes = [];
            }
        }
        try {
            const statusRes = await fetch(isWritable ? STATUS_ANNOTATIONS_API : STATUS_ANNOTATIONS_FILE + '?t=' + Date.now());
            if (statusRes.ok) {
                const statusData = await statusRes.json();
                statusNotes = Array.isArray(statusData) ? statusData : [];
            }
        } catch (e) {
            statusNotes = [];
        }
        updateToolbar();
    }

    function updateToolbar() {
        const selectBtn = document.getElementById('note-overlay-select-btn');
        const addBtn = document.getElementById('note-overlay-add-btn');
        const statusAdd = document.getElementById('note-overlay-status-add-btn');
        const statusRestore = document.getElementById('note-overlay-status-restore-btn');
        const heightBtn = document.getElementById('note-overlay-height-btn');
        if (selectBtn) selectBtn.style.display = isWritable && activeTab === 'text' ? '' : 'none';
        if (addBtn) addBtn.style.display = isWritable && activeTab === 'text' ? '' : 'none';
        if (statusAdd) statusAdd.style.display = isWritable && activeTab === 'status' ? '' : 'none';
        if (statusRestore) statusRestore.style.display = activeTab === 'status' ? '' : 'none';
        if (heightBtn) heightBtn.style.display = activeTab === 'text' ? '' : 'none';
    }

    function setStatus(msg) {
        const el = document.getElementById('note-overlay-status');
        if (el) {
            el.textContent = msg;
            setTimeout(() => el.textContent = '', 3000);
        }
    }

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Escape 关闭大窗
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            closeModal();
        }
    });

    window.addEventListener('resize', applyLayout);
    window.addEventListener('load', function() {
        setTimeout(applyLayout, 200);
        setTimeout(() => {
            if (getLayoutMode() !== 'scale') {
                showAllMarkers(true);
                restartMarkerFadeTimer();
            }
        }, 500);
    });

    // main 内容渲染完成后刷新一次标记位置
    document.addEventListener('DOMContentLoaded', function() {
        setTimeout(() => {
            if (document.getElementById('note-overlay-main')) {
                if (getLayoutMode() !== 'scale') showAllMarkers(false);
            }
        }, 300);
    });

    // ========== 初始化 ==========
    async function init() {
        injectStyles();
        createSidebar();
        updateModeBtn();
        setCardHeightClass();
        await loadNotes();

        const openState = loadOpenState();
        const sidebar = document.getElementById('note-overlay-sidebar');
        const hasNotes = getCurrentPageNotes().length + getCurrentPageStatusNotes().length > 0;
        // 有后端时即使当前页面没有注释也保留面板；只读模式才按注释数量自动折叠。
        const shouldOpen = openState.valid ? openState.open : (isWritable || hasNotes);
        if (shouldOpen) {
            sidebar.classList.add('open');
            if (!openState.valid && hasNotes) {
                try { localStorage.setItem(OPEN_KEY, JSON.stringify({ open: true, t: Date.now() })); } catch (e) {}
            }
        }
        renderNotes();
        // 先根据当前模式和注释数量完成折叠，再更新按钮可见性，避免初始化时闪现等比例按钮。
        updateToggleShift();
        applyLayout();
        // 此时右栏和画布尺寸已经确定，恢复预览可见性时不会经过未缩放状态。
        document.getElementById('note-overlay-main').style.visibility = 'visible';
        if (getLayoutMode() === 'scale') {
            markersReady = false;
            document.querySelectorAll('.' + MARKER_CLASS).forEach(marker => marker.remove());
            setTimeout(() => {
                // applyLayout 中的 transform/layout 需要至少两帧才会反映到 getBoundingClientRect。
                applyLayout();
                requestAnimationFrame(() => requestAnimationFrame(() => {
                    rebuildMarkers(true);
                    restartMarkerFadeTimer();
                }));
            }, 700);
        } else {
            showAllMarkers(true);
            restartMarkerFadeTimer();
        }
        observeMarkerLayout();
        scheduleInitialMarkerRefresh();
        // 右栏状态、画布尺寸和布局模式均已确定，允许页面正常绘制。
        document.body.style.visibility = startupVisibility || 'visible';
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
