const { google } = require('googleapis');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const SPREADSHEET_ID = '1-hqwcXk8DJ1GJxTXZGhAXkV_9_ZCuhdsbTDZSgjL5QI';

// 구글 API 인증
const auth = new google.auth.GoogleAuth({
    keyFile: path.join(__dirname, 'service_account.json'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const dbPath = path.join(__dirname, 'customers.db');
const db = new sqlite3.Database(dbPath);

async function migrateData() {
    try {
        console.log('🔄 기존 로컬 DB 데이터를 구글 시트로 마이그레이션(업로드) 시작...');
        
        // 1. SQLite에서 데이터 모두 가져오기
        const rows = await new Promise((resolve, reject) => {
            db.all('SELECT * FROM customers ORDER BY id ASC', (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        if (rows.length === 0) {
            console.log('⚠️ 로컬 DB에도 데이터가 없습니다. 업로드할 내용이 없습니다.');
            return;
        }

        // 2. 구글 시트에 올릴 배열로 변환 (헤더 포함)
        const values = [
            ['연락처(phone)', '이름(name)', '우편번호(zipcode)', '주소(address)', '상세주소(detail_address)']
        ];

        rows.forEach(row => {
            // 구글 시트가 010...을 숫자로 인식해 0을 지우지 않도록 앞에 ' (아포스트로피) 추가
            const safePhone = row.phone ? `'${row.phone}` : '';
            values.push([safePhone, row.name, row.zipcode, row.address, row.detail_address]);
        });

        // 3. 구글 시트 API 연동 및 첫 번째 시트 이름 찾기
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });

        const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
        const sheetName = meta.data.sheets[0].properties.title;
        const range = `${sheetName}!A1`;

        // 4. 구글 시트 A1부터 데이터 일괄 덮어쓰기 (업데이트)
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: range,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values },
        });

        console.log(`✅ 총 ${rows.length}명의 고객 데이터가 구글 시트에 성공적으로 업로드되었습니다!`);
    } catch (err) {
        console.error('❌ 마이그레이션 에러:', err);
    } finally {
        db.close();
    }
}

migrateData();
