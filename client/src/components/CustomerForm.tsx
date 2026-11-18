import { useState } from 'react';
import axios from 'axios';
import { useKakaoPostcodePopup, type Address } from 'react-daum-postcode';
import {
  Search,
  Save,
  CheckCircle,
  MapPin,
  Plus,
  AlertCircle,
  Database,
  Sparkles,
} from 'lucide-react';
import {
  API_URL,
  normalizeClientPhone,
  normalizeClientZipcode,
  type StatusMessage,
} from '../config/api';
import type { GridRow } from './ShippingGrid';

interface CustomerFormProps {
  /** 현재 선택되어 수정 중인 그리드 행 (없으면 신규 입력 모드) */
  activeRow: GridRow | null;
  /** 중복 추가 검사용 현재 그리드 내 전화번호 목록 */
  existingPhones: string[];
  /** 상단 알림 상태 메시지 */
  status: StatusMessage;
  onStatusChange: (status: StatusMessage) => void;
  /** 신규 행 그리드 추가 콜백 */
  onAddNewRow: (data: {
    phone: string;
    name: string;
    zipcode: string;
    address: string;
    detail_address: string;
    isExistingCustomer: boolean;
  }) => void;
  /** 선택된 기존 행 수정 및 확인 완료 콜백 */
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
  /** 행 선택 해제 콜백 */
  onCancelEdit: () => void;
}

