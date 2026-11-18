import { useState, useEffect } from 'react';
import axios from 'axios';
import { Package, ClipboardPaste, ShoppingBag, Settings } from 'lucide-react';
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
 * App - 최상위 레이아웃, 페이지 라우터 및 API 설정 모달 관리
 */
function App() {
  const [activePage, setActivePage] = useState<ActivePage>(() =>
    getPageFromPathname(window.location.pathname)
  );
  const [kakaoCount, setKakaoCount] = useState(0);
  const [gripCount, setGripCount] = useState(0);
  const [apiSettings, setApiSettings] = useState<PublicApiSettings | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // 브라우저 뒤로가기 / 앞으로가기 지원
  useEffect(() => {
    const handlePopState = () => {
      setActivePage(getPageFromPathname(window.location.pathname));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // 서버에 저장된 API 키 상태 조회 (백엔드가 늦게 켜져도 소켓 연결 시 자동 재동기화)
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

  // 상단 탭에 각 페이지 대기 건수 실시간 표시
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
    <div className="min-h-screen bg-slate-100 py-6 px-4 sm:px-6">
      <div className="w-full max-w-[1480px] mx-auto space-y-4">
        {/* 상단 헤더 및 페이지 전환 네비게이션 */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white rounded-2xl shadow-md px-5 py-3.5 border border-slate-200">
          {/* 좌측 타이틀 */}
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-50 rounded-xl">
              <Package size={26} className="text-blue-600" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-800 tracking-tight">
                한진택배 고객 배송지 입력기
              </h1>
              <p className="text-xs text-slate-500">
                {activePage === 'kakao'
                  ? '카카오톡 대화 AI 분석 → 변경/신규 주소 확인 → 한진택배 엑셀 내보내기'
                  : '그립(Grip) 판매내역서 합포장 추출 → 배송지 확인 → 한진택배 엑셀 내보내기'}
              </p>
            </div>
          </div>

          {/* 우측 페이지 전환 탭 + API 설정 버튼 */}
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="flex items-center gap-1.5 bg-slate-100 p-1.5 rounded-xl flex-1 sm:flex-initial">
              <button
                type="button"
                onClick={() => navigateTo('kakao')}
                className={`flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                  activePage === 'kakao'
                    ? 'bg-amber-500 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                }`}
              >
                <ClipboardPaste size={16} />
                <span>카카오톡 텍스트 입력</span>
                {kakaoCount > 0 && (
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                      activePage === 'kakao'
                        ? 'bg-white/25 text-white'
                        : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    {kakaoCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => navigateTo('grip')}
                className={`flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                  activePage === 'grip'
                    ? 'bg-violet-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                }`}
              >
                <ShoppingBag size={16} />
                <span>그립(Grip) 엑셀 파일</span>
                {gripCount > 0 && (
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                      activePage === 'grip'
                        ? 'bg-white/25 text-white'
                        : 'bg-violet-100 text-violet-700'
                    }`}
                  >
                    {gripCount}
                  </span>
                )}
              </button>
            </div>

            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              className={`flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-bold border transition shrink-0 ${
                apiSettings?.hasGeminiKey
                  ? 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
                  : 'bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-300'
              }`}
              title="Gemini API 키 및 주소 검색 API 키 설정"
            >
              <Settings size={15} />
              <span className="hidden md:inline">API 설정</span>
            </button>
          </div>
        </div>

        {/* 현재 선택된 페이지 렌더링 */}
        {activePage === 'kakao' ? <KakaoShippingPage /> : <GripShippingPage />}
      </div>

      {/* API 키 및 AI 모델 설정 모달 (열릴 때마다 초기 상태로 마운트) */}
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
