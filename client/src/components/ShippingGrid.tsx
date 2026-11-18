import { useState, useMemo } from 'react';
import { CheckCircle2, Trash2, FileSpreadsheet, Check, X } from 'lucide-react';
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
  /** 이름 칸이 변경되어 [수정] 버튼 확인이 필요한지 여부 */
  _namePending?: boolean;
  /** 주소 칸 확인/수정이 필요한 유형 ('MODIFIED': 주소변경 [수정] / 'PHOTO': 사진전송 [확인] / 'NEW': 신규 [확인]) */
  _addressPending?: AddressPendingType;
  /** 전체 행 확인 완료 여부 */
  _isConfirmed?: boolean;
  /** 오타 보정 등 주소 주의 표시 */
  _needsAddressCheck?: boolean;
  _aiNote?: string;
  _chatNameHint?: string;
  /** UI에 표시하지 않고 백그라운드로 구글 시트 F열에 저장할 최신 페이스북 아이디 */
  _fbName?: string;
  _fbUpdated?: boolean;
  /** 변경 전 기존 DB 데이터 */
  _prevDbInfo?: PrevDbCustomerInfo;
  /** 그립 전용 필드 */
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

type FilterTab = 'ALL' | 'PENDING' | 'MODIFIED' | 'PHOTO' | 'NEW';

interface ShippingGridProps {
  mode?: 'kakao' | 'grip';
  rows: GridRow[];
  activeRowId: string | null;
  onRowSelect: (row: GridRow) => void;
  onRowDelete: (tempIds: string[]) => void;
  /** 이름 칸 단독 [수정] 승인 또는 [유지] 되돌리기 */
  onConfirmNameField?: (tempId: string, keepOldDb?: boolean) => void;
  /** 주소 칸 단독 [수정]/[확인] 승인 또는 [유지] 되돌리기 */
  onConfirmAddressField?: (tempId: string, keepOldDb?: boolean) => void;
  /** 여러 행 한꺼번에 전체 확인 처리 */
  onConfirmRows?: (tempIds: string[]) => void;
  onExport: () => void;
  isExporting: boolean;
  checkedIds: Set<string>;
  onCheckToggle: (tempId: string) => void;
  onCheckAll: () => void;
  onQuantityChange: (tempId: string, quantity: number) => void;
}

/** 전화번호 하이픈 포맷팅 */
const formatPhone = (phone: string): string => {
  if (!phone) return '';
  const digits = phone.replace(/[^0-9]/g, '');
  if (digits.length === 11)
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.length === 10)
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return phone;
};

