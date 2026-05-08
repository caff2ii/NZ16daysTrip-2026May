import { db, ref, set, onValue, get, auth, provider, signInWithRedirect, getRedirectResult, signInWithPopup, onAuthStateChanged, signOut } from './firebase-config.js';

const APP_CACHE_NAME = 'nz-trip-app-v121';
const OFFLINE_SNAPSHOT_KEY = 'nz-trip-offline-snapshot';
const OFFLINE_MODE_KEY = 'nz-trip-offline-mode';
const WEATHER_CACHE_KEY = 'nz-trip-weather-cache-v1';
const APP_SHELL_FILES = [
    './',
    './index.html',
    './style.css',
    './main.js',
    './firebase-config.js',
    './sw.js'
];

function buildHamburgerMenuHtml({ isAdmin, displayName }) {
    const authButton = isAdmin
        ? `<button class="hamburger-dropdown-item" onclick="window.logoutAdmin()">登出管理員</button>`
        : `<button class="hamburger-dropdown-item" onclick="openLoginModal()">管理員登入</button>`;
    const modeText = isAdmin
        ? `管理員模式：${displayName || '已開啟'}`
        : '訪客模式 (唯讀)';

    return `
        ${authButton}
        <button class="hamburger-dropdown-item" onclick="window.showAccommodationOverview()">🏨 住宿總覽</button>
        <button class="hamburger-dropdown-item" onclick="window.showScheduleOverview()">📋 行程總覽</button>
        <button class="hamburger-dropdown-item" onclick="window.showActivityOverview()">🧗 活動總覽</button>
        <button class="hamburger-dropdown-item" onclick="window.showWeatherOverview()">☁️ 天氣總覽</button>
        <button class="hamburger-dropdown-item" onclick="window.enableOfflineMode()">離線模式</button>
        <button class="hamburger-dropdown-item danger" onclick="window.clearAppCache()">清除快取</button>
        <div class="hamburger-dropdown-status">
            ${modeText}
        </div>
    `;
}

function saveOfflineSnapshot() {
    try {
        localStorage.setItem(OFFLINE_SNAPSHOT_KEY, JSON.stringify({
            itineraryData,
            coords,
            coordNames,
            savedAt: new Date().toISOString()
        }));
    } catch (e) {
        console.warn('Offline snapshot save failed:', e);
    }
}

function loadOfflineSnapshot() {
    try {
        const raw = localStorage.getItem(OFFLINE_SNAPSHOT_KEY);
        if (!raw) return false;
        const snapshot = JSON.parse(raw);
        itineraryData = snapshot.itineraryData || [];
        coords = snapshot.coords || defaultCoords;
        coordNames = snapshot.coordNames || defaultCoordNames;
        return itineraryData.length > 0;
    } catch (e) {
        console.warn('Offline snapshot load failed:', e);
        return false;
    }
}

function getWeatherCache() {
    try {
        return JSON.parse(localStorage.getItem(WEATHER_CACHE_KEY) || '{}');
    } catch (e) {
        return {};
    }
}

function getWeatherCacheKey(lat, lng, dateStr) {
    return `${Number(lat).toFixed(4)},${Number(lng).toFixed(4)}:${dateStr}`;
}

function getCachedWeather(lat, lng, dateStr) {
    const cache = getWeatherCache();
    return cache[getWeatherCacheKey(lat, lng, dateStr)]?.data || null;
}

function setCachedWeather(lat, lng, dateStr, data) {
    if (!data) return;
    try {
        const cache = getWeatherCache();
        cache[getWeatherCacheKey(lat, lng, dateStr)] = {
            data,
            savedAt: new Date().toISOString()
        };
        localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(cache));
    } catch (e) {
        console.warn('Weather cache save failed:', e);
    }
}

async function cacheAllTripWeather() {
    const jobs = [];
    itineraryData.forEach(day => {
        const dateParts = (day.date || '').split('/');
        if (dateParts.length < 3) return;
        const travelDate = `${dateParts[2]}-${dateParts[1].padStart(2, '0')}-${dateParts[0].padStart(2, '0')}`;
        [day.prevStayMapKey, day.stayMapKey].forEach(key => {
            const point = coords?.[key];
            if (!point) return;
            jobs.push(() => fetchWeatherData(point[0], point[1], travelDate));
        });
    });

    for (const job of jobs) {
        await job();
    }
}

window.logoutAdmin = function() {
    signOut(auth).then(() => location.reload());
};

window.enableOfflineMode = async function() {
    if (!('serviceWorker' in navigator) || !('caches' in window)) {
        alert('此瀏覽器暫不支援離線模式。');
        return;
    }

    try {
        await navigator.serviceWorker.register('./sw.js');
        const cache = await caches.open(APP_CACHE_NAME);
        await cache.addAll(APP_SHELL_FILES);
        saveOfflineSnapshot();
        await cacheAllTripWeather();
        localStorage.setItem(OFFLINE_MODE_KEY, '1');
        alert('離線模式已準備好。之後無網絡時可開啟已快取的行程。');
    } catch (e) {
        console.error('Enable offline mode failed:', e);
        alert('離線模式設定失敗，請稍後再試。');
    }
};

window.clearAppCache = async function() {
    if (!confirm('確定要清除離線快取嗎？下次離線可能無法開啟行程。')) return;

    try {
        if ('caches' in window) {
            const keys = await caches.keys();
            await Promise.all(keys.map(key => caches.delete(key)));
        }
        if ('serviceWorker' in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.map(reg => reg.unregister()));
        }
        localStorage.removeItem(OFFLINE_SNAPSHOT_KEY);
        localStorage.removeItem(OFFLINE_MODE_KEY);
        localStorage.removeItem(WEATHER_CACHE_KEY);
        alert('快取已清除。');
    } catch (e) {
        console.error('Clear cache failed:', e);
        alert('清除快取失敗，請稍後再試。');
    }
};

// ========== DARK MODE 管理 ==========
window.initializeDarkMode = function() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    window.applyTheme(savedTheme);
};

window.applyTheme = function(theme) {
    const html = document.documentElement;
    if (theme === 'dark') {
        html.setAttribute('data-theme', 'dark');
        window.updateToggleIcon('☀️');
        window.updateMapTheme('dark');
    } else {
        html.removeAttribute('data-theme');
        window.updateToggleIcon('🌙');
        window.updateMapTheme('light');
    }
    localStorage.setItem('theme', theme);
    
    // 重新渲染當前內容以反映新的顏色配置
    if (typeof renderViewMode === 'function') {
        if (currentViewMode === 'accommodation' && typeof window.showAccommodationOverview === 'function') {
            window.showAccommodationOverview({ skipMapUpdate: true });
        } else {
            renderViewMode();
        }
    }
    // 重新渲染天氣信息
    if (currentViewMode === 'day' && itineraryData && itineraryData[currentDayIndex]) {
        const data = itineraryData[currentDayIndex];
        const weatherPayload = {
            date: data.date,
            stay: data.stay,
            stayMapKey: data.stayMapKey,
            prevStay: data.prevStay,
            prevStayMapKey: data.prevStayMapKey
        };
        if (typeof updateWeatherInfo === 'function') {
            updateWeatherInfo(weatherPayload);
        }
    }
};

window.toggleDarkMode = function() {
    const html = document.documentElement;
    const currentTheme = html.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    window.applyTheme(newTheme);
};

window.updateToggleIcon = function(icon) {
    const toggleBtn = document.getElementById('dark-mode-toggle');
    if (toggleBtn) {
        toggleBtn.textContent = icon;
    }
};

window.updateMapTheme = function(theme) {
    // CSS will handle the map theme switching automatically
    // No JS action needed as html[data-theme] triggers CSS filter
};

// 頁面載入時初始化 Dark Mode
document.addEventListener('DOMContentLoaded', function() {
    window.initializeDarkMode();
    if (localStorage.getItem(OFFLINE_MODE_KEY) === '1' && 'serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(e => {
            console.warn('Service worker registration failed:', e);
        });
    }
    
    // 添加按鈕事件監聽器
    const toggleBtn = document.getElementById('dark-mode-toggle');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', function(e) {
            e.preventDefault();
            window.toggleDarkMode();
        });
    }
    
    // 添加 hamburger menu 事件監聽器
    const hamburgerBtn = document.getElementById('hamburger-menu');
    const hamburgerDropdown = document.getElementById('hamburger-dropdown');
    
    if (hamburgerBtn && hamburgerDropdown) {
        hamburgerBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            hamburgerDropdown.classList.toggle('show');
        });
        
        // 點擊其他地方關閉選單
        document.addEventListener('click', function(e) {
            if (!hamburgerBtn.contains(e.target) && !hamburgerDropdown.contains(e.target)) {
                hamburgerDropdown.classList.remove('show');
            }
        });
    }

        const mapToggleBtn = document.getElementById('map-toggle-btn');
        const mapFullscreenBtn = document.getElementById('map-fullscreen-btn');

        if (mapToggleBtn) {
            mapToggleBtn.addEventListener('click', function(e) {
                e.preventDefault();
                window.toggleMapShrink();
            });
        }
        if (mapFullscreenBtn) {
            mapFullscreenBtn.addEventListener('click', function(e) {
                e.preventDefault();
                window.toggleMapFullscreen();
            });
        }
    });

onAuthStateChanged(auth, (user) => {
    // 1. 設定你的專屬 UID
    const adminUID = "eECs2vvipQM0QZTP8UpTUk5Lq7o2";
    
    // 2. 獲取頁面上的 UI 元素
    const adminBar = document.getElementById('admin-bar');
    const statusText = document.getElementById('auth-status');
    const loginBtn = document.getElementById('login-trigger-btn');
    const resetBtn = document.getElementById('reset-data-btn');
    const modal = document.getElementById('login-modal');
    const hamburgerDropdown = document.getElementById('hamburger-dropdown');

    // 3. 判斷是否為管理員本人
    const isAdmin = user && user.uid === adminUID;

    if (isAdmin) {
        // --- 情況 A: 管理員本人登入成功 ---
        console.log("✅ 管理員身份已確認 (UID 匹配)");
        
        // 顯示 admin bar
        if (adminBar) adminBar.style.display = 'flex';
        
        if (statusText) statusText.innerText = `管理員模式：${user.displayName || '已開啟'}`;
        if (loginBtn) loginBtn.innerText = "登出管理員";
        
        // 更新 hamburger menu
        if (hamburgerDropdown) {
            hamburgerDropdown.innerHTML = buildHamburgerMenuHtml({
                isAdmin: true,
                displayName: user.displayName
            });
        }
        
        // --- 新增：插入匯出匯入按鈕到頂部 Admin Bar ---
        // 檢查是否已經加過按鈕，避免重複產生
        if (!document.getElementById('gemini-admin-tools')) {
            const adminTools = document.createElement('span');
            adminTools.id = 'gemini-admin-tools';
            adminTools.style = "margin-left: 10px; display: inline-flex; gap: 5px; vertical-align: middle;";
            adminTools.innerHTML = `
                <button onclick="window.openLocManager()" class="admin-top-btn" style="background:#34495e;">📍座標管理</button>
                <button onclick="window.exportAllDays()" class="admin-top-btn" style="background:#673ab7;">📤 匯出</button>
                <button onclick="window.importAllDays()" class="admin-top-btn" style="background:#009688;">📥 匯入</button>
            `;
            // 插入在「管理員模式：XXX」文字後面
            if (statusText) statusText.appendChild(adminTools);
        }
        
        if (resetBtn) resetBtn.style.display = "block";
        if (modal) modal.style.display = 'none';
        
    } else if (user) {
        // --- 情況 B: 非授權用戶 ---
        console.warn("⚠️ 非授權用戶嘗試登入");
        alert("此帳號未經授權。");
        signOut(auth).then(() => {
            location.reload();
        });
        
    } else {
        // --- 情況 C: 訪客模式 ---
        console.log("ℹ️ 訪客模式");
        
        // 隱藏 admin bar
        if (adminBar) adminBar.style.display = 'none';
        
        if (statusText) {
            statusText.innerText = "訪客模式 (唯讀)";
            // 登出時移除按鈕
            const tools = document.getElementById('gemini-admin-tools');
            if (tools) tools.remove();
        }
        if (loginBtn) loginBtn.innerText = "管理員登入";
        if (resetBtn) resetBtn.style.display = "none";
        
        // 更新 hamburger menu
        if (hamburgerDropdown) {
            hamburgerDropdown.innerHTML = buildHamburgerMenuHtml({
                isAdmin: false
            });
        }
    }

    if (currentViewMode === 'accommodation' && typeof window.showAccommodationOverview === 'function') {
        window.showAccommodationOverview({ skipMapUpdate: true });
    } else if (typeof loadDay === 'function') {
        loadDay(currentDayIndex);
    }
});

// --- 1. 預設資料 (初始化或重置用) ---
const defaultCoords = {
    chc_airport: [-43.4864, 172.5369],
    summit_rd: [-43.5850, 172.6400],
    riverside: [-43.5328, 172.6338],
    chc_hotel: [-43.5300, 172.6300],
    fairlie: [-44.1017, 170.8300],
    tekapo_church: [-44.0046, 170.4813],
    mt_john: [-43.9846, 170.4638],
    tekapo_hotel: [-44.0060, 170.4780],
    tasman_glacier: [-43.6974, 170.1634],
    salmon_shop: [-44.1565, 170.1177],
    hooker_valley: [-43.7197, 170.1039],
    peters_lookout: [-44.0487, 170.1557],
    twizel_hotel: [-44.2590, 170.0980],
    high_country_salmon: [-44.3015, 170.1062],
    lake_ohau: [-44.2543, 169.8732],
    clay_cliffs: [-44.4921, 169.8687],
    sailors_cutting: [-44.5097, 170.1264],
    riverstone: [-44.9757, 171.0711],
    oamaru_center: [-45.1000, 170.9700],
    oamaru_lookout: [-45.1054, 170.9722],
    royal_albatross: [-45.7758, 170.7265],
    natures_wonders: [-45.7865, 170.7300],
    dunedin_hotel: [-45.8788, 170.5028],
    dunedin_rail: [-45.8752, 170.5074],
    nugget_point: [-46.4480, 169.8166],
    te_anau_pie: [-45.4144, 167.7126],
    te_anau_caves: [-45.4200, 167.7000],
    te_anau_hotel: [-45.4180, 167.7150],
    milford_sound: [-44.6716, 167.9256],
    queenstown_gondola: [-45.0298, 168.6548],
    deer_park: [-45.0392, 168.7088],
    earnslaw: [-45.0326, 168.6606],
    nevis_swing: [-45.0311, 168.6625],
    qt_hotel: [-45.0312, 168.6626],
    glenorchy_farm: [-44.8360, 168.3900],
    glenorchy_walk: [-44.8504, 168.3965],
    fergburger: [-45.0315, 168.6592],
    lake_hayes: [-44.9774, 168.8090],
    arrowtown: [-44.9425, 168.8354],
    wanaka_tree: [-44.6997, 169.1170],
    mt_iron: [-44.6830, 169.1465],
    lake_hawea: [-44.6133, 169.2600],
    wanaka_hotel: [-44.7000, 169.1300],
    lake_matheson: [-43.4385, 169.9676],
    fox_hotel: [-43.4646, 170.0177],
    fox_glacier: [-43.4660, 170.0300],
    hokitika_gorge: [-42.9248, 171.0210],
    glow_worm_dell: [-42.7128, 170.9706],
    greymouth_hotel: [-42.4504, 171.2108],
    castle_hill: [-43.2285, 171.7196],
    chc_rest: [-43.5320, 172.6362],
};

