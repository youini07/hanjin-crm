const ExcelJS = require('exceljs');
const { normalizeKoreanPhone, normalizeZipcode } = require('./utils/normalizer');

/**
 * CSV 한 줄을 파싱하는 헬퍼 함수 (큰따옴표 내부의 쉼표 보존)
 * 왜: 그립(Grip) 판매내역서의 주소 열에는 "경기 김포시 ... (마산동, 한강신도시 ...)" 처럼
 * 쉼표가 포함되어 있어 단순 split(',')을 사용하면 열이 밀리는 문제를 방지하기 위함.
 */
function parseCsvLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        const next = line[i + 1];

        if (ch === '"') {
            if (inQuotes && next === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += ch;
        }
    }
    result.push(current.trim());
    return result;
}

/**
 * 주소 문자열을 기본주소와 상세주소로 자연스럽게 분리
 * 왜: 그립 내역서는 한 열(Z열)에 전체 주소가 들어있어, 우리 입력 폼 구조(기본주소 / 상세주소)에 맞게
 * 도로명 주소의 괄호 닫힘 ')' 뒤쪽 동/호수를 상세주소로 분리해주면 수정이 편리함.
 */
function splitKoreanAddress(fullAddr) {
    const cleaned = String(fullAddr || '').trim().replace(/\s+/g, ' ');
    if (!cleaned) return { address: '', detail_address: '' };

    // 도로명 주소의 마지막 닫는 괄호 ')' 기준 분리 (예: "... (마산동, 반도유보라3차) 113-303")
    const lastParenIndex = cleaned.lastIndexOf(')');
    if (lastParenIndex !== -1 && lastParenIndex < cleaned.length - 1) {
        return {
            address: cleaned.slice(0, lastParenIndex + 1).trim(),
            detail_address: cleaned.slice(lastParenIndex + 1).trim()
        };
    }

    return { address: cleaned, detail_address: '' };
}

/**
 * 구매 상품 배열을 한진택배 H열(비고/품목명)용 텍스트로 요약
 * 왜: 텍스트가 너무 길어지면 송장 출력 시 잘리거나 가독성이 떨어지므로
 * 3개 이상일 경우 앞 상품명만 표기하고 '외 N개' 형태로 축약함.
 *
 * @param {string[]} products - 구매 상품명 배열
 * @param {number} visibleCount - 3개 이상일 때 앞에 노출할 상품 개수 (기본값: 2)
 */
function formatProductMemo(products, visibleCount = 2) {
    if (!products || products.length === 0) return '';
    if (products.length === 1) return products[0];
    if (products.length === 2) return `${products[0]}, ${products[1]}`;

    // 3개 이상일 경우: visibleCount개만 나열하고 '외 N개' 표기
    const safeVisible = Math.max(1, Math.min(visibleCount, products.length - 1));
    const shown = products.slice(0, safeVisible).join(', ');
    const remaining = products.length - safeVisible;
    return `${shown} 외 ${remaining}개`;
}

/**
 * 2차원 행 배열(헤더 포함)에서 그립 판매내역서 고객별 묶음 데이터 추출
 */
