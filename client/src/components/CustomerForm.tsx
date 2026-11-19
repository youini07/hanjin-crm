import { useState } from 'react';
import axios from 'axios';
import { KakaoPostcodeEmbed, type Address } from 'react-daum-postcode';
import {
  Search,
  CheckCircle2,
  MapPin,
  Plus,
  AlertCircle,
  PenLine,
  UserPlus,
  RotateCcw,
  Check,
  X,
} from 'lucide-react';
import {
  API_URL,
  normalizeClientPhone,
  normalizeClientZipcode,
  type StatusMessage,
} from '../config/api';
import type { GridRow } from './ShippingGrid';

interface CustomerFormProps {
  activeRow: GridRow | null;
  existingPhones: string[];
  status: StatusMessage;
  onStatusChange: (status: StatusMessage) => void;
  onAddNewRow: (data: {
    phone: string;
    name: string;
    zipcode: string;
    address: string;
    detail_address: string;
    isExistingCustomer: boolean;
  }) => void;
  onUpdateRow: (
    tempId: string,
    data: {
      phone: string;
      name: string;
      zipcode: string;
      address: string;
      detail_address: string;
    }
  ) => void;
  onCancelEdit: () => void;
}

const POSTCODE_SCRIPT_URL =
  'https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';

/**
 * CustomerForm - 고객 단건 조회·추가 및 선택 행 수정 폼 (모바일/인앱 브라우저 최적화)
 *
 * 왜 window.open 팝업 대신 인라인 모달(KakaoPostcodeEmbed)을 사용하는가:
 * 모바일 카카오톡 인앱 브라우저 및 홈 화면에 설치된 웹앱(PWA standalone) 환경에서는
 * 새 창 팝업이 차단되거나 닫기 버튼이 사라져 화면이 멈추는 현상이 발생하므로 레이어 모달로 통일함.
 */
