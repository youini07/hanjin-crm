import { useState, useMemo } from 'react';
import {
  Check,
  Trash2,
  Download,
  X,
  Inbox,
  Minus,
  Plus,
  AlertTriangle,
  ExternalLink,
  Search,
} from 'lucide-react';
import { normalizeClientZipcode } from '../config/api';

export type ReviewStatus = 'MATCHED' | 'MODIFIED' | 'NEW' | 'PHOTO_CHECK' | 'NO_ADDRESS';
export type AddressPendingType = 'MODIFIED' | 'PHOTO' | 'NEW' | 'NEW_PHOTO' | null;

export interface PrevDbCustomerInfo {
  name: string;
  zipcode: string;
  address: string;
  detail_address: string;
}

export interface GridRow {
  _tempId: string;
  _isNew: boolean;
  _isSelected: boolean;
  _isDirty: boolean;
  _reviewStatus?: ReviewStatus;
  _namePending?: boolean;
  _addressPending?: AddressPendingType;
  _isConfirmed?: boolean;
  _needsAddressCheck?: boolean;
  _zipcodeMissing?: boolean;
  _aiNote?: string;
  _chatNameHint?: string;
  _fbName?: string;
  _fbUpdated?: boolean;
  _prevDbInfo?: PrevDbCustomerInfo;
  order_number?: string;
  name: string;
  phone: string;
  zipcode: string;
  address: string;
  detail_address: string;
  item_memo?: string;
  products?: string[];
  quantity?: number;
}

type FilterTab = 'ALL' | 'NO_ZIP' | 'PENDING' | 'MODIFIED' | 'PHOTO' | 'NEW';

interface ShippingGridProps {
  mode?: 'kakao' | 'grip';
  rows: GridRow[];
  activeRowId: string | null;
  onRowSelect: (row: GridRow) => void;
  onRowDelete: (tempIds: string[]) => void;
  onConfirmNameField?: (tempId: string, keepOldDb?: boolean) => void;
  onConfirmAddressField?: (tempId: string, keepOldDb?: boolean) => void;
  onConfirmRows?: (tempIds: string[]) => void;
  onExport: () => void;
  isExporting: boolean;
  checkedIds: Set<string>;
  onCheckToggle: (tempId: string) => void;
  onCheckAll: () => void;
  onQuantityChange: (tempId: string, quantity: number) => void;
}

const formatPhone = (phone: string): string => {
  if (!phone) return '';
  const digits = phone.replace(/[^0-9]/g, '');
  if (digits.length === 11)
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.length === 10)
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return phone;
};

const isValidFiveDigitZip = (zip?: string): boolean => {
  return /^\d{5}$/.test(normalizeClientZipcode(zip));
};

const isRowMissingZipcode = (row: GridRow): boolean => {
  return Boolean(row.address.trim() !== '' && !isValidFiveDigitZip(row.zipcode));
};

const hasPendingAction = (row: GridRow): boolean => {
  return Boolean(
    row._namePending ||
      row._addressPending ||
      row._isConfirmed === false ||
      isRowMissingZipcode(row)
  );
};

/**
 * ShippingGrid - 데스크탑 테이블 뷰 & 모바일 송장 카드 뷰 하이브리드 컴포넌트
 *
 * 핵심 안전 설계:
 * 1. 우편번호 미검색(없는 번지·오타 의심) 행은 빨간색 경보 배경 + 좌측 적색 보더로 즉시 식별되게 하고
 *    일괄 확인 대상에서 자동 제외하며, [기존 DB 주소 유지(권장)] 또는 [주소검색 수정]을 유도함.
 * 2. 기존 DB 주소와 다른 주소(MODIFIED)는 주황/앰버 강조 박스로 기존 주소 vs 새 주소를 선명하게 대조함.
 */
