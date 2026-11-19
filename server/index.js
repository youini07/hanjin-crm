const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const {
    getCustomerByPhone,
    getCustomersByPhones,
    upsertCustomer,
    upsertCustomersLocalOnly,
    getAllSettings,
    saveSettings,
} = require('./db');
const { appendToDailyExcel, appendMultipleToDailyExcel } = require('./excel_service');
const {
    syncFromSheetToDB,
    batchPushCustomersToSheet,
    fixSheetZipcodesAndFormat,
} = require('./google_sheets');
const { parseGripExcelBuffer, parseGripCsvText } = require('./grip_parser');
const {
    DEFAULT_GEMINI_MODEL,
    analyzeKakaoChatWithAI,
    extractTextFromKakaoImages,
    testGeminiConnection,
} = require('./kakao_ai_parser');
const { normalizeKoreanPhone, normalizeZipcode } = require('./utils/normalizer');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
    },
});
const PORT = process.env.PORT || 3001;

// API 키 화면 노출 방지용 마스킹 헬퍼
function maskSecret(secret) {
    if (!secret) return '';
    const s = String(secret).trim();
    if (s.length <= 8) return '****' + s.slice(-2);
    return `${s.slice(0, 5)}••••••${s.slice(-4)}`;
}

// [웹소켓] 페이지별 독립 공유 그리드 상태
let sharedKakaoGridRows = [];
let sharedGripGridRows = [];

