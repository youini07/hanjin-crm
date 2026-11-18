const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const dayjs = require('dayjs');
const { normalizeKoreanPhone, normalizeZipcode } = require('./utils/normalizer');

const dataDir = process.env.DATA_DIR || __dirname;
const DB_FOLDER = path.join(dataDir, '고객데이터베이스');
const TEMPLATE_FILE = path.join(DB_FOLDER, '서식_한진-기본.xlsx');

// Ensure the template file exists
async function ensureTemplateExists() {
    if (!fs.existsSync(DB_FOLDER)) {
        fs.mkdirSync(DB_FOLDER, { recursive: true });
    }

    if (!fs.existsSync(TEMPLATE_FILE)) {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Sheet1');
        // Add basic headers if needed. We assume it's blank or has some headers.
        worksheet.addRow(['이름', '전화번호', 'C', 'D', '우편번호', '주소', 'G', '전화번호2']);
        await workbook.xlsx.writeFile(TEMPLATE_FILE);
        console.log('Created missing template file:', TEMPLATE_FILE);
    }
}

// Append customer to today's Excel file
async function appendToDailyExcel(customer) {
    await ensureTemplateExists();

    const today = dayjs().format('YYYYMMDD');
    const timeSuffix = dayjs().format('HHmmss');
    const todayFileName = `${today}_한진송장_${timeSuffix}.xlsx`;
    const todayFilePath = path.join(DB_FOLDER, todayFileName);

    let workbook = new ExcelJS.Workbook();

    // 기존 파일에 이어서 쓰지 않고, 매번 템플릿을 불러와 새 파일로 저장
    await workbook.xlsx.readFile(TEMPLATE_FILE);

    const worksheet = workbook.getWorksheet(1); // Get first sheet

    const { name, phone, zipcode, address, detail_address, quantity, item_memo } = customer;
    
    // Construct full address string
    const fullAddress = `${address || ''} ${detail_address || ''}`.trim();
    const addressWithNote = fullAddress ? `${fullAddress} (외국인입니다 사진부탁해요)` : '';

    // 우편번호가 4자리 숫자로 들어오더라도 무조건 5자리 문자열(예: 8579 → "08579")로 보존
    const safeZipcode = normalizeZipcode(zipcode);
    const safePhone = normalizeKoreanPhone(phone);
    // H열(품목명/비고): 구매상품명(item_memo)이 있으면 우선 기록하고, 없으면 기존처럼 전화번호 기록
    const safeMemo = item_memo && String(item_memo).trim() ? String(item_memo).trim() : safePhone;

    // Create a new row array. ExcelJS uses 1-based indexing for columns.
    const newRow = [];
    newRow[1] = name;                 // A: 이름
    newRow[2] = safePhone;            // B: 전화번호
    newRow[5] = safeZipcode;          // E: 우편번호 (5자리 텍스트)
    newRow[6] = addressWithNote;      // F: 주소+상세주소+메모
    newRow[8] = safeMemo;             // H: 품목명(비고) 또는 전화번호

    // Find the first empty row by checking if column 1 (이름) and column 2 (전화번호) are empty
    let targetRowNumber = 2;
    while (true) {
        const row = worksheet.getRow(targetRowNumber);
        const nameVal = row.getCell(1).value;
        const phoneVal = row.getCell(2).value;
        if (!nameVal && !phoneVal) {
            break;
        }
        targetRowNumber++;
    }

    const targetRow = worksheet.getRow(targetRowNumber);

    targetRow.getCell(1).value = name;
    
    // B열(전화번호): 스타일 전체를 덮어씌워 numFmt 확실히 적용
    const cellB = targetRow.getCell(2);
    cellB.style = { ...cellB.style, numFmt: '@' };
    cellB.value = safePhone;
    
    // E열(우편번호): 스타일 전체를 덮어씌워 numFmt 확실히 적용
    const cellE = targetRow.getCell(5);
    cellE.style = { ...cellE.style, numFmt: '@' };
    cellE.value = safeZipcode;
    
    targetRow.getCell(6).value = newRow[6];
    
    // G열(수량): 2 이상일 때만 기록
    if (quantity && quantity >= 2) {
        targetRow.getCell(7).value = quantity;
    }
    
    // H열(품목명/비고): 구매상품명 요약 또는 전화번호 기록 (주문번호는 한진엑셀에 미표기)
    const cellH = targetRow.getCell(8);
    cellH.style = { ...cellH.style, numFmt: '@' };
    cellH.value = safeMemo;
    
    // 행 데이터를 확정(commit)하여 ExcelJS 내부 캐시 반영
    targetRow.commit();

    await workbook.xlsx.writeFile(todayFilePath);
    return todayFilePath;
}

