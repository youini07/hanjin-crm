const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const {
    upsertCustomer,
    saveSettings,
    fixFourDigitZipcodesInDB,
    getDirectoryFbByPhone,
} = require('./db');
const { normalizeKoreanPhone, normalizeZipcode } = require('./utils/normalizer');

const SPREADSHEET_ID = '1-hqwcXk8DJ1GJxTXZGhAXkV_9_ZCuhdsbTDZSgjL5QI';
const SETTINGS_SHEET_TITLE = '_앱설정';

let auth;
if (process.env.GOOGLE_CREDENTIALS) {
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
} else {
    const localKeyPath = fs.existsSync(path.join(__dirname, 'service_account.json'))
        ? path.join(__dirname, 'service_account.json')
        : path.join(process.cwd(), 'service_account.json');
    auth = new google.auth.GoogleAuth({
        keyFile: localKeyPath,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
}

let FIRST_SHEET_META = null;

async function getFirstSheetMeta(sheets) {
    if (FIRST_SHEET_META) return FIRST_SHEET_META;
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const first = meta.data.sheets[0].properties;
    FIRST_SHEET_META = { title: first.title, sheetId: first.sheetId };
    return FIRST_SHEET_META;
}

/**
 * 구글 시트 A열(전화번호), C열(우편번호), F열(페이스북ID)을 텍스트(@) 서식으로 고정하고,
 * F1 헤더('페이스북(fb_name)') 보장 및 4자리 우편번호를 5자리(0xxxx)로 일괄 복구
 */
async function fixSheetZipcodesAndFormat(existingSheetsClient = null) {
    const sheets =
        existingSheetsClient || google.sheets({ version: 'v4', auth: await auth.getClient() });
    const { title: sheetName, sheetId } = await getFirstSheetMeta(sheets);

    // 1. A열(0~1), C열(2~3), F열(5~6) 전체를 텍스트(@) 서식으로 강제 지정
    await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
            requests: [
                {
                    repeatCell: {
                        range: { sheetId, startColumnIndex: 0, endColumnIndex: 1 },
                        cell: {
                            userEnteredFormat: { numberFormat: { type: 'TEXT', pattern: '@' } },
                        },
                        fields: 'userEnteredFormat.numberFormat',
                    },
                },
                {
                    repeatCell: {
                        range: { sheetId, startColumnIndex: 2, endColumnIndex: 3 },
                        cell: {
                            userEnteredFormat: { numberFormat: { type: 'TEXT', pattern: '@' } },
                        },
                        fields: 'userEnteredFormat.numberFormat',
                    },
                },
                {
                    repeatCell: {
                        range: { sheetId, startColumnIndex: 5, endColumnIndex: 6 },
                        cell: {
                            userEnteredFormat: { numberFormat: { type: 'TEXT', pattern: '@' } },
                        },
                        fields: 'userEnteredFormat.numberFormat',
                    },
                },
            ],
        },
    });

    // F1 헤더가 비어있으면 '페이스북(fb_name)' 자동 생성
    const headerRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetName}!A1:F1`,
    });
    const headerRow = headerRes.data.values?.[0] || [];
    if (!headerRow[5]) {
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${sheetName}!F1`,
            valueInputOption: 'RAW',
            requestBody: { values: [['페이스북(fb_name)']] },
        });
    }

    // 2. C열 전체 데이터를 원본 타입(UNFORMATTED_VALUE)으로 읽어 4자리 및 숫자형 셀을 모두 5자리 문자열(TEXT)로 통일
    const colCRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetName}!C1:C`,
        valueRenderOption: 'UNFORMATTED_VALUE',
    });

    const colCRows = colCRes.data.values || [];
    const updateData = [];
    let fixedFourDigitCount = 0;

    for (let i = 0; i < colCRows.length; i++) {
        const rawVal = colCRows[i]?.[0];
        if (rawVal === undefined || rawVal === null || rawVal === '') continue;

        const rawStr = String(rawVal);
        if (i === 0 && (rawStr.includes('우편') || rawStr.toLowerCase().includes('zip'))) {
            continue;
        }
        const cleaned = rawStr.trim().replace(/^'+/, '').trim();
        if (!cleaned) continue;

        const normalized = normalizeZipcode(cleaned);
        const wasFourDigit = /^\d{4}$/.test(cleaned);
        const wasNumericType = typeof rawVal === 'number';

        if (wasFourDigit || wasNumericType || rawStr !== normalized) {
            if (wasFourDigit) fixedFourDigitCount++;
            updateData.push({
                range: `${sheetName}!C${i + 1}`,
                values: [[normalized]],
            });
        }
    }

    if (updateData.length > 0) {
        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            requestBody: {
                valueInputOption: 'RAW',
                data: updateData,
            },
        });
    }

    const dbFixedCount = await fixFourDigitZipcodesInDB();

    return {
        sheetFixedCount: fixedFourDigitCount,
        sheetTextLockedCount: updateData.length,
        dbFixedCount,
    };
}

/**
 * 전화번호 -> 최신 페이스북 아이디 맵(Map 또는 Object)을 구글 시트 F열에 일괄 매칭 기록
 * 왜: 2월부터 누적된 대화 내역에서 각 전화번호의 '가장 최신 FB 아이디'를 시트 F열에 한 번에 채워넣기 위함
 */
async function applyLatestFbMapToSheet(phoneToFbMap) {
    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });
    await fixSheetZipcodesAndFormat(sheets);

    const { title: sheetName } = await getFirstSheetMeta(sheets);
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetName}!A1:F`,
    });

    const rows = res.data.values || [];
    const getFb = (p) =>
        phoneToFbMap instanceof Map ? phoneToFbMap.get(p) : phoneToFbMap[p];

    const updates = [];
    let matchedCount = 0;

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i] || [];
        if (
            i === 0 &&
            row[0] &&
            (row[0].includes('연락처') || row[0].toLowerCase().includes('phone'))
        ) {
            continue;
        }

        const normPhone = normalizeKoreanPhone(row[0]);
        if (!normPhone) continue;

        const latestFb = getFb(normPhone);
        if (latestFb && String(latestFb).trim()) {
            const cleanFb = String(latestFb).trim();
            matchedCount++;
            if (row[5] !== cleanFb) {
                updates.push({
                    range: `${sheetName}!F${i + 1}`,
                    values: [[cleanFb]],
                });
            }
        }
    }

    if (updates.length > 0) {
        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            requestBody: {
                valueInputOption: 'RAW',
                data: updates,
            },
        });
    }

    return {
        totalSheetRows: Math.max(0, rows.length - 1),
        matchedCount,
        updatedCells: updates.length,
    };
}

