import { useState } from 'react';
import axios from 'axios';
import { useKakaoPostcodePopup, type Address } from 'react-daum-postcode';
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
  const [isExistingCustomer, setIsExistingCustomer] = useState(() =>
    activeRow ? !activeRow._isNew : false
  );

  const openPostcode = useKakaoPostcodePopup(
    'https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js'
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
  };

  const handleOpenPostcode = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    openPostcode({
      onComplete: handlePostcodeComplete,
      defaultQuery: address.trim() || undefined,
    });
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
        message: '이미 목록에 있는 번호입니다. 아래 표에서 해당 행을 클릭해 수정해주세요.',
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
        document.getElementById(`row-${savedRowId}`)?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      }, 50);
    }
  };

  const inputBaseClass =
    'h-10 rounded-xl bg-slate-50/70 hover:bg-slate-50 focus:bg-white border border-slate-200/90 px-3.5 text-[13px] text-slate-800 focus:outline-none focus:border-slate-900 focus:ring-4 focus:ring-slate-900/5 transition placeholder:text-slate-400';

  return (
    <section
      id="top-form"
      className={`bg-white rounded-2xl border transition-all overflow-hidden ${
        activeRow
          ? 'border-indigo-300 shadow-[0_2px_12px_rgba(79,70,229,0.08)]'
          : 'border-slate-200/80 shadow-[0_1px_3px_rgba(15,23,42,0.03)]'
      }`}
    >
      {/* 미니멀 헤더 */}
      <div className="px-6 py-3.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div
            className={`w-7 h-7 rounded-lg flex items-center justify-center ${
              activeRow
                ? 'bg-indigo-50 text-indigo-600'
                : 'bg-slate-100 text-slate-600'
            }`}
          >
            {activeRow ? <PenLine size={14} /> : <UserPlus size={14} />}
          </div>
          <span className="font-semibold text-[14px] text-slate-900">
            {activeRow ? '선택 고객 수정' : '직접 입력 · 검색'}
          </span>
          {activeRow && (
            <span className="text-[11px] font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md font-mono">
              {activeRow.phone}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {status.message && (
            <div
              className={`px-3 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 ${
                status.type === 'success'
                  ? 'bg-emerald-50 text-emerald-700'
                  : status.type === 'error'
                    ? 'bg-rose-50 text-rose-700'
                    : 'bg-slate-100 text-slate-700'
              }`}
            >
              {status.type === 'error' ? (
                <AlertCircle size={13} />
              ) : (
                <CheckCircle2 size={13} />
              )}
              <span>{status.message}</span>
            </div>
          )}

          {activeRow && (
            <button
              type="button"
              onClick={resetFields}
              className="text-xs text-slate-500 hover:text-slate-900 bg-slate-100 hover:bg-slate-200/70 px-3 py-1.5 rounded-lg transition font-medium"
            >
              선택 취소
            </button>
          )}
        </div>
      </div>

      {/* 변경 건 편집 시 이전 DB 참고 라인 */}
      {activeRow?._prevDbInfo && activeRow._reviewStatus === 'MODIFIED' && (
        <div className="mx-6 mt-3.5 px-3.5 py-2 bg-slate-50 border border-slate-200/70 rounded-xl flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <div>
            <span className="font-semibold text-slate-600 mr-1.5">기존 저장 데이터</span>
            {activeRow._prevDbInfo.name} · ({normalizeClientZipcode(activeRow._prevDbInfo.zipcode)}){' '}
            {activeRow._prevDbInfo.address} {activeRow._prevDbInfo.detail_address}
          </div>
          <button
            type="button"
            onClick={applyPrevDbToForm}
            className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900 bg-white border border-slate-200 font-medium px-2.5 py-1 rounded-lg transition"
          >
            <RotateCcw size={11} /> 기존 데이터로 되돌리기
          </button>
        </div>
      )}

      {/* 입력 폼 */}
      <form onSubmit={handleSubmit} className="px-6 py-4 space-y-3.5">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          {/* 전화번호 (4칸) */}
          <div className="md:col-span-4">
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">
              전화번호
            </label>
            <div className="flex gap-1.5">
              <input
                type="text"
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
                className="h-10 bg-slate-100 hover:bg-slate-200/80 text-slate-700 px-3 rounded-xl font-medium flex items-center gap-1.5 transition text-xs whitespace-nowrap"
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

          {/* 우편번호 + 기본주소 (5칸) */}
          <div className="md:col-span-5">
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">
              우편번호 · 기본주소
            </label>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={zipcode}
                onChange={(e) => setZipcode(e.target.value.replace(/[^0-9]/g, '').slice(0, 5))}
                onBlur={() => setZipcode((prev) => normalizeClientZipcode(prev))}
                placeholder="우편번호"
                className={`w-21 shrink-0 font-mono text-center px-2 ${inputBaseClass}`}
              />
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="기본 주소"
                className={`flex-1 min-w-0 ${inputBaseClass}`}
              />
              <button
                type="button"
                onClick={handleOpenPostcode}
                className="h-10 bg-slate-100 hover:bg-slate-200/80 text-slate-700 px-3 rounded-xl font-medium flex items-center gap-1 transition text-xs whitespace-nowrap shrink-0"
              >
                <MapPin size={13} />
                주소검색
              </button>
            </div>
          </div>
        </div>

        {/* 2행: 상세주소 + 제출 버튼 한 줄 배치로 컴팩트하게 */}
        <div className="flex flex-col sm:flex-row gap-2.5 pt-0.5">
          <input
            type="text"
            value={detailAddress}
            onChange={(e) => setDetailAddress(e.target.value)}
            placeholder="상세 주소 (건물명, 동/호수, 공동현관 비밀번호 등)"
            className={`flex-1 ${inputBaseClass}`}
          />

          <button
            type="submit"
            disabled={isLoading}
            className={`h-10 px-6 rounded-xl font-semibold text-[13px] transition flex items-center justify-center gap-1.5 shrink-0 shadow-2xs ${
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
  );
}
