import { useState, useEffect } from 'react';
import axios from 'axios';
import {
  X,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
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
  { id: 'gemini-3.5-flash-lite', label: 'gemini-3.5-flash-lite (기본)' },
  { id: 'gemini-3.1-flash-lite', label: 'gemini-3.1-flash-lite' },
  { id: 'gemini-3-flash-preview', label: 'gemini-3-flash-preview' },
];

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
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

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
          setFeedback({ type: 'error', text: '설정 정보를 불러오지 못했습니다.' });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  if (!isOpen) return null;

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

  const handleClearKey = async (field: 'geminiApiKey' | 'jusoApiKey' | 'kakaoRestApiKey') => {
    if (!window.confirm('저장된 API 키를 삭제할까요?')) return;
    setIsSaving(true);
    try {
      const res = await axios.post(`${API_URL}/settings`, { [field]: '' });
      if (res.data?.success) {
        setCurrentInfo(res.data.settings);
        onSettingsUpdated(res.data.settings);
        setFeedback({ type: 'info', text: '삭제되었습니다.' });
      }
    } catch {
      setFeedback({ type: 'error', text: '삭제 중 오류가 발생했습니다.' });
    } finally {
      setIsSaving(false);
    }
  };

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
        ? err.response?.data?.error || '연결 테스트 실패'
        : '연결 테스트 실패';
      setFeedback({ type: 'error', text: msg });
    } finally {
      setIsTesting(false);
    }
  };

  const handleFixZipcodes = async () => {
    setIsFixingZip(true);
    setFeedback(null);
    try {
      const res = await axios.post(`${API_URL}/settings/fix-zipcodes`);
      setFeedback({ type: 'success', text: res.data.message });
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err)
        ? err.response?.data?.error || '우편번호 점검 실패'
        : '우편번호 점검 실패';
      setFeedback({ type: 'error', text: msg });
    } finally {
      setIsFixingZip(false);
    }
  };

  const inputClass =
    'w-full h-10 rounded-xl bg-slate-50/70 focus:bg-white border border-slate-200/90 px-3.5 text-xs text-slate-800 focus:outline-none focus:border-slate-900 focus:ring-4 focus:ring-slate-900/5 transition placeholder:text-slate-400';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 backdrop-blur-xs p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200/80 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white/95 backdrop-blur-xs z-10">
          <div>
            <h2 className="font-bold text-[15px] text-slate-900">환경 설정</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              AI 분석 모델 및 우편번호 검증 API 키 관리
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-800 hover:bg-slate-100 transition"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-5">
          {feedback && (
            <div
              className={`p-3 rounded-xl text-xs font-medium flex items-start gap-2 ${
                feedback.type === 'success'
                  ? 'bg-emerald-50 text-emerald-700'
                  : feedback.type === 'error'
                    ? 'bg-rose-50 text-rose-700'
                    : 'bg-slate-100 text-slate-700'
              }`}
            >
              {feedback.type === 'error' ? (
                <AlertCircle size={15} className="shrink-0 mt-0.5" />
              ) : (
                <CheckCircle2 size={15} className="shrink-0 mt-0.5" />
              )}
              <span>{feedback.text}</span>
            </div>
          )}

          {/* Gemini 설정 */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[13px] text-slate-900">Google Gemini API</span>
              {currentInfo?.hasGeminiKey ? (
                <span className="text-[11px] font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md font-mono">
                  등록됨 · {currentInfo.geminiKeyMasked}
                </span>
              ) : (
                <span className="text-[11px] font-medium text-slate-400">미등록</span>
              )}
            </div>

            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showGeminiKey ? 'text' : 'password'}
                  value={geminiApiKey}
                  onChange={(e) => setGeminiApiKey(e.target.value)}
                  placeholder={
                    currentInfo?.hasGeminiKey
                      ? '새 키로 교체할 때만 입력'
                      : 'AIzaSy... API 키 입력'
                  }
                  className={`${inputClass} pr-9`}
                />
                <button
                  type="button"
                  onClick={() => setShowGeminiKey(!showGeminiKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showGeminiKey ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              {currentInfo?.hasGeminiKey && (
                <button
                  type="button"
                  onClick={() => handleClearKey('geminiApiKey')}
                  className="text-xs text-slate-400 hover:text-rose-600 px-2.5 rounded-xl hover:bg-rose-50 transition"
                >
                  초기화
                </button>
              )}
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1.5">
                AI 모델
              </label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {MODEL_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setGeminiModel(preset.id)}
                    className={`text-xs px-2.5 py-1 rounded-lg font-medium transition ${
                      geminiModel === preset.id
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70'
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
                  className={`${inputClass} font-mono flex-1`}
                />
                <button
                  type="button"
                  onClick={handleTestAi}
                  disabled={isTesting}
                  className="h-10 bg-slate-100 hover:bg-slate-200/80 text-slate-700 text-xs font-semibold px-3.5 rounded-xl transition whitespace-nowrap"
                >
                  {isTesting ? '확인 중...' : '연결 테스트'}
                </button>
              </div>
            </div>
          </div>

          <hr className="border-slate-100" />

          {/* 주소 검증 API */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[13px] text-slate-900">
                주소 · 우편번호 검증 API (택1)
              </span>
              <button
                type="button"
                onClick={() => setShowAddressKey(!showAddressKey)}
                className="text-xs text-slate-400 hover:text-slate-700"
              >
                {showAddressKey ? '숨기기' : '키 보기'}
              </button>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-medium text-slate-500">
                  카카오 REST API 키
                </label>
                {currentInfo?.hasKakaoKey && (
                  <span className="text-[11px] text-emerald-600 font-mono">
                    {currentInfo.kakaoKeyMasked}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  type={showAddressKey ? 'text' : 'password'}
                  value={kakaoRestApiKey}
                  onChange={(e) => setKakaoRestApiKey(e.target.value)}
                  placeholder={
                    currentInfo?.hasKakaoKey ? '변경 시에만 입력' : '카카오 REST API 키 (선택)'
                  }
                  className={inputClass}
                />
                {currentInfo?.hasKakaoKey && (
                  <button
                    type="button"
                    onClick={() => handleClearKey('kakaoRestApiKey')}
                    className="text-xs text-slate-400 hover:text-rose-600 px-2.5 rounded-xl hover:bg-rose-50 transition"
                  >
                    초기화
                  </button>
                )}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-medium text-slate-500">
                  행안부 도로명주소 API 키
                </label>
                {currentInfo?.hasJusoKey && (
                  <span className="text-[11px] text-emerald-600 font-mono">
                    {currentInfo.jusoKeyMasked}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  type={showAddressKey ? 'text' : 'password'}
                  value={jusoApiKey}
                  onChange={(e) => setJusoApiKey(e.target.value)}
                  placeholder={
                    currentInfo?.hasJusoKey ? '변경 시에만 입력' : '도로명주소 승인키 (선택)'
                  }
                  className={inputClass}
                />
                {currentInfo?.hasJusoKey && (
                  <button
                    type="button"
                    onClick={() => handleClearKey('jusoApiKey')}
                    className="text-xs text-slate-400 hover:text-rose-600 px-2.5 rounded-xl hover:bg-rose-50 transition"
                  >
                    초기화
                  </button>
                )}
              </div>
            </div>
          </div>

          <hr className="border-slate-100" />

          {/* 우편번호 유틸리티 */}
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-slate-500">
              <span className="font-semibold text-slate-700 block">우편번호 5자리 포맷 점검</span>
              시트 및 DB의 4자리 서울권 우편번호를 5자리 텍스트로 복구합니다
            </div>
            <button
              type="button"
              onClick={handleFixZipcodes}
              disabled={isFixingZip}
              className="inline-flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200/80 text-slate-700 text-xs font-medium px-3 py-2 rounded-xl transition shrink-0"
            >
              <RefreshCw size={12} className={isFixingZip ? 'animate-spin' : ''} />
              {isFixingZip ? '점검 중' : '점검 실행'}
            </button>
          </div>

          {/* 저장/취소 */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-500 hover:bg-slate-100 transition"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white font-semibold px-5 py-2.5 rounded-xl transition text-xs"
            >
              {isSaving ? '저장 중...' : '변경사항 저장'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
