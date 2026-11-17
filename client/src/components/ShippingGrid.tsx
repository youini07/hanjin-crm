import { CheckCircle, AlertTriangle, Trash2, FileSpreadsheet, UserPlus, X } from 'lucide-react';

/**
 * ShippingGrid - 배송지 데이터 확인 및 엑셀 내보내기 그리드 컴포넌트
 *
 * 왜 이렇게 설계했는가:
 * 1. 카카오톡 모드('kakao')에서는 그립 전용 컬럼(주문번호, H열 품목명)을 완전히 배제하여
 *    기존의 간결한 카카오톡 배송지 확인 표를 그대로 유지함.
 * 2. 기존에는 주소·상세주소를 일정 글자 수(14~25자)에서 '...'으로 강제 생략하여
 *    뒤쪽 동·호수를 확인하려면 매번 행을 클릭해야 하는 큰 불편이 있었음.
 *    이를 해결하기 위해 글자 수 말줄임 로직을 완전히 제거하고, 주소·상세주소 컬럼에 넓은 가로 폭과
 *    자연스러운 단어 줄바꿈(break-keep)을 적용해 클릭 없이 전체 주소를 한눈에 볼 수 있게 개선함.
 */

export interface GridRow {
  _tempId: string;
  _isNew: boolean;
  _isSelected: boolean;
  _isDirty: boolean;
  /** 그립 주문번호 (그립 페이지 전용) */
  order_number?: string;
  name: string;
  phone: string;
  zipcode: string;
  address: string;
  detail_address: string;
  /** 한진엑셀 H열에 기록될 구매상품 요약 (그립 페이지 전용) */
  item_memo?: string;
  /** 전체 구매상품 배열 (그립 툴팁 확인용) */
  products?: string[];
  quantity?: number;
}

interface ShippingGridProps {
  /** 페이지 모드 ('kakao': 기존 카카오톡 UI / 'grip': 그립 엑셀 전용 UI) */
  mode?: 'kakao' | 'grip';
  rows: GridRow[];
  /** 현재 선택(편집 중)인 행의 _tempId */
  activeRowId: string | null;
  /** 행 클릭 시 상단 폼에 데이터 로드 */
  onRowSelect: (row: GridRow) => void;
  /** 행 삭제 (송장 목록에서만 제거) */
  onRowDelete: (tempIds: string[]) => void;
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
  if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return phone;
};