const defaultCoordNames = {
    chc_airport: "基督城機場",
    summit_rd: "Summit Rd 觀景台",
    riverside: "Riverside Market",
    chc_hotel: "基督城市區住宿",
    fairlie: "Fairlie 派店",
    tekapo_church: "好牧羊人教堂",
    mt_john: "Mt John 天文台",
    tekapo_hotel: "Tekapo 住宿",
    tasman_glacier: "塔斯曼冰川",
    salmon_shop: "高山鮭魚店 (Mt Cook)",
    hooker_valley: "Hooker Valley 步道",
    peters_lookout: "Peter's Lookout",
    twizel_hotel: "Twizel 住宿",
    high_country_salmon: "High Country Salmon",
    lake_ohau: "Lake Ohau",
    clay_cliffs: "黏土懸崖",
    sailors_cutting: "Sailors Cutting",
    riverstone: "Riverstone Castle",
    oamaru_center: "奧馬魯市中心",
    oamaru_lookout: "奧馬魯歷史區",
    royal_albatross: "信天翁中心",
    natures_wonders: "Nature's Wonders",
    dunedin_hotel: "但尼丁住宿",
    dunedin_rail: "但尼丁火車站",
    nugget_point: "Nugget Point 燈塔",
    te_anau_pie: "Te Anau 派店",
    te_anau_caves: "螢火蟲洞",
    te_anau_hotel: "Te Anau 住宿",
    milford_sound: "米佛峽灣",
    queenstown_gondola: "皇后鎮纜車",
    deer_park: "Deer Park Heights",
    earnslaw: "TSS 蒸汽船",
    nevis_swing: "Nevis Swing 集合點",
    qt_hotel: "皇后鎮住宿",
    glenorchy_farm: "Glenorchy 農場",
    glenorchy_walk: "Glenorchy 步道",
    fergburger: "Fergburger",
    lake_hayes: "Lake Hayes",
    arrowtown: "箭鎮 Arrowtown",
    wanaka_tree: "瓦納卡孤獨樹",
    mt_iron: "Mt Iron 步道",
    lake_hawea: "Lake Hawea",
    wanaka_hotel: "Wanaka 住宿",
    lake_matheson: "Lake Matheson 鏡湖",
    fox_hotel: "Fox Glacier 住宿",
    fox_glacier: "Fox 冰川觀景點",
    hokitika_gorge: "Hokitika 峽谷",
    glow_worm_dell: "Hokitika 螢火蟲",
    greymouth_hotel: "Greymouth 住宿",
    castle_hill: "Castle Hill 怪石",
    chc_rest: "基督城休息/採買"
};

const defaultItinerary = [
    {
        day: 1, date: "10/5/2026", title: "抵達基督城", color: "#e74c3c", 
        prevStay: "飛機上", stay: "Christchurch City (Sudima/Rydges)",
        route: ["chc_airport", "summit_rd", "riverside", "chc_hotel"],
        schedule: [
            { time: "14:00", type: "drive", text: "機場取車 Kia Carnival", drive: "40分鐘", desc: "檢查車身刮痕、備胎位置、雪鏈教學。開啟 Google Maps 導航。", mapKey: "chc_airport", hours: "08:00-20:00" },
            { time: "15:00", type: "visit", text: "Summit Road View Point", desc: "初見紐西蘭！從上帝視角俯瞰 Lyttelton 海港與基督城全景。道路稍窄，Kia Carnival 請留意左側車距。", mapKey: "summit_rd", hours: "24H" },
            { time: "17:00", type: "visit", text: "Riverside Market", desc: "充滿活力的室內市集。推薦晚餐：\n1. Shaka Bros (美味漢堡)\n2. Ramen Ria (日式拉麵)\n3. Base Pizza", mapKey: "riverside", hours: "10:00-21:00" },
            { time: "19:00", type: "hotel", text: "入住基督城市區飯店", desc: "市區單行道多，請先確認飯店停車入口高度限制。", mapKey: "chc_hotel" }
        ]
    },
    { day: 2, date: "11/5/2026", title: "蒂卡波觀星", color: "#9b59b6", prevStay: "Christchurch", stay: "Lake Tekapo (Peppers/Mantra)", route: ["chc_hotel", "fairlie", "tekapo_church", "mt_john", "tekapo_hotel"], schedule: [ { time: "09:00", type: "drive", text: "前往 Fairlie", drive: "2.5小時", desc: "沿 SH1 轉 SH79，平原風光。", mapKey: "chc_hotel" }, { time: "11:30", type: "visit", text: "Fairlie Bakehouse", desc: "紐西蘭必吃派店！\n推薦：Pork Belly (五花肉派) 與 Salmon Bacon。\n店內人多，可外帶至外面草地野餐。", mapKey: "fairlie", hours: "06:00-16:00" }, { time: "14:00", type: "visit", text: "好牧羊人教堂", desc: "位於湖畔的標誌性石教堂。下午遊客眾多，請將 Kia Carnival 停在大巴停車區，避免擠在教堂門口。", mapKey: "tekapo_church", hours: "09:00-17:00" }, { time: "15:30", type: "visit", text: "Mt John 天文台 (日間)", desc: "需付 $8 通行費。山路蜿蜒請慢行。山頂 Astro Café 擁有 360 度無敵湖景，必喝 Flat White。", mapKey: "mt_john", hours: "10:00-15:00" }, { time: "20:00", type: "visit", text: "Dark Sky Project 觀星", desc: "世界知名暗空保護區。集合地點通常在鎮中心辦公室，搭專車上山。", mapKey: "tekapo_hotel", hours: "預約制" } ] },
    { day: 3, date: "12/5/2026", title: "庫克山冰河", color: "#3498db", prevStay: "Lake Tekapo", stay: "Twizel (Mountain Chalets)", route: ["tekapo_hotel", "peters_lookout", "tasman_glacier", "hooker_valley", "twizel_hotel"], schedule: [ { time: "08:00", type: "drive", text: "前往庫克山", drive: "1小時10分", desc: "沿著普卡基湖 (Lake Pukaki) 開，湖水是夢幻的土耳其藍。", mapKey: "tekapo_hotel" }, { time: "09:30", type: "visit", text: "塔斯曼冰川 (直升機/健行)", desc: "體驗直升機登冰川或搭船看冰山。天氣變化大，務必預約早場作為緩衝。", mapKey: "tasman_glacier", hours: "08:30-16:30" }, { time: "12:30", type: "visit", text: "Mt Cook Alpine Salmon", desc: "世界上海拔最高的鮭魚養殖場。購買生魚片在湖邊野餐，肉質緊實鮮甜。", mapKey: "salmon_shop", hours: "09:00-17:00" }, { time: "14:00", type: "visit", text: "Hooker Valley Track", desc: "來回約 3 小時。平緩步道，經過三座吊橋，終點是浮著冰山的冰河湖。", mapKey: "hooker_valley", hours: "24H" }, { time: "17:30", type: "drive", text: "前往 Twizel", drive: "45分鐘", desc: "Twizel 超市採買晚餐食材。", mapKey: "twizel_hotel" } ] },
    { day: 4, date: "13/5/2026", title: "湖區與奧馬魯", color: "#2ecc71", prevStay: "Twizel", stay: "Oamaru (Poshtel/Heritage)", route: ["twizel_hotel", "high_country_salmon", "lake_ohau", "clay_cliffs", "sailors_cutting", "riverstone", "oamaru_center"], schedule: [ { time: "09:00", type: "visit", text: "High Country Salmon", desc: "可免費餵食鮭魚，也有餐廳提供熟食早午餐。", mapKey: "high_country_salmon", hours: "09:00-16:00" }, { time: "10:30", type: "visit", text: "Lake Ohau", desc: "較少遊客的秘境湖泊，秋季樹葉變色非常美麗，湖面倒影清晰。", mapKey: "lake_ohau", hours: "24H" }, { time: "13:30", type: "visit", text: "Clay Cliffs (黏土懸崖)", desc: "私人土地需投現 ($5/車)。進入前有一段碎石路，請小心底盤。", mapKey: "clay_cliffs", hours: "日出-日落" }, { time: "16:00", type: "drive", text: "前往 Oamaru", drive: "1.5小時", desc: "途經 Riverstone Castle 休息。", mapKey: "riverstone" }, { time: "18:00", type: "hotel", text: "入住 Oamaru", desc: "晚上可至港口旁尋找免費觀賞的小藍企鵝歸巢點，或付費參觀。", mapKey: "oamaru_center" } ] },
    { day: 5, date: "14/5/2026", title: "但尼丁生態", color: "#f1c40f", prevStay: "Oamaru", stay: "Dunedin (Victoria Hotel)", route: ["oamaru_center", "oamaru_lookout", "dunedin_hotel", "royal_albatross", "natures_wonders", "dunedin_hotel"], schedule: [ { time: "08:30", type: "visit", text: "Oamaru Historic Precinct", desc: "漫步在維多利亞時期的白石建築群中，彷彿穿越時空。Steampunk HQ 也在這裡。", mapKey: "oamaru_lookout", hours: "24H" }, { time: "10:00", type: "drive", text: "前往 Dunedin", drive: "1.5小時", desc: "沿途經過 Moeraki Boulders (大圓石) 可短暫停留。", mapKey: "oamaru_center" }, { time: "14:30", type: "visit", text: "Nature's Wonders", desc: "搭乘 8輪傳動車越野，近距離觀賞黃眼企鵝與海豹，極具臨場感的生態之旅。", mapKey: "natures_wonders", hours: "預約制" }, { time: "16:00", type: "visit", text: "Royal Albatross Centre", desc: "世界唯一的大陸信天翁繁殖中心。半島風大，請穿著防風外套。", mapKey: "royal_albatross", hours: "10:15-17:00" }, { time: "18:30", type: "hotel", text: "入住 Dunedin", desc: "晚餐推薦：Speight's Ale House 品嚐在地啤酒與豬肋排。", mapKey: "dunedin_hotel" } ] },
    { day: 6, date: "15/5/2026", title: "燈塔與螢火蟲", color: "#e67e22", prevStay: "Dunedin", stay: "Te Anau (Distinction/Lakeside)", route: ["dunedin_hotel", "dunedin_rail", "nugget_point", "te_anau_pie", "te_anau_caves"], schedule: [ { time: "08:00", type: "visit", text: "但尼丁火車站", desc: "被譽為世上最美火車站之一，文藝復興風格建築。每週六早上有農夫市集。", mapKey: "dunedin_rail", hours: "08:00-17:00" }, { time: "09:00", type: "drive", text: "前往 Nugget Point", drive: "1.5小時", desc: "南部景觀公路的起點。", mapKey: "dunedin_hotel" }, { time: "10:30", type: "visit", text: "Nugget Point Lighthouse", desc: "步行 20 分鐘至燈塔。斷崖下的岩石像金塊般散落，有機會看到海豹嬉戲。", mapKey: "nugget_point", hours: "24H" }, { time: "12:30", type: "drive", text: "長途前往 Te Anau", drive: "3.5小時", desc: "中途於 Gore 休息加油。這段路較長，需輪流駕駛。", mapKey: "te_anau_pie" }, { time: "16:00", type: "visit", text: "Miles Better Pies", desc: "Te Anau 鎮上名店，派皮酥脆內餡豐富。", mapKey: "te_anau_pie", hours: "06:00-15:00" }, { time: "17:00", type: "visit", text: "Te Anau Glowworm Caves", desc: "搭船穿越湖泊進入洞穴，在黑暗中欣賞如星空般的螢火蟲藍光。", mapKey: "te_anau_caves", hours: "預約制" } ] },
    { day: 7, date: "16/5/2026", title: "米佛峽灣一日遊", color: "#16a085", prevStay: "Te Anau", stay: "Queenstown (Novotel/Hilton)", route: ["te_anau_hotel", "milford_sound", "qt_hotel"], schedule: [ { time: "07:30", type: "drive", text: "前往米佛峽灣 (或搭巴士)", drive: "2小時 (不含停留)", desc: "若自駕請預留 3 小時，沿途風景絕美(鏡湖、荷馬隧道)。若參加 Local Tour 則在飯店等接駁。", mapKey: "te_anau_hotel" }, { time: "11:00", type: "visit", text: "米佛峽灣遊船 (Cruise)", desc: "世界第八大奇蹟。近距離觀賞史特靈瀑布(Stirling Falls)與海豹岩。船上通常提供自助午餐。", mapKey: "milford_sound", hours: "船班固定" }, { time: "14:00", type: "drive", text: "自駕前往 Queenstown", drive: "3.5 - 4小時", desc: "行程結束後，沿米佛公路返回 Te Anau 短暫休息，隨即沿湖景公路開往皇后鎮。", mapKey: "milford_sound" }, { time: "18:30", type: "hotel", text: "入住 Queenstown", desc: "抵達冒險之都。晚餐推薦：Rata (米其林主廚餐廳) 或 湖邊 Fish & Chips。", mapKey: "qt_hotel" } ] },
    { day: 8, date: "17/5/2026", title: "皇后鎮冒險", color: "#c0392b", prevStay: "Queenstown", stay: "Queenstown", route: ["qt_hotel", "deer_park", "nevis_swing", "earnslaw", "qt_hotel"], schedule: [ { time: "09:00", type: "visit", text: "Deer Park Heights", desc: "需線上預訂 ($55/車)。自駕進入私人農場，可餵食鹿、驢子、羊駝。這裡是《魔戒》多個場景取景地，風景優美。", mapKey: "deer_park", hours: "07:00-黃昏" }, { time: "12:00", type: "visit", text: "Nevis Swing / Bungy", desc: "紐西蘭最刺激體驗！通常需至市區 Station Building 集合搭乘接駁車前往峽谷。世界最大的高空鞦韆。", mapKey: "nevis_swing", hours: "需預約" }, { time: "17:00", type: "visit", text: "TSS Earnslaw 蒸汽船晚餐", desc: "搭乘百年燃煤蒸汽船前往 Walter Peak 農場。包含剪羊毛秀與高品質 BBQ 自助晚餐。", mapKey: "earnslaw", hours: "17:00 出發" } ] },
    { day: 9, date: "18/5/2026", title: "格林諾奇魔戒小鎮", color: "#27ae60", prevStay: "Queenstown", stay: "Queenstown", route: ["qt_hotel", "glenorchy_farm", "glenorchy_walk", "qt_hotel"], schedule: [ { time: "10:00", type: "drive", text: "前往 Glenorchy", drive: "45分鐘", desc: "被譽為「通往天堂之路」的公路，沿著瓦卡蒂普湖行駛，每一彎都是明信片風景。", mapKey: "qt_hotel" }, { time: "11:00", type: "visit", text: "Glenorchy Animal Farm", desc: "互動式農場，適合放鬆心情，親近動物。", mapKey: "glenorchy_farm", hours: "10:00-16:00" }, { time: "13:00", type: "visit", text: "Glenorchy Walkway & 紅屋子", desc: "必拍經典紅屋子(Wharf Shed)。漫步在濕地步道，尋找黑天鵝。", mapKey: "glenorchy_walk", hours: "24H" }, { time: "16:00", type: "drive", text: "返回 Queenstown", drive: "45分鐘", desc: "回程光線不同，湖景依舊迷人。", mapKey: "glenorchy_farm" }, { time: "18:00", type: "visit", text: "皇后鎮自由活動", desc: "逛街採買，或去 Patagonia Chocolates 吃冰淇淋。", mapKey: "qt_hotel" } ] },
    { day: 10, date: "19/5/2026", title: "箭鎮與漢堡", color: "#d35400", prevStay: "Queenstown", stay: "Wanaka (Edgewater)", route: ["qt_hotel", "fergburger", "lake_hayes", "arrowtown", "wanaka_hotel"], schedule: [ { time: "10:00", type: "visit", text: "Fergburger", desc: "全球知名的大漢堡。建議早上開門即去或電話預訂，避免排隊一小時以上。", mapKey: "fergburger", hours: "08:00-04:30" }, { time: "12:00", type: "visit", text: "Lake Hayes", desc: "野餐好去處，湖面如鏡，倒影極美。", mapKey: "lake_hayes", hours: "24H" }, { time: "14:00", type: "visit", text: "Arrowtown", desc: "保留淘金熱時期的建築。參觀華人礦工村遺跡，感受歷史滄桑。", mapKey: "arrowtown", hours: "24H" }, { time: "16:30", type: "drive", text: "前往 Wanaka", drive: "1小時", desc: "經由 Crown Range Road (皇冠山脈公路)，是紐西蘭海拔最高的公路，髮夾彎多請小心。", mapKey: "arrowtown" } ] },
    { day: 11, date: "20/5/2026", title: "瓦納卡湖光", color: "#8e44ad", prevStay: "Wanaka", stay: "Wanaka", route: ["wanaka_hotel", "wanaka_tree", "mt_iron", "lake_hawea", "wanaka_hotel"], schedule: [ { time: "09:00", type: "visit", text: "That Wanaka Tree", desc: "紐西蘭最「孤獨」的樹，生長在湖水中。早晨光線柔和適合攝影。", mapKey: "wanaka_tree", hours: "24H" }, { time: "10:30", type: "visit", text: "Mt Iron Track", desc: "環形步道約 1.5 小時。登頂後可 360 度俯瞰 Wanaka 湖與 Hawea 湖。", mapKey: "mt_iron", hours: "24H" }, { time: "13:30", type: "visit", text: "Lake Hawea", desc: "前往 The Neck 觀景台，一次眺望兩座大湖。", mapKey: "lake_hawea", hours: "24H" }, { time: "15:30", type: "visit", text: "Puzzling World (選購)", desc: "有趣的立體迷宮與錯覺房間，適合消磨下午時光。", mapKey: "wanaka_hotel", hours: "09:00-16:30" } ] },
    { day: 12, date: "21/5/2026", title: "前往西海岸", color: "#2980b9", prevStay: "Wanaka", stay: "Fox Glacier (Heartland Hotel)", route: ["wanaka_hotel", "lake_matheson", "fox_hotel"], schedule: [ { time: "09:00", type: "drive", text: "前往 Fox Glacier", drive: "4小時", desc: "穿越 Haast Pass。沿途停靠：Blue Pools (藍池)、Thunder Creek Falls (雷河瀑布)。", mapKey: "wanaka_hotel" }, { time: "14:00", type: "hotel", text: "抵達 Fox Glacier 辦理入住", desc: "小鎮不大，補給有限。", mapKey: "fox_hotel" }, { time: "16:00", type: "visit", text: "Lake Matheson (鏡湖)", desc: "必去！環湖步道約 1.5 小時。在 Jetty Viewpoint 等待日落，拍攝庫克山與塔斯曼山的完美倒影。", mapKey: "lake_matheson", hours: "24H" } ] },
    { day: 13, date: "22/5/2026", title: "藍色峽谷與西岸", color: "#1abc9c", prevStay: "Fox Glacier", stay: "Greymouth (Copthorne/Top 10)", route: ["fox_hotel", "fox_glacier", "hokitika_gorge", "glow_worm_dell", "greymouth_hotel"], schedule: [ { time: "08:30", type: "visit", text: "Fox Glacier South Side Walk", desc: "遠眺冰河前緣。若預算許可，非常推薦參加直升機冰川健行 (Heli-Hike)。", mapKey: "fox_glacier", hours: "08:00-17:00" }, { time: "11:00", type: "drive", text: "前往 Hokitika", drive: "2小時", desc: "沿著壯麗的西海岸駕駛。", mapKey: "fox_hotel" }, { time: "13:30", type: "visit", text: "Hokitika Gorge", desc: "令人驚豔的乳藍色河水與吊橋。注意：此處沙蠅 (Sandflies) 極多，務必噴防蚊液。", mapKey: "hokitika_gorge", hours: "24H" }, { time: "16:00", type: "visit", text: "Hokitika 市區/海灘", desc: "與用漂流木排成的 Hokitika Sign 合照。晚餐可吃 Fat Pipi Pizza (白銀魚披薩)。", mapKey: "glow_worm_dell" }, { time: "18:00", type: "drive", text: "前往 Greymouth", drive: "30分鐘", desc: "沿 SH6 北上。", mapKey: "glow_worm_dell" }, { time: "19:00", type: "hotel", text: "入住 Greymouth", desc: "西海岸最大城鎮。", mapKey: "greymouth_hotel" } ] },
    { day: 14, date: "23/5/2026", title: "亞瑟通道與巨石", color: "#7f8c8d", prevStay: "Greymouth", stay: "Christchurch", route: ["greymouth_hotel", "castle_hill", "chc_rest"], schedule: [ { time: "09:00", type: "drive", text: "穿越 Arthur's Pass", drive: "1.5小時", desc: "景觀公路，途經 Otira Viaduct 高架橋。", mapKey: "greymouth_hotel" }, { time: "11:00", type: "visit", text: "Castle Hill (Kura Tawhiti)", desc: "《納尼亞傳奇》取景地。巨大的石灰岩陣列散落在草地上，壯觀且適合攀爬拍照。", mapKey: "castle_hill", hours: "24H" }, { time: "13:30", type: "drive", text: "返回 Christchurch", drive: "1小時20分", desc: "回到平原。", mapKey: "castle_hill" }, { time: "16:00", type: "hotel", text: "入住基督城", desc: "整理行李，將生鮮食品清空。", mapKey: "chc_rest" } ] },
    { day: 15, date: "24/5/2026", title: "基督城市區巡禮", color: "#bdc3c7", prevStay: "Christchurch", stay: "Christchurch", route: ["chc_rest", "riverside", "chc_rest"], schedule: [ { time: "10:00", type: "visit", text: "紙教堂 (Cardboard Cathedral)", desc: "由日本建築師坂茂設計，象徵震後重生的希望。結構特殊，光影迷人。", mapKey: "chc_rest", hours: "09:00-17:00" }, { time: "11:30", type: "visit", text: "雅芳河撐篙 (Punting)", desc: "體驗英式風情，乘船穿梭在植物園與市中心。", mapKey: "riverside", hours: "10:00-16:00" }, { time: "14:00", type: "visit", text: "人氣手信採買", desc: "1. Cookie Time Factory Shop (郊區，巨大曲奇)\n2. Pak'nSave 超市 (Whittaker's 巧克力, Manuka 蜂蜜)\n3. Farmers Corner (羊駝被, 保健品)", mapKey: "chc_rest", hours: "各店不同" }, { time: "18:00", type: "visit", text: "告別晚餐", desc: "King of Snake (亞洲融合菜) 或 The Monday Room。", mapKey: "riverside" } ] },
    { day: 16, date: "25/5/2026", title: "返程", color: "#95a5a6", prevStay: "Christchurch", stay: "溫暖的家", route: ["chc_rest", "chc_airport"], schedule: [ { time: "08:00", type: "drive", text: "前往機場還車", drive: "30分鐘", desc: "預留驗車時間。Kia Carnival 需加滿油歸還。", mapKey: "chc_rest" }, { time: "10:00", type: "visit", text: "搭機", desc: "Bon Voyage! 帶著滿滿回憶回家。", mapKey: "chc_airport" } ] }
];