/**
 * CustomerForm - 고객 배송지 단건 입력 및 선택 행 수정·확인 폼
 *
 * 왜 DB 즉시 덮어쓰기 대신 그리드 확인 반영 방식을 사용하는가:
 * AI가 분석한 변경/신규 주소를 사용자가 최종 확인하고 내보내기 전까지는 기존 DB가 무작정 변경되지 않도록 보호하기 위함.
 * (최종 [확정 저장 & 엑셀 내보내기] 시 확인 완료된 행들이 일괄로 DB 및 구글 시트에 저장됨)
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
  const [isExistingCustomer, setIsExistingCustomer] = useState(() =>
    activeRow ? !activeRow._isNew : false
  );

  // 카카오 우편번호 검색 팝업 훅
  const openPostcode = useKakaoPostcodePopup(
    'https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js'
  );

  /** 카카오 주소검색 완료 시 5자리 우편번호(0 보존) 및 기본주소 자동 조합 */
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

  /**
   * 전화번호로 기존 DB 고객 수동 검색 (+82 국가번호 자동 변환 지원)
   * 왜: 그리드 행을 이미 편집 중일 때는 실수로 포커스가 벗어나(onBlur) AI가 찾아둔 새 주소가
   * 예전 DB 주소로 덮어써지지 않도록 수동 [검색] 버튼 클릭 시에만 덮어쓰기를 수행함.
   */
  const searchCustomer = async (isAutoBlur = false) => {
    // 행 수정 모드에서 이미 주소가 채워져 있을 때는 onBlur 자동 덮어쓰기 방지
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
        onStatusChange({ type: 'success', message: '기존 DB 고객 정보가 불러와졌습니다.' });
      } else {
        if (!activeRow) {
          setName('');
          setZipcode('');
          setAddress('');
          setDetailAddress('');
        }
        setIsExistingCustomer(false);
        onStatusChange({ type: 'info', message: 'DB에 없는 신규 전화번호입니다. 주소를 입력해주세요.' });
      }
    } catch (error) {
      console.error('Customer search error:', error);
      onStatusChange({ type: 'error', message: '고객 검색 중 오류가 발생했습니다.' });
    } finally {
      setIsLoading(false);
    }
  };

  /** 기존 DB 비교 정보가 있을 때 폼에 그대로 불러오기 */
  const applyPrevDbToForm = () => {
    if (!activeRow?._prevDbInfo) return;
    const prev = activeRow._prevDbInfo;
    setName(prev.name || '');
    setZipcode(normalizeClientZipcode(prev.zipcode));
    setAddress(prev.address || '');
    setDetailAddress(prev.detail_address || '');
    onStatusChange({ type: 'info', message: '기존 DB 주소·이름을 입력칸에 불러왔습니다. [그리드 수정 & 확인]을 눌러주세요.' });
  };

  /** 폼 초기화 및 선택 해제 */
  const resetFields = () => {
    setPhone('');
    setName('');
    setZipcode('');
    setAddress('');
    setDetailAddress('');
    setIsExistingCustomer(false);
    onCancelEdit();
  };

  /**
   * 폼 제출 시 그리드 행 반영 및 확인 완료(_isConfirmed = true) 처리
   * (실제 DB 및 구글 시트 저장은 모든 검토가 끝난 뒤 [확정 저장 & 엑셀 내보내기]에서 안전하게 수행됨)
   */
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const normalizedPhone = normalizeClientPhone(phone);
    const safeZip = normalizeClientZipcode(zipcode);

    if (!normalizedPhone || !name.trim()) {
      onStatusChange({ type: 'error', message: '전화번호와 이름은 필수 항목입니다.' });
      return;
    }

    if (!address.trim()) {
      onStatusChange({ type: 'error', message: '기본 주소를 입력하거나 [검색] 버튼으로 찾아주세요.' });
      return;
    }

    if (!activeRow && existingPhones.includes(normalizedPhone)) {
      onStatusChange({
        type: 'error',
        message:
          '이미 그리드에 같은 전화번호가 있습니다. 아래 목록에서 해당 행을 클릭하여 수정하세요.',
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
        message: '✅ 그리드에 수정 내용이 반영되고 [확인 완료] 처리되었습니다.',
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
        message: '✅ 그리드에 새 고객이 추가되었습니다. (내보내기 시 DB에 최종 저장됩니다)',
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

  return (
    <div
      id="top-form"
      className="bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden"
    >
      {/* 폼 헤더 */}
      <div className="px-5 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Save size={18} />
          <span className="font-bold text-sm">
            {activeRow ? '📝 선택 행 수정 및 확인 모드' : '➕ 단건 수동 입력'}
          </span>
        </div>
        {activeRow && (
          <button
            type="button"
            onClick={resetFields}
            className="text-xs bg-white/20 hover:bg-white/30 px-3 py-1 rounded-lg transition font-medium"
          >
            선택 해제 (신규 입력으로)
          </button>
        )}
      </div>

      {/* 상태 알림 메시지 */}
      {status.message && (
        <div
          className={`px-5 py-2.5 text-xs font-semibold flex items-center gap-2 ${
            status.type === 'success'
              ? 'bg-green-50 text-green-700'
              : status.type === 'error'
                ? 'bg-red-50 text-red-700'
                : 'bg-blue-50 text-blue-700'
          }`}
        >
          {status.type === 'error' ? <AlertCircle size={14} /> : <CheckCircle size={14} />}
          {status.message}
        </div>
      )}

      {/* 변경된 행('MODIFIED') 편집 시에만 기존 DB 비교 데이터 표시 */}
      {activeRow?._prevDbInfo && activeRow._reviewStatus === 'MODIFIED' && (
        <div className="mx-5 mt-4 px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
          <div>
            <strong className="text-slate-700 mr-1.5">기존 DB 정보:</strong>[
            {activeRow._prevDbInfo.name}] ({normalizeClientZipcode(activeRow._prevDbInfo.zipcode)}){' '}
            {activeRow._prevDbInfo.address} {activeRow._prevDbInfo.detail_address}
          </div>
          <button
            type="button"
            onClick={applyPrevDbToForm}
            className="inline-flex items-center gap-1 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 font-semibold px-2.5 py-1 rounded-lg transition"
          >
            <Database size={12} /> 기존 DB 주소 채우기
          </button>
        </div>
      )}

      {/* 폼 본체 */}
      <form onSubmit={handleSubmit} className="p-5 space-y-4">
        {/* 1행: 전화번호 + 이름 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">
              전화번호 <span className="text-red-500">*</span>
              <span className="text-[11px] font-normal text-slate-400 ml-1.5">
                (+82 국가번호 붙여넣기 시 자동 변환)
              </span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={phone}
                onChange={(e) => {
                  const rawVal = e.target.value;
                  // +82 로 시작하는 전체 번호를 붙여넣은 경우 즉시 010...으로 변환
                  if (rawVal.trim().startsWith('+82') && rawVal.replace(/\D/g, '').length >= 11) {
                    setPhone(normalizeClientPhone(rawVal));
                  } else {
                    setPhone(rawVal.replace(/[^0-9+-]/g, ''));
                  }
                  setIsExistingCustomer(false);
                }}
                placeholder="010-0000-0000 또는 +8210..."
                className="flex-1 rounded-lg border-slate-300 shadow-xs focus:border-blue-500 focus:ring-blue-500 border p-2.5 text-sm"
                onBlur={() => searchCustomer(true)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), searchCustomer(false))}
                required
              />
              <button
                type="button"
                onClick={() => searchCustomer(false)}
                disabled={isLoading}
                className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2.5 rounded-lg font-medium flex items-center gap-1.5 transition text-sm whitespace-nowrap"
                title="전화번호로 기존 DB에 저장된 주소를 불러옵니다"
              >
                <Search size={15} />
                DB검색
              </button>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold text-slate-600">
                이름 <span className="text-red-500">*</span>
              </label>
              {activeRow?._chatNameHint && !name.trim() && (
                <button
                  type="button"
                  onClick={() => setName(activeRow._chatNameHint || '')}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-2 py-0.5 rounded transition"
                >
                  <Sparkles size={11} /> 채팅 이름 채우기: {activeRow._chatNameHint}
                </button>
              )}
            </div>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="고객명 (태국어/영문/한글)"
              className="w-full rounded-lg border-slate-300 shadow-xs focus:border-blue-500 focus:ring-blue-500 border p-2.5 text-sm"
            />
          </div>
        </div>

        {/* 2행: 우편번호 + 기본주소 + 상세주소 */}
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">
            주소 <span className="text-red-500">*</span>
          </label>
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            {/* 좌측(7칸): 우편번호 + 기본 주소 + 카카오 우편번호 검색 버튼 */}
            <div className="md:col-span-7 flex gap-2">
              <input
                type="text"
                value={zipcode}
                onChange={(e) => setZipcode(e.target.value.replace(/[^0-9]/g, '').slice(0, 5))}
                onBlur={() => setZipcode((prev) => normalizeClientZipcode(prev))}
                placeholder="우편번호"
                className="w-24 rounded-lg border-slate-300 shadow-xs bg-slate-50 focus:bg-white border p-2.5 text-sm font-mono text-slate-700 shrink-0"
              />
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="기본 주소 ([검색] 버튼 클릭 시 정확한 우편번호와 함께 자동 입력)"
                className="flex-1 min-w-0 rounded-lg border-slate-300 shadow-xs bg-slate-50 focus:bg-white border p-2.5 text-sm text-slate-700"
              />
              <button
                type="button"
                onClick={handleOpenPostcode}
                className="bg-blue-50 hover:bg-blue-100 text-blue-700 px-3.5 py-2.5 rounded-lg font-semibold flex items-center gap-1.5 transition border border-blue-200 text-sm whitespace-nowrap shrink-0"
              >
                <MapPin size={15} />
                검색
              </button>
            </div>

            {/* 우측(5칸): 상세 주소 입력 */}
            <div className="md:col-span-5">
              <input
                type="text"
                value={detailAddress}
                onChange={(e) => setDetailAddress(e.target.value)}
                placeholder="상세 주소 (건물명, 동/호수, 현관비밀번호 등)"
                className="w-full rounded-lg border-slate-300 shadow-xs focus:border-blue-500 focus:ring-blue-500 border p-2.5 text-sm"
              />
            </div>
          </div>
        </div>

        {/* 저장 / 수정 확인 버튼 */}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={isLoading}
            className={`flex-1 font-bold py-3 rounded-xl shadow-md transition flex justify-center items-center gap-2 text-sm ${
              activeRow
                ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-amber-200'
                : 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-200'
            }`}
          >
            {activeRow ? (
              <>
                <Save size={18} /> 그리드 수정 & 확인 완료
              </>
            ) : (
              <>
                <Plus size={18} /> 그리드에 추가
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