export default function ShippingGrid({
  mode = 'kakao',
  rows,
  activeRowId,
  onRowSelect,
  onRowDelete,
  onExport,
  isExporting,
  checkedIds,
  onCheckToggle,
  onCheckAll,
  onQuantityChange,
}: ShippingGridProps) {
  const isGripMode = mode === 'grip';
  const validCount = rows.filter((r) => r.name && r.phone).length;
  const newCount = rows.filter((r) => r._isNew).length;
  const dirtyCount = rows.filter((r) => r._isDirty).length;
  const hasIncomplete = rows.some((r) => r.phone && !r.name);

  return (
    <div className="bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden">
      {/* 헤더 */}
      <div className="px-5 py-3.5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <FileSpreadsheet size={20} />
          <span className="font-bold text-sm">
            {isGripMode ? '그립 배송 데이터 확인' : '배송 데이터 확인'}
          </span>
          <span className="bg-white/20 text-xs font-bold px-2 py-0.5 rounded-full">
            {rows.length}건
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          {newCount > 0 && (
            <span className="flex items-center gap-1">
              <UserPlus size={13} /> 신규 {newCount}
            </span>
          )}
          {dirtyCount > 0 && (
            <span className="flex items-center gap-1 text-yellow-200">✏️ 수정 {dirtyCount}</span>
          )}
        </div>
      </div>

      {/* 빈 상태 */}
      {rows.length === 0 ? (
        <div className="py-16 text-center text-slate-400">
          <FileSpreadsheet size={40} className="mx-auto mb-3 text-slate-300" />
          <p className="text-sm font-medium">아직 데이터가 없습니다</p>
          <p className="text-xs mt-1">
            {isGripMode
              ? '위에서 그립(Grip) 판매내역서 엑셀 파일을 업로드하거나 시트를 붙여넣으세요'
              : '위에서 카카오톡 텍스트를 붙여넣거나, 폼에서 직접 입력하세요'}
          </p>
        </div>
      ) : (
        <>
          {/* 미입력 경고 */}
          {hasIncomplete && (
            <div className="mx-4 mt-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-center gap-2 text-xs text-amber-700">
              <AlertTriangle size={14} />
              <span className="font-medium">
                이름이 비어있는 행이 있습니다. 행을 클릭 → 위 폼에서 정보를 입력해주세요.
              </span>
            </div>
          )}

          {/* 안내 문구 */}
          <div className="mx-4 mt-3 mb-1 text-xs text-slate-400 text-center">
            💡 행을 클릭하면 위 입력 폼에 내용이 채워집니다. 폼에서 수정 후 [그리드 수정] 버튼을 누르세요.
          </div>

          {/* 테이블 */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="w-10 px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={checkedIds.size === rows.length && rows.length > 0}
                      onChange={onCheckAll}
                      className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                  </th>
                  <th className="px-2.5 py-2.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider w-10">
                    #
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    이름
                  </th>
                  <th className="px-2 py-2.5 text-center text-xs font-bold text-slate-500 uppercase tracking-wider w-16 whitespace-nowrap">
                    수량
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    전화번호
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    우편번호
                  </th>
                  <th
                    className={`px-3 py-2.5 text-left text-xs font-bold text-slate-600 uppercase tracking-wider ${
                      isGripMode ? 'min-w-[260px] w-[34%]' : 'min-w-[300px] w-[42%]'
                    }`}
                  >
                    주소
                  </th>
                  <th
                    className={`px-3 py-2.5 text-left text-xs font-bold text-slate-600 uppercase tracking-wider ${
                      isGripMode ? 'min-w-[190px] w-[22%]' : 'min-w-[220px] w-[28%]'
                    }`}
                  >
                    상세주소
                  </th>
                  {isGripMode && (
                    <th className="px-3 py-2.5 text-left text-xs font-bold text-emerald-700 uppercase tracking-wider min-w-[180px] w-[20%]">
                      구매상품 (H열)
                    </th>
                  )}
                  <th className="px-2.5 py-2.5 text-center text-xs font-bold text-slate-500 uppercase tracking-wider w-16 whitespace-nowrap">
                    상태
                  </th>
                  <th className="px-2 py-2.5 w-9"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row, index) => {
                  const isActive = activeRowId === row._tempId;
                  const isIncomplete = row.phone && !row.name;
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
                          ? 'bg-blue-50 ring-2 ring-inset ring-blue-400'
                          : isIncomplete
                            ? 'bg-red-50/50 hover:bg-red-50'
                            : 'hover:bg-slate-50'
                      }`}
                    >
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
                      <td className="px-2.5 py-3 text-slate-400 font-mono text-xs">
                        {index + 1}
                      </td>
                      <td className="px-3 py-3 font-medium text-slate-800 whitespace-nowrap">
                        <div>
                          {row.name || (
                            <span className="text-red-400 text-xs italic">미입력</span>
                          )}
                        </div>
                        {/* 그립 모드에서 주문번호가 있을 경우 가로 폭을 차지하지 않도록 이름 아래 작게 보조 표기 */}
                        {isGripMode && row.order_number && (
                          <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                            #{row.order_number}
                          </div>
                        )}
                      </td>
                      <td
                        className="px-2 py-3 text-center text-slate-700 font-bold text-xs"
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
                          className="w-14 text-center rounded border border-slate-300 focus:border-emerald-500 focus:ring-emerald-500 py-1 px-1 bg-white shadow-sm"
                        />
                      </td>
                      <td className="px-3 py-3 text-slate-600 font-mono text-xs whitespace-nowrap">
                        {formatPhone(row.phone)}
                      </td>
                      <td className="px-3 py-3 text-slate-600 font-mono text-xs whitespace-nowrap">
                        {row.zipcode || <span className="text-slate-300">-</span>}
                      </td>

                      {/* 주소: 말줄임(...) 없이 전체 주소 그대로 노출 */}
                      <td className="px-3 py-3 text-slate-700 text-xs sm:text-[13px] break-keep leading-relaxed">
                        {row.address || <span className="text-slate-300">-</span>}
                      </td>

                      {/* 상세주소: 말줄임(...) 없이 전체 상세주소 그대로 노출 */}
                      <td className="px-3 py-3 text-slate-700 text-xs sm:text-[13px] break-keep leading-relaxed">
                        {row.detail_address || <span className="text-slate-300">-</span>}
                      </td>

                      {/* 그립 전용 페이지에서만 구매상품 요약 표시 */}
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

                      <td className="px-2.5 py-3 text-center whitespace-nowrap">
                        {row._isNew ? (
                          <span className="inline-flex items-center text-xs font-bold text-orange-600 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-full">
                            신규
                          </span>
                        ) : row._isDirty ? (
                          <span className="inline-flex items-center text-xs font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                            수정
                          </span>
                        ) : (
                          <span className="inline-flex items-center text-xs text-emerald-500">
                            <CheckCircle size={14} />
                          </span>
                        )}
                      </td>

                      {/* 개별 행 삭제 */}
                      <td
                        className="px-2 py-3 text-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => onRowDelete([row._tempId])}
                          className="p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-md transition"
                          title="송장 목록에서 제거"
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
          <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
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
                내보내기 가능: <strong className="text-emerald-600">{validCount}</strong>/
                {rows.length}건
              </span>
              <button
                type="button"
                onClick={onExport}
                disabled={isExporting || validCount === 0}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-bold py-2.5 px-5 rounded-xl shadow-md shadow-emerald-200 transition text-sm"
              >
                <FileSpreadsheet size={16} />
                {isExporting ? '처리 중...' : `저장&내보내기 (${validCount}건)`}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