// --- 2. 系統變數 ---
let map, currentLayerGroup;
let routeMarkersByKey = {};
let suppressRouteFitUntil = 0;
let keepMapFocusUntil = 0;
let currentViewMode = 'day';
let itineraryData = [];
let coords = {};
let coordNames = {};
let currentDayIndex = 0;
let isEditingMode = false;
let dragSrcEl = null; // for drag & drop
let lastRouteBounds = null; // Leaflet LatLngBounds for current day route (used to re-fit after resize)

// --- 3. 初始化 ---
async function init() {
    // 1. Map Setup (保持不變)
    map = L.map('map').setView([-43.5321, 172.6362], 7);
    window.map = map; // 存储到 window 以供 Dark Mode 使用
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map);
    currentLayerGroup = L.layerGroup().addTo(map);

    // 2. 分別定義具體路徑
    const itineraryRef = ref(db, 'itinerary');
    const coordsRef = ref(db, 'coords');
    const coordNamesRef = ref(db, 'coordNames');

    try {
        const [itiSnap, coordsSnap, namesSnap] = await Promise.all([
            get(itineraryRef),
            get(coordsRef),
            get(coordNamesRef)
        ]);

        const itiData = itiSnap.val();
        
        if (itiData) {
            itineraryData = itiData;
            coords = coordsSnap.val() || defaultCoords;
            coordNames = namesSnap.val() || defaultCoordNames;
            console.log("✅ 具體路徑資料載入成功");
        } else {
            console.log("Database empty, initializing defaults...");
            itineraryData = JSON.parse(JSON.stringify(defaultItinerary));
            coords = JSON.parse(JSON.stringify(defaultCoords));
            coordNames = JSON.parse(JSON.stringify(defaultCoordNames));
            saveToFirebase();
        }
        saveOfflineSnapshot();

        // --- 修改這裡：不要覆蓋 innerText ---
        console.log("📡 Firebase 連線狀態: 已連線"); 
        // ----------------------------------

        renderNav();
        loadDay(currentDayIndex);

        // 4. 開啟即時監聽
        onValue(itineraryRef, (snapshot) => {
            if (!isEditingMode && snapshot.exists()) {
                console.log("🔄 偵測到雲端更新");
                itineraryData = snapshot.val();
                saveOfflineSnapshot();
                loadDay(currentDayIndex);
            }
        });

    } catch (error) {
        console.error("Firebase 讀取錯誤:", error);
        if (loadOfflineSnapshot()) {
            console.log("📴 使用離線快取資料");
            renderNav();
            loadDay(currentDayIndex);
        } else {
            itineraryData = JSON.parse(JSON.stringify(defaultItinerary));
            coords = JSON.parse(JSON.stringify(defaultCoords));
            coordNames = JSON.parse(JSON.stringify(defaultCoordNames));
            renderNav();
            loadDay(currentDayIndex);
        }
        const statusText = document.getElementById('auth-status');
        if (statusText) statusText.innerText = navigator.onLine ? "連線失敗：使用離線資料" : "離線模式：使用快取資料";
    }
    // ─────────────────────────────────────────────────
    // Map resize handling:
    // - Scroll shrink changes #map-container height with a CSS transition
    // - Switching days may call fitBounds while container is small, causing huge zoom-out
    // - Fix: always re-fit to the latest route bounds whenever the container size changes
    // ─────────────────────────────────────────────────
    window._fitLastBounds = function () {
        if (Date.now() < suppressRouteFitUntil) return;
        if (!map || !lastRouteBounds) return;
        if (typeof lastRouteBounds.isValid === 'function' && !lastRouteBounds.isValid()) return;
        try {
            map.invalidateSize();
            map.fitBounds(lastRouteBounds, { padding: [40, 40], animate: true });
        } catch (e) {}
    };

    (function setupMapResize() {
        const container = document.getElementById('map-container');
        if (!container || typeof ResizeObserver === 'undefined') return;

        let resizeTimer = null;
        const ro = new ResizeObserver(() => {
            // Debounce to avoid repeated fits during transition animation
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                if (Date.now() < suppressRouteFitUntil) return;
                window._fitLastBounds && window._fitLastBounds();
                // Extra delayed pass helps when CSS transition hasn't finished yet
                setTimeout(() => {
                    if (Date.now() < suppressRouteFitUntil) return;
                    window._fitLastBounds && window._fitLastBounds();
                }, 350);
            }, 200);
        });

        ro.observe(container);
    })();

    function updateMapToggleIcon() {
        const toggleBtn = document.getElementById('map-toggle-btn');
        if (!toggleBtn) return;
        toggleBtn.textContent = document.body.classList.contains('map-shrunk') ? '▼' : '▲';
    }

    window.toggleMapShrink = function () {
        document.body.classList.remove('map-card-focus');
        const isShrunk = document.body.classList.toggle('map-shrunk');
        updateMapToggleIcon();
        if (!isShrunk) {
            window._fitLastBounds && window._fitLastBounds();
        }
    };

    window.restoreMapPosition = function () {
        document.body.classList.remove('map-shrunk');
        document.body.classList.remove('map-card-focus');
        document.body.classList.remove('map-fullscreen');
        updateMapToggleIcon();
        window._fitLastBounds && window._fitLastBounds();
    };

    window.toggleMapFullscreen = function () {
        const isFullscreen = document.body.classList.toggle('map-fullscreen');
        document.body.classList.remove('map-card-focus');
        if (isFullscreen) {
            document.body.classList.remove('map-shrunk');
        }
        updateMapToggleIcon();
        window._fitLastBounds && window._fitLastBounds();
    };
    
    // ─────────────────────────────────────────────────
    // 3. Sticky Map Shrink（捲動時地圖縮小）
    // ─────────────────────────────────────────────────
    (function setupMapShrink() {
        const THRESHOLD = 60;
        let ticking = false;
    
        function onScroll(scrollTop) {
            if (!ticking) {
                requestAnimationFrame(() => {
                    if (
                        document.body.classList.contains('map-card-focus') &&
                        scrollTop > THRESHOLD &&
                        Date.now() > keepMapFocusUntil
                    ) {
                        document.body.classList.remove('map-card-focus');
                        map?.invalidateSize();
                    }
                    const wasShrunk = document.body.classList.contains('map-shrunk');
                    const shouldShrink = scrollTop > THRESHOLD;
                    if (wasShrunk !== shouldShrink) {
                        if (!shouldShrink) document.body.classList.remove('map-card-focus');
                        document.body.classList.toggle('map-shrunk', shouldShrink);
                        updateMapToggleIcon();
                        // layout 改了才 invalidate，ResizeObserver 會接手 fitBounds
                    }
                    ticking = false;
                });
                ticking = true;
            }
        }
    
        // 手機：sidebar 獨立 scroll
        const sidebar = document.getElementById('sidebar');
        if (sidebar) sidebar.addEventListener('scroll', () => onScroll(sidebar.scrollTop), { passive: true });
    
        // 桌面 fallback
        window.addEventListener('scroll', () => onScroll(window.scrollY), { passive: true });
    })();
    
    // ─────────────────────────────────────────────────
    // 4. 視窗方向改變（直／橫屏切換）
    // ─────────────────────────────────────────────────
    window.addEventListener('orientationchange', () => {
        setTimeout(() => window._fitLastBounds && window._fitLastBounds(), 400);
    });
}

// --- 4. 核心功能: Firebase 存取 ---
function saveToFirebase() {
    saveOfflineSnapshot();
    // 分開儲存到指定路徑，這樣不會觸發根目錄的寫入權限錯誤
    set(ref(db, 'itinerary'), itineraryData);
    set(ref(db, 'coords'), coords);
    set(ref(db, 'coordNames'), coordNames)
    .then(() => console.log("☁️ 雲端同步成功"))
    .catch(err => {
        console.error("Firebase Save Error:", err);
        alert("儲存失敗：權限不足");
    });
}

// 暴露給 window 的重置功能
function resetDataToDefault() {
    if(confirm("確定要重置所有行程回到預設值嗎？資料庫將被覆寫。")) {
        itineraryData = JSON.parse(JSON.stringify(defaultItinerary));
        coords = JSON.parse(JSON.stringify(defaultCoords));
        coordNames = JSON.parse(JSON.stringify(defaultCoordNames));
        saveToFirebase();
        alert("資料已重置！");
    }
};

// --- 5. UI 渲染邏輯 ---

function renderNav() {
    const container = document.getElementById('nav-container');
    container.innerHTML = '';
    itineraryData.forEach((item, index) => {
        const btn = document.createElement('button');
        btn.className = 'nav-btn';
        const dateParts = (item.date || '').split('/');
        const dateLabel = dateParts.length >= 2 ? `${dateParts[0]}/${dateParts[1]}` : `Day ${item.day}`;
        btn.innerHTML = `<span class="nav-date">${dateLabel}</span><span class="nav-day">Day ${item.day}</span>`;
        btn.title = `Day ${item.day}: ${item.title || ''}`;
        btn.onclick = () => { if(!isEditingMode) loadDay(index); else alert("請先儲存或取消編輯模式"); };
        container.appendChild(btn);
    });
    // Set active
    const btns = container.querySelectorAll('.nav-btn');
    if(btns[currentDayIndex]) {
        btns[currentDayIndex].classList.add('active');
        btns[currentDayIndex].scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
}

function loadDay(index) {
    currentViewMode = 'day';
    currentDayIndex = index;
    isEditingMode = false;
    
    // 1. 處理 Tab 活化狀態
    document.querySelectorAll('.nav-btn').forEach((btn, i) => {
        btn.classList.toggle('active', i === index);
        if (i === index) btn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    });

    // 2. 渲染畫面
    renderViewMode();

    // 2.5 轉 Day 後自動跳返最上面（sidebar 為主要 scroll container）
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
        sidebar.scrollTo({ top: 0, behavior: 'auto' });
        // 保險：等 DOM repaint 後再設一次，避免部分手機瀏覽器 miss
        requestAnimationFrame(() => sidebar.scrollTo({ top: 0, behavior: 'auto' }));
    } else {
        window.scrollTo({ top: 0, behavior: 'auto' });
        requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'auto' }));
    }
    
    // 3. 獲取當天資料
    const data = itineraryData[index];
    
    if (data) {
        // 4. 更新地圖路徑
        updateMapWithRouting(data.route, data.color);

        const weatherPayload = {
            date: data.date,               // 當天日期
            stay: data.stay,            // 今日住宿地點名稱
            stayMapKey: data.stayMapKey,       // 今日住宿 MapKey
            prevStay: data.prevStay,    // 昨日住宿地點名稱
            prevStayMapKey: data.prevStayMapKey // 昨日住宿 MapKey
        };

        // 6. 執行更新天氣（傳入整合後的資料包）
        updateWeatherInfo(weatherPayload);
    }
}