io.on('connection', (socket) => {
    console.log(`[Socket] Client connected: ${socket.id}`);

    socket.emit('init_kakao_grid', sharedKakaoGridRows);
    socket.emit('init_grip_grid', sharedGripGridRows);
    socket.emit('init_grid', sharedKakaoGridRows);

    socket.on('request_kakao_grid', () => {
        socket.emit('init_kakao_grid', sharedKakaoGridRows);
    });

    socket.on('request_grip_grid', () => {
        socket.emit('init_grip_grid', sharedGripGridRows);
    });

    socket.on('update_kakao_grid', (newRows) => {
        sharedKakaoGridRows = Array.isArray(newRows) ? newRows : [];
        socket.broadcast.emit('kakao_grid_updated', sharedKakaoGridRows);
    });

    socket.on('update_grid', (newRows) => {
        sharedKakaoGridRows = Array.isArray(newRows) ? newRows : [];
        socket.broadcast.emit('kakao_grid_updated', sharedKakaoGridRows);
        socket.broadcast.emit('grid_updated', sharedKakaoGridRows);
    });

    socket.on('update_grip_grid', (newRows) => {
        sharedGripGridRows = Array.isArray(newRows) ? newRows : [];
        socket.broadcast.emit('grip_grid_updated', sharedGripGridRows);
    });

    socket.on('disconnect', () => {
        console.log(`[Socket] Client disconnected: ${socket.id}`);
    });
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// 정적 프론트엔드 파일 서빙
app.use(express.static(path.join(__dirname, 'public')));

// ──────────────────────────────────────────────────────
// [신규 API] 웹 UI용 AI / 주소 API 키 설정 조회 및 저장
// ──────────────────────────────────────────────────────
app.get('/api/settings', async (req, res) => {
    try {
        const settings = await getAllSettings();
        const geminiKey = settings.gemini_api_key || process.env.GEMINI_API_KEY || '';
        const jusoKey = settings.juso_api_key || process.env.JUSO_API_KEY || '';
        const kakaoKey = settings.kakao_rest_api_key || process.env.KAKAO_REST_API_KEY || '';
        const geminiModel = settings.gemini_model || DEFAULT_GEMINI_MODEL;

        res.json({
            success: true,
            settings: {
                hasGeminiKey: Boolean(geminiKey),
                geminiKeyMasked: maskSecret(geminiKey),
                geminiModel,
                hasJusoKey: Boolean(jusoKey),
                jusoKeyMasked: maskSecret(jusoKey),
                hasKakaoKey: Boolean(kakaoKey),
                kakaoKeyMasked: maskSecret(kakaoKey),
            },
        });
    } catch (err) {
        console.error('Get Settings Error:', err);
        res.status(500).json({ error: '설정을 불러오는 중 오류가 발생했습니다.' });
    }
});

app.post('/api/settings', async (req, res) => {
    try {
        const { geminiApiKey, geminiModel, jusoApiKey, kakaoRestApiKey } = req.body || {};
        const toSave = {};

        // 프론트엔드에서 명시적으로 전달된 항목만 업데이트 (빈 칸으로 두고 저장했을 때 기존 키가 날아가지 않게 보호)
        if (geminiApiKey !== undefined) toSave.gemini_api_key = String(geminiApiKey).trim();
        if (geminiModel !== undefined) {
            toSave.gemini_model = String(geminiModel).trim() || DEFAULT_GEMINI_MODEL;
        }
        if (jusoApiKey !== undefined) toSave.juso_api_key = String(jusoApiKey).trim();
        if (kakaoRestApiKey !== undefined) {
            toSave.kakao_rest_api_key = String(kakaoRestApiKey).trim();
        }

        await saveSettings(toSave, false);

        const updated = await getAllSettings();
        res.json({
            success: true,
            message: 'API 설정이 저장되었습니다. (구글 시트 자동 백업 완료)',
            settings: {
                hasGeminiKey: Boolean(updated.gemini_api_key),
                geminiKeyMasked: maskSecret(updated.gemini_api_key),
                geminiModel: updated.gemini_model || DEFAULT_GEMINI_MODEL,
                hasJusoKey: Boolean(updated.juso_api_key),
                jusoKeyMasked: maskSecret(updated.juso_api_key),
                hasKakaoKey: Boolean(updated.kakao_rest_api_key),
                kakaoKeyMasked: maskSecret(updated.kakao_rest_api_key),
            },
        });
    } catch (err) {
        console.error('Save Settings Error:', err);
        res.status(500).json({ error: '설정 저장 실패: ' + err.message });
    }
});

app.post('/api/settings/test-ai', async (req, res) => {
    try {
        const saved = await getAllSettings();
        const apiKey =
            (req.body?.geminiApiKey && String(req.body.geminiApiKey).trim()) ||
            saved.gemini_api_key ||
            process.env.GEMINI_API_KEY ||
            '';
        const model =
            (req.body?.geminiModel && String(req.body.geminiModel).trim()) ||
            saved.gemini_model ||
            DEFAULT_GEMINI_MODEL;

        if (!apiKey) {
            return res.status(400).json({ error: '테스트할 Gemini API 키를 먼저 입력해주세요.' });
        }

        const result = await testGeminiConnection(apiKey, model);
        res.json({
            success: true,
            message: `✅ 연결 성공! (${result.model} 응답 확인됨)`,
            result,
        });
    } catch (err) {
        console.error('AI Connection Test Error:', err);
        res.status(400).json({ error: err.message });
    }
});

// 스프레드시트 & 로컬 DB 4자리 우편번호 -> 5자리(0 포함) 수동 점검 트리거
app.post('/api/settings/fix-zipcodes', async (req, res) => {
    try {
        const result = await fixSheetZipcodesAndFormat();
        res.json({
            success: true,
            message: `우편번호 5자리 텍스트 점검 완료! (시트 4자리 복구: ${result.sheetFixedCount}건, DB 복구: ${result.dbFixedCount}건)`,
            result,
        });
    } catch (err) {
        console.error('Fix Zipcodes Error:', err);
        res.status(500).json({ error: '우편번호 보정 중 오류: ' + err.message });
    }
});

// ──────────────────────────────────────────────────────
// [신규 핵심 API] 카카오톡 대화 AI 분석 + 주소 오타 보정 + 기존 DB 비교
// 왜: 분석 시점에는 DB를 절대 수정하지 않고, 그리드 확인(승인) 대기용 데이터만 반환함
// ──────────────────────────────────────────────────────
app.post('/api/kakao/ai-parse', async (req, res) => {
    const { rawText } = req.body || {};
    if (!rawText || !String(rawText).trim()) {
        return res.status(400).json({ error: '분석할 카카오톡 대화 내용을 붙여넣어 주세요.' });
    }

    try {
        const settings = await getAllSettings();
        const result = await analyzeKakaoChatWithAI(String(rawText), settings);
        res.json({
            success: true,
            ...result,
        });
    } catch (err) {
        console.error('Kakao AI Parse Error:', err);
        res.status(500).json({ error: err.message || 'AI 채팅 분석 중 오류가 발생했습니다.' });
    }
});

// ──────────────────────────────────────────────────────
// [신규 API] 모바일 카카오톡 범위 캡처 이미지 -> 대화 원문 텍스트 추출
// 왜: 모바일 카톡에서는 드래그 복사가 불가능하므로 캡처 이미지를 텍스트로 정제한 뒤
// 프론트엔드 기존 붙여넣기 창에 업로드 순서대로 이어 붙여주기 위함
// ──────────────────────────────────────────────────────
app.post('/api/kakao/extract-image-text', async (req, res) => {
    const { tiles } = req.body || {};
    if (!Array.isArray(tiles) || tiles.length === 0) {
        return res.status(400).json({ error: '추출할 캡처 이미지 데이터가 전달되지 않았습니다.' });
    }

    try {
        const settings = await getAllSettings();
        const result = await extractTextFromKakaoImages(tiles, settings);
        res.json({
            success: true,
            ...result,
        });
    } catch (err) {
        console.error('Kakao Image Extract Error:', err);
        res.status(500).json({ error: err.message || '이미지 텍스트 추출 중 오류가 발생했습니다.' });
    }
});

// ──────────────────────────────────────────────────────
// [기존 API] 전화번호로 단일 고객 검색 (+82 국가번호 자동 변환 지원)
// ──────────────────────────────────────────────────────
app.get('/api/customers/search', async (req, res) => {
    let { phone } = req.query;
    if (!phone) {
        return res.status(400).json({ error: 'Phone number is required' });
    }

    phone = normalizeKoreanPhone(phone);

    try {
        const customer = await getCustomerByPhone(phone);
        if (customer) {
            res.json({ success: true, customer });
        } else {
            res.json({ success: false, message: 'Customer not found' });
        }
    } catch (err) {
        console.error('DB Error:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// ──────────────────────────────────────────────────────
// [기존 API] 고객 저장 + 엑셀 추가 (단건)
// ──────────────────────────────────────────────────────
app.post('/api/customers/save-and-export', async (req, res) => {
    let { phone, name, zipcode, address, detail_address } = req.body;

    if (!phone || !name) {
        return res.status(400).json({ error: 'Phone and Name are required' });
    }

    phone = normalizeKoreanPhone(phone);
    zipcode = normalizeZipcode(zipcode);

    try {
        await upsertCustomer({ phone, name, zipcode, address, detail_address });
        const excelPath = await appendToDailyExcel({
            phone,
            name,
            zipcode,
            address,
            detail_address,
        });
        res.json({ success: true, message: 'Saved to DB and Excel', excelPath });
    } catch (err) {
        console.error('Save/Export Error:', err);
        res.status(500).json({ error: 'Failed to save or export: ' + err.message });
    }
});

// ──────────────────────────────────────────────────────
// [기존 API] 고객 데이터 단건 저장
// ──────────────────────────────────────────────────────
app.post('/api/customers/save', async (req, res) => {
    let { phone, name, zipcode, address, detail_address } = req.body;

    if (!phone || !name) {
        return res.status(400).json({ error: 'Phone and Name are required' });
    }

    phone = normalizeKoreanPhone(phone);
    zipcode = normalizeZipcode(zipcode);

    try {
        await upsertCustomer({ phone, name, zipcode, address, detail_address });
        res.json({ success: true, message: 'Saved to DB immediately' });
    } catch (err) {
        console.error('Immediate Save Error:', err);
        res.status(500).json({ error: 'Failed to save immediately: ' + err.message });
    }
});

// ──────────────────────────────────────────────────────
// [기존 API] 전화번호 배열로 한 번에 고객 매칭 (비상용 폴백 유지, +82 지원)
// ──────────────────────────────────────────────────────
app.post('/api/customers/bulk-match', async (req, res) => {
    const { phones } = req.body;

    if (!phones || !Array.isArray(phones) || phones.length === 0) {
        return res.status(400).json({ error: 'phones 배열이 필요합니다.' });
    }

    try {
        const normalizedPhones = [
            ...new Set(phones.map((p) => normalizeKoreanPhone(p)).filter(Boolean)),
        ];

        const foundCustomers = await getCustomersByPhones(normalizedPhones);

        const customerMap = {};
        for (const c of foundCustomers) {
            customerMap[c.phone] = c;
        }

        const results = normalizedPhones.map((phone) => {
            const customer = customerMap[phone];
            if (customer) {
                return {
                    phone,
                    found: true,
                    customer: {
                        id: customer.id,
                        name: customer.name,
                        phone: customer.phone,
                        zipcode: normalizeZipcode(customer.zipcode),
                        address: customer.address || '',
                        detail_address: customer.detail_address || '',
                    },
                };
            } else {
                return {
                    phone,
                    found: false,
                    customer: {
                        name: '',
                        phone,
                        zipcode: '',
                        address: '',
                        detail_address: '',
                    },
                };
            }
        });

        res.json({ success: true, results });
    } catch (err) {
        console.error('Bulk Match Error:', err);
        res.status(500).json({ error: 'DB 매칭 중 오류: ' + err.message });
    }
});

// ──────────────────────────────────────────────────────
// [그립 API] 그립(Grip) 판매내역서 파싱 및 동일 고객 묶기
// ──────────────────────────────────────────────────────
app.post('/api/grip/parse', async (req, res) => {
    const { fileBase64, csvText, visibleCount = 2 } = req.body;

    try {
        let groupedItems = [];
        if (fileBase64) {
            const buffer = Buffer.from(fileBase64, 'base64');
            groupedItems = await parseGripExcelBuffer(buffer, Number(visibleCount) || 2);
        } else if (csvText) {
            groupedItems = parseGripCsvText(csvText, Number(visibleCount) || 2);
        } else {
            return res
                .status(400)
                .json({ error: '업로드할 파일(fileBase64) 또는 텍스트(csvText)가 필요합니다.' });
        }

        const phones = groupedItems.map((item) => item.phone).filter(Boolean);
        const existingCustomers = await getCustomersByPhones(phones);
        const existingPhoneSet = new Set(existingCustomers.map((c) => c.phone));

        const items = groupedItems.map((item) => ({
            ...item,
            zipcode: normalizeZipcode(item.zipcode),
            foundInDb: existingPhoneSet.has(item.phone),
        }));

        res.json({
            success: true,
            items,
        });
    } catch (err) {
        console.error('Grip Parse Error:', err);
        res.status(500).json({ error: '그립 판매내역서 분석 중 오류 발생: ' + err.message });
    }
});

app.get('/api/grip/sample', async (req, res) => {
    try {
        const rootDir = path.join(__dirname, '..');
        const files = fs
            .readdirSync(rootDir)
            .filter((f) => f.startsWith('주문_') && f.endsWith('.xlsx'));
        if (files.length === 0) {
            return res.status(404).json({ error: '프로젝트 폴더에 주문 엑셀 파일이 없습니다.' });
        }
        files.sort().reverse();
        const filePath = path.join(rootDir, files[0]);
        const buffer = fs.readFileSync(filePath);
        const visibleCount = Number(req.query.visibleCount) || 2;
        const groupedItems = await parseGripExcelBuffer(buffer, visibleCount);

        const phones = groupedItems.map((item) => item.phone).filter(Boolean);
        const existingCustomers = await getCustomersByPhones(phones);
        const existingPhoneSet = new Set(existingCustomers.map((c) => c.phone));

        const items = groupedItems.map((item) => ({
            ...item,
            zipcode: normalizeZipcode(item.zipcode),
            foundInDb: existingPhoneSet.has(item.phone),
        }));

        res.json({
            success: true,
            fileName: files[0],
            items,
        });
    } catch (err) {
        console.error('Grip Sample Load Error:', err);
        res.status(500).json({ error: '주문 파일 불러오기 실패: ' + err.message });
    }
});

// ──────────────────────────────────────────────────────
// [핵심 API] 확인 완료된 고객 일괄 저장 + 한진택배 엑셀 내보내기
// 왜:
// 1. 주소가 비어있는 행(사진 주소 미입력 등)이 기존 DB 주소를 빈 값으로 덮어쓰는 사고를 원천 차단함.
// 2. 실제로 신규/수정된 고객만 구글 시트에 1회 Batch 반영하여 내보내기 속도를 높이고 API 한도 초과를 방지함.
// ──────────────────────────────────────────────────────
app.post('/api/customers/bulk-save-and-export', async (req, res) => {
    const { customers } = req.body;

    if (!customers || !Array.isArray(customers) || customers.length === 0) {
        return res.status(400).json({ error: 'customers 배열이 필요합니다.' });
    }

    try {
        const validCustomers = [];
        const customersToPersist = [];
        let skippedCount = 0;

        for (const c of customers) {
            const phone = normalizeKoreanPhone(c.phone);
            const name = String(c.name || '').trim();
            const address = String(c.address || '').trim();
            const zipcode = normalizeZipcode(c.zipcode);
            const detail_address = String(c.detail_address || '').trim();
            const fb_name = c.fb_name ? String(c.fb_name).trim() : '';

            // 전화번호, 이름, 기본주소, 5자리 우편번호가 모두 있는 행만 송장 내보내기 및 DB 반영 허용
            // 왜: 우편번호가 없는 없는 주소(번지 오타 등)가 한진 엑셀 오류행으로 출력되거나 기존 DB 정상 주소를 덮어쓰는 사고를 원천 차단함
            if (!phone || !name || !address || !/^\d{5}$/.test(zipcode)) {
                skippedCount++;
                continue;
            }

            const cleaned = {
                ...c,
                phone,
                name,
                zipcode,
                address,
                detail_address,
                fb_name,
            };

            validCustomers.push(cleaned);

            // _shouldSaveToDb가 명시적으로 false(변경 없는 기존 일치 고객)가 아닌 경우에만 DB/시트 업데이트 대상에 포함
            if (c._shouldSaveToDb !== false) {
                customersToPersist.push(cleaned);
            }
        }

        if (validCustomers.length === 0) {
            return res.status(400).json({
                error: '내보내기할 유효한 고객(전화번호·이름·기본주소 필수)이 없습니다.',
            });
        }

        // 1단계: 변경/신규 확정된 고객만 로컬 SQLite 및 구글 시트에 일괄(Batch) 저장
        if (customersToPersist.length > 0) {
            await upsertCustomersLocalOnly(customersToPersist);
            await batchPushCustomersToSheet(customersToPersist);
        }

        // 2단계: 유효한 전체 송장 목록을 한진택배 양식 엑셀로 생성
        const excelPath = await appendMultipleToDailyExcel(validCustomers);

        res.json({
            success: true,
            message: `송장 ${validCustomers.length}건 생성 완료 (DB 신규·변경 반영 ${customersToPersist.length}건${
                skippedCount > 0 ? `, 미입력 제외 ${skippedCount}건` : ''
            })`,
            exportedCount: validCustomers.length,
            savedCount: customersToPersist.length,
            skippedCount,
            excelPath,
        });
    } catch (err) {
        console.error('Bulk Save/Export Error:', err);
        res.status(500).json({ error: '일괄 저장/내보내기 실패: ' + err.message });
    }
});

// 생성된 엑셀 파일 다운로드
app.get('/api/download', (req, res) => {
    const filePath = req.query.path;
    if (!filePath) {
        return res.status(400).send('파일 경로가 제공되지 않았습니다.');
    }

    const fileName = path.basename(filePath);
    res.download(filePath, fileName, (err) => {
        if (err) {
            console.error('파일 다운로드 중 에러:', err);
            if (!res.headersSent) {
                res.status(500).send('파일 다운로드 실패');
            }
        }
    });
});

// 존재하지 않는 API 경로 404 처리
app.use('/api', (req, res) => {
    res.status(404).json({ error: '요청하신 API 경로를 찾을 수 없습니다.' });
});

// React SPA fallback
app.get(/.*/, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, '0.0.0.0', async () => {
    console.log(`Backend server running on http://0.0.0.0:${PORT}`);
    await syncFromSheetToDB();
});
