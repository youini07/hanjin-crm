import { useState, useEffect } from 'react';
import axios from 'axios';
import { Package, MessageSquareText, FileSpreadsheet, SlidersHorizontal } from 'lucide-react';
import KakaoShippingPage from './pages/KakaoShippingPage';
import GripShippingPage from './pages/GripShippingPage';
import ApiSettingsModal, { type PublicApiSettings } from './components/ApiSettingsModal';
import { API_URL, socket } from './config/api';
import type { GridRow } from './components/ShippingGrid';

type ActivePage = 'kakao' | 'grip';

const getPageFromPathname = (pathname: string): ActivePage => {
  return pathname.startsWith('/grip') ? 'grip' : 'kakao';
};

/**
 * App - 모던 미니멀 상단 네비게이션 및 페이지 레이아웃
 */
function App() {
  const [activePage, setActivePage] = useState<ActivePage>(() =>
    getPageFromPathname(window.location.pathname)
  );
  const [kakaoCount, setKakaoCount] = useState(0);
  const [gripCount, setGripCount] = useState(0);
  const [apiSettings, setApiSettings] = useState<PublicApiSettings | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  useEffect(() => {
    const handlePopState = () => {
      setActivePage(getPageFromPathname(window.location.pathname));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // 서버에 저장된 API 키 상태 조회 (소켓 재연결 시 자동 동기화)
  useEffect(() => {
    const loadSettings = () => {
      axios
        .get(`${API_URL}/settings`)
        .then((res) => {
          if (res.data?.success && res.data.settings) {
            setApiSettings(res.data.settings);
          }
        })
        .catch(() => {});
    };

    loadSettings();
    socket.on('connect', loadSettings);
    return () => {
      socket.off('connect', loadSettings);
    };
  }, []);

  useEffect(() => {
    const updateKakaoCount = (rows: GridRow[]) =>
      setKakaoCount(Array.isArray(rows) ? rows.length : 0);
    const updateGripCount = (rows: GridRow[]) =>
      setGripCount(Array.isArray(rows) ? rows.length : 0);

    socket.on('init_kakao_grid', updateKakaoCount);
    socket.on('kakao_grid_updated', updateKakaoCount);
    socket.on('init_grip_grid', updateGripCount);
    socket.on('grip_grid_updated', updateGripCount);

    socket.emit('request_kakao_grid');
    socket.emit('request_grip_grid');

    return () => {
      socket.off('init_kakao_grid', updateKakaoCount);
      socket.off('kakao_grid_updated', updateKakaoCount);
      socket.off('init_grip_grid', updateGripCount);
      socket.off('grip_grid_updated', updateGripCount);
    };
  }, []);

  const navigateTo = (page: ActivePage) => {
    const targetPath = page === 'grip' ? '/grip' : '/';
    if (window.location.pathname !== targetPath) {
      window.history.pushState({}, '', targetPath);
    }
    setActivePage(page);
  };

  return (
    <div className="min-h-screen bg-[#F7F8FA] text-slate-900">
      {/* 모던 글래스 상단 헤더 */}
      <header className="sticky top-0 z-30 bg-white/85 backdrop-blur-md border-b border-slate-200/80">
        <div className="w-full max-w-[1480px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          {/* 브랜드 영역 */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0 shadow-xs">
              <Package size={18} strokeWidth={2.2} />
            </div>
            <div className="truncate">
              <h1 className="text-[15px] font-bold text-slate-900 tracking-tight leading-tight">
                한진택배 송장 워크스페이스
              </h1>
              <p className="text-[11px] text-slate-400 hidden sm:block">
                {activePage === 'kakao'
                  ? '카카오톡 AI 주소 분석 · DB 대조 · 엑셀 출력'
                  : '그립(Grip) 주문 합포장 추출 · 엑셀 출력'}
              </p>
            </div>
          </div>

          {/* 우측 세그먼트 탭 & 설정 버튼 */}
          <div className="flex items-center gap-2.5">
            <nav className="flex items-center bg-slate-100/90 p-1 rounded-xl border border-slate-200/60">
              <button
                type="button"
                onClick={() => navigateTo('kakao')}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-[13px] font-semibold transition-all ${
                  activePage === 'kakao'
                    ? 'bg-white text-slate-900 shadow-xs ring-1 ring-slate-900/5'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <MessageSquareText size={15} />
                <span>카카오톡 주문</span>
                {kakaoCount > 0 && (
                  <span
                    className={`text-[11px] px-1.5 py-0.2 rounded-md font-bold tabular-nums ${
                      activePage === 'kakao'
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-200/80 text-slate-600'
                    }`}
                  >
                    {kakaoCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => navigateTo('grip')}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-[13px] font-semibold transition-all ${
                  activePage === 'grip'
                    ? 'bg-white text-slate-900 shadow-xs ring-1 ring-slate-900/5'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <FileSpreadsheet size={15} />
                <span>그립(Grip) 시트</span>
                {gripCount > 0 && (
                  <span
                    className={`text-[11px] px-1.5 py-0.2 rounded-md font-bold tabular-nums ${
                      activePage === 'grip'
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-200/80 text-slate-600'
                    }`}
                  >
                    {gripCount}
                  </span>
                )}
              </button>
            </nav>

            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-200/90 shadow-2xs transition"
              title="AI 및 주소 API 설정"
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  apiSettings?.hasGeminiKey ? 'bg-emerald-500' : 'bg-slate-300'
                }`}
              />
              <SlidersHorizontal size={14} />
              <span className="hidden md:inline">설정</span>
            </button>
          </div>
        </div>
      </header>

      {/* 메인 컨텐츠 영역 */}
      <main className="w-full max-w-[1480px] mx-auto px-4 sm:px-6 py-6">
        {activePage === 'kakao' ? <KakaoShippingPage /> : <GripShippingPage />}
      </main>

      {isSettingsOpen && (
        <ApiSettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          onSettingsUpdated={(updated) => setApiSettings(updated)}
        />
      )}
    </div>
  );
}

export default App;