function renderViewMode() {
    const data = itineraryData[currentDayIndex];
    if (!data) return;
    const contentDiv = document.getElementById('itinerary-content');
    const isDarkMode = document.documentElement.getAttribute('data-theme') === 'dark';

    // 1. 定義你的專屬 UID
    const adminUID = "eECs2vvipQM0QZTP8UpTUk5Lq7o2";

    // 2. 嚴格檢查：必須登入 且 UID 必須是你本人
    const isAdmin = auth.currentUser && auth.currentUser.uid === adminUID;
    
    const titleColor = isDarkMode ? '#e0e0e0' : '#2c3e50';
    const metaColor = isDarkMode ? '#aaa' : '#7f8c8d';
    const readOnlyBg = isDarkMode ? '#2a2a2a' : '#eee';
    const readOnlyText = isDarkMode ? '#aaa' : '#95a5a6';
    const readOnlyBorder = isDarkMode ? '#444' : '#ddd';
    
    // 檢查是否登入，決定顯示編輯按鈕還是完全隱藏
    const editBtnHtml = isAdmin ?
        `<button class="btn-main" onclick="window.startEditMode()" style="margin-top:10px; width:100%;">✏️ 編輯整日行程</button>` : 
        ``;
    
    const stayLinkBtn = data.stayLink ? 
        `<a href="${data.stayLink}" target="_blank" style="text-decoration:none; font-size:12px; background:#e67e22; color:white; padding:4px 10px; border-radius:6px; margin-left:10px; font-weight:bold;">🔗 查看預訂</a>` : '';

    let html = `
        <div class="day-header">
            <div style="font-size:12px; color:${isDarkMode ? '#888' : '#7f8c8d'};">前一晚住宿: <b>${data.prevStay || '無'}</b></div>
            <h2 style="margin:5px 0 10px; color:${titleColor};">Day ${data.day}: ${data.title}</h2>
            <div style="font-size:13px; margin-bottom:10px; color:${isDarkMode ? '#b0b0b0' : '#555'};">📅 ${data.date}</div>
            
            <div class="stay-info-container" style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                <div class="stay-info" style="display:flex; align-items:center; color:${isDarkMode ? '#b0b0b0' : '#555'};">
                    🏨 今晚住宿: <b>${data.stay}</b> ${stayLinkBtn}
                </div>
            </div>
            
            ${editBtnHtml}
        </div>
    `;
    
    data.schedule.forEach((item, idx) => {
        // Remove "drive" type; treat legacy drive entries as "activity"
        const normalizedType = item.type === 'drive' ? 'activity' : item.type;
        const typeClass =
            normalizedType === 'activity' ? 'activity' :
            (normalizedType === 'hotel' ? 'hotel' : '');

        // --- 1. 停留時間顯示優化 (自動轉 hr) ---
        let stayHtml = '';
        if (item.stayMinutes) {
            const sMin = parseInt(item.stayMinutes);
            const stayText = sMin >= 60 ? `${(sMin / 60).toFixed(1)} hr` : `${sMin} min`;
            stayHtml = `<span class="stay-badge">⏳ ${stayText}</span>`;
        }

        // --- 2. 車程自動換算 (152 min -> 2hr 32min) ---
        let displayDrive = '';
        if (item.drive) {
            // 呼叫我們之前寫好的轉換函數
            displayDrive = window.formatDriveTime ? window.formatDriveTime(item.drive) : item.drive;
        }
        
        const hasMapPoint = item.mapKey && coords[item.mapKey];
        const mapKeyAttrs = hasMapPoint ? ` data-map-key="${item.mapKey}" role="button" tabindex="0" title="在地圖查看此地點"` : '';
        const mapFocusClass = hasMapPoint ? ' has-map-point' : '';
        const point = hasMapPoint ? coords[item.mapKey] : null;
        const pointLat = point ? point[0] : null;
        const pointLng = point ? point[1] : null;
        const mapLabel = point ? (coordNames[item.mapKey] || item.text || item.mapKey) : '';
        const mapUrl = point ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(pointLat + ',' + pointLng)}` : '';
        const navButton = point ? `<button class="link-btn nav-btn" type="button" data-nav-lat="${pointLat}" data-nav-lng="${pointLng}" data-nav-label="${mapLabel.replace(/"/g, '&quot;')}" onclick="window.openNavigationChooser(this.dataset.navLat, this.dataset.navLng, this.dataset.navLabel)">🧭 導航</button>` : '';
        html += `
            <div class="timeline-item ${typeClass}${mapFocusClass}"${mapKeyAttrs}>
                <div class="item-header" style="display: flex; align-items: center; justify-content: space-between;">
                    <div style="display: flex; align-items: center;">
                        <span class="time-badge">${item.time}</span>
                        ${stayHtml}
                    </div>
                    <div style="font-size: 18px;">
                        ${normalizedType === 'activity' ? '🧗' : ''}
                        ${normalizedType === 'hotel' ? '🛏️' : ''}
                        ${normalizedType === 'visit' ? '🏔️' : ''}
                        ${normalizedType === 'food' ? '🍴' : ''}
                    </div>
                </div>
                <div class="item-title" style="font-weight: bold; margin-top: 5px; font-size: 1.1em;">${item.text}</div>
            
                <div class="item-meta" style="color: ${isDarkMode ? '#888' : '#7f8c8d'}; font-size: 12px; margin-top: 3px;">
                    ${item.hours ? `🕒 開放時間: ${item.hours}` : ''}
                </div>
    
                <div class="item-desc" style="margin-top: 8px; font-size: 14px; line-height: 1.5; color: ${isDarkMode ? '#d0d0d0' : '#34495e'};">
                    ${item.desc ? item.desc.replace(/\n/g, '<br>') : ''}
                </div>
    
                <div class="links-row" style="margin-top: 12px; border-top: 1px dashed ${isDarkMode ? '#444' : '#eee'}; padding-top: 8px;">
                    ${point ? `<a class="link-btn map-view-btn" href="${mapUrl}" target="_blank" rel="noopener">📍 地圖查看</a>` : `<span>未設定地圖座標</span>`}
                    ${navButton}
                    ${item.link ? `<a class="link-btn external-link-btn" href="${item.link}" target="_blank" rel="noopener">🔗 相關連結 / 預訂</a>` : ''}
                </div>
            </div>
        `;

        // 把「下段車程」放喺 card 與 card 之間（最後一張 card 後唔需要顯示）
        if (displayDrive && idx < data.schedule.length - 1) {
            html += `
                <div class="drive-between">
                    <span class="drive-between-chip">🚗 <b>路程</b> ${displayDrive}</span>
                </div>
            `;
        }
    });
    
    contentDiv.innerHTML = html;
    bindTimelineMapFocus(contentDiv);
}

window.showAccommodationOverview = function(options = {}) {
    if (isEditingMode) {
        alert("請先儲存或取消編輯模式");
        return;
    }

    currentViewMode = 'accommodation';
    const contentDiv = document.getElementById('itinerary-content');
    const weatherDiv = document.getElementById('weather-display');
    const hamburgerDropdown = document.getElementById('hamburger-dropdown');
    if (weatherDiv) weatherDiv.style.display = 'none';
    if (hamburgerDropdown) hamburgerDropdown.classList.remove('show');

    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));

    const stayKeys = [];
    const cards = itineraryData.map((day, index) => {
        const stayKey = day.stayMapKey || '';
        const hasMapPoint = stayKey && coords[stayKey];
        if (hasMapPoint && !stayKeys.includes(stayKey)) stayKeys.push(stayKey);

        const mapAttrs = hasMapPoint ? ` data-map-key="${stayKey}" role="button" tabindex="0" title="在地圖查看住宿位置"` : '';
        const mapClass = hasMapPoint ? ' has-map-point' : '';
        const dateText = day.date || `Day ${day.day}`;
        const mapName = coordNames[stayKey] || stayKey;
        const point = hasMapPoint ? coords[stayKey] : null;
        const mapUrl = point
            ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(point[0] + ',' + point[1])}`
            : '';
        const navBtn = point ? `<button class="link-btn nav-btn" type="button" data-nav-lat="${point[0]}" data-nav-lng="${point[1]}" data-nav-label="${mapName.replace(/"/g, '&quot;')}" onclick="window.openNavigationChooser(this.dataset.navLat, this.dataset.navLng, this.dataset.navLabel)">🧭 導航</button>` : '';

        return `
            <div class="accommodation-card${mapClass}"${mapAttrs}>
                <div class="accommodation-card-top">
                    <span class="accommodation-night">Day ${day.day}</span>
                    <span class="accommodation-date">${dateText}</span>
                </div>
                <div class="accommodation-title">${day.stay || '未設定住宿'}</div>
                <div class="accommodation-meta">Day ${day.day}: ${day.title || ''}</div>
                <div class="accommodation-actions">
                    ${hasMapPoint ? `<a class="link-btn map-view-btn" href="${mapUrl}" target="_blank" rel="noopener">📍 地圖查看</a>${navBtn}` : `<span>未設定地圖座標</span>`}
                    ${day.stayLink ? `<a class="link-btn external-link-btn" href="${day.stayLink}" target="_blank" rel="noopener">🔗 查看預訂</a>` : ''}
                </div>
            </div>
        `;
    }).join('');

    contentDiv.innerHTML = `
        <div class="day-header accommodation-overview-header">
            <div style="font-size:12px; color:var(--text-tertiary);">住宿總覽</div>
            <h2 style="margin:5px 0 8px;">全程住宿一覽</h2>
            <div style="font-size:13px; color:var(--text-secondary);">撳住宿卡可以將地圖 zoom 去該住宿位置。</div>
            <button class="btn-main" style="margin-top:12px; width:100%;" onclick="loadDay(${currentDayIndex})">返回當日行程</button>
        </div>
        <div class="accommodation-list">
            ${cards}
        </div>
    `;

    bindTimelineMapFocus(contentDiv);
    if (!options.skipMapUpdate) {
        updateMapWithRouting(stayKeys, '#9b59b6');
    }

    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.scrollTo({ top: 0, behavior: 'auto' });
};

window.showScheduleOverview = function(options = {}) {
    if (isEditingMode) {
        alert("請先儲存或取消編輯模式");
        return;
    }

    currentViewMode = 'schedule';
    const contentDiv = document.getElementById('itinerary-content');
    const weatherDiv = document.getElementById('weather-display');
    const hamburgerDropdown = document.getElementById('hamburger-dropdown');
    if (weatherDiv) weatherDiv.style.display = 'none';
    if (hamburgerDropdown) hamburgerDropdown.classList.remove('show');

    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));

    const scheduleItems = [];
    itineraryData.forEach((day, dayIdx) => {
        if (!day.schedule) return;
        day.schedule.forEach((item) => {
            scheduleItems.push({
                ...item,
                day: day.day,
                date: day.date,
                dayTitle: day.title,
                dayColor: day.color
            });
        });
    });

    const cards = scheduleItems.map((item) => {
        const point = item.mapKey && coords[item.mapKey] ? coords[item.mapKey] : null;
        const mapUrl = point ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(point[0] + ',' + point[1])}` : '';
        const mapName = item.mapKey ? (coordNames[item.mapKey] || item.text) : item.text;
        const navBtn = point ? `<button class="link-btn nav-btn" type="button" data-nav-lat="${point[0]}" data-nav-lng="${point[1]}" data-nav-label="${mapName.replace(/"/g, '&quot;')}" onclick="window.openNavigationChooser(this.dataset.navLat, this.dataset.navLng, this.dataset.navLabel)">🧭 導航</button>` : '';

        const typeIcon = {
            'activity': '🧗',
            'visit': '🏔️',
            'food': '🍴',
            'hotel': '🛏️',
            'drive': '🚗'
        }[item.type] || '📍';

        return `
            <div class="activity-card" style="background: var(--bg-card); padding: 14px; margin-bottom: 12px; border-radius: 10px; border-left: 4px solid ${item.dayColor};">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                    <div>
                        <div style="font-size: 12px; color: var(--text-tertiary); margin-bottom: 2px;">Day ${item.day} | ${item.date}</div>
                        <div style="font-weight: 700; color: var(--text-primary); margin-bottom: 2px;">${typeIcon} ${item.text}</div>
                        <div style="font-size: 12px; color: var(--text-secondary);">${item.dayTitle}</div>
                    </div>
                    <div style="text-align: right; font-size: 13px; font-weight: 700; color: ${item.dayColor};">${item.time}</div>
                </div>
                ${item.hours ? `<div style="font-size: 12px; color: var(--text-tertiary); margin-bottom: 8px;">🕒 ${item.hours}</div>` : ''}
                ${item.drive ? `<div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 8px;">🚗 ${item.drive}</div>` : ''}
                ${item.desc ? `<div style="font-size: 13px; color: var(--text-secondary); line-height: 1.5; margin-bottom: 10px;">${item.desc.replace(/\n/g, '<br>')}</div>` : ''}
                ${point || item.link ? `<div class="links-row" style="margin-top: 0; border-top: none; padding-top: 0; gap: 8px;">
                    ${point ? `<a class="link-btn map-view-btn" href="${mapUrl}" target="_blank" rel="noopener">📍 地圖查看</a>` : ''}
                    ${navBtn}
                    ${item.link ? `<a class="link-btn external-link-btn" href="${item.link}" target="_blank" rel="noopener">🔗 預訂</a>` : ''}
                </div>` : ''}
            </div>
        `;
    }).join('');

    contentDiv.innerHTML = `
        <div class="day-header" style="margin-bottom: 16px;">
            <div style="font-size:12px; color:var(--text-tertiary);">行程總覽</div>
            <h2 style="margin:5px 0 8px;">全程行程一覽</h2>
            <div style="font-size:13px; color:var(--text-secondary);">瀏覽所有行程中的全部項目、景點、活動與用餐。</div>
            <button class="btn-main" style="margin-top:12px; width:100%;" onclick="loadDay(${currentDayIndex})">返回當日行程</button>
        </div>
        <div style="display: grid; gap: 8px;">
            ${cards}
        </div>
    `;

    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.scrollTo({ top: 0, behavior: 'auto' });
};

window.showActivityOverview = function(options = {}) {
    if (isEditingMode) {
        alert("請先儲存或取消編輯模式");
        return;
    }

    currentViewMode = 'activity';
    const contentDiv = document.getElementById('itinerary-content');
    const weatherDiv = document.getElementById('weather-display');
    const hamburgerDropdown = document.getElementById('hamburger-dropdown');
    if (weatherDiv) weatherDiv.style.display = 'none';
    if (hamburgerDropdown) hamburgerDropdown.classList.remove('show');

    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));

    const activities = [];
    itineraryData.forEach((day, dayIdx) => {
        if (!day.schedule) return;
        day.schedule.forEach((item) => {
            if (item.type === 'activity') {
                activities.push({
                    ...item,
                    day: day.day,
                    date: day.date,
                    dayTitle: day.title,
                    dayColor: day.color
                });
            }
        });
    });

    if (activities.length === 0) {
        contentDiv.innerHTML = `
            <div class="day-header" style="margin-bottom: 16px;">
                <div style="font-size:12px; color:var(--text-tertiary);">活動總覽</div>
                <h2 style="margin:5px 0 8px;">全程活動一覽</h2>
                <button class="btn-main" style="margin-top:12px; width:100%;" onclick="loadDay(${currentDayIndex})">返回當日行程</button>
            </div>
            <div style="text-align: center; padding: 30px 20px; color: var(--text-secondary);">
                <div style="font-size: 16px; margin-bottom: 10px;">📭 此行程中沒有活動項目</div>
                <div style="font-size: 13px;">活動指的是冒險、戶外體驗等帶有 🧗 符號的項目。</div>
            </div>
        `;
    } else {
        const cards = activities.map((activity) => {
            const point = activity.mapKey && coords[activity.mapKey] ? coords[activity.mapKey] : null;
            const mapUrl = point ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(point[0] + ',' + point[1])}` : '';
            const mapName = activity.mapKey ? (coordNames[activity.mapKey] || activity.text) : activity.text;
            const navBtn = point ? `<button class="link-btn nav-btn" type="button" data-nav-lat="${point[0]}" data-nav-lng="${point[1]}" data-nav-label="${mapName.replace(/"/g, '&quot;')}" onclick="window.openNavigationChooser(this.dataset.navLat, this.dataset.navLng, this.dataset.navLabel)">🧭 導航</button>` : '';

            return `
                <div class="activity-card" style="background: var(--bg-card); padding: 14px; margin-bottom: 12px; border-radius: 10px; border-left: 4px solid ${activity.dayColor};">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                        <div>
                            <div style="font-size: 12px; color: var(--text-tertiary); margin-bottom: 2px;">Day ${activity.day} | ${activity.date}</div>
                            <div style="font-weight: 700; color: var(--text-primary); margin-bottom: 2px;">🧗 ${activity.text}</div>
                            <div style="font-size: 12px; color: var(--text-secondary);">${activity.dayTitle}</div>
                        </div>
                        <div style="text-align: right; font-size: 13px; font-weight: 700; color: ${activity.dayColor};">${activity.time}</div>
                    </div>
                    ${activity.hours ? `<div style="font-size: 12px; color: var(--text-tertiary); margin-bottom: 8px;">🕒 ${activity.hours}</div>` : ''}
                    ${activity.desc ? `<div style="font-size: 13px; color: var(--text-secondary); line-height: 1.5; margin-bottom: 10px;">${activity.desc.replace(/\n/g, '<br>')}</div>` : ''}
                    ${point || activity.link ? `<div class="links-row" style="margin-top: 0; border-top: none; padding-top: 0; gap: 8px;">
                        ${point ? `<a class="link-btn map-view-btn" href="${mapUrl}" target="_blank" rel="noopener">📍 地圖查看</a>` : ''}
                        ${navBtn}
                        ${activity.link ? `<a class="link-btn external-link-btn" href="${activity.link}" target="_blank" rel="noopener">🔗 預訂</a>` : ''}
                    </div>` : ''}
                </div>
            `;
        }).join('');

        contentDiv.innerHTML = `
            <div class="day-header" style="margin-bottom: 16px;">
                <div style="font-size:12px; color:var(--text-tertiary);">活動總覽</div>
                <h2 style="margin:5px 0 8px;">全程活動一覽</h2>
                <div style="font-size:13px; color:var(--text-secondary);">共 ${activities.length} 個活動項目</div>
                <button class="btn-main" style="margin-top:12px; width:100%;" onclick="loadDay(${currentDayIndex})">返回當日行程</button>
            </div>
            <div style="display: grid; gap: 8px;">
                ${cards}
            </div>
        `;
    }

    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.scrollTo({ top: 0, behavior: 'auto' });
};

