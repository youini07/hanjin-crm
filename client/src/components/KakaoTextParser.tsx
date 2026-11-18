import { useState } from 'react';
import {
  Sparkles,
  X,
  Phone,
  ChevronDown,
  RotateCcw,
  Loader2,
} from 'lucide-react';
import { normalizeClientPhone } from '../config/api';

export interface AiParsedSummary {
  total: number;
  matched: number;
  modified: number;
  newCount: number;
  photoCheck: number;
  typoWarning: number;
}

interface KakaoTextParserProps {
  onAiParseRequest: (rawText: string) => Promise<AiParsedSummary | null>;
  onMatchRequest: (phones: string[]) => void;
  isLoading: boolean;
}

const PHONE_REGEX =
  /(?:☎|📞|☏|✆|전화|핸드폰|HP|hp|연락처)?[\s\u200B]*(?:\+?82[-\s.]?0?1[0-9]|0[1-9][0-9])(?:[^\d\na-zA-Z가-힣\u0E00-\u0E7F]{0,6}\d){7,8}/g;

export default function KakaoTextParser({
  onAiParseRequest,
  onMatchRequest,
  isLoading,
}: KakaoTextParserProps) {
  const [rawText, setRawText] = useState('');
  const [extractedPhones, setExtractedPhones] = useState<string[]>([]);
  const [lastAiSummary, setLastAiSummary] = useState<AiParsedSummary | null>(null);
  const [isExpanded, setIsExpanded] = useState(true);

  const handleAiAnalyze = async () => {
    if (!rawText.trim() || isLoading) return;
    setExtractedPhones([]);
    const summary = await onAiParseRequest(rawText);
    if (summary) {
      setLastAiSummary(summary);
      setIsExpanded(false);
    }
  };

  const handleFallbackExtract = () => {
    if (!rawText.trim()) return;
    setLastAiSummary(null);

    const matches = rawText.match(PHONE_REGEX);
    if (!matches || matches.length === 0) {
      setExtractedPhones([]);
      return;
    }

    const normalized = matches
      .map((m) => normalizeClientPhone(m))
      .filter((p) => p.length >= 10 && p.length <= 12);

    const unique = [...new Set(normalized)];
    setExtractedPhones(unique);
  };

  const handleFallbackMatch = () => {
    if (extractedPhones.length === 0) return;
    onMatchRequest(extractedPhones);
    setIsExpanded(false);
  };

  const removePhone = (phone: string) => {
    setExtractedPhones((prev) => prev.filter((p) => p !== phone));
  };

  const handleClear = () => {
    setRawText('');
    setExtractedPhones([]);
    setLastAiSummary(null);
  };

  return (
    <section className="bg-white rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(15,23,42,0.03)] overflow-hidden">
      {/* 미니멀 카드 헤더 */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-6 py-4 flex items-center justify-between hover:bg-slate-50/60 transition"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <Sparkles size={16} />
          </div>
          <div className="text-left">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-[14px] text-slate-900">
                카카오톡 대화 붙여넣기
              </span>
              {lastAiSummary && (
                <span className="text-[11px] font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md tabular-nums">
                  {lastAiSummary.total}건 분석 완료
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              대화 원문을 붙여넣으면 AI가 주소·이름 변경 및 오타를 자동 분류합니다
            </p>
          </div>
        </div>

        <ChevronDown
          size={18}
          className={`text-slate-400 transition-transform duration-200 ${
            isExpanded ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* 접혀 있을 때 심플 요약 바 */}
      {!isExpanded && lastAiSummary && (
        <div className="px-6 py-3 bg-slate-50/70 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-4 text-slate-500 tabular-nums">
            <span>
              기존 일치 <strong className="text-slate-800 ml-0.5">{lastAiSummary.matched}</strong>
            </span>
            <span className="text-slate-200">|</span>
            <span>
              정보 변경 <strong className="text-indigo-600 ml-0.5">{lastAiSummary.modified}</strong>
            </span>
            <span className="text-slate-200">|</span>
            <span>
              신규 고객 <strong className="text-emerald-600 ml-0.5">{lastAiSummary.newCount}</strong>
            </span>
            {lastAiSummary.photoCheck > 0 && (
              <>
                <span className="text-slate-200">|</span>
                <span>
                  사진 확인 <strong className="text-amber-600 ml-0.5">{lastAiSummary.photoCheck}</strong>
                </span>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => setIsExpanded(true)}
            className="text-xs font-semibold text-slate-600 hover:text-slate-900 transition"
          >
            입력창 열기
          </button>
        </div>
      )}

      {/* 펼쳐진 본문 */}
      {isExpanded && (
        <div className="px-6 pb-5 pt-1 space-y-3.5 border-t border-slate-100">
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder={`카카오톡 PC 버전 대화를 그대로 드래그해서 붙여넣으세요.\n날짜 구분선, FB 아이디, 사진 알림, 현관 비밀번호 등이 섞여 있어도 자동으로 정리됩니다.`}
            className="w-full h-38 mt-3 rounded-xl bg-slate-50/60 focus:bg-white border border-slate-200/90 p-4 text-[13px] leading-relaxed text-slate-800 resize-y focus:outline-none focus:border-slate-900 focus:ring-4 focus:ring-slate-900/5 transition placeholder:text-slate-400"
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleFallbackExtract}
                disabled={!rawText.trim() || isLoading}
                className="px-3.5 py-2.5 rounded-xl text-xs font-medium text-slate-500 hover:text-slate-800 bg-slate-100/80 hover:bg-slate-200/70 disabled:opacity-40 transition"
              >
                전화번호만 추출
              </button>
              {rawText && (
                <button
                  type="button"
                  onClick={handleClear}
                  disabled={isLoading}
                  className="inline-flex items-center gap-1 px-3 py-2.5 rounded-xl text-xs font-medium text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
                >
                  <RotateCcw size={13} />
                  초기화
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={handleAiAnalyze}
              disabled={!rawText.trim() || isLoading}
              className="flex-1 sm:flex-initial sm:min-w-[240px] bg-slate-900 hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold py-2.5 px-5 rounded-xl shadow-xs transition flex items-center justify-center gap-2 text-[13px]"
            >
              {isLoading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>AI 주소 분석 및 DB 대조 중...</span>
                </>
              ) : (
                <>
                  <Sparkles size={15} className="text-indigo-300" />
                  <span>AI 분석 후 목록에 담기</span>
                </>
              )}
            </button>
          </div>

          {extractedPhones.length > 0 && (
            <div className="space-y-3 pt-3 border-t border-slate-100">
              <div className="text-xs font-medium text-slate-400">
                추출된 번호 {extractedPhones.length}건
              </div>
              <div className="flex flex-wrap gap-1.5">
                {extractedPhones.map((phone) => (
                  <span
                    key={phone}
                    className="inline-flex items-center gap-1.5 bg-slate-100 text-slate-700 px-2.5 py-1 rounded-lg text-xs font-mono"
                  >
                    <Phone size={11} className="text-slate-400" />
                    {phone.replace(/(\d{3})(\d{3,4})(\d{4})/, '$1-$2-$3')}
                    <button
                      type="button"
                      onClick={() => removePhone(phone)}
                      className="text-slate-400 hover:text-red-500 transition"
                    >
                      <X size={13} />
                    </button>
                  </span>
                ))}
              </div>

              <button
                type="button"
                onClick={handleFallbackMatch}
                disabled={isLoading}
                className="w-full bg-slate-800 hover:bg-slate-900 disabled:bg-slate-300 text-white font-semibold py-2.5 rounded-xl transition text-xs"
              >
                번호 기준으로 DB 불러오기
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