export default function CustomerForm({
  activeRow,
  existingPhones,
  status,
  onStatusChange,
  onAddNewRow,
  onUpdateRow,
  onCancelEdit,
}: CustomerFormProps) {
  const [phone, setPhone] = useState(() => activeRow?.phone || '');
  const [name, setName] = useState(() => activeRow?.name || '');
  const [zipcode, setZipcode] = useState(() => normalizeClientZipcode(activeRow?.zipcode));
  const [address, setAddress] = useState(() => activeRow?.address || '');
  const [detailAddress, setDetailAddress] = useState(() => activeRow?.detail_address || '');
  const [isLoading, setIsLoading] = useState(false);
  const [isPostcodeOpen, setIsPostcodeOpen] = useState(false);
  const [isExistingCustomer, setIsExistingCustomer] = useState(() =>
    activeRow ? !activeRow._isNew : false
  );

  const handlePostcodeComplete = (data: Address) => {
    let fullAddress = data.address;
    let extraAddress = '';

    if (data.addressType === 'R') {
      if (data.bname !== '') extraAddress += data.bname;
      if (data.buildingName !== '') {
        extraAddress += extraAddress !== '' ? `, ${data.buildingName}` : data.buildingName;
      }
      fullAddress += extraAddress !== '' ? ` (${extraAddress})` : '';
    }

    setZipcode(normalizeClientZipcode(data.zonecode));
    setAddress(fullAddress);
    setIsPostcodeOpen(false);
  };

  const handleOpenPostcode = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setIsPostcodeOpen(true);
  };

  const searchCustomer = async (isAutoBlur = false) => {
    if (isAutoBlur && activeRow && address.trim()) {
      return;
    }

    const normalizedPhone = normalizeClientPhone(phone);
    if (!normalizedPhone || normalizedPhone.length < 10) return;

    if (normalizedPhone !== phone.replace(/[^0-9]/g, '')) {
      setPhone(normalizedPhone);
    }

    setIsLoading(true);
    onStatusChange({ type: '', message: '' });

    try {
      const response = await axios.get(`${API_URL}/customers/search?phone=${normalizedPhone}`);

      if (response.data.success && response.data.customer) {
        const c = response.data.customer;
        setName(c.name || '');
        setZipcode(normalizeClientZipcode(c.zipcode));
        setAddress(c.address || '');
        setDetailAddress(c.detail_address || '');
        setIsExistingCustomer(true);
        onStatusChange({ type: 'success', message: '기존 DB 고객 정보를 불러왔습니다.' });
      } else {
        if (!activeRow) {
          setName('');
          setZipcode('');
          setAddress('');
          setDetailAddress('');
        }
        setIsExistingCustomer(false);
        onStatusChange({ type: 'info', message: '신규 전화번호입니다. 주소를 입력해주세요.' });
      }
    } catch {
      onStatusChange({ type: 'error', message: '고객 검색 중 오류가 발생했습니다.' });
    } finally {
      setIsLoading(false);
    }
  };

  const applyPrevDbToForm = () => {
    if (!activeRow?._prevDbInfo) return;
    const prev = activeRow._prevDbInfo;
    setName(prev.name || '');
    setZipcode(normalizeClientZipcode(prev.zipcode));
    setAddress(prev.address || '');
    setDetailAddress(prev.detail_address || '');
    onStatusChange({
      type: 'info',
      message: '기존 DB 정보를 채웠습니다. [수정 반영] 버튼을 눌러주세요.',
    });
  };

  const resetFields = () => {
    setPhone('');
    setName('');
    setZipcode('');
    setAddress('');
    setDetailAddress('');
    setIsExistingCustomer(false);
    onCancelEdit();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const normalizedPhone = normalizeClientPhone(phone);
    const safeZip = normalizeClientZipcode(zipcode);

    if (!normalizedPhone || !name.trim()) {
      onStatusChange({ type: 'error', message: '전화번호와 이름은 필수 항목입니다.' });
      return;
    }

    if (!address.trim()) {
      onStatusChange({ type: 'error', message: '기본 주소를 입력하거나 검색해주세요.' });
      return;
    }

    if (!activeRow && existingPhones.includes(normalizedPhone)) {
      onStatusChange({
        type: 'error',
        message: '이미 목록에 있는 번호입니다. 아래 목록에서 해당 항목을 눌러 수정해주세요.',
      });
      return;
    }

    const savedRowId = activeRow?._tempId || null;

    if (activeRow) {
      onUpdateRow(activeRow._tempId, {
        phone: normalizedPhone,
        name: name.trim(),
        zipcode: safeZip,
        address: address.trim(),
        detail_address: detailAddress.trim(),
      });
      onStatusChange({
        type: 'success',
        message: '수정한 내용이 목록에 반영되고 확인 완료 처리되었습니다.',
      });
    } else {
      onAddNewRow({
        phone: normalizedPhone,
        name: name.trim(),
        zipcode: safeZip,
        address: address.trim(),
        detail_address: detailAddress.trim(),
        isExistingCustomer,
      });
      onStatusChange({
        type: 'success',
        message: '새 고객이 목록에 추가되었습니다.',
      });
    }

    resetFields();

    if (savedRowId) {
      setTimeout(() => {
        const mobileEl = document.getElementById(`card-${savedRowId}`);
        const desktopEl = document.getElementById(`row-${savedRowId}`);
        const targetEl =
          mobileEl && mobileEl.offsetParent !== null ? mobileEl : desktopEl;
        targetEl?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      }, 50);
    }
  };

  // 모바일 터치 시 iOS/인앱 브라우저 자동 확대(Zoom) 방지를 위해 모바일 text-base(16px), 데스크탑 text-[13px] 적용
  const inputBaseClass =
    'h-11 sm:h-10 rounded-xl bg-slate-50/70 hover:bg-slate-50 focus:bg-white border border-slate-200/90 px-3.5 text-base sm:text-[13px] text-slate-800 focus:outline-none focus:border-slate-900 focus:ring-4 focus:ring-slate-900/5 transition placeholder:text-slate-400 placeholder:text-[13px]';

  return (
    <>
      <section
        id="top-form"
        className={`bg-white rounded-2xl border transition-all overflow-hidden ${
          activeRow
            ? 'border-indigo-300 shadow-[0_2px_12px_rgba(79,70,229,0.08)]'
            : 'border-slate-200/80 shadow-[0_1px_3px_rgba(15,23,42,0.03)]'
        }`}
      >
        {/* 미니멀 헤더 */}
        <div className="px-4 sm:px-6 py-3.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                activeRow
                  ? 'bg-indigo-50 text-indigo-600'
                  : 'bg-slate-100 text-slate-600'
              }`}
            >
              {activeRow ? <PenLine size={14} /> : <UserPlus size={14} />}
            </div>
            <span className="font-semibold text-[14px] text-slate-900 whitespace-nowrap">
              {activeRow ? '선택 고객 수정' : '직접 입력 · 검색'}
            </span>
            {activeRow && (
              <span className="text-[11px] font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md font-mono">
                {activeRow.phone}
              </span>
            )}
          </div>

          {activeRow && (
            <button
              type="button"
              onClick={resetFields}
              className="text-xs text-slate-500 hover:text-slate-900 bg-slate-100 hover:bg-slate-200/70 px-3 py-1.5 rounded-lg transition font-medium whitespace-nowrap"
            >
              선택 취소
            </button>
          )}
        </div>

        {/* 상태 메시지 배너 (모바일에서도 줄바꿈 깨짐 없이 전체폭으로 표시) */}
        {status.message && (
          <div
            className={`mx-4 sm:mx-6 mt-3 px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-start gap-2 ${
              status.type === 'success'
                ? 'bg-emerald-50 text-emerald-700'
                : status.type === 'error'
                  ? 'bg-rose-50 text-rose-700'
                  : 'bg-slate-100 text-slate-700'
            }`}
          >
            {status.type === 'error' ? (
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
            ) : (
              <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
            )}
            <span className="leading-snug">{status.message}</span>
          </div>
        )}

        {/* 변경 건 편집 시 이전 DB 참고 라인 */}
        {activeRow?._prevDbInfo && activeRow._reviewStatus === 'MODIFIED' && (
          <div className="mx-4 sm:mx-6 mt-3 px-3.5 py-2.5 bg-slate-50 border border-slate-200/70 rounded-xl flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <div className="leading-relaxed">
              <span className="font-semibold text-slate-700 mr-1.5">기존 저장 데이터</span>
              {activeRow._prevDbInfo.name} · ({normalizeClientZipcode(activeRow._prevDbInfo.zipcode)}){' '}
              {activeRow._prevDbInfo.address} {activeRow._prevDbInfo.detail_address}
            </div>
            <button
              type="button"
              onClick={applyPrevDbToForm}
              className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900 bg-white border border-slate-200 font-medium px-2.5 py-1.5 rounded-lg transition whitespace-nowrap"
            >
              <RotateCcw size={11} /> 기존 데이터로 되돌리기
            </button>
          </div>
        )}

        {/* 입력 폼 */}
        <form onSubmit={handleSubmit} className="px-4 sm:px-6 py-4 space-y-3.5">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            {/* 전화번호 (4칸) */}
            <div className="md:col-span-4">
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                전화번호
              </label>
              <div className="flex gap-1.5">
                <input
                  type="tel"
                  inputMode="tel"
                  value={phone}
                  onChange={(e) => {
                    const rawVal = e.target.value;
                    if (rawVal.trim().startsWith('+82') && rawVal.replace(/\D/g, '').length >= 11) {
                      setPhone(normalizeClientPhone(rawVal));
                    } else {
                      setPhone(rawVal.replace(/[^0-9+-]/g, ''));
                    }
                    setIsExistingCustomer(false);
                  }}
                  placeholder="010-0000-0000"
                  className={`flex-1 min-w-0 font-mono ${inputBaseClass}`}
                  onBlur={() => searchCustomer(true)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), searchCustomer(false))}
                  required
                />
                <button
                  type="button"
                  onClick={() => searchCustomer(false)}
                  disabled={isLoading}
                  className="h-11 sm:h-10 bg-slate-100 hover:bg-slate-200/80 text-slate-700 px-3.5 rounded-xl font-medium flex items-center gap-1.5 transition text-xs whitespace-nowrap shrink-0"
                >
                  <Search size={13} />
                  조회
                </button>
              </div>
            </div>

            {/* 이름 (3칸) */}
            <div className="md:col-span-3">
              <div className="flex items-center justify-between mb-1">
                <label className="block text-[11px] font-semibold text-slate-500">고객명</label>
                {activeRow?._chatNameHint && !name.trim() && (
                  <button
                    type="button"
                    onClick={() => setName(activeRow._chatNameHint || '')}
                    className="text-[11px] font-semibold text-indigo-600 hover:underline"
                  >
                    +{activeRow._chatNameHint}
                  </button>
                )}
              </div>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="한글 / 영문 / 태국어"
                className={`w-full ${inputBaseClass}`}
              />
            </div>

            {/* 우편번호 + 기본주소 (5칸, 모바일에서는 좁아지지 않게 2줄 반응형 배치) */}
            <div className="md:col-span-5">
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                우편번호 · 기본주소
              </label>
              <div className="space-y-2 sm:space-y-0 sm:flex sm:gap-1.5">
                <div className="flex gap-1.5 sm:contents">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={zipcode}
                    onChange={(e) => setZipcode(e.target.value.replace(/[^0-9]/g, '').slice(0, 5))}
                    onBlur={() => setZipcode((prev) => normalizeClientZipcode(prev))}
                    placeholder="우편번호"
                    className={`w-24 sm:w-21 shrink-0 font-mono text-center px-2 ${inputBaseClass}`}
                  />
                  <button
                    type="button"
                    onClick={handleOpenPostcode}
                    className="sm:order-last h-11 sm:h-10 flex-1 sm:flex-initial justify-center bg-slate-100 hover:bg-slate-200/80 text-slate-700 px-3.5 rounded-xl font-medium flex items-center gap-1.5 transition text-xs whitespace-nowrap shrink-0"
                  >
                    <MapPin size={13} />
                    주소검색
                  </button>
                </div>

                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="기본 주소 (도로명 / 지번)"
                  className={`w-full sm:flex-1 sm:min-w-0 ${inputBaseClass}`}
                />
              </div>
            </div>
          </div>

          {/* 2행: 상세주소 + 제출 버튼 */}
          <div className="flex flex-col sm:flex-row gap-2.5 pt-0.5">
            <input
              type="text"
              value={detailAddress}
              onChange={(e) => setDetailAddress(e.target.value)}
              placeholder="상세 주소 (건물명, 동/호수, 공동현관 비밀번호 등)"
              className={`w-full sm:flex-1 ${inputBaseClass}`}
            />

            <button
              type="submit"
              disabled={isLoading}
              className={`h-11 sm:h-10 px-6 rounded-xl font-semibold text-[14px] sm:text-[13px] transition flex items-center justify-center gap-1.5 shrink-0 shadow-2xs ${
                activeRow
                  ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                  : 'bg-slate-900 hover:bg-slate-800 text-white'
              }`}
            >
              {activeRow ? (
                <>
                  <Check size={15} /> 수정 반영 및 확인
                </>
              ) : (
                <>
                  <Plus size={15} /> 목록에 추가
                </>
              )}
            </button>
          </div>
        </form>
      </section>

      {/* 인앱 브라우저 및 모바일 완벽 호환용 레이어 주소 검색 모달 */}
      {isPostcodeOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/45 backdrop-blur-xs p-0 sm:p-4">
          <div className="bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl border border-slate-200/80 w-full max-w-lg overflow-hidden pb-safe-bottom">
            <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
              <span className="font-bold text-[14px] text-slate-900">도로명 · 지번 주소 검색</span>
              <button
                type="button"
                onClick={() => setIsPostcodeOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-800 hover:bg-slate-100 transition"
              >
                <X size={18} />
              </button>
            </div>
            <div className="w-full h-[430px] sm:h-[460px]">
              <KakaoPostcodeEmbed
                scriptUrl={POSTCODE_SCRIPT_URL}
                defaultQuery={address.trim() || undefined}
                onComplete={handlePostcodeComplete}
                style={{ width: '100%', height: '100%' }}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
