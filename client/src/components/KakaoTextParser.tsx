import { useState, useRef } from 'react';
import axios from 'axios';
import {
  Sparkles,
  X,
  Phone,
  ChevronDown,
  RotateCcw,
  Loader2,
  ImagePlus,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { API_URL, normalizeClientPhone } from '../config/api';
import { sliceKakaoImageIntoTiles } from '../utils/imageTileSlicer';

export interface AiParsedSummary {
  total: number;
  matched: number;
  modified: number;
  newCount: number;
  photoCheck: number;
  typoWarning: number;
  zipcodeMissingCount?: number;
}

interface KakaoTextParserProps {
  onAiParseRequest: (rawText: string) => Promise<AiParsedSummary | null>;
  onMatchRequest: (phones: string[]) => void;
  isLoading: boolean;
}

interface ImageQueueItem {
  id: string;
  orderIndex: number;
  fileName: string;
  status: 'waiting' | 'extracting' | 'done' | 'empty' | 'error';
  errorText?: string;
}

const PHONE_REGEX =
  /(?:☎|📞|☏|✆|전화|핸드폰|HP|hp|연락처)?[\s\u200B]*(?:\+?82[-\s.]?0?1[0-9]|0[1-9][0-9])(?:[^\d\na-zA-Z가-힣\u0E00-\u0E7F]{0,6}\d){7,8}/g;

/**
 * KakaoTextParser - 카카오톡 대화 텍스트 붙여넣기 및 모바일 범위 캡처(다중 이미지) 순차 텍스트 추출기
 *
 * 왜 다중 이미지를 병렬이 아닌 엄격한 순차(Sequential) 루프로 처리하는가:
 * 사용자가 캡처한 1번, 2번, 3번 스샷의 대화 시간 순서가 뒤섞이지 않고,
 * 선택한 순서 그대로 한 장씩 텍스트 입력창(textarea) 하단에 차곡차곡 입력되도록 보장하기 위함.
 */
export default function KakaoTextParser({
  onAiParseRequest,
  onMatchRequest,
  isLoading,
}: KakaoTextParserProps) {
  const [rawText, setRawText] = useState('');
  const [extractedPhones, setExtractedPhones] = useState<string[]>([]);
  const [lastAiSummary, setLastAiSummary] = useState<AiParsedSummary | null>(null);
  const [isExpanded, setIsExpanded] = useState(true);

  // 캡처 이미지 순차 추출 상태
  const [isExtractingImages, setIsExtractingImages] = useState(false);
  const [imageQueue, setImageQueue] = useState<ImageQueueItem[]>([]);
  const [extractStatusMsg, setExtractStatusMsg] = useState<{
    type: 'info' | 'success' | 'error';
    text: string;
  } | null>(null);

  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const isBusy = isLoading || isExtractingImages;

  /**
   * 업로드(또는 붙여넣기)된 이미지 배열을 사용자가 선택한 순서대로 1장씩 텍스트 추출 후 textarea에 순차 추가
   */
  const processImagesSequentially = async (files: File[]) => {
    const validImages = files.filter((f) => f.type.startsWith('image/'));
    if (validImages.length === 0 || isBusy) return;

    setIsExpanded(true);
    setIsExtractingImages(true);
    setLastAiSummary(null);

    const initialQueue: ImageQueueItem[] = validImages.map((file, idx) => ({
      id: `${Date.now()}_${idx}`,
      orderIndex: idx + 1,
      fileName: file.name || `캡처_${idx + 1}.jpg`,
      status: 'waiting',
    }));
    setImageQueue(initialQueue);

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < validImages.length; i++) {
      const file = validImages[i];
      const itemId = initialQueue[i].id;

      setImageQueue((prev) =>
        prev.map((q) => (q.id === itemId ? { ...q, status: 'extracting' } : q))
      );
      setExtractStatusMsg({
        type: 'info',
        text: `스샷 텍스트 추출 중 (${i + 1}/${validImages.length}번째 이미지)...`,
      });

      try {
        // 1. 세로로 긴 범위 캡처 이미지인 경우 고화질 타일로 분할
        const tiles = await sliceKakaoImageIntoTiles(file);

        // 2. 서버 Gemini Vision API로 해당 이미지의 대화 원문 추출
        const res = await axios.post(`${API_URL}/kakao/extract-image-text`, { tiles });
        const extractedText = String(res.data?.text || '').trim();

        if (extractedText) {
          // 3. 추출 완료 즉시 기존 텍스트창 하단에 순서대로 이어 붙임
          setRawText((prev) => {
            const trimmedPrev = prev.trim();
            return trimmedPrev ? `${trimmedPrev}\n\n${extractedText}` : extractedText;
          });
          setImageQueue((prev) =>
            prev.map((q) => (q.id === itemId ? { ...q, status: 'done' } : q))
          );
          successCount++;

          // 새로 추가된 텍스트가 보이도록 입력창 스크롤을 부드럽게 아래로 이동
          setTimeout(() => {
            if (textareaRef.current) {
              textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
            }
          }, 30);
        } else {
          setImageQueue((prev) =>
            prev.map((q) => (q.id === itemId ? { ...q, status: 'empty' } : q))
          );
        }
      } catch (err: unknown) {
        errorCount++;
        const errMsg = axios.isAxiosError(err)
          ? err.response?.data?.error || '추출 실패'
          : err instanceof Error
            ? err.message
            : '추출 실패';
        setImageQueue((prev) =>
          prev.map((q) =>
            q.id === itemId ? { ...q, status: 'error', errorText: errMsg } : q
          )
        );
      }
    }

    if (errorCount > 0 && successCount === 0) {
      setExtractStatusMsg({
        type: 'error',
        text: '스샷 텍스트 추출에 실패했습니다. 우측 상단 [설정]의 Gemini API 키를 확인해주세요.',
      });
    } else if (errorCount > 0) {
      setExtractStatusMsg({
        type: 'info',
        text: `총 ${validImages.length}장 중 ${successCount}장 순차 입력 완료 (${errorCount}장 실패) — 내용을 확인 후 아래 [AI 분석]을 눌러주세요.`,
      });
    } else {
      setExtractStatusMsg({
        type: 'success',
        text: `스샷 ${successCount}장 텍스트 순차 입력 완료! 내용을 확인하신 뒤 아래 [AI 분석 후 목록에 담기]를 눌러주세요.`,
      });
    }

    setIsExtractingImages(false);
  };

  const handleImageFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    // FileList가 초기화되기 전에 배열로 복사하여 선택 순서 보존
    const filesArray = Array.from(fileList);
    if (imageInputRef.current) {
      imageInputRef.current.value = '';
    }
    await processImagesSequentially(filesArray);
  };

  /**
   * 클립보드에 복사된 캡처 이미지를 입력창에 바로 붙여넣기(Ctrl+V / 모바일 붙여넣기) 했을 때도 자동 추출 지원
   */
  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) imageFiles.push(file);
      }
    }

    if (imageFiles.length > 0) {
      e.preventDefault();
      await processImagesSequentially(imageFiles);
    }
  };

  const handleAiAnalyze = async () => {
    if (!rawText.trim() || isBusy) return;
    setExtractedPhones([]);
    const summary = await onAiParseRequest(rawText);
    if (summary) {
      setLastAiSummary(summary);
      setIsExpanded(false);
    }
  };

  const handleFallbackExtract = () => {
    if (!rawText.trim() || isBusy) return;
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
    setImageQueue([]);
    setExtractStatusMsg(null);
  };

  return (
    <section className="bg-white rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(15,23,42,0.03)] overflow-hidden">
      {/* 미니멀 카드 헤더 */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 sm:px-6 py-3.5 sm:py-4 flex items-center justify-between gap-2 hover:bg-slate-50/60 transition"
      >
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
            <Sparkles size={16} />
          </div>
          <div className="text-left min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-[14px] text-slate-900">
                카톡 대화 붙여넣기 · 캡처 업로드
              </span>
              {lastAiSummary && (
                <span className="text-[11px] font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md tabular-nums">
                  {lastAiSummary.total}건 분석 완료
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-0.5 truncate">
              모바일 범위 캡처 스샷이나 PC 대화를 넣으면 AI가 주소를 자동 정리합니다
            </p>
          </div>
        </div>

        <ChevronDown
          size={18}
          className={`text-slate-400 shrink-0 transition-transform duration-200 ${
            isExpanded ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* 접혀 있을 때 심플 요약 바 */}
      {!isExpanded && lastAiSummary && (
        <div className="px-4 sm:px-6 py-3 bg-slate-50/70 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-500 tabular-nums">
            <span>
              기존 일치 <strong className="text-slate-800 ml-0.5">{lastAiSummary.matched}</strong>
            </span>
            <span className="text-slate-200">|</span>
            <span>
              정보 변경 <strong className="text-amber-700 ml-0.5">{lastAiSummary.modified}</strong>
            </span>
            <span className="text-slate-200">|</span>
            <span>
              신규 고객 <strong className="text-emerald-600 ml-0.5">{lastAiSummary.newCount}</strong>
            </span>
            {(lastAiSummary.zipcodeMissingCount ?? 0) > 0 && (
              <>
                <span className="text-slate-200">|</span>
                <span className="px-2 py-0.5 rounded-md bg-rose-100 text-rose-700 font-bold">
                  우편번호 미검색 {lastAiSummary.zipcodeMissingCount}건 확인 필수!
                </span>
              </>
            )}
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
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition"
          >
            입력창 열기
          </button>
        </div>
      )}

      {/* 펼쳐진 본문 */}
      {isExpanded && (
        <div className="px-4 sm:px-6 pb-4 sm:pb-5 pt-3 space-y-3 border-t border-slate-100">
          {/* 모바일 핵심 기능: 카톡 범위 캡처 이미지 업로드 바 */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 sm:p-3 rounded-xl bg-indigo-50/55 border border-indigo-100">
            <div className="text-xs text-slate-600 leading-snug">
              <strong className="font-semibold text-indigo-950">모바일 카톡 스샷 추출</strong>
              <span className="text-slate-500 ml-1.5">
                여러 장을 선택하면 올린 순서대로 아래 입력창에 차곡차곡 채워집니다.
              </span>
            </div>

            <label
              className={`inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 sm:py-2 rounded-xl text-xs font-semibold transition whitespace-nowrap shrink-0 ${
                isBusy
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-2xs cursor-pointer'
              }`}
            >
              {isExtractingImages ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>순차 추출 중...</span>
                </>
              ) : (
                <>
                  <ImagePlus size={15} />
                  <span>카톡 캡처 스샷 올리기 (다중 선택)</span>
                </>
              )}
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                multiple
                disabled={isBusy}
                onChange={handleImageFileSelect}
                className="hidden"
              />
            </label>
          </div>

          {/* 다중 이미지 순차 처리 진행 배지 */}
          {imageQueue.length > 0 && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {imageQueue.map((item) => (
                  <span
                    key={item.id}
                    title={item.errorText || item.fileName}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium border ${
                      item.status === 'extracting'
                        ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                        : item.status === 'done'
                          ? 'bg-emerald-50 border-emerald-200/80 text-emerald-700'
                          : item.status === 'error'
                            ? 'bg-rose-50 border-rose-200 text-rose-700'
                            : 'bg-slate-50 border-slate-200 text-slate-500'
                    }`}
                  >
                    <span className="font-bold font-mono">#{item.orderIndex}</span>
                    <span className="max-w-[110px] truncate">{item.fileName}</span>
                    {item.status === 'extracting' && <Loader2 size={11} className="animate-spin" />}
                    {item.status === 'done' && <CheckCircle2 size={11} />}
                    {item.status === 'error' && <AlertCircle size={11} />}
                  </span>
                ))}
              </div>

              {extractStatusMsg && (
                <div
                  className={`text-xs px-3 py-2 rounded-xl font-medium ${
                    extractStatusMsg.type === 'success'
                      ? 'bg-emerald-50 text-emerald-700'
                      : extractStatusMsg.type === 'error'
                        ? 'bg-rose-50 text-rose-700'
                        : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {extractStatusMsg.text}
                </div>
              )}
            </div>
          )}

          {/* 대화 원문 텍스트 입력창 (모바일 터치 시 화면 자동 줌 방지를 위해 text-base -> sm:text-[13px]) */}
          <textarea
            ref={textareaRef}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            onPaste={handlePaste}
            placeholder={`위 [카톡 캡처 스샷 올리기]로 범위 캡처 이미지를 올리거나, PC 카카오톡 대화를 붙여넣으세요.\n여러 장의 스샷을 올리면 업로드한 순서대로 텍스트가 이어서 입력됩니다.`}
            className="w-full h-40 rounded-xl bg-slate-50/60 focus:bg-white border border-slate-200/90 p-3.5 sm:p-4 text-base sm:text-[13px] leading-relaxed text-slate-800 resize-y focus:outline-none focus:border-slate-900 focus:ring-4 focus:ring-slate-900/5 transition placeholder:text-slate-400 placeholder:text-[13px]"
          />

          {/* 하단 액션 버튼 (모바일에서는 메인 분석 버튼을 상단 전체폭으로 크게 배치) */}
          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleFallbackExtract}
                disabled={!rawText.trim() || isBusy}
                className="flex-1 sm:flex-initial px-3.5 py-2.5 rounded-xl text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100/90 hover:bg-slate-200/70 disabled:opacity-40 transition whitespace-nowrap"
              >
                전화번호만 추출
              </button>
              {(rawText || imageQueue.length > 0) && (
                <button
                  type="button"
                  onClick={handleClear}
                  disabled={isBusy}
                  className="inline-flex items-center justify-center gap-1 px-3.5 py-2.5 rounded-xl text-xs font-medium text-slate-500 hover:text-slate-800 bg-slate-100/60 hover:bg-slate-100 transition whitespace-nowrap"
                >
                  <RotateCcw size={13} />
                  초기화
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={handleAiAnalyze}
              disabled={!rawText.trim() || isBusy}
              className="w-full sm:w-auto sm:min-w-[240px] bg-slate-900 hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold py-3 sm:py-2.5 px-5 rounded-xl shadow-xs transition flex items-center justify-center gap-2 text-[14px] sm:text-[13px]"
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
                disabled={isBusy}
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
