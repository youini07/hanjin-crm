import { useState, useMemo } from 'react';
import { Check, Trash2, Download, X, Inbox } from 'lucide-react';
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

type FilterTab = 'ALL' | 'PENDING' | 'MODIFIED' | 'PHOTO' | 'NEW';

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
    <section className="bg-white rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(15,23,42,0.03)] overflow-hidden">
      {/* 모던 화이트 카드 헤더 & 인라인 필터 컨트롤 */}
      <div className="px-6 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-[15px] text-slate-900">배송 대기 목록</h2>
            <span className="text-xs font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md tabular-nums">
              {rows.length}
            </span>
          </div>

          {/* 필터 알약 탭 */}
          {!isGripMode && rows.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 bg-slate-100/80 p-1 rounded-xl">
              {[
                { id: 'ALL' as FilterTab, label: '전체', count: rows.length, show: true },
                {
                  id: 'PENDING' as FilterTab,
                  label: '미확인',
                  count: stats.pendingCount,
                  show: stats.pendingCount > 0,
                },
                {
                  id: 'MODIFIED' as FilterTab,
                  label: '변경',
                  count: stats.modifiedCount,
                  show: stats.modifiedCount > 0,
                },
                {
                  id: 'PHOTO' as FilterTab,
                  label: '사진',
                  count: stats.photoCount,
                  show: stats.photoCount > 0,
                },
                {
                  id: 'NEW' as FilterTab,
                  label: '신규',
                  count: stats.newCount,
                  show: stats.newCount > 0,
                },
              ]
                .filter((t) => t.show)
                .map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setFilterTab(tab.id)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition tabular-nums ${
                      filterTab === tab.id
                        ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    {tab.label}{' '}
                    <span
                      className={
                        filterTab === tab.id ? 'text-indigo-600 ml-0.5' : 'text-slate-400 ml-0.5'
                      }
                    >
                      {tab.count}
                    </span>
                  </button>
                ))}
            </div>
          )}
        </div>

        {/* 우측 일괄 승인 버튼 */}
        {!isGripMode && rows.length > 0 && (
          <div className="flex items-center gap-2">
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
                      `미확인 항목 ${stats.bulkConfirmableIds.length}건을 모두 확인 완료할까요?`
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
        <div className="py-20 text-center">
          <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3">
            <Inbox size={22} />
          </div>
          <p className="text-[14px] font-medium text-slate-600">등록된 송장 목록이 없습니다</p>
          <p className="text-xs text-slate-400 mt-1">
            {isGripMode
              ? '상단에서 그립 판매내역서 파일을 업로드해주세요'
              : '상단에 카카오톡 대화를 붙여넣고 AI 분석을 실행해보세요'}
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
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
                      isGripMode ? 'min-w-[260px] w-[35%]' : 'min-w-[320px] w-[42%]'
                    }`}
                  >
                    기본주소
                  </th>
                  <th
                    className={`px-3 py-2.5 text-left text-[11px] font-medium ${
                      isGripMode ? 'min-w-[180px] w-[22%]' : 'min-w-[200px] w-[25%]'
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
                      className={`group cursor-pointer transition-colors ${
                        isActive
                          ? 'bg-indigo-50/40'
                          : 'hover:bg-slate-50/70'
                      }`}
                    >
                      {/* 체크박스 */}
                      <td
                        className="px-4 py-3.5 text-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={checkedIds.has(row._tempId)}
                          onChange={() => onCheckToggle(row._tempId)}
                          className="rounded border-slate-300 text-slate-900 focus:ring-slate-900/20"
                        />
                      </td>

                      {/* 번호 */}
                      <td className="px-2 py-3.5 text-slate-400 font-mono text-xs tabular-nums">
                        {originalIndex + 1}
                      </td>

                      {/* ─────────────────────────────────────────────
                          [고객명 셀] 이름만 변경된 경우 전/후 비교 + [수정]
                         ───────────────────────────────────────────── */}
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
                                      className="px-1.5 py-0.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-[11px] transition"
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
                              <span className="text-rose-500 text-xs">미입력</span>
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
                          className={`w-12 h-7 text-center rounded-lg border text-xs tabular-nums transition focus:outline-none focus:border-slate-900 ${
                            (row.quantity || 1) >= 2
                              ? 'border-indigo-200 bg-indigo-50/70 text-indigo-700 font-bold'
                              : 'border-slate-200/80 bg-transparent hover:bg-white text-slate-600'
                          }`}
                        />
                      </td>

                      {/* 연락처 */}
                      <td className="px-3 py-3.5 text-slate-500 font-mono text-xs tabular-nums whitespace-nowrap">
                        {formatPhone(row.phone)}
                      </td>

                      {/* 우편번호 */}
                      <td className="px-3 py-3.5 text-slate-500 font-mono text-xs tabular-nums whitespace-nowrap">
                        {safeZip || <span className="text-slate-300">-</span>}
                      </td>

                      {/* ─────────────────────────────────────────────
                          [기본주소 셀] 바뀐 경우만 인라인 비교 & 미니멀 버튼
                         ───────────────────────────────────────────── */}
                      <td className="px-3 py-3.5 text-slate-800 break-keep leading-relaxed">
                        {row._addressPending === 'MODIFIED' ? (
                          <div className="space-y-1">
                            {row._prevDbInfo?.address && (
                              <div className="text-[11px] text-slate-400 line-through">
                                {row._prevDbInfo.address} {row._prevDbInfo.detail_address}
                              </div>
                            )}
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="font-medium text-indigo-700">
                                {row.address}
                                {row._aiNote && (
                                  <span className="ml-1.5 text-[11px] font-medium text-rose-600 bg-rose-50 ring-1 ring-inset ring-rose-500/15 px-1.5 py-0.5 rounded-md">
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
                                    className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-700 text-white text-[11px] font-medium transition"
                                  >
                                    수정
                                  </button>
                                  {row._prevDbInfo?.address && (
                                    <button
                                      type="button"
                                      onClick={() => onConfirmAddressField(row._tempId, true)}
                                      className="px-2 py-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-[11px] transition"
                                    >
                                      유지
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
                          <span className="text-amber-600 text-xs">
                            사진 전송 · 주소 직접 입력 필요
                          </span>
                        ) : (
                          <span>{row.address}</span>
                        )}
                      </td>

                      {/* 상세주소 */}
                      <td className="px-3 py-3.5 text-slate-600 break-keep leading-relaxed">
                        {row.detail_address || <span className="text-slate-300">-</span>}
                      </td>

                      {/* 그립 구매상품 */}
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

                      {/* 미니멀 확인 상태 */}
                      <td className="px-2.5 py-3.5 text-center whitespace-nowrap">
                        {!pending && row.address.trim() && row.name.trim() ? (
                          <span className="inline-flex w-5 h-5 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                            <Check size={12} strokeWidth={2.6} />
                          </span>
                        ) : (
                          <span
                            className="inline-block w-2 h-2 rounded-full bg-amber-400"
                            title="확인 대기"
                          />
                        )}
                      </td>

                      {/* 삭제 (호버 시 선명해짐) */}
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

          {/* 미니멀 하단 푸터 */}
          <div className="px-6 py-4 bg-slate-50/50 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <div>
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

            <div className="flex items-center gap-4">
              <div className="text-xs text-slate-500 tabular-nums">
                출력 가능 <strong className="text-slate-900">{stats.exportReady}</strong> /{' '}
                {rows.length}건
                {stats.pendingCount > 0 && (
                  <span className="ml-2 text-amber-600 font-medium">
                    · 미확인 {stats.pendingCount}건
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={onExport}
                disabled={isExporting || rows.length === 0}
                className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold py-2.5 px-5 rounded-xl shadow-xs transition text-[13px]"
              >
                <Download size={15} />
                {isExporting ? '내보내는 중...' : `저장 및 엑셀 출력 (${stats.exportReady})`}
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
