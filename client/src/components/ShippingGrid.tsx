import { CheckCircle, AlertTriangle, Trash2, FileSpreadsheet, UserPlus, X } from 'lucide-react';

/**
 * ShippingGrid - 읽기 전용 인라인 엑셀 그리드 컴포넌트
 *
 * 동작 방식:
 * 1. 행을 클릭하면 → 상단 폼에 해당 행 데이터가 채워짐
 * 2. 폼에서 수정 후 → [그리드 수정] 버튼 클릭으로 반영
 * 3. 그리드 셀은 직접 편집 불가 (읽기 전용)
 */

/** 그리드에 표시되는 고객 행 데이터 타입 */
export interface GridRow {
  _tempId: string;
  _isNew: boolean;
  _isSelected: boolean;
  _isDirty: boolean;
  name: string;
  phone: string;
  zipcode: string;
  address: string;
  detail_address: string;
}

interface ShippingGridProps {
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
}

/** 전화번호 포맷팅 */
const formatPhone = (phone: string): string => {
  if (!phone) return '';
  const digits = phone.replace(/[^0-9]/g, '');
  if (digits.length === 11) return `${digits.slice(0,3)}-${digits.slice(3,7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `${digits.slice(0,3)}-${digits.slice(3,6)}-${digits.slice(6)}`;
  return phone;
};

/** 주소 축약 */
const truncateAddress = (addr: string, maxLen: number = 25): string => {
  if (!addr) return '';
  return addr.length > maxLen ? addr.slice(0, maxLen) + '…' : addr;
};

export default function ShippingGrid({
  rows,
  activeRowId,
  onRowSelect,
  onRowDelete,
  onExport,
  isExporting,
  checkedIds,
  onCheckToggle,
  onCheckAll,
}: ShippingGridProps) {
  const validCount = rows.filter(r => r.name && r.phone).length;
  const newCount = rows.filter(r => r._isNew).length;
  const dirtyCount = rows.filter(r => r._isDirty).length;
  const hasIncomplete = rows.some(r => r.phone && !r.name);

  return (
    <div className="bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden">
      {/* 헤더 */}
      <div className="px-5 py-3.5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <FileSpreadsheet size={20} />
          <span className="font-bold text-sm">배송 데이터 확인</span>
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
            <span className="flex items-center gap-1 text-yellow-200">
              ✏️ 수정 {dirtyCount}
            </span>
          )}
        </div>
      </div>

      {/* 빈 상태 */}
      {rows.length === 0 ? (
        <div className="py-16 text-center text-slate-400">
          <FileSpreadsheet size={40} className="mx-auto mb-3 text-slate-300" />
          <p className="text-sm font-medium">아직 데이터가 없습니다</p>
          <p className="text-xs mt-1">위에서 카카오톡 텍스트를 붙여넣거나, 폼에서 직접 입력하세요</p>
        </div>
      ) : (
        <>
          {/* 미입력 경고 */}
          {hasIncomplete && (
            <div className="mx-4 mt-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-center gap-2 text-xs text-amber-700">
              <AlertTriangle size={14} />
              <span className="font-medium">이름이 비어있는 행이 있습니다. 행을 클릭 → 위 폼에서 정보를 입력해주세요.</span>
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
                  <th className="px-3 py-2.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider w-10">#</th>
                  <th className="px-3 py-2.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">이름</th>
                  <th className="px-3 py-2.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">전화번호</th>
                  <th className="px-3 py-2.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">우편번호</th>
                  <th className="px-3 py-2.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">주소</th>
                  <th className="px-3 py-2.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">상세주소</th>
                  <th className="px-3 py-2.5 text-center text-xs font-bold text-slate-500 uppercase tracking-wider w-16">상태</th>
                  <th className="px-1 py-2.5 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row, index) => {
                  const isActive = activeRowId === row._tempId;
                  const isIncomplete = row.phone && !row.name;

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
                      <td className="px-3 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={checkedIds.has(row._tempId)}
                          onChange={() => onCheckToggle(row._tempId)}
                          className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                        />
                      </td>
                      <td className="px-3 py-2.5 text-slate-400 font-mono text-xs">{index + 1}</td>
                      <td className="px-3 py-2.5 font-medium text-slate-800">
                        {row.name || <span className="text-red-400 text-xs italic">미입력</span>}
                      </td>
                      <td className="px-3 py-2.5 text-slate-600 font-mono text-xs">
                        {formatPhone(row.phone)}
                      </td>
                      <td className="px-3 py-2.5 text-slate-600 font-mono text-xs">
                        {row.zipcode || <span className="text-slate-300">-</span>}
                      </td>
                      <td className="px-3 py-2.5 text-slate-600 text-xs" title={row.address}>
                        {truncateAddress(row.address) || <span className="text-slate-300">-</span>}
                      </td>
                      <td className="px-3 py-2.5 text-slate-600 text-xs" title={row.detail_address}>
                        {truncateAddress(row.detail_address, 15) || <span className="text-slate-300">-</span>}
                      </td>
                      <td className="px-3 py-2.5 text-center">
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
                      {/* 행 제거 */}
                      <td className="px-1 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                        <button
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
                내보내기 가능: <strong className="text-emerald-600">{validCount}</strong>/{rows.length}건
              </span>
              <button
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