/** 행에 아직 누르지 않은 [수정] 또는 [확인] 버튼이 남아 있는지 판별 */
const hasPendingAction = (row: GridRow): boolean => {
  return Boolean(row._namePending || row._addressPending || row._isConfirmed === false);
};

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
    const exportReady = rows.filter(
      (r) => r.name.trim() && r.phone.trim() && r.address.trim() && !hasPendingAction(r)
    ).length;
    const pendingRows = rows.filter((r) => hasPendingAction(r));
    const bulkConfirmableIds = pendingRows
      .filter((r) => r.name.trim() && r.address.trim())
      .map((r) => r._tempId);
    const modifiedCount = rows.filter(
      (r) => r._namePending || r._addressPending === 'MODIFIED'
    ).length;
    const photoCount = rows.filter(
      (r) => r._addressPending === 'PHOTO' || r._addressPending === 'NEW_PHOTO'
    ).length;
    const newCount = rows.filter((r) => r._addressPending === 'NEW' || r._isNew).length;

    return {
      exportReady,
      pendingCount: pendingRows.length,
      bulkConfirmableIds,
      modifiedCount,
      photoCount,
      newCount,
    };
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (isGripMode || filterTab === 'ALL') return rows;
    return rows.filter((r) => {
      if (filterTab === 'PENDING') return hasPendingAction(r);
      if (filterTab === 'MODIFIED') return Boolean(r._namePending || r._addressPending === 'MODIFIED');
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
            r.address.trim()
        )
        .map((r) => r._tempId),
    [rows, checkedIds]
  );

  return (
    <div className="bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden">
      {/* 심플 헤더 */}
      <div className="px-5 py-3.5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <FileSpreadsheet size={19} />
          <span className="font-bold text-sm">
            {isGripMode ? '그립 배송 데이터 확인' : '배송 목록 확인'}
          </span>
          <span className="bg-white/20 text-xs font-bold px-2.5 py-0.5 rounded-full">
            {rows.length}건
          </span>
        </div>

        {!isGripMode && stats.pendingCount > 0 && (
          <span className="text-xs font-semibold bg-white/20 px-3 py-1 rounded-full">
            확인 대기 {stats.pendingCount}건
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="py-16 text-center text-slate-400">
          <FileSpreadsheet size={38} className="mx-auto mb-3 text-slate-300" />
          <p className="text-sm font-medium">아직 데이터가 없습니다</p>
          <p className="text-xs mt-1">
            {isGripMode
              ? '위에서 그립 판매내역서 엑셀 파일을 업로드하거나 붙여넣으세요'
              : '위에서 카카오톡 대화를 붙여넣고 [AI 스마트 분석]을 눌러주세요'}
          </p>
        </div>
      ) : (
        <>
          {/* 간결한 필터 탭 & 일괄 승인 버튼 */}
          {!isGripMode && (
            <div className="px-5 py-2.5 bg-slate-50/70 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {[
                  { id: 'ALL' as FilterTab, label: `전체 ${rows.length}`, show: true },
                  {
                    id: 'PENDING' as FilterTab,
                    label: `미확인 ${stats.pendingCount}`,
                    show: stats.pendingCount > 0,
                  },
                  {
                    id: 'MODIFIED' as FilterTab,
                    label: `수정 ${stats.modifiedCount}`,
                    show: stats.modifiedCount > 0,
                  },
                  {
                    id: 'PHOTO' as FilterTab,
                    label: `사진확인 ${stats.photoCount}`,
                    show: stats.photoCount > 0,
                  },
                  {
                    id: 'NEW' as FilterTab,
                    label: `신규 ${stats.newCount}`,
                    show: stats.newCount > 0,
                  },
                ]
                  .filter((t) => t.show)
                  .map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setFilterTab(tab.id)}
                      className={`text-xs px-3 py-1 rounded-lg font-semibold transition ${
                        filterTab === tab.id
                          ? 'bg-slate-800 text-white'
                          : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
              </div>

              <div className="flex items-center gap-2">
                {onConfirmRows && checkedConfirmableIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onConfirmRows(checkedConfirmableIds)}
                    className="inline-flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition"
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
                          `주소가 입력된 미확인 항목 ${stats.bulkConfirmableIds.length}건을 모두 확인 완료할까요?`
                        )
                      ) {
                        onConfirmRows(stats.bulkConfirmableIds);
                      }
                    }}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-3 py-1.5 rounded-lg transition"
                  >
                    <Check size={13} /> 미확인 일괄 승인 ({stats.bulkConfirmableIds.length})
                  </button>
                )}
              </div>
            </div>
          )}

          {/* 깔끔한 테이블 (바뀐 셀에만 전/후 비교 및 버튼 노출) */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50/60 border-b border-slate-200 text-slate-500">
                  <th className="w-10 px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={checkedIds.size === rows.length && rows.length > 0}
                      onChange={onCheckAll}
                      className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                  </th>
                  <th className="px-2 py-2.5 text-left text-xs font-semibold w-9">#</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold whitespace-nowrap min-w-[140px]">
                    이름
                  </th>
                  <th className="px-2 py-2.5 text-center text-xs font-semibold w-16 whitespace-nowrap">
                    수량
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold whitespace-nowrap">
                    전화번호
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold whitespace-nowrap">
                    우편번호
                  </th>
                  <th
                    className={`px-3 py-2.5 text-left text-xs font-semibold text-slate-600 ${
                      isGripMode ? 'min-w-[260px] w-[35%]' : 'min-w-[320px] w-[42%]'
                    }`}
                  >
                    주소
                  </th>
                  <th
                    className={`px-3 py-2.5 text-left text-xs font-semibold text-slate-600 ${
                      isGripMode ? 'min-w-[180px] w-[22%]' : 'min-w-[200px] w-[25%]'
                    }`}
                  >
                    상세주소
                  </th>
                  {isGripMode && (
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-emerald-700 min-w-[180px] w-[20%]">
                      구매상품 (H열)
                    </th>
                  )}
                  <th className="px-2.5 py-2.5 text-center text-xs font-semibold w-14 whitespace-nowrap">
                    상태
                  </th>
                  <th className="px-2 py-2.5 w-8"></th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {filteredRows.map((row) => {
                  const originalIndex = rows.findIndex((r) => r._tempId === row._tempId);
                  const isActive = activeRowId === row._tempId;
                  const pending = hasPendingAction(row);
                  const safeZip = normalizeClientZipcode(row.zipcode);

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
                      className={`cursor-pointer transition-colors ${
                        isActive
                          ? 'bg-blue-50/70 ring-1 ring-inset ring-blue-400'
                          : pending
                            ? 'bg-amber-50/20 hover:bg-slate-50'
                            : 'hover:bg-slate-50/80'
                      }`}
                    >
                      {/* 체크박스 */}
                      <td
                        className="px-3 py-3 text-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={checkedIds.has(row._tempId)}
                          onChange={() => onCheckToggle(row._tempId)}
                          className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                        />
                      </td>

                      {/* 순번 */}
                      <td className="px-2 py-3 text-slate-400 font-mono text-xs">
                        {originalIndex + 1}
                      </td>

                      {/* ─────────────────────────────────────────────
                          [이름 칸] 이름이 바뀐 경우에만 기존->새이름 + [수정] 버튼 노출
                         ───────────────────────────────────────────── */}
                      <td className="px-3 py-3 text-slate-800">
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
                              <span className="font-bold text-indigo-700">{row.name}</span>
                              {onConfirmNameField && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => onConfirmNameField(row._tempId, false)}
                                    className="px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-semibold transition"
                                  >
                                    수정
                                  </button>
                                  {row._prevDbInfo?.name && (
                                    <button
                                      type="button"
                                      onClick={() => onConfirmNameField(row._tempId, true)}
                                      className="px-1.5 py-0.5 rounded text-slate-500 hover:text-slate-700 hover:bg-slate-100 text-[11px] transition"
                                      title="기존 이름 유지"
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
                              <span className="text-red-400 text-xs">미입력</span>
                            )}
                          </div>
                        )}

                        {isGripMode && row.order_number && (
                          <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                            #{row.order_number}
                          </div>
                        )}
                      </td>

                      {/* 수량 */}
                      <td
                        className="px-2 py-3 text-center text-xs"
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
                          className={`w-13 text-center rounded-md border py-1 px-1 bg-white ${
                            (row.quantity || 1) >= 2
                              ? 'border-amber-400 bg-amber-50 text-amber-800 font-bold'
                              : 'border-slate-200 text-slate-700'
                          }`}
                        />
                      </td>

                      {/* 전화번호 */}
                      <td className="px-3 py-3 text-slate-600 font-mono text-xs whitespace-nowrap">
                        {formatPhone(row.phone)}
                      </td>

                      {/* 우편번호 */}
                      <td className="px-3 py-3 text-slate-600 font-mono text-xs whitespace-nowrap">
                        {safeZip || <span className="text-slate-300">-</span>}
                      </td>

                      {/* ─────────────────────────────────────────────
                          [주소 칸] 주소 변경 / 사진 확인 / 신규 확인이 필요한 경우에만 인라인 버튼 노출
                         ───────────────────────────────────────────── */}
                      <td className="px-3 py-3 text-slate-700 text-[13px] break-keep leading-relaxed">
                        {row._addressPending === 'MODIFIED' ? (
                          /* 1) 주소가 바뀐 경우: 기존 주소(회색 취소선) -> 새 주소 + [수정] 버튼 */
                          <div className="space-y-1">
                            {row._prevDbInfo?.address && (
                              <div className="text-[11px] text-slate-400 line-through">
                                {row._prevDbInfo.address} {row._prevDbInfo.detail_address}
                              </div>
                            )}
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="font-semibold text-indigo-800">
                                {row.address}
                                {row._aiNote && (
                                  <span className="ml-1.5 text-[11px] font-medium text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded">
                                    {row._aiNote}
                                  </span>
                                )}
                              </div>
                              {onConfirmAddressField && (
                                <div
                                  className="flex items-center gap-1 shrink-0"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <button
                                    type="button"
                                    onClick={() => onConfirmAddressField(row._tempId, false)}
                                    className="px-2.5 py-1 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold transition"
                                  >
                                    수정
                                  </button>
                                  {row._prevDbInfo?.address && (
                                    <button
                                      type="button"
                                      onClick={() => onConfirmAddressField(row._tempId, true)}
                                      className="px-2 py-1 rounded-md text-slate-500 hover:text-slate-700 hover:bg-slate-100 text-xs transition"
                                      title="기존 DB 주소로 유지"
                                    >
                                      유지
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        ) : row._addressPending === 'PHOTO' ? (
                          /* 2) 사진 주소 & 기존 DB 있음: 기존 DB 주소를 그대로 보여주고 [확인] 버튼만 배치 */
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <span>{row.address}</span>
                              <span className="ml-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded font-medium">
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
                                className="px-2.5 py-1 rounded-md bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold transition shrink-0"
                              >
                                확인
                              </button>
                            )}
                          </div>
                        ) : row._addressPending === 'NEW' ? (
                          /* 3) 신규 고객(텍스트 주소 있음): 새 주소 + [확인] 버튼 */
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <span className="font-medium text-slate-800">{row.address}</span>
                              <span className="ml-2 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded font-medium">
                                신규
                              </span>
                              {row._aiNote && (
                                <span className="ml-1.5 text-[11px] font-medium text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded">
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
                                className="px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition shrink-0"
                              >
                                확인
                              </button>
                            )}
                          </div>
                        ) : row._addressPending === 'NEW_PHOTO' || !row.address.trim() ? (
                          /* 4) 기존 DB도 없는 완전 신규 사진 주문: 클릭해서 입력 유도 */
                          <span className="text-amber-600 text-xs font-medium">
                            사진 전송 (기존 DB 없음 — 클릭하여 주소 입력)
                          </span>
                        ) : (
                          /* 5) 변경 없거나 이미 확인 완료된 주소: 군더더기 없이 주소만 깔끔하게 표시 */
                          <span>{row.address}</span>
                        )}
                      </td>

                      {/* 상세주소 */}
                      <td className="px-3 py-3 text-slate-700 text-[13px] break-keep leading-relaxed">
                        {row.detail_address || <span className="text-slate-300">-</span>}
                      </td>

                      {/* 그립 전용 구매상품 */}
                      {isGripMode && (
                        <td
                          className="px-3 py-3 text-xs break-keep leading-relaxed"
                          title={fullProductsTooltip}
                        >
                          {row.item_memo ? (
                            <span className="inline-block text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded font-medium">
                              {row.item_memo}
                            </span>
                          ) : (
                            <span className="text-slate-300">-</span>
                          )}
                        </td>
                      )}

                      {/* 심플 상태 표시 */}
                      <td className="px-2.5 py-3 text-center whitespace-nowrap">
                        {!pending && row.address.trim() && row.name.trim() ? (
                          <CheckCircle2 size={16} className="inline text-emerald-500" />
                        ) : (
                          <span className="inline-block w-2 h-2 rounded-full bg-amber-400" title="확인 대기" />
                        )}
                      </td>

                      {/* 행 삭제 */}
                      <td
                        className="px-2 py-3 text-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => onRowDelete([row._tempId])}
                          className="p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded transition"
                          title="목록에서 제거"
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

          {/* 하단 액션 바 */}
          <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div>
              {checkedIds.size > 0 && (
                <button
                  type="button"
                  onClick={() => onRowDelete(Array.from(checkedIds))}
                  className="flex items-center gap-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 px-3 py-2 rounded-lg transition"
                >
                  <Trash2 size={13} />
                  선택 삭제 ({checkedIds.size})
                </button>
              )}
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-500">
                준비 완료: <strong className="text-emerald-600">{stats.exportReady}</strong>/
                {rows.length}건
                {stats.pendingCount > 0 && (
                  <span className="ml-1.5 text-amber-600 font-semibold">
                    (미확인 {stats.pendingCount}건)
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={onExport}
                disabled={isExporting || rows.length === 0}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-bold py-2.5 px-5 rounded-xl shadow-md shadow-emerald-200 transition text-sm"
              >
                <FileSpreadsheet size={16} />
                {isExporting ? '처리 중...' : `저장 & 엑셀 내보내기 (${stats.exportReady}건)`}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