export default function ShippingGrid({
  mode = 'kakao',
  rows,
  activeRowId,
  onRowSelect,
  onRowDelete,
  onConfirmNameField,
  onConfirmAddressField,
  onConfirmRows,
  onExport,
  isExporting,
  checkedIds,
  onCheckToggle,
  onCheckAll,
  onQuantityChange,
}: ShippingGridProps) {
  const isGripMode = mode === 'grip';
  const [filterTab, setFilterTab] = useState<FilterTab>('ALL');

  const stats = useMemo(() => {
    const missingZipCount = rows.filter((r) => isRowMissingZipcode(r)).length;
    const exportReady = rows.filter(
      (r) =>
        r.name.trim() &&
        r.phone.trim() &&
        r.address.trim() &&
        isValidFiveDigitZip(r.zipcode) &&
        !hasPendingAction(r)
    ).length;
    const pendingRows = rows.filter((r) => hasPendingAction(r));

    // 우편번호가 없는 의심 행은 절대 일괄 확인으로 넘어가지 않도록 차단!
    const bulkConfirmableIds = pendingRows
      .filter((r) => r.name.trim() && r.address.trim() && isValidFiveDigitZip(r.zipcode))
      .map((r) => r._tempId);

    const modifiedCount = rows.filter(
      (r) => r._namePending || r._addressPending === 'MODIFIED'
    ).length;
    const photoCount = rows.filter(
      (r) => r._addressPending === 'PHOTO' || r._addressPending === 'NEW_PHOTO'
    ).length;
    const newCount = rows.filter((r) => r._addressPending === 'NEW' || r._isNew).length;

    return {
      missingZipCount,
      exportReady,
      pendingCount: pendingRows.length,
      bulkConfirmableIds,
      modifiedCount,
      photoCount,
      newCount,
    };
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (filterTab === 'ALL') return rows;
    if (filterTab === 'NO_ZIP') return rows.filter((r) => isRowMissingZipcode(r));
    if (isGripMode) return rows;
    return rows.filter((r) => {
      if (filterTab === 'PENDING') return hasPendingAction(r);
      if (filterTab === 'MODIFIED')
        return Boolean(r._namePending || r._addressPending === 'MODIFIED');
      if (filterTab === 'PHOTO')
        return r._addressPending === 'PHOTO' || r._addressPending === 'NEW_PHOTO';
      if (filterTab === 'NEW') return r._addressPending === 'NEW' || r._isNew;
      return true;
    });
  }, [rows, filterTab, isGripMode]);

  const checkedConfirmableIds = useMemo(
    () =>
      rows
        .filter(
          (r) =>
            checkedIds.has(r._tempId) &&
            hasPendingAction(r) &&
            r.name.trim() &&
            r.address.trim() &&
            isValidFiveDigitZip(r.zipcode)
        )
        .map((r) => r._tempId),
    [rows, checkedIds]
  );

  return (
    <section className="bg-white rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(15,23,42,0.03)] overflow-hidden">
      {/* 상단 긴급 경고 배너: 우편번호 미검색(없는 주소) 또는 주소 변경 건이 있을 때 즉시 시선 유도 */}
      {(stats.missingZipCount > 0 || (!isGripMode && stats.modifiedCount > 0)) && (
        <div
          className={`px-4 sm:px-6 py-2.5 border-b flex flex-wrap items-center justify-between gap-2 text-xs ${
            stats.missingZipCount > 0
              ? 'bg-rose-50 border-rose-200/80 text-rose-800'
              : 'bg-amber-50/90 border-amber-200/80 text-amber-900'
          }`}
        >
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle
              size={15}
              className={
                stats.missingZipCount > 0 ? 'text-rose-600 shrink-0' : 'text-amber-600 shrink-0'
              }
            />
            <span>
              {stats.missingZipCount > 0 ? (
                <>
                  <strong>우편번호 미검색(없는 주소·번지 오타 의심) {stats.missingZipCount}건</strong>
                  {stats.modifiedCount > 0 && ` · 기존 정보 변경 ${stats.modifiedCount}건`}이 있습니다.
                  빨간색 항목을 반드시 확인해주세요!
                </>
              ) : (
                <>
                  기존 저장된 DB 주소·이름과 다른 항목이{' '}
                  <strong>{stats.modifiedCount}건</strong> 있습니다. 전·후 주소를 비교 후 승인해주세요.
                </>
              )}
            </span>
          </div>

          {stats.missingZipCount > 0 && filterTab !== 'NO_ZIP' && (
            <button
              type="button"
              onClick={() => setFilterTab('NO_ZIP')}
              className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold whitespace-nowrap transition"
            >
              오류 주소만 보기 ({stats.missingZipCount})
            </button>
          )}
        </div>
      )}

      {/* 카드 헤더 & 인라인 필터 컨트롤 */}
      <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center justify-between sm:justify-start gap-2.5">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-[15px] text-slate-900">배송 대기 목록</h2>
            <span className="text-xs font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md tabular-nums">
              {rows.length}
            </span>
          </div>

          {/* 모바일 상단 일괄 승인 버튼 */}
          {!isGripMode && rows.length > 0 && (
            <div className="flex sm:hidden items-center gap-1.5">
              {onConfirmRows && checkedConfirmableIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => onConfirmRows(checkedConfirmableIds)}
                  className="inline-flex items-center gap-1 bg-slate-900 text-white text-xs font-semibold px-2.5 py-1.5 rounded-lg whitespace-nowrap"
                >
                  <Check size={12} /> 선택확인 ({checkedConfirmableIds.length})
                </button>
              )}
              {onConfirmRows && stats.bulkConfirmableIds.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    if (
                      window.confirm(
                        `정상 우편번호가 확인된 ${stats.bulkConfirmableIds.length}건을 일괄 확인 완료할까요?\n(우편번호가 없는 오류 의심 주소는 제외됩니다)`
                      )
                    ) {
                      onConfirmRows(stats.bulkConfirmableIds);
                    }
                  }}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-700 bg-indigo-50 px-2.5 py-1.5 rounded-lg whitespace-nowrap"
                >
                  <Check size={12} /> 일괄확인 ({stats.bulkConfirmableIds.length})
                </button>
              )}
            </div>
          )}

          {/* 필터 알약 탭 */}
          {rows.length > 0 && (!isGripMode || stats.missingZipCount > 0) && (
            <div className="w-full sm:w-auto flex items-center gap-1 bg-slate-100/80 p-1 rounded-xl overflow-x-auto">
              {[
                {
                  id: 'ALL' as FilterTab,
                  label: '전체',
                  count: rows.length,
                  show: true,
                  danger: false,
                  warn: false,
                },
                {
                  id: 'NO_ZIP' as FilterTab,
                  label: '🚨우편번호없음',
                  count: stats.missingZipCount,
                  show: stats.missingZipCount > 0,
                  danger: true,
                  warn: false,
                },
                {
                  id: 'MODIFIED' as FilterTab,
                  label: '⚠️주소/이름변경',
                  count: stats.modifiedCount,
                  show: !isGripMode && stats.modifiedCount > 0,
                  danger: false,
                  warn: true,
                },
                {
                  id: 'PENDING' as FilterTab,
                  label: '미확인',
                  count: stats.pendingCount,
                  show: !isGripMode && stats.pendingCount > 0,
                  danger: false,
                  warn: false,
                },
                {
                  id: 'PHOTO' as FilterTab,
                  label: '사진',
                  count: stats.photoCount,
                  show: !isGripMode && stats.photoCount > 0,
                  danger: false,
                  warn: false,
                },
                {
                  id: 'NEW' as FilterTab,
                  label: '신규',
                  count: stats.newCount,
                  show: !isGripMode && stats.newCount > 0,
                  danger: false,
                  warn: false,
                },
              ]
                .filter((t) => t.show)
                .map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setFilterTab(tab.id)}
                    className={`flex-1 sm:flex-initial px-2.5 py-1.5 sm:py-1 rounded-lg text-xs font-medium transition tabular-nums whitespace-nowrap ${
                      filterTab === tab.id
                        ? tab.danger
                          ? 'bg-rose-600 text-white shadow-2xs font-bold'
                          : 'bg-white text-slate-900 shadow-2xs font-semibold'
                        : tab.danger
                          ? 'text-rose-600 bg-rose-50 hover:bg-rose-100 font-bold'
                          : tab.warn
                            ? 'text-amber-700 hover:text-amber-900 font-semibold'
                            : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    {tab.label}{' '}
                    <span
                      className={
                        filterTab === tab.id
                          ? tab.danger
                            ? 'text-rose-100 ml-0.5'
                            : 'text-indigo-600 ml-0.5'
                          : tab.danger
                            ? 'text-rose-700 ml-0.5'
                            : 'text-slate-400 ml-0.5'
                      }
                    >
                      {tab.count}
                    </span>
                  </button>
                ))}
            </div>
          )}
        </div>

        {/* 데스크탑 우측 일괄 승인 버튼 */}
        {!isGripMode && rows.length > 0 && (
          <div className="hidden sm:flex items-center gap-2 shrink-0">
            {onConfirmRows && checkedConfirmableIds.length > 0 && (
              <button
                type="button"
                onClick={() => onConfirmRows(checkedConfirmableIds)}
                className="inline-flex items-center gap-1 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition"
              >
                <Check size={13} /> 선택 확인 ({checkedConfirmableIds.length})
              </button>
            )}
            {onConfirmRows && stats.bulkConfirmableIds.length > 1 && (
              <button
                type="button"
                onClick={() => {
                  if (
                    window.confirm(
                      `정상 우편번호가 확인된 ${stats.bulkConfirmableIds.length}건을 모두 확인 완료할까요?\n(우편번호가 없는 오류 의심 주소는 제외됩니다)`
                    )
                  ) {
                    onConfirmRows(stats.bulkConfirmableIds);
                  }
                }}
                className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100/90 hover:bg-slate-200/70 px-3 py-1.5 rounded-lg transition"
              >
                <Check size={13} /> 전체 일괄 확인 ({stats.bulkConfirmableIds.length})
              </button>
            )}
          </div>
        )}
      </div>

      {/* 빈 상태 */}
      {rows.length === 0 ? (
        <div className="py-16 sm:py-20 px-4 text-center">
          <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3">
            <Inbox size={22} />
          </div>
          <p className="text-[14px] font-medium text-slate-600">등록된 송장 목록이 없습니다</p>
          <p className="text-xs text-slate-400 mt-1">
            {isGripMode
              ? '상단에서 그립 판매내역서 파일을 업로드해주세요'
              : '상단에서 카톡 캡처 스샷을 올리거나 대화를 붙여넣어 보세요'}
          </p>
        </div>
      ) : (
        <>
          {/* ─────────────────────────────────────────────────────────────────
              [모바일 전용 뷰] 가로 스크롤 없는 송장 카드 리스트 (md 미만에서 활성화)
             ───────────────────────────────────────────────────────────────── */}
          <div className="md:hidden">
            <div className="px-4 py-2.5 bg-slate-50/80 border-b border-slate-100 flex items-center justify-between text-xs">
              <label className="inline-flex items-center gap-2 text-slate-600 font-medium cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={checkedIds.size === rows.length && rows.length > 0}
                  onChange={onCheckAll}
                  className="w-4 h-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900/20"
                />
                <span>
                  전체 선택 ({checkedIds.size}/{rows.length})
                </span>
              </label>

              {checkedIds.size > 0 && (
                <button
                  type="button"
                  onClick={() => onRowDelete(Array.from(checkedIds))}
                  className="inline-flex items-center gap-1 text-rose-600 font-semibold px-2 py-1 rounded-lg bg-rose-50"
                >
                  <Trash2 size={12} />
                  선택 삭제 ({checkedIds.size})
                </button>
              )}
            </div>

            <div className="divide-y divide-slate-100">
              {filteredRows.map((row) => {
                const originalIndex = rows.findIndex((r) => r._tempId === row._tempId);
                const isActive = activeRowId === row._tempId;
                const missingZip = isRowMissingZipcode(row);
                const isAddrModified = row._addressPending === 'MODIFIED';
                const pending = hasPendingAction(row);
                const safeZip = normalizeClientZipcode(row.zipcode);
                const prevZip = normalizeClientZipcode(row._prevDbInfo?.zipcode);
                const qty = row.quantity || 1;

                return (
                  <div
                    id={`card-${row._tempId}`}
                    key={row._tempId}
                    onClick={() => onRowSelect(row)}
                    className={`p-4 space-y-2.5 transition-colors border-l-4 ${
                      isActive
                        ? 'bg-indigo-50/50 border-l-indigo-600'
                        : missingZip
                          ? 'bg-rose-50/70 border-l-rose-500'
                          : isAddrModified
                            ? 'bg-amber-50/45 border-l-amber-500'
                            : 'bg-white border-l-transparent active:bg-slate-50'
                    }`}
                  >
                    {/* 카드 상단 */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <div
                          className="pt-0.5 shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={checkedIds.has(row._tempId)}
                            onChange={() => onCheckToggle(row._tempId)}
                            className="w-4 h-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900/20"
                          />
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[11px] font-mono text-slate-400">
                              #{originalIndex + 1}
                            </span>

                            {!row._namePending && (
                              <span className="font-bold text-[14px] text-slate-900 break-all">
                                {row.name || (
                                  <span className="text-rose-500 text-xs font-semibold">
                                    이름 미입력
                                  </span>
                                )}
                              </span>
                            )}

                            {missingZip ? (
                              <span className="px-1.5 py-0.5 rounded bg-rose-600 text-white text-[10px] font-bold">
                                🚨 우편번호 없음
                              </span>
                            ) : !pending && row.address.trim() && row.name.trim() ? (
                              <span className="inline-flex w-4 h-4 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 shrink-0">
                                <Check size={11} strokeWidth={2.8} />
                              </span>
                            ) : (
                              <span
                                className="inline-block w-2 h-2 rounded-full bg-amber-500 shrink-0"
                                title="확인 대기"
                              />
                            )}
                          </div>

                          {/* 고객명 변경 승인 영역 */}
                          {row._namePending && (
                            <div
                              className="mt-1 space-y-1"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {row._prevDbInfo?.name && (
                                <div className="text-xs text-slate-400 line-through">
                                  기존: {row._prevDbInfo.name}
                                </div>
                              )}
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-bold text-[14px] text-indigo-600">
                                  {row.name}
                                </span>
                                {onConfirmNameField && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => onConfirmNameField(row._tempId, false)}
                                      className="px-2.5 py-1 rounded-lg bg-slate-900 text-white text-xs font-semibold"
                                    >
                                      이름 수정
                                    </button>
                                    {row._prevDbInfo?.name && (
                                      <button
                                        type="button"
                                        onClick={() => onConfirmNameField(row._tempId, true)}
                                        className="px-2 py-1 rounded-lg bg-slate-100 text-slate-600 text-xs font-medium"
                                      >
                                        기존 유지
                                      </button>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                          )}

                          {/* 연락처 및 우편번호 */}
                          <div className="flex items-center gap-2 mt-1 text-xs text-slate-500 font-mono">
                            <span>{formatPhone(row.phone)}</span>
                            {safeZip && (
                              <span className="px-1.5 py-0.2 rounded bg-slate-100 text-slate-700 font-semibold text-[11px]">
                                {safeZip}
                              </span>
                            )}
                            {isGripMode && row.order_number && (
                              <span className="text-[11px] text-slate-400">
                                #{row.order_number}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* 우측 수량 조절기 + 삭제 */}
                      <div
                        className="flex items-center gap-1.5 shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div
                          className={`inline-flex items-center rounded-lg border bg-white ${
                            qty >= 2
                              ? 'border-indigo-200 text-indigo-700'
                              : 'border-slate-200 text-slate-700'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => onQuantityChange(row._tempId, Math.max(1, qty - 1))}
                            className="w-7 h-7 flex items-center justify-center text-slate-500 active:bg-slate-100 rounded-l-lg"
                            aria-label="수량 감소"
                          >
                            <Minus size={12} />
                          </button>
                          <span className="w-6 text-center text-xs font-bold tabular-nums">
                            {qty}
                          </span>
                          <button
                            type="button"
                            onClick={() => onQuantityChange(row._tempId, qty + 1)}
                            className="w-7 h-7 flex items-center justify-center text-slate-500 active:bg-slate-100 rounded-r-lg"
                            aria-label="수량 증가"
                          >
                            <Plus size={12} />
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() => onRowDelete([row._tempId])}
                          className="p-1.5 text-slate-400 hover:text-rose-600 active:bg-rose-50 rounded-lg"
                          aria-label="행 삭제"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    </div>

                    {/* 카드 하단: 주소 및 상태별 강력 강조 박스 */}
                    <div className="pl-6 space-y-1.5 text-[13px] leading-snug">
                      {missingZip ? (
                        /* [경보 1순위] 우편번호가 검색되지 않는 없는 주소 / 번지 오타! */
                        <div className="p-3 rounded-xl bg-white border-2 border-rose-300 space-y-2 shadow-2xs">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[11px] font-bold text-white bg-rose-600 px-2 py-0.5 rounded-md">
                              🚨 없는 주소 · 우편번호 미검색 (체크 필수!)
                            </span>
                            {row._aiNote && (
                              <span className="text-[11px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-200">
                                {row._aiNote}
                              </span>
                            )}
                          </div>

                          {row._prevDbInfo?.address && (
                            <div className="p-2 rounded-lg bg-emerald-50/70 border border-emerald-200/80 text-xs text-emerald-950">
                              <span className="font-bold text-emerald-700 block mb-0.5">
                                기존 DB 저장 주소 {prevZip ? `(${prevZip})` : ''}
                              </span>
                              {row._prevDbInfo.address} {row._prevDbInfo.detail_address}
                            </div>
                          )}

                          <div className="p-2 rounded-lg bg-rose-50/80 border border-rose-200/80 text-xs text-rose-950">
                            <span className="font-bold text-rose-700 block mb-0.5">
                              고객 입력 주소 (우편번호 없음)
                            </span>
                            {row.address}
                            {row.detail_address ? ` · ${row.detail_address}` : ''}
                          </div>

                          <div
                            className="flex flex-wrap items-center gap-2 pt-0.5"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {onConfirmAddressField && row._prevDbInfo?.address && (
                              <button
                                type="button"
                                onClick={() => onConfirmAddressField(row._tempId, true)}
                                className="flex-1 py-2.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-2xs"
                              >
                                기존 DB 주소 유지 (권장)
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => onRowSelect(row)}
                              className="flex-1 py-2.5 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold inline-flex items-center justify-center gap-1"
                            >
                              <Search size={12} /> 주소검색으로 직접 수정
                            </button>
                          </div>
                        </div>
                      ) : isAddrModified ? (
                        /* [경보 2순위] 우편번호는 있으나 기존 저장된 DB 주소와 다른 경우 */
                        <div className="p-3 rounded-xl bg-white border-2 border-amber-300 space-y-2 shadow-2xs">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[11px] font-bold text-amber-900 bg-amber-200/80 px-2 py-0.5 rounded-md">
                              ⚠️ 기존 주소와 다름 · 변경 확인 필요
                            </span>
                            {row._aiNote && (
                              <span className="text-[11px] font-semibold text-rose-600 bg-rose-50 ring-1 ring-inset ring-rose-500/15 px-1.5 py-0.5 rounded-md">
                                {row._aiNote}
                              </span>
                            )}
                          </div>

                          {row._prevDbInfo?.address && (
                            <div className="p-2 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600">
                              <span className="font-bold text-slate-700 mr-1">
                                기존 DB {prevZip ? `(${prevZip})` : ''}:
                              </span>
                              <span className="line-through">
                                {row._prevDbInfo.address} {row._prevDbInfo.detail_address}
                              </span>
                            </div>
                          )}

                          <div className="p-2 rounded-lg bg-amber-50/70 border border-amber-200 text-xs text-slate-900 font-semibold">
                            <span className="font-bold text-amber-800 mr-1">
                              새 주소 {safeZip ? `(${safeZip})` : ''}:
                            </span>
                            {row.address}
                            {row.detail_address ? ` · ${row.detail_address}` : ''}
                          </div>

                          {onConfirmAddressField && (
                            <div
                              className="flex items-center gap-2 pt-0.5"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                onClick={() => onConfirmAddressField(row._tempId, false)}
                                className="flex-1 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold"
                              >
                                새 주소로 변경 승인
                              </button>
                              {row._prevDbInfo?.address && (
                                <button
                                  type="button"
                                  onClick={() => onConfirmAddressField(row._tempId, true)}
                                  className="px-3 py-2 rounded-lg bg-slate-100 border border-slate-200 text-slate-700 text-xs font-semibold"
                                >
                                  기존 DB 유지
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      ) : row._addressPending === 'PHOTO' ? (
                        <div className="p-2.5 rounded-xl bg-amber-50/60 border border-amber-200/70 space-y-2">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[11px] text-amber-800 bg-amber-100/80 px-1.5 py-0.5 rounded font-semibold">
                              사진주소 · 기존 DB
                            </span>
                            <span className="text-slate-800 font-medium">
                              {row.address} {row.detail_address}
                            </span>
                          </div>
                          {onConfirmAddressField && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onConfirmAddressField(row._tempId, false);
                              }}
                              className="w-full py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold"
                            >
                              기존 주소로 확인 완료
                            </button>
                          )}
                        </div>
                      ) : row._addressPending === 'NEW' ? (
                        <div className="p-2.5 rounded-xl bg-sky-50/55 border border-sky-100 space-y-2">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[11px] text-blue-700 bg-blue-50 ring-1 ring-inset ring-blue-600/20 px-1.5 py-0.5 rounded font-semibold">
                              신규 고객
                            </span>
                            {row._aiNote && (
                              <span className="text-[11px] font-medium text-rose-600 bg-rose-50 ring-1 ring-inset ring-rose-500/15 px-1.5 py-0.5 rounded">
                                {row._aiNote}
                              </span>
                            )}
                          </div>
                          <div className="text-slate-800 font-medium">
                            {row.address}
                            {row.detail_address ? ` · ${row.detail_address}` : ''}
                          </div>
                          {onConfirmAddressField && row.address.trim() && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onConfirmAddressField(row._tempId, false);
                              }}
                              className="w-full py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold"
                            >
                              신규 주소 확인 완료
                            </button>
                          )}
                        </div>
                      ) : row._addressPending === 'NEW_PHOTO' || !row.address.trim() ? (
                        <div className="p-2.5 rounded-xl bg-amber-50/70 border border-dashed border-amber-300 text-amber-800 text-xs font-medium">
                          사진 주소 주문입니다 · 이 카드를 눌러 상단 폼에서 주소를 입력해주세요
                        </div>
                      ) : (
                        <div className="text-slate-700">
                          <div>{row.address}</div>
                          {row.detail_address && (
                            <div className="text-xs text-slate-500 mt-0.5">
                              {row.detail_address}
                            </div>
                          )}
                        </div>
                      )}

                      {isGripMode && row.item_memo && (
                        <div className="pt-0.5">
                          <span className="inline-block text-xs text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md font-medium">
                            {row.item_memo}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ─────────────────────────────────────────────────────────────────
              [데스크탑 전용 뷰] 고밀도 테이블 레이아웃 (md 이상에서 활성화)
             ───────────────────────────────────────────────────────────────── */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-slate-50/50 border-b border-slate-100 text-slate-400">
                  <th className="w-10 px-4 py-2.5 text-center">
                    <input
                      type="checkbox"
                      checked={checkedIds.size === rows.length && rows.length > 0}
                      onChange={onCheckAll}
                      className="rounded border-slate-300 text-slate-900 focus:ring-slate-900/20"
                    />
                  </th>
                  <th className="px-2 py-2.5 text-left text-[11px] font-medium w-9">#</th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-medium whitespace-nowrap min-w-[140px]">
                    고객명
                  </th>
                  <th className="px-2 py-2.5 text-center text-[11px] font-medium w-16 whitespace-nowrap">
                    수량
                  </th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-medium whitespace-nowrap">
                    연락처
                  </th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-medium whitespace-nowrap">
                    우편번호
                  </th>
                  <th
                    className={`px-3 py-2.5 text-left text-[11px] font-medium ${
                      isGripMode ? 'min-w-[260px] w-[35%]' : 'min-w-[340px] w-[44%]'
                    }`}
                  >
                    기본주소
                  </th>
                  <th
                    className={`px-3 py-2.5 text-left text-[11px] font-medium ${
                      isGripMode ? 'min-w-[180px] w-[22%]' : 'min-w-[190px] w-[23%]'
                    }`}
                  >
                    상세주소
                  </th>
                  {isGripMode && (
                    <th className="px-3 py-2.5 text-left text-[11px] font-medium min-w-[180px] w-[20%]">
                      구매상품 (H열)
                    </th>
                  )}
                  <th className="px-2.5 py-2.5 text-center text-[11px] font-medium w-12 whitespace-nowrap">
                    확인
                  </th>
                  <th className="px-3 py-2.5 w-9"></th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100/90">
                {filteredRows.map((row) => {
                  const originalIndex = rows.findIndex((r) => r._tempId === row._tempId);
                  const isActive = activeRowId === row._tempId;
                  const missingZip = isRowMissingZipcode(row);
                  const isAddrModified = row._addressPending === 'MODIFIED';
                  const pending = hasPendingAction(row);
                  const safeZip = normalizeClientZipcode(row.zipcode);
                  const prevZip = normalizeClientZipcode(row._prevDbInfo?.zipcode);

                  const fullProductsTooltip =
                    row.products && row.products.length > 0
                      ? `총 ${row.products.length}개 상품:\n` +
                        row.products.map((p, i) => `${i + 1}. ${p}`).join('\n')
                      : row.item_memo || '';

                  return (
                    <tr
                      id={`row-${row._tempId}`}
                      key={row._tempId}
                      onClick={() => onRowSelect(row)}
                      className={`group cursor-pointer transition-colors ${
                        isActive
                          ? 'bg-indigo-50/55'
                          : missingZip
                            ? 'bg-rose-50/75 hover:bg-rose-50'
                            : isAddrModified
                              ? 'bg-amber-50/50 hover:bg-amber-50/80'
                              : 'hover:bg-slate-50/70'
                      }`}
                    >
                      <td
                        className={`px-4 py-3.5 text-center border-l-4 ${
                          isActive
                            ? 'border-l-indigo-600'
                            : missingZip
                              ? 'border-l-rose-500'
                              : isAddrModified
                                ? 'border-l-amber-500'
                                : 'border-l-transparent'
                        }`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={checkedIds.has(row._tempId)}
                          onChange={() => onCheckToggle(row._tempId)}
                          className="rounded border-slate-300 text-slate-900 focus:ring-slate-900/20"
                        />
                      </td>

                      <td className="px-2 py-3.5 text-slate-400 font-mono text-xs tabular-nums">
                        {originalIndex + 1}
                      </td>

                      <td className="px-3 py-3.5 text-slate-900">
                        {row._namePending ? (
                          <div
                            className="space-y-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {row._prevDbInfo?.name && (
                              <div className="text-[11px] text-slate-400 line-through">
                                {row._prevDbInfo.name}
                              </div>
                            )}
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-semibold text-indigo-600">{row.name}</span>
                              {onConfirmNameField && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => onConfirmNameField(row._tempId, false)}
                                    className="px-2 py-0.5 rounded-md bg-slate-900 hover:bg-slate-700 text-white text-[11px] font-medium transition"
                                  >
                                    수정
                                  </button>
                                  {row._prevDbInfo?.name && (
                                    <button
                                      type="button"
                                      onClick={() => onConfirmNameField(row._tempId, true)}
                                      className="px-1.5 py-0.5 rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-100 text-[11px] transition"
                                    >
                                      유지
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="font-medium whitespace-nowrap">
                            {row.name || (
                              <span className="text-rose-500 text-xs font-semibold">미입력</span>
                            )}
                          </div>
                        )}

                        {isGripMode && row.order_number && (
                          <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                            #{row.order_number}
                          </div>
                        )}
                      </td>

                      <td
                        className="px-2 py-3.5 text-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="number"
                          min="1"
                          value={row.quantity || 1}
                          onChange={(e) =>
                            onQuantityChange(
                              row._tempId,
                              Math.max(1, parseInt(e.target.value) || 1)
                            )
                          }
                          className={`w-12 h-7 text-center rounded-lg border text-xs tabular-nums transition focus:outline-none focus:border-slate-900 bg-white ${
                            (row.quantity || 1) >= 2
                              ? 'border-indigo-200 text-indigo-700 font-bold'
                              : 'border-slate-200/80 text-slate-600'
                          }`}
                        />
                      </td>

                      <td className="px-3 py-3.5 text-slate-500 font-mono text-xs tabular-nums whitespace-nowrap">
                        {formatPhone(row.phone)}
                      </td>

                      {/* 우편번호 셀: 미검색 시 강렬한 빨간 배지 표시 */}
                      <td className="px-3 py-3.5 font-mono text-xs tabular-nums whitespace-nowrap">
                        {safeZip ? (
                          <span className="text-slate-600 font-medium">{safeZip}</span>
                        ) : row.address.trim() ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-600 text-white text-[11px] font-sans font-bold">
                            🚨 미검색
                          </span>
                        ) : (
                          <span className="text-slate-300">-</span>
                        )}
                      </td>

                      {/* 기본주소 셀: 우편번호 미검색 / 기존 주소 변경 강력 대비 */}
                      <td className="px-3 py-3.5 text-slate-800 break-keep leading-relaxed">
                        {missingZip ? (
                          <div className="p-2.5 rounded-xl bg-white border border-rose-300 space-y-1.5 shadow-2xs">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-[11px] font-bold text-white bg-rose-600 px-2 py-0.5 rounded-md">
                                🚨 없는 주소 · 우편번호 미검색 (체크 필수!)
                              </span>
                              {row._aiNote && (
                                <span className="text-[11px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-200">
                                  {row._aiNote}
                                </span>
                              )}
                            </div>

                            {row._prevDbInfo?.address && (
                              <div className="text-xs text-emerald-900 bg-emerald-50/75 border border-emerald-200/80 px-2.5 py-1.5 rounded-lg">
                                <strong className="text-emerald-700 mr-1.5">
                                  기존 DB {prevZip ? `(${prevZip})` : ''}:
                                </strong>
                                {row._prevDbInfo.address} {row._prevDbInfo.detail_address}
                              </div>
                            )}

                            <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                              <div className="font-semibold text-rose-900">
                                <span className="text-xs font-bold text-rose-600 mr-1.5">
                                  고객 입력:
                                </span>
                                {row.address}
                              </div>

                              <div
                                className="flex items-center gap-1.5 shrink-0"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {onConfirmAddressField && row._prevDbInfo?.address && (
                                  <button
                                    type="button"
                                    onClick={() => onConfirmAddressField(row._tempId, true)}
                                    className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold transition shadow-2xs"
                                  >
                                    기존 DB 유지 (권장)
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => onRowSelect(row)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-700 text-white text-[11px] font-semibold transition"
                                >
                                  <Search size={11} /> 주소검색 수정
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : isAddrModified ? (
                          <div className="p-2.5 rounded-xl bg-white border border-amber-300 space-y-1.5 shadow-2xs">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-[11px] font-bold text-amber-900 bg-amber-200/85 px-2 py-0.5 rounded-md">
                                ⚠️ 기존 주소와 다름 · 확인 필요
                              </span>
                              {row._aiNote && (
                                <span className="text-[11px] font-semibold text-rose-600 bg-rose-50 ring-1 ring-inset ring-rose-500/15 px-1.5 py-0.5 rounded-md">
                                  {row._aiNote}
                                </span>
                              )}
                            </div>

                            {row._prevDbInfo?.address && (
                              <div className="text-xs text-slate-500">
                                <strong className="text-slate-600 mr-1">
                                  기존 DB {prevZip ? `(${prevZip})` : ''}:
                                </strong>
                                <span className="line-through">
                                  {row._prevDbInfo.address} {row._prevDbInfo.detail_address}
                                </span>
                              </div>
                            )}

                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="font-semibold text-slate-900">
                                <span className="text-xs font-bold text-amber-700 mr-1">
                                  새 주소:
                                </span>
                                {row.address}
                              </div>

                              {onConfirmAddressField && (
                                <div
                                  className="flex items-center gap-1.5 shrink-0"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <button
                                    type="button"
                                    onClick={() => onConfirmAddressField(row._tempId, false)}
                                    className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-700 text-white text-[11px] font-semibold transition"
                                  >
                                    새 주소로 변경
                                  </button>
                                  {row._prevDbInfo?.address && (
                                    <button
                                      type="button"
                                      onClick={() => onConfirmAddressField(row._tempId, true)}
                                      className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-semibold transition"
                                    >
                                      기존 DB 유지
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        ) : row._addressPending === 'PHOTO' ? (
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span>{row.address}</span>
                              <span className="text-[11px] text-amber-700 bg-amber-50 ring-1 ring-inset ring-amber-600/20 px-1.5 py-0.5 rounded-md font-medium">
                                사진주소
                              </span>
                            </div>
                            {onConfirmAddressField && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onConfirmAddressField(row._tempId, false);
                                }}
                                className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-700 text-white text-[11px] font-medium transition shrink-0"
                              >
                                확인
                              </button>
                            )}
                          </div>
                        ) : row._addressPending === 'NEW' ? (
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-medium">{row.address}</span>
                              <span className="text-[11px] text-blue-700 bg-blue-50 ring-1 ring-inset ring-blue-600/20 px-1.5 py-0.5 rounded-md font-medium">
                                신규
                              </span>
                              {row._aiNote && (
                                <span className="text-[11px] font-medium text-rose-600 bg-rose-50 ring-1 ring-inset ring-rose-500/15 px-1.5 py-0.5 rounded-md">
                                  {row._aiNote}
                                </span>
                              )}
                            </div>
                            {onConfirmAddressField && row.address.trim() && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onConfirmAddressField(row._tempId, false);
                                }}
                                className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-700 text-white text-[11px] font-medium transition shrink-0"
                              >
                                확인
                              </button>
                            )}
                          </div>
                        ) : row._addressPending === 'NEW_PHOTO' || !row.address.trim() ? (
                          <span className="text-amber-600 text-xs font-medium">
                            사진 전송 · 주소 직접 입력 필요
                          </span>
                        ) : (
                          <span>{row.address}</span>
                        )}
                      </td>

                      <td className="px-3 py-3.5 text-slate-600 break-keep leading-relaxed">
                        {row.detail_address || <span className="text-slate-300">-</span>}
                      </td>

                      {isGripMode && (
                        <td
                          className="px-3 py-3.5 text-xs break-keep leading-relaxed"
                          title={fullProductsTooltip}
                        >
                          {row.item_memo ? (
                            <span className="inline-block text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md font-medium">
                              {row.item_memo}
                            </span>
                          ) : (
                            <span className="text-slate-300">-</span>
                          )}
                        </td>
                      )}

                      <td className="px-2.5 py-3.5 text-center whitespace-nowrap">
                        {missingZip ? (
                          <span
                            className="inline-flex w-5 h-5 items-center justify-center rounded-full bg-rose-100 text-rose-600 font-bold text-xs"
                            title="우편번호 미검색 오류"
                          >
                            !
                          </span>
                        ) : !pending && row.address.trim() && row.name.trim() ? (
                          <span className="inline-flex w-5 h-5 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                            <Check size={12} strokeWidth={2.6} />
                          </span>
                        ) : (
                          <span
                            className="inline-block w-2 h-2 rounded-full bg-amber-500"
                            title="확인 대기"
                          />
                        )}
                      </td>

                      <td
                        className="px-3 py-3.5 text-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => onRowDelete([row._tempId])}
                          className="p-1 text-slate-300 opacity-60 group-hover:opacity-100 hover:text-rose-500 hover:bg-rose-50 rounded-md transition"
                          title="삭제"
                        >
                          <X size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 하단 출력 푸터 (한진 Focus 로그인 바로가기 + 엑셀 출력 나란히 배치) */}
          <div className="px-4 sm:px-6 py-3.5 sm:py-4 bg-slate-50/70 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="hidden md:block">
              {checkedIds.size > 0 && (
                <button
                  type="button"
                  onClick={() => onRowDelete(Array.from(checkedIds))}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 px-3 py-2 rounded-xl transition"
                >
                  <Trash2 size={13} />
                  선택 삭제 ({checkedIds.size})
                </button>
              )}
            </div>

            <div className="w-full sm:w-auto flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-3">
              <div className="text-xs text-slate-500 tabular-nums text-center sm:text-right">
                출력 가능 <strong className="text-slate-900">{stats.exportReady}</strong> /{' '}
                {rows.length}건
                {stats.missingZipCount > 0 && (
                  <span className="ml-2 text-rose-600 font-bold">
                    · 🚨 우편번호없음 {stats.missingZipCount}건
                  </span>
                )}
                {stats.pendingCount > 0 && (
                  <span className="ml-2 text-amber-600 font-medium">
                    · 미확인 {stats.pendingCount}건
                  </span>
                )}
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <button
                  type="button"
                  onClick={onExport}
                  disabled={isExporting || rows.length === 0}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold py-3 sm:py-2.5 px-5 rounded-xl shadow-xs transition text-[14px] sm:text-[13px]"
                >
                  <Download size={15} />
                  {isExporting ? '내보내는 중...' : `저장 및 엑셀 출력 (${stats.exportReady})`}
                </button>

                <a
                  href="https://focus.hanjin.com/login"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 bg-white hover:bg-sky-50 text-sky-700 border border-sky-200 font-semibold py-2.5 px-4 rounded-xl shadow-2xs transition text-[13px] whitespace-nowrap"
                >
                  <span>한진 Focus 로그인</span>
                  <ExternalLink size={14} />
                </a>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