/**
 * 여러 고객을 한 번에 오늘자 엑셀 파일에 추가
 * 왜: 내보내기 시 고객 배열을 한 번의 파일 I/O로 처리하여 성능 최적화
 * 기존 appendToDailyExcel의 로직을 배열 단위로 확장
 */
async function appendMultipleToDailyExcel(customers) {
    await ensureTemplateExists();

    const today = dayjs().format('YYYYMMDD');
    const timeSuffix = dayjs().format('HHmmss');
    const todayFileName = `${today}_한진송장_${timeSuffix}.xlsx`;
    const todayFilePath = path.join(DB_FOLDER, todayFileName);

    let workbook = new ExcelJS.Workbook();

    // 매번 템플릿을 불러와 새로운 파일 생성
    await workbook.xlsx.readFile(TEMPLATE_FILE);

    const worksheet = workbook.getWorksheet(1);

    // 첫 빈 행 찾기 (기존 데이터 아래에 추가)
    let targetRowNumber = 2;
    while (true) {
        const row = worksheet.getRow(targetRowNumber);
        const nameVal = row.getCell(1).value;
        const phoneVal = row.getCell(2).value;
        if (!nameVal && !phoneVal) break;
        targetRowNumber++;
    }

    // 각 고객 데이터를 연속 행에 추가
    for (const customer of customers) {
        const { name, phone, zipcode, address, detail_address, quantity, item_memo } = customer;

        const fullAddress = `${address || ''} ${detail_address || ''}`.trim();
        const addressWithNote = fullAddress ? `${fullAddress} (외국인입니다 사진부탁해요)` : '';
        const safeZipcode = normalizeZipcode(zipcode);
        const safePhone = normalizeKoreanPhone(phone);
        // H열(품목명/비고): 구매상품명(item_memo)이 있으면 우선 기록하고, 없으면 기존처럼 전화번호 기록
        const safeMemo = item_memo && String(item_memo).trim() ? String(item_memo).trim() : safePhone;

        const targetRow = worksheet.getRow(targetRowNumber);

        targetRow.getCell(1).value = name;

        const cellB = targetRow.getCell(2);
        cellB.style = { ...cellB.style, numFmt: '@' };
        cellB.value = safePhone;

        const cellE = targetRow.getCell(5);
        cellE.style = { ...cellE.style, numFmt: '@' };
        cellE.value = safeZipcode;

        targetRow.getCell(6).value = addressWithNote;

        if (quantity && quantity >= 2) {
            targetRow.getCell(7).value = quantity;
        }

        // H열(품목명/비고): 구매상품명 요약 또는 전화번호 기록 (주문번호는 한진엑셀에 미표기)
        const cellH = targetRow.getCell(8);
        cellH.style = { ...cellH.style, numFmt: '@' };
        cellH.value = safeMemo;

        targetRow.commit();
        targetRowNumber++;
    }

    await workbook.xlsx.writeFile(todayFilePath);
    return todayFilePath;
}

module.exports = {
    appendToDailyExcel,
    appendMultipleToDailyExcel
};