window.showWeatherOverview = async function(options = {}) {
    if (isEditingMode) {
        alert("請先儲存或取消編輯模式");
        return;
    }

    currentViewMode = 'weather';
    const contentDiv = document.getElementById('itinerary-content');
    const weatherDiv = document.getElementById('weather-display');
    const hamburgerDropdown = document.getElementById('hamburger-dropdown');
    if (weatherDiv) weatherDiv.style.display = 'none';
    if (hamburgerDropdown) hamburgerDropdown.classList.remove('show');

    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));

    // 顯示載入中
    contentDiv.innerHTML = `
        <div class="day-header" style="margin-bottom: 16px;">
            <div style="font-size:12px; color:var(--text-tertiary);">天氣總覽</div>
            <h2 style="margin:5px 0 8px;">全程天氣預報</h2>
            <button class="btn-main" style="margin-top:12px; width:100%;" onclick="loadDay(${currentDayIndex})">返回當日行程</button>
        </div>
        <div style="text-align: center; padding: 40px 20px; color: var(--text-secondary);">
            <div style="font-size: 20px; margin-bottom: 10px;">⏳</div>
            <div style="font-size: 14px;">正在載入天氣數據...</div>
        </div>
    `;

    // 收集所有需要 fetch 的天氣點
    const weatherFetchJobs = [];
    const weatherCache = {};

    itineraryData.forEach((day) => {
        const stayKey = day.stayMapKey;
        const prevKey = day.prevStayMapKey;
        const dateParts = (day.date || '').split('/');
        const travelDate = dateParts.length === 3 
            ? `${dateParts[2]}-${dateParts[1].padStart(2, '0')}-${dateParts[0].padStart(2, '0')}`
            : '';

        if (!travelDate) return;

        // Fetch 當晚 stay 的天氣
        if (stayKey && coords[stayKey]) {
            const point = coords[stayKey];
            const cacheKey = `${point[0]},${point[1]}:${travelDate}`;
            if (!weatherCache[day.day]) weatherCache[day.day] = {};
            weatherFetchJobs.push(
                fetchWeatherData(point[0], point[1], travelDate)
                    .then(w => { weatherCache[day.day].stay = w; })
            );
        }

        // Fetch 前一晚的天氣（用於該天的起點）
        if (prevKey && coords[prevKey]) {
            const point = coords[prevKey];
            const cacheKey = `${point[0]},${point[1]}:${travelDate}`;
            if (!weatherCache[day.day]) weatherCache[day.day] = {};
            weatherFetchJobs.push(
                fetchWeatherData(point[0], point[1], travelDate)
                    .then(w => { weatherCache[day.day].prev = w; })
            );
        }
    });

    // 等待所有 fetch 完成
    if (weatherFetchJobs.length > 0) {
        await Promise.all(weatherFetchJobs);
    }

    // 建立天氣卡片的輔助函數
    const buildWeatherCardSmall = (locName, weather) => {
        const style = getWeatherStyle(weather?.type);
        const isDarkMode = document.documentElement.getAttribute('data-theme') === 'dark';

        if (!weather || weather.isOutOfRange) {
            return `
                <div style="
                    flex:1;
                    background: var(--bg-input);
                    border-radius: 12px;
                    padding: 12px;
                    text-align: center;
                    color: var(--text-secondary);
                    border: 1px solid var(--border-light);
                    min-width: 0;
                ">
                    <div style="font-size: 13px; font-weight: 700; margin-bottom: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${locName}">
                        ${locName}
                    </div>
                    <div style="font-size: 12px;">❓ 暫無資料</div>
                </div>
            `;
        }

        const textColor = weather?.type === "storm" ? (isDarkMode ? "#e0e0e0" : "#fff") : (isDarkMode ? "#e0e0e0" : "#111");
        const boxBg = weather?.type === "storm"
            ? (isDarkMode ? "rgba(100,100,100,0.2)" : "rgba(255,255,255,0.1)")
            : (isDarkMode ? "rgba(100,100,100,0.2)" : "rgba(255,255,255,0.4)");

        return `
            <div style="
                flex: 1;
                background: ${style.bg};
                border-radius: 12px;
                padding: 12px;
                text-align: center;
                color: ${textColor};
                border: 1px solid ${style.border};
                min-width: 0;
            ">
                <div style="font-size: 13px; font-weight: 700; margin-bottom: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${locName}">
                    ${locName}
                </div>
                <div style="font-size: 22px; margin-bottom: 6px;">
                    ${weather.icon}
                </div>
                <div style="font-size: 11px; font-weight: 600; margin-bottom: 8px; opacity: 0.9;">
                    ${weather.weather}
                </div>
                <div style="display: flex; gap: 4px; font-size: 10px;">
                    <div style="flex: 1; background: ${boxBg}; border-radius: 8px; padding: 3px;">
                        <div style="opacity: 0.7;">早</div>
                        <div style="font-weight: 700;">${weather.tempAM}</div>
                    </div>
                    <div style="flex: 1; background: ${boxBg}; border-radius: 8px; padding: 3px;">
                        <div style="opacity: 0.7;">午</div>
                        <div style="font-weight: 700;">${weather.tempPM}</div>
                    </div>
                    <div style="flex: 1; background: ${boxBg}; border-radius: 8px; padding: 3px;">
                        <div style="opacity: 0.7;">晚</div>
                        <div style="font-weight: 700;">${weather.tempNight}</div>
                    </div>
                </div>
            </div>
        `;
    };

    // 建立每日卡片
    const dayCards = itineraryData.map((day) => {
        const dayWeather = weatherCache[day.day] || {};
        const prevLocName = day.prevStay || '起點';
        const stayLocName = day.stay || '終點';

        return `
            <div style="background: var(--bg-card); padding: 16px; margin-bottom: 12px; border-radius: 12px; border-left: 4px solid ${day.color};">
                <div style="font-size: 13px; color: var(--text-tertiary); margin-bottom: 2px; font-weight: 700;">Day ${day.day}</div>
                <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 12px;">${day.date} - ${day.title}</div>
                <div style="display: flex; gap: 10px;">
                    ${buildWeatherCardSmall(prevLocName, dayWeather.prev)}
                    ${buildWeatherCardSmall(stayLocName, dayWeather.stay)}
                </div>
            </div>
        `;
    }).join('');

    contentDiv.innerHTML = `
        <div class="day-header" style="margin-bottom: 16px;">
            <div style="font-size:12px; color:var(--text-tertiary);">天氣總覽</div>
            <h2 style="margin:5px 0 8px;">全程天氣預報</h2>
            <div style="font-size:13px; color:var(--text-secondary);">根據各日出發點與目的地的天氣預報。</div>
            <button class="btn-main" style="margin-top:12px; width:100%;" onclick="loadDay(${currentDayIndex})">返回當日行程</button>
        </div>
        <div style="display: grid; gap: 8px;">
            ${dayCards}
        </div>
    `;

    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.scrollTo({ top: 0, behavior: 'auto' });
};

function bindTimelineMapFocus(contentDiv) {
    contentDiv.querySelectorAll('.timeline-item[data-map-key], .accommodation-card[data-map-key]').forEach(card => {
        let touchFocusedAt = 0;
        let pointerStart = null;
        const focusFromEvent = (event) => {
            if (event.target.closest('a, button, input, select, textarea')) return;
            window.focusMapPoint(card.dataset.mapKey, card);
        };

        card.addEventListener('click', (event) => {
            if (Date.now() - touchFocusedAt < 500) return;
            focusFromEvent(event);
        });
        card.addEventListener('pointerdown', (event) => {
            if (event.pointerType === 'mouse') return;
            pointerStart = { x: event.clientX, y: event.clientY };
        });
        card.addEventListener('pointerup', (event) => {
            if (event.pointerType === 'mouse') return;
            if (pointerStart) {
                const moved = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
                pointerStart = null;
                if (moved > 12) return;
            }
            touchFocusedAt = Date.now();
            focusFromEvent(event);
        });

        card.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            window.focusMapPoint(card.dataset.mapKey, card);
        });
    });
}

window.focusMapPoint = function(mapKey, sourceCard) {
    const point = coords?.[mapKey];
    if (!map || !point) return;
    const wasShrunk = document.body.classList.contains('map-shrunk');
    const useFloatingMap = wasShrunk && window.matchMedia('(max-width: 768px)').matches;
    suppressRouteFitUntil = Date.now() + 1200;

    document.querySelectorAll('.is-map-focused').forEach(card => {
        card.classList.remove('is-map-focused');
    });
    if (sourceCard) sourceCard.classList.add('is-map-focused');

    if (useFloatingMap) {
        document.body.classList.add('map-card-focus');
        keepMapFocusUntil = Date.now() + 500;
    } else if (wasShrunk) {
        document.body.classList.remove('map-shrunk');
        const toggleBtn = document.getElementById('map-toggle-btn');
        if (toggleBtn) toggleBtn.textContent = '▲';
    }

    requestAnimationFrame(() => {
        setTimeout(() => {
            map.invalidateSize();
            map.flyTo(point, Math.max(map.getZoom(), 13), {
                animate: true,
                duration: 0.7
            });

            const marker = routeMarkersByKey[mapKey]?.[0];
            if (marker) {
                setTimeout(() => marker.openPopup(), 450);
            }
        }, wasShrunk ? 320 : 0);
    });
};

window.openNavigationChooser = function(lat, lng, label = '') {
    const title = label ? `導航至：${label}` : '導航';
    const sheet = document.createElement('div');
    sheet.className = 'nav-sheet-overlay';
    sheet.innerHTML = `
        <div class="nav-sheet">
            <div class="nav-sheet-header">
                <div>
                    <div class="nav-sheet-title">${title}</div>
                    <div class="nav-sheet-subtitle">選擇導航應用程式</div>
                </div>
                <button type="button" class="nav-sheet-close" aria-label="關閉">×</button>
            </div>
            <div class="nav-sheet-body">
                <a class="nav-sheet-option" href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}" target="_blank" rel="noopener">Google Maps</a>
                <a class="nav-sheet-option" href="https://maps.apple.com/?daddr=${lat},${lng}" target="_blank" rel="noopener">Apple 地圖</a>
                <a class="nav-sheet-option" href="https://www.waze.com/ul?ll=${lat},${lng}&navigate=yes" target="_blank" rel="noopener">Waze</a>
            </div>
        </div>
    `;
    document.body.appendChild(sheet);
    sheet.querySelector('.nav-sheet-close').addEventListener('click', () => sheet.remove());
    sheet.addEventListener('click', (event) => {
        if (event.target === sheet) sheet.remove();
    });
};

// 計算兩點之間的車程（回傳分鐘與公里）
async function getDriveInfo(startCoords, endCoords) {
    // OSRM 格式是 lng,lat;lng,lat (經度在前)
    // 注意：你的 coords 格式如果是 [lat, lng]，這裡要反轉
    const url = `https://router.project-osrm.org/route/v1/driving/${startCoords[1]},${startCoords[0]};${endCoords[1]},${endCoords[0]}?overview=false`;
    
    try {
        const response = await fetch(url);
        const data = await response.json();
        if (data.code === 'Ok' && data.routes.length > 0) {
            return {
                minutes: Math.round(data.routes[0].duration / 60),
                km: (data.routes[0].distance / 1000).toFixed(1)
            };
        }
    } catch (e) {
        console.error("OSRM 計算出錯:", e);
    }
    return null;
}

window.autoFillTraffic = async function() {
    const rows = document.querySelectorAll('.edit-item-row');
    if (rows.length < 2) return;

    const btn = event.currentTarget;
    const statusText = document.getElementById('sync-status');
    btn.innerText = "⏳ 計算中...";
    btn.disabled = true;

    try {
        for (let i = 0; i < rows.length - 1; i++) {
            const startKey = rows[i].querySelector('select[name="mapKey"]').value;
            const endKey = rows[i+1].querySelector('select[name="mapKey"]').value;
            const startPos = coords[startKey];
            const endPos = coords[endKey];

            if (startPos && endPos && startKey !== 'none' && endKey !== 'none') {
                const info = await getDriveInfo(startPos, endPos);
                if (info) {
                    // 1. 更新駕駛時間文字
                    rows[i].querySelector('.drive-input').value = `${info.minutes} min (${info.km} km)`;

                    // 2. 計算時間連動
                    const currentTimeStr = rows[i].querySelector('input[name="time"]').value;
                    const stayMin = parseInt(rows[i].querySelector('input[name="stayMinutes"]').value) || 0;
                    
                    if (currentTimeStr) {
                        const totalGap = stayMin + info.minutes;
                        const nextTime = addMinutesToTime(currentTimeStr, totalGap);
                        rows[i+1].querySelector('input[name="time"]').value = nextTime;
                    }
                }
            }
        }
        statusText.innerText = "✅ 已更新全天車程與時間";
        statusText.style.opacity = "1";
        setTimeout(() => statusText.style.opacity = "0", 3000);
    } catch (err) {
        statusText.innerText = "❌ 計算出錯";
        statusText.style.opacity = "1";
    } finally {
        btn.innerText = "🚗 自動計算車程";
        btn.disabled = false;
    }
};

