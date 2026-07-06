const { google } = require('googleapis');
const path = require('path');
const { upsertCustomer } = require('./db');

const SPREADSHEET_ID = '1-hqwcXk8DJ1GJxTXZGhAXkV_9_ZCuhdsbTDZSgjL5QI';

let auth;
if (process.env.GOOGLE_CREDENTIALS) {
    // Railway 환경: 환경변수에서 인증서 정보 로드
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
} else {
    // 로컬 환경: 파일에서 인증서 정보 로드
    auth = new google.auth.GoogleAuth({
        keyFile: path.join(process.cwd(), 'service_account.json'),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
}

let FIRST_SHEET_NAME = null;

async function getFirstSheetName(sheets) {
    if (FIRST_SHEET_NAME) return FIRST_SHEET_NAME;
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    FIRST_SHEET_NAME = meta.data.sheets[0].properties.title;
    return FIRST_SHEET_NAME;
}

/**
 * 서버 시작 시: 구글 시트의 모든 데이터를 읽어와서 로컬 SQLite에 덮어쓰기 (Pull)
 */
async function syncFromSheetToDB() {
    try {
        console.log('🔄 구글 시트에서 로컬 DB로 동기화를 시작합니다...');
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });

        const sheetName = await getFirstSheetName(sheets);
        const range = `${sheetName}!A:E`;

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: range,
        });

        const rows = response.data.values;
        if (!rows || rows.length === 0) {
            console.log('⚠️ 구글 시트에 데이터가 없습니다. 빈 시트이거나 아직 동기화된 데이터가 없습니다.');
            return;
        }

        // 첫 번째 행이 헤더(이름, 연락처 등)일 수 있으므로 검사
        let startIndex = 0;
        if (rows[0] && rows[0].length > 0 && (rows[0][0].includes('이름') || rows[0][0].includes('연락처') || rows[0][0].includes('phone'))) {
            startIndex = 1;
        }

        let syncCount = 0;
        for (let i = startIndex; i < rows.length; i++) {
            const row = rows[i];
            const phone = row[0];
            const name = row[1];
            if (!phone || !name) continue;

            const customer = {
                phone: phone,
                name: name,
                zipcode: row[2] || '',
                address: row[3] || '',
                detail_address: row[4] || ''
            };
            
            // 로컬 DB에 저장 (동기화)
            await upsertCustomer(customer, true); // true는 시트로 다시 Push하지 않게 하기 위함
            syncCount++;
        }
        
        console.log(`✅ 구글 시트에서 총 ${syncCount}건의 데이터를 로컬 DB로 성공적으로 동기화했습니다!`);
    } catch (err) {
        console.error('❌ 구글 시트 동기화 중 에러 발생:', err.message);
    }
}

/**
 * 데이터 저장/수정 시: 구글 시트에서 기존 번호를 찾아 수정(Update)하거나 새 줄에 추가(Append)
 */
async function pushCustomerToSheet(customer) {
    try {
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });

        const sheetName = await getFirstSheetName(sheets);
        
        // 전화번호 맨 앞 0이 사라지는 것을 방지하기 위해 텍스트 강제 처리(' 추가)
        const safePhone = customer.phone ? `'${customer.phone}` : '';
        const values = [
            [safePhone, customer.name, customer.zipcode, customer.address, customer.detail_address]
        ];

        // 1. 기존 데이터에서 동일한 전화번호가 있는지 검색 (A열 전체 가져오기)
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${sheetName}!A:A`,
        });

        const rows = response.data.values || [];
        let rowIndex = -1;

        // 구글 시트에서 가져온 값은 아포스트로피가 제거된 상태로 오기도 함
        for (let i = 0; i < rows.length; i++) {
            if (rows[i] && rows[i].length > 0) {
                let cellValue = rows[i][0];
                if (cellValue === customer.phone || cellValue === safePhone || cellValue === `'${customer.phone}`) {
                    rowIndex = i + 1; // 구글 시트 행은 1부터 시작
                    break;
                }
            }
        }

        if (rowIndex !== -1) {
            // 2. 발견됨 -> 해당 줄을 덮어쓰기 (Update)
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${sheetName}!A${rowIndex}:E${rowIndex}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values },
            });
            console.log(`✅ [${customer.name}]님의 정보가 구글 시트(행 ${rowIndex})에 수정(Update)되었습니다.`);
        } else {
            // 3. 없음 -> 맨 아랫줄에 새로 추가 (Append)
            await sheets.spreadsheets.values.append({
                spreadsheetId: SPREADSHEET_ID,
                range: `${sheetName}!A:E`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values },
            });
            console.log(`✅ [${customer.name}]님의 정보가 구글 시트에 새로 추가(Append)되었습니다.`);
        }
    } catch (err) {
        console.error('❌ 구글 시트 업로드 중 에러 발생:', err.message);
    }
}

module.exports = {
    syncFromSheetToDB,
    pushCustomerToSheet
};
