import { useState, useEffect } from 'react';
import axios from 'axios';
import {
  Settings,
  X,
  KeyRound,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  Sparkles,
  MapPinned,
  ShieldCheck,
  RefreshCw,
} from 'lucide-react';
import { API_URL } from '../config/api';

export interface PublicApiSettings {
  hasGeminiKey: boolean;
  geminiKeyMasked: string;
  geminiModel: string;
  hasJusoKey: boolean;
  jusoKeyMasked: string;
  hasKakaoKey: boolean;
  kakaoKeyMasked: string;
}

interface ApiSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSettingsUpdated: (settings: PublicApiSettings) => void;
}

const MODEL_PRESETS = [
  { id: 'gemini-3.5-flash-lite', label: 'gemini-3.5-flash-lite (권장 · 초저가 · 고속)' },
  { id: 'gemini-3.1-flash-lite', label: 'gemini-3.1-flash-lite' },
  { id: 'gemini-3-flash-preview', label: 'gemini-3-flash-preview (고성능)' },
];

/**
 * ApiSettingsModal - 웹 화면에서 Gemini API 키·모델 및 주소 검색 API 키를 직접 입력·저장하는 모달
 *
 * 왜 필요한가:
 * 코드나 서버 환경변수 파일을 건드리지 않고도 웹 브라우저에서 API 키와 AI 모델을 손쉽게 교체·저장할 수 있게 함.
 * 저장된 키는 로컬 DB뿐만 아니라 비공개 구글 시트(_앱설정)에도 백업되어 재배포 후에도 유지됨.
 */