// 輔助函數：時間加法
function addMinutesToTime(timeStr, minutesToAdd) {
    const [hours, mins] = timeStr.split(':').map(Number);
    const date = new Date();
    date.setHours(hours);
    date.setMinutes(mins + minutesToAdd);
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
}

// --- 【新增輔助函數】：將 API 數字代碼轉換為天氣描述 ---
function getWeatherMeta(code) {
    if (code === 0) return { icon:"☀️", text:"晴朗", type:"clear" };
    if (code === 1) return { icon:"🌤️", text:"大致晴朗", type:"clear" };
    if (code === 2) return { icon:"⛅", text:"部分多雲", type:"cloud" };
    if (code === 3) return { icon:"☁️", text:"多雲", type:"cloud" };
    if (code === 45 || code === 48) return { icon:"🌫️", text:"霧", type:"fog" };
    if (code >= 51 && code <= 57) return { icon:"🌦️", text:"毛毛雨", type:"rain" };
    if (code >= 61 && code <= 67) return { icon:"🌧️", text:"降雨", type:"rain" };
    if (code >= 80 && code <= 82) return { icon:"🌦️", text:"陣雨", type:"rain" };
    if (code >= 71 && code <= 77) return { icon:"❄️", text:"降雪", type:"snow" };
    if (code === 95) return { icon:"⛈️", text:"雷暴", type:"storm" };
    if (code >= 96) return { icon:"⛈️", text:"強雷暴/冰雹", type:"storm" };
    return { icon:"❓", text:"未知", type:"unknown" };
}

