const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { upsertCustomer } = require('./db');

const DB_FOLDER = 'C:\\Users\\youin\\OneDrive\\바탕 화면\\고객데이터베이스';
const IMPORT_FILE = path.join(DB_FOLDER, '과거고객데이터_업데이트용.xlsx');

async function runImport() {
    if (!fs.existsSync(IMPORT_FILE)) {
        console.log(`[알림] 업데이트할 엑셀 파일이 없어서 빈 양식을 새로 생성합니다.`);
        console.log(`[안내] 바탕화면 > 고객데이터베이스 > '과거고객데이터_업데이트용.xlsx' 파일을 열어서 데이터를 채운 후 다시 실행해주세요.`);
        
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('고객데이터');
        
        // 헤더 추가
        worksheet.addRow(['전화번호(필수)', '이름(필수)', '우편번호', '기본주소', '상세주소']);
        
        // 열 너비 조절
        worksheet.getColumn(1).width = 20; // 전화번호
        worksheet.getColumn(1).numFmt = '@'; // 텍스트 포맷
        worksheet.getColumn(2).width = 15; // 이름
        worksheet.getColumn(3).width = 10; // 우편번호
        worksheet.getColumn(4).width = 40; // 기본주소
        worksheet.getColumn(5).width = 30; // 상세주소

        await workbook.xlsx.writeFile(IMPORT_FILE);
        console.log('\n엔터(Enter) 키를 누르면 창이 닫힙니다.');
        return;
    }

    console.log(`[진행중] '${IMPORT_FILE}' 파일에서 데이터를 읽어오는 중입니다...`);
    
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(IMPORT_FILE);
    const worksheet = workbook.getWorksheet(1);
    
    let successCount = 0;
    let failCount = 0;

    // 2번째 줄부터 데이터 읽기 (1번째 줄은 헤더)
    worksheet.eachRow(async (row, rowNumber) => {
        if (rowNumber === 1) return; // 헤더 건너뛰기

        let phone = row.getCell(1).text || '';
        let name = row.getCell(2).text || '';
        const zipcode = row.getCell(3).text || '';
        const address = row.getCell(4).text || '';
        const detail_address = row.getCell(5).text || '';

        phone = phone.replace(/[^0-9]/g, ''); // 숫자만 추출

        if (!phone || !name) {
            failCount++;
            console.log(`[오류] ${rowNumber}번째 줄: 전화번호나 이름이 비어있어 건너뜁니다.`);
            return;
        }

        try {
            await upsertCustomer({ phone, name, zipcode, address, detail_address });
            successCount++;
        } catch (err) {
            console.error(`[오류] ${rowNumber}번째 줄 (${name}) 저장 실패:`, err.message);
            failCount++;
        }
    });

    // Promise 처리를 위해 약간의 대기 후 종료 (eachRow 내부가 비동기이므로)
    setTimeout(() => {
        console.log(`\n================================`);
        console.log(`🎉 대량 업데이트 완료!`);
        console.log(` - 성공: ${successCount} 명`);
        console.log(` - 실패: ${failCount} 명`);
        console.log(`================================`);
        console.log('\n업데이트가 완료되었습니다. 프로그램(웹페이지)에서 전화번호를 검색해 확인해보세요!');
        console.log('\n엔터(Enter) 키를 누르면 창이 닫힙니다.');
    }, 2000);
}

runImport();