export default function ApiSettingsModal({
  isOpen,
  onClose,
  onSettingsUpdated,
}: ApiSettingsModalProps) {
  const [currentInfo, setCurrentInfo] = useState<PublicApiSettings | null>(null);
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [geminiModel, setGeminiModel] = useState('gemini-3.5-flash-lite');
  const [jusoApiKey, setJusoApiKey] = useState('');
  const [kakaoRestApiKey, setKakaoRestApiKey] = useState('');

  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [showAddressKey, setShowAddressKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isFixingZip, setIsFixingZip] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(
    null
  );

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    axios
      .get(`${API_URL}/settings`)
      .then((res) => {
        if (!cancelled && res.data?.success && res.data.settings) {
          const s: PublicApiSettings = res.data.settings;
          setCurrentInfo(s);
          setGeminiModel(s.geminiModel || 'gemini-3.5-flash-lite');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFeedback({ type: 'error', text: '기존 설정 정보를 불러오지 못했습니다.' });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  /** 설정 저장 (새로 입력한 칸만 덮어쓰고 빈 칸은 기존 저장된 키 유지) */
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setFeedback(null);

    try {
      const payload: Record<string, string> = {
        geminiModel: geminiModel.trim() || 'gemini-3.5-flash-lite',
      };
      if (geminiApiKey.trim()) payload.geminiApiKey = geminiApiKey.trim();
      if (jusoApiKey.trim()) payload.jusoApiKey = jusoApiKey.trim();
      if (kakaoRestApiKey.trim()) payload.kakaoRestApiKey = kakaoRestApiKey.trim();

      const res = await axios.post(`${API_URL}/settings`, payload);
      if (res.data?.success) {
        setCurrentInfo(res.data.settings);
        onSettingsUpdated(res.data.settings);
        setGeminiApiKey('');
        setJusoApiKey('');
        setKakaoRestApiKey('');
        onClose();
      }
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err)
        ? err.response?.data?.error || '설정 저장에 실패했습니다.'
        : '설정 저장에 실패했습니다.';
      setFeedback({ type: 'error', text: msg });
    } finally {
      setIsSaving(false);
    }
  };

  /** 특정 키 삭제 */
  const handleClearKey = async (field: 'geminiApiKey' | 'jusoApiKey' | 'kakaoRestApiKey') => {
    if (!window.confirm('저장된 해당 API 키를 삭제할까요?')) return;
    setIsSaving(true);
    try {
      const res = await axios.post(`${API_URL}/settings`, { [field]: '' });
      if (res.data?.success) {
        setCurrentInfo(res.data.settings);
        onSettingsUpdated(res.data.settings);
        setFeedback({ type: 'info', text: '선택한 API 키가 삭제되었습니다.' });
      }
    } catch {
      setFeedback({ type: 'error', text: '키 삭제 중 오류가 발생했습니다.' });
    } finally {
      setIsSaving(false);
    }
  };

  /** Gemini 모델 응답 연결 테스트 */
  const handleTestAi = async () => {
    setIsTesting(true);
    setFeedback(null);
    try {
      const res = await axios.post(`${API_URL}/settings/test-ai`, {
        geminiApiKey: geminiApiKey.trim() || undefined,
        geminiModel: geminiModel.trim() || 'gemini-3.5-flash-lite',
      });
      setFeedback({ type: 'success', text: res.data.message });
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err)
        ? err.response?.data?.error || 'AI 연결 테스트 실패'
        : 'AI 연결 테스트 실패';
      setFeedback({ type: 'error', text: msg });
    } finally {
      setIsTesting(false);
    }
  };

  /** 스프레드시트 및 로컬 DB 4자리 우편번호 -> 5자리(0 포함) 수동 점검 */
  const handleFixZipcodes = async () => {
    setIsFixingZip(true);
    setFeedback(null);
    try {
      const res = await axios.post(`${API_URL}/settings/fix-zipcodes`);
      setFeedback({ type: 'success', text: res.data.message });
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err)
        ? err.response?.data?.error || '우편번호 보정 실패'
        : '우편번호 보정 실패';
      setFeedback({ type: 'error', text: msg });
    } finally {
      setIsFixingZip(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-xl max-h-[90vh] overflow-y-auto">
        {/* 모달 헤더 */}
        <div className="px-6 py-4 bg-gradient-to-r from-slate-800 to-slate-900 text-white flex items-center justify-between sticky top-0 z-10">
          <div className="flex items-center gap-2.5">
            <Settings size={20} className="text-amber-400" />
            <div>
              <h2 className="font-bold text-base">AI 분석 및 주소 API 키 설정</h2>
              <p className="text-xs text-slate-300">
                한 번 저장해 두면 로컬 DB와 구글 시트에 안전하게 보관됩니다.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-6">
          {feedback && (
            <div
              className={`p-3.5 rounded-xl text-xs font-semibold flex items-start gap-2 border ${
                feedback.type === 'success'
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  : feedback.type === 'error'
                    ? 'bg-red-50 text-red-800 border-red-200'
                    : 'bg-blue-50 text-blue-800 border-blue-200'
              }`}
            >
              {feedback.type === 'error' ? (
                <AlertCircle size={16} className="shrink-0 mt-0.5" />
              ) : (
                <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
              )}
              <span>{feedback.text}</span>
            </div>
          )}

          {/* 1. Gemini API 설정 (필수) */}
          <div className="space-y-3 bg-amber-50/50 border border-amber-200/80 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-amber-600" />
                <span className="font-bold text-sm text-slate-800">
                  1. Google Gemini API 설정 (필수)
                </span>
              </div>
              {currentInfo?.hasGeminiKey ? (
                <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-100 px-2.5 py-0.5 rounded-full">
                  <ShieldCheck size={13} /> 등록됨 ({currentInfo.geminiKeyMasked})
                </span>
              ) : (
                <span className="text-xs font-bold text-red-600 bg-red-100 px-2.5 py-0.5 rounded-full">
                  미등록
                </span>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Gemini API Key
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type={showGeminiKey ? 'text' : 'password'}
                    value={geminiApiKey}
                    onChange={(e) => setGeminiApiKey(e.target.value)}
                    placeholder={
                      currentInfo?.hasGeminiKey
                        ? '변경할 때만 새 API 키를 입력하세요 (비워두면 기존 키 유지)'
                        : 'AIzaSy... 로 시작하는 Google AI Studio API 키 입력'
                    }
                    className="w-full rounded-lg border border-slate-300 bg-white p-2.5 pr-9 text-sm focus:border-amber-500 focus:ring-2 focus:ring-amber-200"
                  />
                  <button
                    type="button"
                    onClick={() => setShowGeminiKey(!showGeminiKey)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showGeminiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {currentInfo?.hasGeminiKey && (
                  <button
                    type="button"
                    onClick={() => handleClearKey('geminiApiKey')}
                    className="text-xs text-red-600 hover:bg-red-50 border border-red-200 px-2.5 rounded-lg transition whitespace-nowrap"
                  >
                    삭제
                  </button>
                )}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                사용할 AI 모델명
              </label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {MODEL_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setGeminiModel(preset.id)}
                    className={`text-xs px-2.5 py-1 rounded-md border font-medium transition ${
                      geminiModel === preset.id
                        ? 'bg-amber-500 text-white border-amber-500 shadow-xs'
                        : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={geminiModel}
                  onChange={(e) => setGeminiModel(e.target.value)}
                  placeholder="gemini-3.5-flash-lite"
                  className="flex-1 rounded-lg border border-slate-300 bg-white p-2 text-xs font-mono text-slate-700 focus:border-amber-500"
                />
                <button
                  type="button"
                  onClick={handleTestAi}
                  disabled={isTesting}
                  className="bg-slate-800 hover:bg-slate-900 disabled:bg-slate-400 text-white text-xs font-bold px-3.5 py-2 rounded-lg transition whitespace-nowrap"
                >
                  {isTesting ? '테스트 중...' : '⚡ AI 연결 테스트'}
                </button>
              </div>
            </div>
          </div>

          {/* 2. 한국 주소 & 5자리 우편번호 공식 검증 API (선택·권장) */}
          <div className="space-y-3 bg-slate-50 border border-slate-200 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MapPinned size={16} className="text-blue-600" />
                <span className="font-bold text-sm text-slate-800">
                  2. 5자리 우편번호 · 표준주소 자동검증 API (권장 · 택1)
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowAddressKey(!showAddressKey)}
                className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1"
              >
                {showAddressKey ? <EyeOff size={14} /> : <Eye size={14} />}
                {showAddressKey ? '숨기기' : '보기'}
              </button>
            </div>

            <p className="text-xs text-slate-500 leading-relaxed">
              신규 고객이나 이사 간 고객의 <strong>정확한 5자리 우편번호</strong>와 시/군/구 생략 주소를
              공식 DB로 자동 완성합니다. 아래 둘 중 편하신 키 <strong>하나만</strong> 넣어도 작동합니다.
            </p>

            {/* 카카오 REST API 키 */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-slate-600">
                  카카오 개발자 REST API 키 (developers.kakao.com)
                </label>
                {currentInfo?.hasKakaoKey && (
                  <span className="text-[11px] font-semibold text-emerald-700">
                    등록됨 ({currentInfo.kakaoKeyMasked})
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  type={showAddressKey ? 'text' : 'password'}
                  value={kakaoRestApiKey}
                  onChange={(e) => setKakaoRestApiKey(e.target.value)}
                  placeholder={
                    currentInfo?.hasKakaoKey
                      ? '변경할 때만 입력 (비워두면 기존 키 유지)'
                      : '카카오 앱의 REST API 키 입력 (선택)'
                  }
                  className="flex-1 rounded-lg border border-slate-300 bg-white p-2 text-xs focus:border-blue-500"
                />
                {currentInfo?.hasKakaoKey && (
                  <button
                    type="button"
                    onClick={() => handleClearKey('kakaoRestApiKey')}
                    className="text-xs text-red-600 hover:bg-red-50 border border-red-200 px-2.5 rounded-lg"
                  >
                    삭제
                  </button>
                )}
              </div>
            </div>

            {/* 행안부 도로명주소 API 키 */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-slate-600">
                  행정안전부 도로명주소 검색 API 승인키 (business.juso.go.kr)
                </label>
                {currentInfo?.hasJusoKey && (
                  <span className="text-[11px] font-semibold text-emerald-700">
                    등록됨 ({currentInfo.jusoKeyMasked})
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  type={showAddressKey ? 'text' : 'password'}
                  value={jusoApiKey}
                  onChange={(e) => setJusoApiKey(e.target.value)}
                  placeholder={
                    currentInfo?.hasJusoKey
                      ? '변경할 때만 입력 (비워두면 기존 키 유지)'
                      : 'devU01TX0FVVE... 형태 승인키 입력 (선택)'
                  }
                  className="flex-1 rounded-lg border border-slate-300 bg-white p-2 text-xs focus:border-blue-500"
                />
                {currentInfo?.hasJusoKey && (
                  <button
                    type="button"
                    onClick={() => handleClearKey('jusoApiKey')}
                    className="text-xs text-red-600 hover:bg-red-50 border border-red-200 px-2.5 rounded-lg"
                  >
                    삭제
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* 3. 우편번호 5자리 텍스트 보존 점검 도구 */}
          <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
            <div className="text-xs text-slate-600">
              <strong className="text-slate-800 block">서울권 4자리 우편번호 → 5자리(0 포함) 점검</strong>
              구글 시트와 DB에서 앞자리 0이 빠진 우편번호를 찾아 텍스트 형식으로 복구합니다.
            </div>
            <button
              type="button"
              onClick={handleFixZipcodes}
              disabled={isFixingZip}
              className="flex items-center gap-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 text-xs font-semibold px-3 py-2 rounded-lg transition shrink-0 ml-3"
            >
              <RefreshCw size={13} className={isFixingZip ? 'animate-spin' : ''} />
              {isFixingZip ? '점검 중...' : '수동 점검'}
            </button>
          </div>

          {/* 하단 저장 / 닫기 버튼 */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-100 transition"
            >
              닫기
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-bold px-6 py-2.5 rounded-xl shadow-md shadow-blue-200 transition text-sm"
            >
              <KeyRound size={16} />
              {isSaving ? '저장 중...' : '설정 저장하기'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