async function ensureSettingsSheetExists(sheets) {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const found = meta.data.sheets.find((s) => s.properties.title === SETTINGS_SHEET_TITLE);
    if (found) return found.properties.sheetId;

    const addRes = await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
            requests: [
                {
                    addSheet: {
                        properties: {
                            title: SETTINGS_SHEET_TITLE,
                            hidden: true,
                        },
                    },
                },
            ],
        },
    });
    return addRes.data.replies[0].addSheet.properties.sheetId;
}

async function syncSettingsFromSheetToDB(existingSheetsClient = null) {
    try {
        const sheets =
            existingSheetsClient || google.sheets({ version: 'v4', auth: await auth.getClient() });
        await ensureSettingsSheetExists(sheets);

        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SETTINGS_SHEET_TITLE}!A1:B50`,
        });

        const rows = res.data.values || [];
        const settingsMap = {};
        for (const row of rows) {
            if (row && row[0]) {
                settingsMap[String(row[0]).trim()] =
                    row[1] !== undefined ? String(row[1]).trim() : '';
            }
        }

        if (Object.keys(settingsMap).length > 0) {
            await saveSettings(settingsMap, true);
            console.log(
                `✅ 구글 시트에서 앱 설정(${Object.keys(settingsMap).length}개 항목)을 복원했습니다.`
            );
        }
    } catch (err) {
        console.error('⚠️ 구글 시트 앱 설정 복원 중 에러:', err.message);
    }
}

async function pushSettingsToSheet(settingsObj) {
    const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });
    await ensureSettingsSheetExists(sheets);

    const rows = Object.entries(settingsObj).map(([k, v]) => [String(k), String(v ?? '')]);

    await sheets.spreadsheets.values.clear({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SETTINGS_SHEET_TITLE}!A1:B50`,
    });

    if (rows.length > 0) {
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SETTINGS_SHEET_TITLE}!A1:B${rows.length}`,
            valueInputOption: 'RAW',
            requestBody: { values: rows },
        });
    }
}

/**
 * 서버 시작 시: 시트(A~F열) 고객 데이터를 로컬 SQLite로 동기화
 */
async function syncFromSheetToDB() {
    try {
        console.log('🔄 구글 시트 서식 점검 및 로컬 DB 동기화를 시작합니다...');
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });

        await fixSheetZipcodesAndFormat(sheets);
        await syncSettingsFromSheetToDB(sheets);

        const { title: sheetName } = await getFirstSheetMeta(sheets);
        const range = `${sheetName}!A:F`;

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range,
        });

        const rows = response.data.values;
        if (!rows || rows.length === 0) {
            console.log('⚠️ 구글 시트에 고객 데이터가 없습니다.');
            return;
        }

        let startIndex = 0;
        if (
            rows[0] &&
            rows[0].length > 0 &&
            (rows[0][0].includes('이름') ||
                rows[0][0].includes('연락처') ||
                rows[0][0].toLowerCase().includes('phone'))
        ) {
            startIndex = 1;
        }

        let syncCount = 0;
        for (let i = startIndex; i < rows.length; i++) {
            const row = rows[i];
            const phone = normalizeKoreanPhone(row[0]);
            const name = row[1] ? String(row[1]).trim() : '';
            if (!phone || !name) continue;

            const customer = {
                phone,
                name,
                zipcode: normalizeZipcode(row[2] || ''),
                address: row[3] ? String(row[3]).trim() : '',
                detail_address: row[4] ? String(row[4]).trim() : '',
                fb_name: row[5] ? String(row[5]).trim() : '',
            };

            await upsertCustomer(customer, true);
            syncCount++;
        }

        console.log(
            `✅ 구글 시트에서 총 ${syncCount}건의 데이터를 로컬 DB(FB 포함)로 동기화했습니다!`
        );
    } catch (err) {
        console.error('❌ 구글 시트 동기화 중 에러 발생:', err.message);
    }
}

async function pushCustomerToSheet(customer) {
    return batchPushCustomersToSheet([customer]);
}

/**
 * 다건 고객 구글 시트 일괄 반영 (A~F열: 연락처, 이름, 우편번호, 주소, 상세주소, 페이스북ID)
 * 왜: 이번 주문에 FB 아이디가 없으면 시트 F열의 기존 FB 아이디(또는 사전 테이블 값)를 그대로 보존하고,
 * 새로운 FB 아이디가 들어왔을 때만 최신 값으로 덮어쓰기 위함.
 */
async function batchPushCustomersToSheet(customers) {
    if (!customers || customers.length === 0) return;

    try {
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });
        const { title: sheetName } = await getFirstSheetMeta(sheets);

        // 기존 A:F 전체 조회 (전화번호 행 위치 + 기존 F열 FB 아이디 보존용)
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${sheetName}!A:F`,
        });

        const existingRows = response.data.values || [];
        const phoneToExisting = new Map();

        for (let i = 0; i < existingRows.length; i++) {
            const rawPhone = existingRows[i]?.[0];
            if (!rawPhone) continue;
            const norm = normalizeKoreanPhone(rawPhone);
            if (norm) {
                phoneToExisting.set(norm, {
                    rowIndex: i + 1,
                    existingFb: existingRows[i]?.[5] ? String(existingRows[i][5]).trim() : '',
                });
            }
        }

        const updateData = [];
        const appendValues = [];

        for (const c of customers) {
            const safePhone = normalizeKoreanPhone(c.phone);
            const safeName = String(c.name || '').trim();
            const safeZipcode = normalizeZipcode(c.zipcode);
            const safeAddress = String(c.address || '').trim();
            const safeDetail = String(c.detail_address || '').trim();
            let incomingFb = c.fb_name ? String(c.fb_name).trim() : '';

            if (!safePhone || !safeName) continue;

            if (!incomingFb) {
                incomingFb = await getDirectoryFbByPhone(safePhone);
            }

            const existingInfo = phoneToExisting.get(safePhone);
            const finalFb = incomingFb || existingInfo?.existingFb || '';
            const rowVals = [safePhone, safeName, safeZipcode, safeAddress, safeDetail, finalFb];

            if (existingInfo) {
                updateData.push({
                    range: `${sheetName}!A${existingInfo.rowIndex}:F${existingInfo.rowIndex}`,
                    values: [rowVals],
                });
            } else {
                appendValues.push(rowVals);
            }
        }

        if (updateData.length > 0) {
            await sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                requestBody: {
                    valueInputOption: 'RAW',
                    data: updateData,
                },
            });
        }

        if (appendValues.length > 0) {
            await sheets.spreadsheets.values.append({
                spreadsheetId: SPREADSHEET_ID,
                range: `${sheetName}!A:F`,
                valueInputOption: 'RAW',
                insertDataOption: 'INSERT_ROWS',
                requestBody: {
                    values: appendValues,
                },
            });
        }

        console.log(
            `✅ 구글 시트(A~F열) 반영 완료 (수정 ${updateData.length}건, 신규 추가 ${appendValues.length}건)`
        );
    } catch (err) {
        console.error('❌ 구글 시트 일괄 업로드 중 에러 발생:', err.message);
    }
}

module.exports = {
    syncFromSheetToDB,
    pushCustomerToSheet,
    batchPushCustomersToSheet,
    fixSheetZipcodesAndFormat,
    applyLatestFbMapToSheet,
    syncSettingsFromSheetToDB,
    pushSettingsToSheet,
};