// --- 【修改 1】：更新 fetchWeatherData，攔截「超過預測範圍」的錯誤 ---
async function fetchWeatherData(lat, lng, dateStr) {
    const cached = getCachedWeather(lat, lng, dateStr);
    if (cached) return cached;

    try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=sunrise,sunset,weathercode&hourly=temperature_2m&timezone=auto&start_date=${dateStr}&end_date=${dateStr}`;
        
        const res = await fetch(url);

        // ❗ API error handling
        if (!res.ok) {
            let errorJson = {};
            try {
                errorJson = await res.json();
            } catch (e) {}

            if (errorJson?.reason?.includes("out of allowed range")) {
                const outOfRange = { isOutOfRange: true };
                setCachedWeather(lat, lng, dateStr, outOfRange);
                return outOfRange;
            }

            throw new Error("API 回應失敗");
        }

        const json = await res.json();

        const weatherCode = json?.daily?.weathercode?.[0];
        const hourly = json?.hourly?.temperature_2m;

        if (weatherCode === undefined || weatherCode === null || !hourly) {
            throw new Error("資料不完整");
        }

        const meta = getWeatherMeta(weatherCode);

        const weatherData = {
            // 🌅 日出日落
            sunrise: json.daily.sunrise[0]?.split('T')[1] || "--",
            sunset: json.daily.sunset[0]?.split('T')[1] || "--",

            // 🌤️ 天氣（升級版 object）
            weather: meta.text,
            icon: meta.icon,
            type: meta.type,

            // 🌡️ 溫度（安全 fallback）
            tempAM: hourly[8] != null ? Math.round(hourly[8]) + "°C" : "--",
            tempPM: hourly[13] != null ? Math.round(hourly[13]) + "°C" : "--",
            tempNight: hourly[20] != null ? Math.round(hourly[20]) + "°C" : "--",
        };
        setCachedWeather(lat, lng, dateStr, weatherData);
        return weatherData;

    } catch (e) {
        console.error("天氣抓取錯誤:", e);
        return getCachedWeather(lat, lng, dateStr);
    }
}

function getWeatherStyle(type) {
    const isDarkMode = document.documentElement.getAttribute('data-theme') === 'dark';
    
    if (isDarkMode) {
        // 深色模式
        switch (type) {
            case "clear":
                return {
                    bg: "linear-gradient(135deg,#1a3a52,#0d4a6e)",
                    border: "rgba(100,181,246,0.4)",
                    shadow: "0 10px 25px rgba(100,181,246,0.1)"
                };
            case "cloud":
                return {
                    bg: "linear-gradient(135deg,#2a2a2a,#1f1f1f)",
                    border: "rgba(150,150,150,0.3)",
                    shadow: "0 8px 20px rgba(0,0,0,0.3)"
                };
            case "rain":
                return {
                    bg: "linear-gradient(135deg,#1a3a52,#0d4a6e)",
                    border: "rgba(100,181,246,0.4)",
                    shadow: "0 10px 25px rgba(100,181,246,0.15)"
                };
            case "snow":
                return {
                    bg: "linear-gradient(135deg,#1a2a3a,#0d3a52)",
                    border: "rgba(144,202,249,0.4)",
                    shadow: "0 10px 25px rgba(144,202,249,0.1)"
                };
            case "storm":
                return {
                    bg: "linear-gradient(135deg,#2a2a3a,#1a1a2a)",
                    border: "rgba(100,181,246,0.3)",
                    shadow: "0 12px 30px rgba(0,0,0,0.5)"
                };
            case "fog":
                return {
                    bg: "linear-gradient(135deg,#252525,#1a1a1a)",
                    border: "rgba(130,130,130,0.3)",
                    shadow: "0 8px 20px rgba(0,0,0,0.3)"
                };
            default:
                return {
                    bg: "linear-gradient(135deg,#2a2a2a,#1f1f1f)",
                    border: "rgba(100,100,100,0.3)",
                    shadow: "0 8px 20px rgba(0,0,0,0.3)"
                };
        }
    } else {
        // 淺色模式
        switch (type) {
            case "clear":
                return {
                    bg: "linear-gradient(135deg,#e0f2fe,#bae6fd)",
                    border: "rgba(59,130,246,0.3)",
                    shadow: "0 10px 25px rgba(59,130,246,0.15)"
                };
            case "cloud":
                return {
                    bg: "linear-gradient(135deg,#f5f5f5,#e5e5e5)",
                    border: "rgba(0,0,0,0.08)",
                    shadow: "0 8px 20px rgba(0,0,0,0.08)"
                };
            case "rain":
                return {
                    bg: "linear-gradient(135deg,#dbeafe,#93c5fd)",
                    border: "rgba(37,99,235,0.3)",
                    shadow: "0 10px 25px rgba(37,99,235,0.2)"
                };
            case "snow":
                return {
                    bg: "linear-gradient(135deg,#f0f9ff,#e0f2fe)",
                    border: "rgba(125,211,252,0.4)",
                    shadow: "0 10px 25px rgba(125,211,252,0.2)"
                };
            case "storm":
                return {
                    bg: "linear-gradient(135deg,#1f2937,#374151)",
                    border: "rgba(255,255,255,0.15)",
                    shadow: "0 12px 30px rgba(0,0,0,0.5)"
                };
            case "fog":
                return {
                    bg: "linear-gradient(135deg,#e5e7eb,#d1d5db)",
                    border: "rgba(0,0,0,0.05)",
                    shadow: "0 8px 20px rgba(0,0,0,0.1)"
                };
            default:
                return {
                    bg: "linear-gradient(135deg,#f3f4f6,#e5e7eb)",
                    border: "rgba(0,0,0,0.1)",
                    shadow: "0 8px 20px rgba(0,0,0,0.1)"
                };
        }
    }
}

async function updateWeatherInfo(data) {
    const weatherDiv = document.getElementById('weather-display');
    if (!weatherDiv) return;
    weatherDiv.style.display = 'block';

    const rawDate = data.date || "10/05/2026";
    const dateParts = rawDate.split('/');
    const travelDate = `${dateParts[2]}-${dateParts[1].padStart(2, '0')}-${dateParts[0].padStart(2, '0')}`;

    const stayKey = data.stayMapKey;
    const prevKey = data.prevStayMapKey;
    const getCoords = (key) => coords?.[key];
    const stayCoords = getCoords(stayKey);
    const prevCoords = getCoords(prevKey);

    let stayWeather = null;
    let prevWeather = null;

    if (stayCoords) {
        stayWeather = await fetchWeatherData(stayCoords[0], stayCoords[1], travelDate);
    }

    if (prevCoords) {
        prevWeather = await fetchWeatherData(prevCoords[0], prevCoords[1], travelDate);
    }

    const buildWeatherCard = (name, weather) => {
        const style = getWeatherStyle(weather?.type);
        const isDarkMode = document.documentElement.getAttribute('data-theme') === 'dark';

        const textColor = weather?.type === "storm" ? (isDarkMode ? "#e0e0e0" : "#fff") : (isDarkMode ? "#e0e0e0" : "#111");
        const boxBg = weather?.type === "storm"
            ? (isDarkMode ? "rgba(100,100,100,0.2)" : "rgba(255,255,255,0.1)")
            : (isDarkMode ? "rgba(100,100,100,0.2)" : "rgba(255,255,255,0.4)");

        if (!weather || weather.isOutOfRange) {
            return `
                <div style="
                    flex:1;
                    background:${style.bg};
                    border-radius:15px;
                    padding:15px;
                    text-align:center;
                    color:${textColor};
                    border:1px solid ${style.border};
                    min-width:0;
                ">
                    <div style="font-size:14px;font-weight:900;margin-bottom:8px;">
                        ${name || '未知'}
                    </div>
                    <div style="font-size:12px;font-weight:bold;">
                        ❓ 暫無資料
                    </div>
                </div>
            `;
        }

        return `
            <div style="
                flex:1;
                background:${style.bg};
                border-radius:15px;
                padding:15px;
                text-align:center;
                color:${textColor};
                box-shadow:${style.shadow};
                border:1px solid ${style.border};
                min-width:0;
            ">
                <div style="
                    font-size:15px;
                    font-weight:900;
                    margin:0 0 10px;
                    white-space:nowrap;
                    overflow:hidden;
                    text-overflow:ellipsis;
                " title="${name}">
                    ${name}
                </div>
                <div style="font-size:26px;margin-bottom:6px;">
                    ${weather.icon} ${weather.weather}
                </div>
                <div style="
                    background:${boxBg};
                    border-radius:20px;
                    padding:4px 10px;
                    margin-bottom:12px;
                    font-size:11px;
                    display:inline-flex;
                    gap:10px;
                    font-weight:bold;
                ">
                    <span>🌅 ${weather.sunrise}</span>
                    <span>🌇 ${weather.sunset}</span>
                </div>
                <div style="display:flex;gap:6px;">
                    <div style="flex:1;background:${boxBg};border-radius:10px;padding:6px 0;">
                        <div style="font-size:10px;opacity:0.8;">早</div>
                        <div style="font-size:13px;font-weight:900;">${weather.tempAM}</div>
                    </div>
                    <div style="flex:1;background:${boxBg};border-radius:10px;padding:6px 0;">
                        <div style="font-size:10px;opacity:0.8;">午</div>
                        <div style="font-size:13px;font-weight:900;">${weather.tempPM}</div>
                    </div>
                    <div style="flex:1;background:${boxBg};border-radius:10px;padding:6px 0;">
                        <div style="font-size:10px;opacity:0.8;">晚</div>
                        <div style="font-size:13px;font-weight:900;">${weather.tempNight}</div>
                    </div>
                </div>
            </div>
        `;
    };

    const buildCompactCard = (name, weather) => {
        const style = getWeatherStyle(weather?.type);
        const currentHour = new Date().getHours();
        const tempSlot = currentHour < 12
            ? 'am'
            : (currentHour < 18 ? 'pm' : 'night');
        if (!weather || weather.isOutOfRange) {
            return `
                <div class="weather-compact-card" style="--weather-accent:${style.border};">
                    <div class="weather-small-main">
                        <div class="weather-small-icon">?</div>
                        <div class="weather-small-copy">
                            <div class="weather-small-title">${name || '未知'}</div>
                            <div class="weather-small-desc">? 暫無資料</div>
                        </div>
                    </div>
                    <div class="weather-small-temps weather-small-empty">--</div>
                </div>
            `;
        }

        return `
            <div class="weather-compact-card" style="--weather-accent:${style.border};">
                <div class="weather-small-main">
                    <div class="weather-small-icon">${weather.icon}</div>
                    <div class="weather-small-copy">
                        <div class="weather-small-title" title="${name}">${name}</div>
                        <div class="weather-small-desc">${weather.weather}</div>
                    </div>
                </div>
                <div class="weather-small-temps">
                    <div class="weather-temp-chip ${tempSlot === 'am' ? 'is-current' : ''}"><span>早</span><strong>${weather.tempAM}</strong></div>
                    <div class="weather-temp-chip ${tempSlot === 'pm' ? 'is-current' : ''}"><span>午</span><strong>${weather.tempPM}</strong></div>
                    <div class="weather-temp-chip ${tempSlot === 'night' ? 'is-current' : ''}"><span>晚</span><strong>${weather.tempNight}</strong></div>
                </div>
                <div class="weather-small-sun">
                    <span>🌅 ${weather.sunrise}</span>
                    <span>🌇 ${weather.sunset}</span>
                </div>
            </div>
        `;
    };

    weatherDiv.innerHTML = `
        <div class="weather-full">
            <div style="
                display:flex;
                gap:15px;
                width:100%;
                box-sizing:border-box;
                margin:15px 0;
                padding:5px;
            ">
                ${buildWeatherCard(data.prevStay, prevWeather)}
                ${buildWeatherCard(data.stay, stayWeather)}
            </div>
        </div>
        <div class="weather-compact">
            ${buildCompactCard(data.prevStay, prevWeather)}
            ${buildCompactCard(data.stay, stayWeather)}
        </div>
    `;
}

// --- 6. 編輯模式 ---

function startEditMode() {
    isEditingMode = true;
    const data = itineraryData[currentDayIndex];
    // 獲取前一天的資料，用於自動抓取「前一晚住宿」的定位與連結
    const prevDayData = currentDayIndex > 0 ? itineraryData[currentDayIndex - 1] : null;
    const contentDiv = document.getElementById('itinerary-content');

    // 進入編輯模式時，隱藏天氣看板
    const weatherDiv = document.getElementById('weather-display');
    if (weatherDiv) weatherDiv.style.display = 'none';
    
    // 工具函數：根據名稱反向搜尋 MapKey
    const findMapKeyByName = (name) => {
        if (!name) return "";
        return Object.keys(coordNames).find(key => coordNames[key] === name) || "";
    };

    let editSchedule = JSON.parse(JSON.stringify(data.schedule || []));
    // Remove legacy "drive" type by converting to "activity"
    editSchedule = editSchedule.map((it) => (it && it.type === 'drive' ? { ...it, type: 'activity' } : it));

    // --- 1. 數據自動同步與更新 (Grab Logic) ---
    
    // A. 處理「前一晚住宿」(行程起點)
    const prevName = (data.prevStay || "").trim();
    const prevMapKey =
        data.prevStayMapKey ||
        (prevDayData ? prevDayData.stayMapKey : findMapKeyByName(prevName));
    const prevLink = prevDayData ? (prevDayData.stayLink || "") : "";
    if (prevName !== "" && prevName !== "飛機上") {
        const firstIsSameStay =
            editSchedule.length > 0 &&
            editSchedule[0].type === "hotel" &&
            (editSchedule[0].text || "").trim() === prevName;
        if (firstIsSameStay) {
            // 已存在則自動同步資料
            editSchedule[0].mapKey = prevMapKey;
            editSchedule[0].link = prevLink;
            editSchedule[0].type = "hotel";
        } else {
            // 不存在則插入
            editSchedule.unshift({
                time: "08:00",
                type: "hotel",
                text: prevName,
                stayMinutes: 0,
                desc: "從前一晚住宿出發",
                mapKey: prevMapKey,
                link: prevLink,
                hours: ""
            });
        }
    }
    
    // B. 處理「當晚住宿」(行程終點)
    const stayName = (data.stay || "").trim();
    const stayMapKey = data.stayMapKey || findMapKeyByName(stayName);
    const stayLink = data.stayLink || "";
    if (stayName !== "") {
        const lastIdx = editSchedule.length - 1;
        const lastIsSameStay =
            editSchedule.length > 0 &&
            editSchedule[lastIdx].type === "hotel" &&
            (editSchedule[lastIdx].text || "").trim() === stayName;
        if (lastIsSameStay) {
            // 已存在則自動同步資料
            editSchedule[lastIdx].mapKey = stayMapKey;
            editSchedule[lastIdx].link = stayLink;
            editSchedule[lastIdx].type = "hotel";
        } else {
            // 不存在則插入
            editSchedule.push({
                time: "18:00",
                type: "hotel",
                text: stayName,
                stayMinutes: 0,
                desc: "抵達今晚住宿",
                mapKey: stayMapKey,
                link: stayLink,
                hours: ""
            });
        }
    }

    // --- 2. 構建 UI 介面 ---
    let html = `
        <div class="edit-controls" style="position: sticky; top: 0; background: white; z-index: 1000; padding: 10px 0; border-bottom: 2px solid #ddd; margin-bottom: 10px;">
            <div style="display: flex; gap: 10px; margin-bottom: 10px;">
                <button class="btn-main btn-cancel" style="flex:1" onclick="loadDay(${currentDayIndex})">取消</button>
                <button class="btn-main btn-save" style="flex:2; background: #27ae60;" onclick="saveDayEdit()">💾 儲存所有變更</button>
            </div>
            <div style="display: flex; gap: 10px; align-items: center;">
                <button class="btn-main" style="flex:1; background: #6c5ce7; color: white;" onclick="autoFillTraffic()">🚗 自動計算車程</button>
                <span id="sync-status" style="font-size: 12px; color: #27ae60; font-weight: bold; opacity: 0; transition: opacity 0.5s;"></span>
            </div>
        </div>

        ${typeof generateEditHeader === 'function' ? generateEditHeader(data) : ''}

        <div style="background:#f8f9fa; padding:15px; border-radius:8px; border:1px solid #dee2e6; margin-bottom:15px;">
            <label style="font-size:11px; font-weight:bold; color:#6c757d; text-transform:uppercase;">今日行程標題</label>
            <input type="text" id="edit-day-title" value="${data.title || ''}" class="input-full" style="margin-bottom:12px; font-weight:bold;">
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                <div>
                    <label style="font-size:11px; font-weight:bold; color:#6c757d;">🏠 前一晚住宿</label>
                    <input type="text" id="edit-prev-stay" value="${data.prevStay || ''}" class="input-full" placeholder="名稱">
                    <input type="hidden" id="edit-prevStayMapKey" value="${prevMapKey}">
                </div>
                <div>
                    <label style="font-size:11px; font-weight:bold; color:#6c757d;">🛌 今晚住宿</label>
                    <input type="text" id="edit-stay" value="${data.stay || ''}" class="input-full" placeholder="名稱">
                    <input type="hidden" id="edit-stayMapKey" value="${stayMapKey}">
                    <input type="hidden" id="edit-stayLink" value="${stayLink}">
                </div>
            </div>
        </div>

        <div id="edit-list-container">
    `;

    // 渲染行程項目 (這裡會顯示你圖片中下方那部分的定位選單與連結)
    editSchedule.forEach((item, idx) => {
        html += generateEditRow(item, idx);
    });

    html += `</div>
        <button class="btn-add-row" style="width:100%; padding:12px; background:#f39c12; color:white; border:none; border-radius:5px; margin-top:10px; font-weight:bold;" onclick="addEditRow()">+ 新增行程項目</button>
    `;

    contentDiv.innerHTML = html;
    if (typeof enableDragAndDrop === 'function') enableDragAndDrop();
}

function generateEditRow(item, idx) {
    const options = generateLocOptions(item.mapKey);
    const displayDrive = window.formatDriveTime(item.drive || '');

    return `
        <div class="edit-item-row" data-idx="${idx}" style="padding: 12px; margin-bottom: 15px;">
            <div class="row-number-badge">ITEM ${idx + 1}</div>
            <button class="btn-delete-row" onclick="this.parentElement.remove(); window.updateRoutePreview();">×</button>
            
            <div class="edit-row-header" style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px;">
                <div class="drag-controls" style="display: flex; align-items: center; gap: 0; background: #f0f2f5; border-radius: 6px; border: 1px solid #ddd; height: 32px; flex-shrink: 0;">
                    <span class="drag-handle" draggable="true" style="cursor: grab; font-size: 14px; color: #95a5a6; padding: 0 8px; display: flex; align-items: center; height: 100%; border-right: 1px solid #ddd;">☰</span>
                    <button type="button" onclick="moveRow(this, -1)" class="sort-btn" style="width: 28px; height: 100%; display: flex; align-items: center; justify-content: center; border: none; background: transparent; cursor: pointer; border-right: 1px solid #ddd;">▲</button>
                    <button type="button" onclick="moveRow(this, 1)" class="sort-btn" style="width: 28px; height: 100%; display: flex; align-items: center; justify-content: center; border: none; background: transparent; cursor: pointer;">▼</button>
                </div>
                <input type="text" 
                       name="time" 
                       value="${item.time}" 
                       placeholder="HHmm" 
                       maxlength="5"
                       oninput="formatTimeInput(this)"
                       style="width: 60px; flex-shrink: 0; height: 32px; text-align: center; border: 1px solid #dcdfe6; border-radius: 6px; font-size: 13px; font-family: monospace; font-weight: bold;">
                <select name="type" style="width: 70px; flex-shrink: 0; height: 32px;">
                    <option value="visit" ${item.type==='visit'?'selected':''}>景點</option>
                    <option value="activity" ${item.type==='activity'?'selected':''}>活動</option>
                    <option value="hotel" ${item.type==='hotel'?'selected':''}>住宿</option>
                    <option value="food" ${item.type==='food'?'selected':''}>餐廳</option>
                </select>
                <input type="text" name="text" value="${item.text}" class="input-full" placeholder="名稱" style="flex: 1; min-width: 0; height: 32px;">
            </div>
            
            <textarea name="desc" class="input-full" placeholder="詳細介紹" style="margin-bottom: 8px; min-height: 40px;">${item.desc || ''}</textarea>
            
            <div class="input-group" style="display: flex; gap: 8px; margin-bottom: 8px; align-items: center;">
                <input type="text" name="hours" value="${item.hours || ''}" placeholder="開放時間" style="flex: 1.5;">
                <div style="flex: 1; display: flex; align-items: center; background: #fff3e0; padding: 4px 10px; border-radius: 6px; border: 1px solid #ffcc80; justify-content: center;">
                    <span style="font-size: 12px; color: #e65100; white-space: nowrap; margin-right: 5px;">⏳ 停留</span>
                    <input type="number" 
                       name="stayMinutes" 
                       value="${(item.stayMinutes !== undefined && item.stayMinutes !== null) ? item.stayMinutes : 60}" 
                       step="10" 
                       style="width: 45px; border: 1px solid #ffcc80; background: white; text-align: center; font-weight: bold; color: #e65100; font-size: 13px; border-radius: 4px;">
                    <span style="font-size: 12px; color: #e65100; margin-left: 5px;">分</span>
                </div>
            </div>

            <div style="display: flex; gap: 8px; margin-bottom: 8px; width: 100%; box-sizing: border-box;">
                <div style="flex: 1; min-width: 0; background: #f0f7ff; padding: 5px 8px; border-radius: 4px; display: flex; align-items: center; border: 1px solid #d0e4f5;">
                    <span style="font-size: 12px; color: #2980b9; margin-right: 5px; white-space: nowrap;">🚗 車程:</span>
                    <input type="text" name="drive" class="drive-input" value="${displayDrive}" placeholder="自動計算" 
                           style="width: 100%; border: none; background: transparent; color: #2980b9; font-size: 12px; min-width: 0;">
                </div>
                
                <div style="flex: 1.5; min-width: 0; background: #fef5e7; padding: 5px 8px; border-radius: 4px; display: flex; align-items: center; border: 1px solid #fad7a0;">
                    <span style="font-size: 12px; color: #d35400; margin-right: 5px; white-space: nowrap;">🔗 連結:</span>
                    <input type="url" name="link" value="${item.link || ''}" placeholder="預訂網址" 
                           style="width: 100%; border: none; background: transparent; font-size: 12px; min-width: 0;">
                </div>
            </div>

            <div style="background:#eee; padding:5px 8px; border-radius:4px; display: flex; align-items: center; gap: 8px;">
                <span style="font-size:11px; color:#666; white-space: nowrap;">🗺️ 地圖定位:</span>
                <select name="mapKey" class="input-full map-key-select" onchange="window.updateRoutePreview()" style="flex: 1; border: 1px solid #ccc; background: white; font-size: 12px; height: 26px; padding: 0 5px;">
                    ${options}
                </select>
                <button type="button" onclick="window.openLocManager()" title="管理地點座標" style="background:none; border:none; cursor:pointer; font-size:14px; padding: 0 4px;">⚙️</button>
            </div>
        </div>
    `;
}

function generateLocOptions(selectedKey) {
    let options = `<option value="">(無/自訂地點)</option>`;
    const sortedKeys = Object.keys(coords).sort((a, b) => {
        const nameA = coordNames[a] || a;
        const nameB = coordNames[b] || b;
        return nameA.localeCompare(nameB);
    });

    for (let key of sortedKeys) {
        const selected = selectedKey === key ? 'selected' : '';
        const displayName = coordNames[key] ? `${coordNames[key]} (${key})` : key;
        options += `<option value="${key}" ${selected}>${displayName}</option>`;
    }
    return options;
}

function addEditRow() {
    const newItem = { time: "12:00", type: "visit", text: "", desc: "", mapKey: "", stayMinutes: 60, link: "" };
    const container = document.getElementById('edit-list-container');
    const count = container.children.length;
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = generateEditRow(newItem, count);
    container.appendChild(tempDiv.firstElementChild);
    enableDragAndDrop();
}

function saveDayEdit() {
    console.log("正在觸發儲存..."); 
    const container = document.getElementById('edit-list-container');
    const rows = container.querySelectorAll('.edit-item-row');
    const newSchedule = [];
    const newRoute = [];

    rows.forEach(row => {
        const mapKey = row.querySelector('[name="mapKey"]').value;
        
        // --- 核心修正 1：解決 0 分鐘問題 ---
        const stayInput = row.querySelector('[name="stayMinutes"]');
        const stayVal = stayInput ? stayInput.value : "";
        // 只要不是空字串就轉數字，確保 0 被保留；只有完全沒填才給 60
        const stayMinutes = stayVal !== "" ? parseInt(stayVal) : 60;

        newSchedule.push({
            time: row.querySelector('[name="time"]').value,
            type: row.querySelector('[name="type"]').value,
            text: row.querySelector('[name="text"]').value,
            desc: row.querySelector('[name="desc"]').value,
            hours: row.querySelector('[name="hours"]').value,
            drive: row.querySelector('[name="drive"]').value,
            stayMinutes: stayMinutes, 
            mapKey: mapKey,
            link: row.querySelector('[name="link"]').value
        });

        if(mapKey) newRoute.push(mapKey);
    });
    
    // 排序行程
    newSchedule.sort((a,b) => a.time.localeCompare(b.time));

    // --- 核心修正 2：更新 Local State (確保所有欄位都被讀取) ---
    const dayData = itineraryData[currentDayIndex];
    dayData.title = document.getElementById('edit-day-title').value;
    dayData.prevStay = document.getElementById('edit-prev-stay').value;
    
    // 這裡要對應你在 startEditMode 加入的住宿欄位 ID
    // 如果你在 UI 沒加這些 ID 的 input，記得要在 startEditMode 的 HTML 加上去
    if(document.getElementById('edit-prevStayMapKey')) {
        dayData.prevStayMapKey = document.getElementById('edit-prevStayMapKey').value;
    }
    
    dayData.stay = document.getElementById('edit-stay').value;
    
    if(document.getElementById('edit-stayLink')) {
        dayData.stayLink = document.getElementById('edit-stayLink').value;
    }
    if(document.getElementById('edit-stayMapKey')) {
        dayData.stayMapKey = document.getElementById('edit-stayMapKey').value;
    }
    
    dayData.schedule = newSchedule;
    dayData.route = newRoute;

    // 重置編輯狀態
    isEditingMode = false;

    // 儲存至 Firebase
    saveToFirebase();

    // 立即重新載入畫面
    loadDay(currentDayIndex);
    
    console.log("儲存程序完成");
}

// --- 7. 拖曳排序 (Drag & Drop) ---
function enableDragAndDrop() {
    const rows = document.querySelectorAll('.edit-item-row');
    rows.forEach(row => {
        const handle = row.querySelector('.drag-handle');
        
        // 只有從 handle 開始拖拽時才記錄目標
        handle.addEventListener('dragstart', (e) => {
            dragSrcEl = row; // 記錄整個 row 為被拖對象
            e.dataTransfer.effectAllowed = 'move';
            row.style.opacity = '0.4';
        });

        row.addEventListener('dragover', handleDragOver);
        row.addEventListener('drop', handleDrop);
        row.addEventListener('dragend', () => {
            row.style.opacity = '1';
            updateRowNumbers(); // 每次拖完更新序號
        });
    });
}
function handleDragStart(e) { dragSrcEl = this; e.dataTransfer.effectAllowed = 'move'; this.style.opacity = '0.4'; }
function handleDragOver(e) { if (e.preventDefault) e.preventDefault(); e.dataTransfer.dropEffect = 'move'; return false; }
function handleDrop(e) {
    if (e.stopPropagation) e.stopPropagation();
    if (dragSrcEl !== this) {
        if (Array.from(this.parentNode.children).indexOf(this) > Array.from(this.parentNode.children).indexOf(dragSrcEl)) {
            this.after(dragSrcEl);
        } else {
            this.before(dragSrcEl);
        }
        window.updateRoutePreview();
    }
    return false;
}
function handleDragEnd() { this.style.opacity = '1'; }

function updateRoutePreview() {
    const rows = document.querySelectorAll('.edit-item-row');
    const tempRoute = [];
    rows.forEach(row => {
        const key = row.querySelector('[name="mapKey"]').value;
        if(key) tempRoute.push(key);
    });
    const color = itineraryData[currentDayIndex].color;
    updateMapWithRouting(tempRoute, color);
}
// 新增：一鍵移動函數
window.moveRow = function(btn, direction) {
    // 1. 找到目前的這一格
    const row = btn.closest('.edit-item-row');
    const container = row.parentElement;
    
    if (direction === -1) {
        // 向上移：找到前一個兄弟元素
        const prev = row.previousElementSibling;
        // 確保前一個元素也是行程格子 (避免移過頭到標題或其它元件)
        if (prev && prev.classList.contains('edit-item-row')) {
            container.insertBefore(row, prev);
        } else {
            return; // 已經是頂部了
        }
    } else {
        // 向下移：找到下一個兄弟元素
        const next = row.nextElementSibling;
        if (next && next.classList.contains('edit-item-row')) {
            // insertBefore(要移動的, 在哪個之後) -> 這裡要把下一格插到目前這格的前面，效果等同於目前這格下移
            container.insertBefore(next, row);
        } else {
            return; // 已經是底部了
        }
    }
    
    // 2. 移動後更新視覺序號 (ITEM 1, ITEM 2...)
    updateRowNumbers();
    
    // 3. 更新地圖路線預覽
    if (window.updateRoutePreview) {
        window.updateRoutePreview();
    }

    // 4. (選配) 增加一個簡單的閃爍效果，提示移動成功
    row.style.transition = 'background-color 0.3s';
    row.style.backgroundColor = '#f1f8ff';
    setTimeout(() => {
        row.style.backgroundColor = '#fff';
    }, 300);
};

// 更新所有格子序號的輔助函數
function updateRowNumbers() {
    document.querySelectorAll('.row-number-badge').forEach((badge, i) => {
        badge.innerText = `ITEM ${i + 1}`;
    });
}

// --- 8. 地圖路由 (OSRM) ---
async function updateMapWithRouting(routeKeys, color) {
    currentLayerGroup.clearLayers();
    routeMarkersByKey = {};
    if (!routeKeys || routeKeys.length === 0) return;

    const waypoints = [];
    routeKeys.forEach((key, idx) => {
        if (coords[key]) {
            const point = coords[key];
            waypoints.push(point);
            const marker = L.marker(point).bindPopup(`<b>${idx + 1}. ${coordNames[key] || key}</b>`).addTo(currentLayerGroup);
            if (!routeMarkersByKey[key]) routeMarkersByKey[key] = [];
            routeMarkersByKey[key].push(marker);
        }
    });

    if (waypoints.length < 2) {
         if (waypoints.length === 1) {
            map.setView(waypoints[0], 10);
            lastRouteBounds = L.latLngBounds([waypoints[0], waypoints[0]]);
         }
         return;
    }

    const coordsString = waypoints.map(p => `${p[1]},${p[0]}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coordsString}?overview=full&geometries=geojson`;

    try {
        const response = await fetch(url);
        const json = await response.json();

        if (json.code === 'Ok') {
            const routeGeoJSON = json.routes[0].geometry;
            L.geoJSON(routeGeoJSON, { style: { color: color, weight: 5, opacity: 0.8 } }).addTo(currentLayerGroup);
            const bounds = L.geoJSON(routeGeoJSON).getBounds();
            lastRouteBounds = bounds;
            map.fitBounds(bounds, { padding: [50, 50] });
        } else {
            L.polyline(waypoints, { color: color, weight: 2, dashArray: '5,5' }).addTo(currentLayerGroup);
            lastRouteBounds = L.latLngBounds(waypoints.map(p => L.latLng(p[0], p[1])));
            map.fitBounds(lastRouteBounds, { padding: [50, 50] });
        }
    } catch (e) {
        L.polyline(waypoints, { color: color, weight: 2, dashArray: '5,5' }).addTo(currentLayerGroup);
        lastRouteBounds = L.latLngBounds(waypoints.map(p => L.latLng(p[0], p[1])));
        map.fitBounds(lastRouteBounds, { padding: [50, 50] });
    }
}

// --- 9. 座標管理員 ---
function openLocManager() {
    document.getElementById('loc-modal').style.display = 'flex';
    window.renderLocList();
    document.getElementById('loc-key').value = '';
    document.getElementById('loc-key').disabled = false;
    document.getElementById('loc-name').value = '';
    document.getElementById('loc-lat').value = '';
    document.getElementById('loc-lng').value = '';
}
function closeLocManager() { document.getElementById('loc-modal').style.display = 'none'; }

function renderLocList() {
    const container = document.getElementById('loc-list-container');
    const filter = document.getElementById('loc-search').value.toLowerCase();
    container.innerHTML = '';
    const keys = Object.keys(coords).sort();
    
    keys.forEach(key => {
        const name = coordNames[key] || '';
        const match = key.toLowerCase().includes(filter) || name.toLowerCase().includes(filter);
        if (match) {
            const [lat, lng] = coords[key];
            const div = document.createElement('div');
            div.className = 'loc-item';
            div.innerHTML = `
                <div class="loc-details"><b>${name}</b> <span style="color:#888;">(${key})</span><br><span style="font-size:10px; color:#555;">${lat}, ${lng}</span></div>
                <div class="loc-actions">
                    <button onclick="window.editLocation('${key}')">✏️</button>
                    <button onclick="window.deleteLocation('${key}')" style="color:#e74c3c;">🗑️</button>
                </div>
            `;
            container.appendChild(div);
        }
    });
}

function editLocation(key) {
    document.getElementById('loc-key').value = key;
    document.getElementById('loc-key').disabled = true; 
    document.getElementById('loc-name').value = coordNames[key] || '';
    document.getElementById('loc-lat').value = coords[key][0];
    document.getElementById('loc-lng').value = coords[key][1];
    document.querySelector('.modal-content').scrollTop = 0;
}

function saveLocation() {
    const key = document.getElementById('loc-key').value.trim();
    const name = document.getElementById('loc-name').value.trim();
    const lat = parseFloat(document.getElementById('loc-lat').value);
    const lng = parseFloat(document.getElementById('loc-lng').value);

    if (!key || !name || isNaN(lat) || isNaN(lng)) { alert("請填寫所有欄位"); return; }

    coords[key] = [lat, lng];
    coordNames[key] = name;
    
    saveToFirebase(); // 同步到雲端
    
    window.renderLocList();
    document.getElementById('loc-key').value = '';
    document.getElementById('loc-key').disabled = false;
    document.getElementById('loc-name').value = '';
    document.getElementById('loc-lat').value = '';
    document.getElementById('loc-lng').value = '';
    updateMapKeySelects();
}

function deleteLocation(key) {
    if (confirm(`確定要刪除 ${key} 嗎?`)) {
        delete coords[key];
        delete coordNames[key];
        saveToFirebase();
        window.renderLocList();
        updateMapKeySelects();
    }
}

// login
window.handleLoginSubmit = async function() {
    try {
        console.log("嘗試開啟彈窗登入...");
        const result = await signInWithPopup(auth, provider);
        console.log("登入成功！", result.user);
    } catch (err) {
        console.error("登入失敗原因：", err.code);
        alert("登入失敗：" + err.message);
    }
};

window.openLoginModal = function() {
    if (auth.currentUser) {
        if(confirm("確定要登出管理員模式嗎？")) {
            signOut(auth).then(() => {
                alert("已登出");
                location.reload(); 
            });
        }
    } else {
        const modal = document.getElementById('login-modal');
        if (modal) modal.style.display = 'flex';
    }
};

window.closeLoginModal = function() {
    document.getElementById('login-modal').style.display = 'none';
};

//time
window.formatTimeInput = function(input) {
    // 1. 只准輸入數字，刪除所有非數字字元
    let val = input.value.replace(/\D/g, '');
    
    // 2. 限制最多 4 位數字 (HHmm)
    if (val.length > 4) val = val.slice(0, 4);
    
    // 3. 如果達到 3-4 位數字，自動在第 2 位後面補冒號
    if (val.length >= 3) {
        input.value = val.slice(0, 2) + ':' + val.slice(2);
    } else {
        input.value = val;
    }
};

//km
window.formatDriveTime = function(driveStr) {
    if (!driveStr) return '';
    
    // 使用正則表達式提取數字（分鐘）和剩餘部分（公里數）
    const match = driveStr.match(/(\d+)\s*min(.*)/);
    
    if (match) {
        const totalMin = parseInt(match[1]);
        const extra = match[2]; // 這裡會拿到 " (184.9 km)"
        
        const hrs = Math.floor(totalMin / 60);
        const mins = totalMin % 60;
        
        let result = "";
        if (hrs > 0) result += `${hrs}hr `;
        result += `${mins}min`;
        
        return result + extra;
    }
    
    return driveStr; // 如果格式不符，回傳原始字串
};

// 同步函數：將頂部資料推送到下方所有 hotel 類型的 row
window.syncStayToItems = function() {
    const prevName = document.getElementById('edit-prev-stay').value;
    const prevLoc = document.getElementById('edit-prevStayMapKey').value;
    
    const stayName = document.getElementById('edit-stay').value;
    const stayLink = document.getElementById('edit-stayLink').value;
    const stayLoc = document.getElementById('edit-stayMapKey').value;

    const rows = document.querySelectorAll('.edit-item-row');
    rows.forEach((row, idx) => {
        const typeSelect = row.querySelector('select[name="type"]');
        if (typeSelect && typeSelect.value === 'hotel') {
            const nameInput = row.querySelector('input[name="text"]');
            const linkInput = row.querySelector('input[name="link"]');
            const locSelect = row.querySelector('select[name="mapKey"]');

            if (idx === 0) {
                // 如果是第一行，自動填入昨天的資料
                if (nameInput) nameInput.value = prevName;
                if (locSelect) locSelect.value = prevLoc;
                if (linkInput) linkInput.value = ""; 
            } else {
                // 其他位置，填入今天的資料
                if (nameInput) nameInput.value = stayName;
                if (linkInput) linkInput.value = stayLink;
                if (locSelect) locSelect.value = stayLoc;
            }
        }
    });
    
    // 如果你有即時預覽功能，同步後觸發更新
    if (window.updateRoutePreview) window.updateRoutePreview();
};

function generateEditHeader(data) {
    // 自動獲取前一天的資料作為起點
    const prevDayData = currentDayIndex > 0 ? itineraryData[currentDayIndex - 1] : null;
    const prevStayName = prevDayData ? prevDayData.stay : (data.prevStay || "起點/機場");
    const prevStayMapKey = prevDayData ? prevDayData.stayMapKey : (data.prevStayMapKey || "");

    const locOptionsStay = generateLocOptions(data.stayMapKey || '');
    
    return `
        <div class="edit-day-header" style="background:#f8f9fa; padding:15px; border-radius:12px; margin-bottom:20px; border:1px solid #e0e6ed; box-sizing: border-box;">
            <div style="background:#f1f2f6; border:1px solid #dcdfe6; padding:10px; border-radius:8px; margin-bottom:12px; font-size:12px; color:#57606f;">
                📍 <b>出發點同步 (來自昨天):</b> ${prevStayName} 
                <input type="hidden" id="edit-prev-stay" value="${prevStayName}">
                <input type="hidden" id="edit-prevStayMapKey" value="${prevStayMapKey}">
            </div>

            <h3 style="margin:0 0 12px; font-size:16px; color:#2c3e50;">🏨 今晚住宿配置</h3>
            
            <div style="background:#fff; border:1px solid #eee; padding:10px; border-radius:8px; box-sizing: border-box;">
                <div style="display:flex; gap:8px; margin-bottom:12px; width: 100%; box-sizing: border-box;">
                    <div style="flex:1.2; min-width:0;">
                        <label style="font-size:11px; color:#7f8c8d; display:block; margin-bottom:4px;">住宿名稱</label>
                        <input type="text" id="edit-stay" value="${data.stay || ''}" 
                               oninput="window.syncStayToItems()" placeholder="飯店名稱" 
                               style="width:100%; height:32px; border:1px solid #ddd; border-radius:6px; padding:0 8px; box-sizing: border-box;">
                    </div>
                    <div style="flex:1; min-width:0;">
                        <label style="font-size:11px; color:#7f8c8d; display:block; margin-bottom:4px;">Google Map 定位</label>
                        <div style="display:flex; align-items:center; background:white; border:1px solid #ddd; border-radius:6px; padding-right:4px; height:32px; box-sizing: border-box;">
                            <select id="edit-stayMapKey" onchange="window.syncStayToItems()" 
                                    style="flex:1; border:none; background:transparent; height:100%; min-width:0; font-size:12px; outline:none;">
                                ${locOptionsStay}
                            </select>
                            <button type="button" onclick="window.openLocManager()" style="background:none; border:none; cursor:pointer; font-size:16px;">⚙️</button>
                        </div>
                    </div>
                </div>
                <label style="font-size:11px; color:#7f8c8d; display:block; margin-bottom:4px;">預訂/官網連結</label>
                <input type="url" id="edit-stayLink" value="${data.stayLink || ''}" 
                       oninput="window.syncStayToItems()" placeholder="https://..." 
                       style="width:100%; height:32px; border:1px solid #ddd; border-radius:6px; padding:0 8px; box-sizing: border-box;">
            </div>
        </div>
    `;
}

// 全局導出功能：產出 JSON 給 Gemini
function exportAllDays() {
    if (!itineraryData) return alert("資料尚未加載");
    
    const exportData = itineraryData.map(day => ({
        day: day.day,
        title: day.title,
        schedule: day.schedule.map((item, sIdx) => ({
            id: `D${day.day}-S${sIdx}`, // 固定 ID 確保回填精準
            text: item.text,
            type: item.type,
            desc: item.desc || "",   // 匯出原有描述參考
            hours: item.hours || ""  // 匯出原有時間參考
        }))
    }));

    const jsonStr = JSON.stringify(exportData, null, 2);
    navigator.clipboard.writeText(jsonStr).then(() => {
        alert("📊 全行程資料已複製！\n請貼給 Gemini 並要求它優化內容。");
    });
}

// 全局匯入功能：接收 Gemini 回傳的 JSON
function importAllDays() {
    // 1. 建立背景遮罩
    const overlay = document.createElement('div');
    overlay.id = 'gemini-import-overlay';
    overlay.style = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.85); z-index: 9999;
        display: flex; align-items: center; justify-content: center;
        padding: 20px; box-sizing: border-box;
    `;

    // 2. 建立輸入視窗
    overlay.innerHTML = `
        <div style="background: white; width: 100%; max-width: 800px; border-radius: 12px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
            <div style="padding: 15px 20px; background: #f8f9fa; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center;">
                <h3 style="margin: 0; color: #2c3e50; font-size: 18px;">📥 貼上 Gemini 完整 JSON 資料</h3>
                <button onclick="document.getElementById('gemini-import-overlay').remove()" style="background:none; border:none; font-size: 24px; cursor: pointer; color: #95a5a6;">&times;</button>
            </div>
            
            <div style="padding: 20px;">
                <p style="font-size: 13px; color: #7f8c8d; margin-top: 0;">請將 Gemini 回傳的代碼完整貼在下方（支援超長文字）：</p>
                <textarea id="gemini-import-textarea" placeholder="在此貼上 [ { ... } ] 格式的資料" 
                    style="width: 100%; height: 400px; padding: 12px; border: 1px solid #ddd; border-radius: 8px; font-family: 'Courier New', monospace; font-size: 12px; line-height: 1.5; resize: none; box-sizing: border-box; outline: none;"></textarea>
            </div>

            <div style="padding: 15px 20px; background: #f8f9fa; border-top: 1px solid #eee; text-align: right;">
                <button id="gemini-cancel-btn" style="padding: 10px 20px; border: 1px solid #ccc; background: white; border-radius: 6px; cursor: pointer; margin-right: 10px;">取消</button>
                <button id="gemini-confirm-btn" style="padding: 10px 20px; border: none; background: #009688; color: white; border-radius: 6px; cursor: pointer; font-weight: bold;">確認匯入資料</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // 取消事件
    document.getElementById('gemini-cancel-btn').onclick = () => overlay.remove();

    // 匯入處理事件
    document.getElementById('gemini-confirm-btn').onclick = function() {
        const rawValue = document.getElementById('gemini-import-textarea').value.trim();
        if (!rawValue) return alert("內容不能為空");

        try {
            const importedData = JSON.parse(rawValue);
            
            // 開始對應更新 itineraryData
            importedData.forEach((importedDay, dIdx) => {
                if (itineraryData[dIdx]) {
                    importedDay.schedule.forEach((importedItem, sIdx) => {
                        if (itineraryData[dIdx].schedule[sIdx]) {
                            // 覆蓋描述與營業時間
                            itineraryData[dIdx].schedule[sIdx].desc = importedItem.desc || "";
                            itineraryData[dIdx].schedule[sIdx].hours = importedItem.hours || "";
                        }
                    });
                }
            });

            alert("✅ 資料已成功加載至記憶體！\n請進入當天編輯模式點擊「儲存」以寫入雲端。");
            overlay.remove();
            
            // 刷新當前畫面
            if (typeof loadDay === 'function') loadDay(currentDayIndex);
            
        } catch (error) {
            console.error("JSON 解析出錯:", error);
            alert("❌ 格式解析失敗！請確保貼上的是完整的 [ ] 陣列格式，且沒有被截斷。");
        }
    };
}

// 10. Global Function Exposures
// 登入與權限控制 (新增)
window.openLoginModal = openLoginModal;
window.closeLoginModal = closeLoginModal;
window.handleLoginSubmit = handleLoginSubmit;

// --- 新增：Gemini 批量處理功能 ---
window.exportAllDays = exportAllDays;
window.importAllDays = importAllDays;
// ----------------------------

// 原有的行程編輯功能
window.saveDayEdit = saveDayEdit;
window.startEditMode = startEditMode;
window.addEditRow = addEditRow;
window.loadDay = loadDay;
window.resetDataToDefault = resetDataToDefault;

// 地點管理功能
window.openLocManager = openLocManager;
window.closeLocManager = closeLocManager;
window.saveLocation = saveLocation;
window.deleteLocation = deleteLocation;
window.editLocation = editLocation;
window.renderLocList = renderLocList;
window.updateRoutePreview = updateRoutePreview;

// 啟動 App
init();