function groupGripRows(rawRows, visibleCount = 2) {
    if (!rawRows || rawRows.length < 2) {
        return [];
    }

    // 1행 헤더에서 컬럼 인덱스 탐색 (그립 기본 양식 인덱스 폴백 지원)
    const headers = rawRows[0].map(h => String(h || '').trim());
    const findIdx = (keywords, fallbackIdx) => {
        const idx = headers.findIndex(h => keywords.some(k => h === k || h.includes(k)));
        return idx !== -1 ? idx : fallbackIdx;
    };

    const idxOrderNo = findIdx(['주문번호'], 0);           // A열 (0)
    const idxOrderStatus = findIdx(['주문상태'], 3);       // D열 (3)
    const idxProductName = findIdx(['상품명'], 7);         // H열 (7)
    const idxQuantity = findIdx(['수량'], 10);             // K열 (10)
    const idxBuyerName = findIdx(['구매자 이름'], 20);     // U열 (20)
    const idxBuyerPhone = findIdx(['구매자 연락처'], 21);  // V열 (21)
    const idxRecName = findIdx(['수령인'], 22);            // W열 (22)
    const idxRecPhone = findIdx(['수령인 연락처'], 23);    // X열 (23)
    const idxZipcode = findIdx(['수령인 우편번호', '우편번호'], 24); // Y열 (24)
    const idxAddress = findIdx(['수령인 주소', '주소'], 25);         // Z열 (25)
    const idxDeliveryMsg = findIdx(['배송 메시지'], 26);   // AA열 (26)

    // 동일 고객 묶기용 Map (순서 보존)
    const groupedMap = new Map();

    for (let i = 1; i < rawRows.length; i++) {
        const row = rawRows[i];
        if (!row || row.length === 0) continue;

        const orderNo = String(row[idxOrderNo] ?? '').trim();
        const productName = String(row[idxProductName] ?? '').trim();
        const recName = String(row[idxRecName] || row[idxBuyerName] || '').trim();
        const rawPhone = String(row[idxRecPhone] || row[idxBuyerPhone] || '').trim();
        const normalizedPhone = normalizeKoreanPhone(rawPhone);
        const rawZip = String(row[idxZipcode] ?? '').trim();
        const zipcode = normalizeZipcode(rawZip);
        const fullAddr = String(row[idxAddress] ?? '').trim();
        const deliveryMsg = String(row[idxDeliveryMsg] ?? '').trim();
        const orderStatus = String(row[idxOrderStatus] ?? '').trim();
        const itemQty = parseInt(row[idxQuantity], 10) || 1;

        // 빈 행 스킵
        if (!orderNo && !normalizedPhone && !recName) continue;
        // 취소된 주문은 제외 (취소사유나 주문상태가 취소인 경우)
        if (orderStatus.includes('취소') || orderStatus.includes('환불')) continue;

        // 동일 고객 식별 키: 수령인 전화번호(정규화) + 수령인 이름 (전화번호가 없으면 주문번호 기준)
        const groupKey = normalizedPhone
            ? `${normalizedPhone}_${recName.replace(/\s+/g, '')}`
            : `order_${orderNo}`;

        const formattedProd = itemQty > 1 ? `${productName}(${itemQty}개)` : productName;

        if (!groupedMap.has(groupKey)) {
            const { address, detail_address } = splitKoreanAddress(fullAddr);
            groupedMap.set(groupKey, {
                orderNumbers: orderNo ? [orderNo] : [],
                name: recName,
                phone: normalizedPhone,
                zipcode,
                address,
                detail_address,
                delivery_message: deliveryMsg,
                products: formattedProd ? [formattedProd] : [],
                totalItemCount: itemQty
            });
        } else {
            const existing = groupedMap.get(groupKey);
            if (orderNo && !existing.orderNumbers.includes(orderNo)) {
                existing.orderNumbers.push(orderNo);
            }
            if (formattedProd) {
                existing.products.push(formattedProd);
            }
            existing.totalItemCount += itemQty;
            // 기존 행에 주소나 배송메시지가 비어있었다면 보완
            if (!existing.address && fullAddr) {
                const { address, detail_address } = splitKoreanAddress(fullAddr);
                existing.address = address;
                existing.detail_address = detail_address;
            }
            if (!existing.delivery_message && deliveryMsg) {
                existing.delivery_message = deliveryMsg;
            }
        }
    }

    // Map -> 최종 배열 변환
    const results = [];
    for (const item of groupedMap.values()) {
        results.push({
            order_number: item.orderNumbers.join(', '),
            name: item.name,
            phone: item.phone,
            zipcode: item.zipcode,
            address: item.address,
            detail_address: item.detail_address,
            delivery_message: item.delivery_message,
            products: item.products,
            item_memo: formatProductMemo(item.products, visibleCount),
            quantity: 1 // 기본 택배 박스 수량은 1 (필요 시 그리드에서 조정)
        });
    }

    return results;
}

/**
 * 엑셀 Buffer(.xlsx)에서 그립 판매내역 파싱
 */
async function parseGripExcelBuffer(buffer, visibleCount = 2) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.getWorksheet(1);
    if (!worksheet) return [];

    const rawRows = [];
    worksheet.eachRow({ includeEmpty: false }, (row) => {
        // ExcelJS의 row.values는 1-based 배열이므로 slice(1)로 0-based로 변환
        const vals = Array.isArray(row.values) ? row.values.slice(1) : [];
        const normalizedVals = vals.map(v => {
            if (v === null || v === undefined) return '';
            if (typeof v === 'object' && v.text) return v.text;
            if (typeof v === 'object' && v.result !== undefined) return v.result;
            return String(v);
        });
        rawRows.push(normalizedVals);
    });

    return groupGripRows(rawRows, visibleCount);
}

/**
 * CSV 또는 탭 구분(TSV) 텍스트에서 그립 판매내역 파싱
 */
function parseGripCsvText(csvText, visibleCount = 2) {
    const lines = String(csvText || '')
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(Boolean);

    if (lines.length < 2) return [];

    // 첫 줄에 탭(\t)이 많으면 엑셀 복사-붙여넣기(TSV), 아니면 CSV로 파싱
    const isTsv = (lines[0].match(/\t/g) || []).length >= 5;
    const rawRows = lines.map(line => (isTsv ? line.split('\t').map(s => s.trim()) : parseCsvLine(line)));

    return groupGripRows(rawRows, visibleCount);
}

module.exports = {
    parseGripExcelBuffer,
    parseGripCsvText,
    formatProductMemo
};

