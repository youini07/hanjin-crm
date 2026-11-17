const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const { getCustomerByPhone, getCustomersByPhones, upsertCustomer } = require('./db');
const { appendToDailyExcel, appendMultipleToDailyExcel } = require('./excel_service');
const { syncFromSheetToDB } = require('./google_sheets');
const { parseGripExcelBuffer, parseGripCsvText } = require('./grip_parser');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
const PORT = 3001;

// [웹소켓] 페이지별 독립 공유 그리드 상태
// 왜: 카카오톡 텍스트 입력 페이지와 그립(Grip) 엑셀 페이지가 분리됨에 따라,
// 각 페이지의 작업 중 데이터가 서로 섞이거나 덮어써지지 않도록 별도 배열로 격리함
let sharedKakaoGridRows = [];
let sharedGripGridRows = [];

io.on('connection', (socket) => {
    console.log(`[Socket] Client connected: ${socket.id}`);

    // 최초 접속 시 각 페이지의 현재 그리드 상태 전달
    socket.emit('init_kakao_grid', sharedKakaoGridRows);
    socket.emit('init_grip_grid', sharedGripGridRows);
    // 하위 호환용 기본 이벤트(카카오 페이지 기준)
    socket.emit('init_grid', sharedKakaoGridRows);

    // 페이지 전환 시 최신 그리드 상태를 재요청할 수 있도록 지원
    socket.on('request_kakao_grid', () => {
        socket.emit('init_kakao_grid', sharedKakaoGridRows);
    });

    socket.on('request_grip_grid', () => {
        socket.emit('init_grip_grid', sharedGripGridRows);
    });

    // 카카오톡 페이지 그리드 업데이트 동기화
    socket.on('update_kakao_grid', (newRows) => {
        sharedKakaoGridRows = Array.isArray(newRows) ? newRows : [];
        socket.broadcast.emit('kakao_grid_updated', sharedKakaoGridRows);
    });

    // 하위 호환용 기본 업데이트 이벤트
    socket.on('update_grid', (newRows) => {
        sharedKakaoGridRows = Array.isArray(newRows) ? newRows : [];
        socket.broadcast.emit('kakao_grid_updated', sharedKakaoGridRows);
        socket.broadcast.emit('grid_updated', sharedKakaoGridRows);
    });

    // 그립(Grip) 페이지 그리드 업데이트 동기화
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
// [기존 API] 전화번호로 단일 고객 검색
// ──────────────────────────────────────────────────────
app.get('/api/customers/search', async (req, res) => {
    let { phone } = req.query;
    if (!phone) {
        return res.status(400).json({ error: 'Phone number is required' });
    }

    // 모든 특수기호, 공백, 하이픈 무시하고 숫자만 추출
    phone = phone.replace(/[^0-9]/g, '');

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

    phone = phone.replace(/[^0-9]/g, '');

    try {
        await upsertCustomer({ phone, name, zipcode, address, detail_address });
        const excelPath = await appendToDailyExcel({ phone, name, zipcode, address, detail_address });
        res.json({ success: true, message: 'Saved to DB and Excel', excelPath });
    } catch (err) {
        console.error('Save/Export Error:', err);
        res.status(500).json({ error: 'Failed to save or export: ' + err.message });
    }
});

// ──────────────────────────────────────────────────────
// [신규 API] 고객 데이터 즉시 저장 (단건)
// 왜: 폼에서 수정 또는 신규 추가 시 즉각적으로 DB에 반영하기 위함
// ──────────────────────────────────────────────────────
app.post('/api/customers/save', async (req, res) => {
    let { phone, name, zipcode, address, detail_address } = req.body;
    
    if (!phone || !name) {
        return res.status(400).json({ error: 'Phone and Name are required' });
    }

    phone = phone.replace(/[^0-9]/g, '');

    try {
        await upsertCustomer({ phone, name, zipcode, address, detail_address });
        res.json({ success: true, message: 'Saved to DB immediately' });
    } catch (err) {
        console.error('Immediate Save Error:', err);
        res.status(500).json({ error: 'Failed to save immediately: ' + err.message });
    }
});

// ──────────────────────────────────────────────────────
// [신규 API] 전화번호 배열로 한 번에 고객 매칭
// 왜: 카카오톡에서 추출한 여러 전화번호를 한 번에 DB 조회하기 위함
// ──────────────────────────────────────────────────────
app.post('/api/customers/bulk-match', async (req, res) => {
    const { phones } = req.body;

    if (!phones || !Array.isArray(phones) || phones.length === 0) {
        return res.status(400).json({ error: 'phones 배열이 필요합니다.' });
    }

    try {
        // 모든 전화번호를 숫자만 추출하여 정규화
        const normalizedPhones = phones.map(p => String(p).replace(/[^0-9]/g, ''));

        // DB에서 한 번에 조회
        const foundCustomers = await getCustomersByPhones(normalizedPhones);

        // 전화번호 → 고객 정보 맵 생성
        const customerMap = {};
        for (const c of foundCustomers) {
            customerMap[c.phone] = c;
        }

        // 각 전화번호에 대해 매칭 결과 생성
        const results = normalizedPhones.map(phone => {
            const customer = customerMap[phone];
            if (customer) {
                return {
                    phone,
                    found: true,
                    customer: {
                        id: customer.id,
                        name: customer.name,
                        phone: customer.phone,
                        zipcode: customer.zipcode || '',
                        address: customer.address || '',
                        detail_address: customer.detail_address || ''
                    }
                };
            } else {
                // 신규 고객: 전화번호만 채우고 나머지 빈칸
                return {
                    phone,
                    found: false,
                    customer: {
                        name: '',
                        phone,
                        zipcode: '',
                        address: '',
                        detail_address: ''
                    }
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
// [신규 API] 그립(Grip) 판매내역서 파싱 및 동일 고객 묶기
// 왜: 엑셀(.xlsx) 또는 CSV 데이터를 받아 동일 고객의 여러 구매 상품을 묶고
// H열 상품명('외 N개') 요약 및 주문번호를 추출하여 그리드에 전달하기 위함
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
            return res.status(400).json({ error: '업로드할 파일(fileBase64) 또는 텍스트(csvText)가 필요합니다.' });
        }

        // 기존 DB에 등록된 전화번호인지 여부 확인
        const phones = groupedItems.map(item => item.phone).filter(Boolean);
        const existingCustomers = await getCustomersByPhones(phones);
        const existingPhoneSet = new Set(existingCustomers.map(c => c.phone));

        const items = groupedItems.map(item => ({
            ...item,
            foundInDb: existingPhoneSet.has(item.phone)
        }));

        res.json({
            success: true,
            items
        });
    } catch (err) {
        console.error('Grip Parse Error:', err);
        res.status(500).json({ error: '그립 판매내역서 분석 중 오류 발생: ' + err.message });
    }
});

// ──────────────────────────────────────────────────────
// [신규 API] 루트 폴더의 최근 그립 주문 엑셀 파일 즉시 불러오기
// ──────────────────────────────────────────────────────
app.get('/api/grip/sample', async (req, res) => {
    try {
        const rootDir = path.join(__dirname, '..');
        const files = fs.readdirSync(rootDir).filter(f => f.startsWith('주문_') && f.endsWith('.xlsx'));
        if (files.length === 0) {
            return res.status(404).json({ error: '프로젝트 폴더에 주문 엑셀 파일이 없습니다.' });
        }
        // 가장 최근 파일 선택
        files.sort().reverse();
        const filePath = path.join(rootDir, files[0]);
        const buffer = fs.readFileSync(filePath);
        const visibleCount = Number(req.query.visibleCount) || 2;
        const groupedItems = await parseGripExcelBuffer(buffer, visibleCount);

        const phones = groupedItems.map(item => item.phone).filter(Boolean);
        const existingCustomers = await getCustomersByPhones(phones);
        const existingPhoneSet = new Set(existingCustomers.map(c => c.phone));

        const items = groupedItems.map(item => ({
            ...item,
            foundInDb: existingPhoneSet.has(item.phone)
        }));

        res.json({
            success: true,
            fileName: files[0],
            items
        });
    } catch (err) {
        console.error('Grip Sample Load Error:', err);
        res.status(500).json({ error: '주문 파일 불러오기 실패: ' + err.message });
    }
});

// ──────────────────────────────────────────────────────
// [신규 API] 여러 고객 일괄 저장 + 엑셀 내보내기
// 왜: 그리드에서 수정한 데이터를 한 번에 DB 저장 + 엑셀 생성
// 내보내기 시에만 DB 저장 (임시 상태 → 확정)
// ──────────────────────────────────────────────────────
app.post('/api/customers/bulk-save-and-export', async (req, res) => {
    const { customers } = req.body;

    if (!customers || !Array.isArray(customers) || customers.length === 0) {
        return res.status(400).json({ error: 'customers 배열이 필요합니다.' });
    }

    try {
        let savedCount = 0;
        let skippedCount = 0;

        // 1단계: 모든 고객을 DB에 upsert (이름이 있는 경우만)
        for (const c of customers) {
            const phone = String(c.phone).replace(/[^0-9]/g, '');
            if (!phone || !c.name) {
                skippedCount++;
                continue;
            }
            await upsertCustomer({
                phone,
                name: c.name,
                zipcode: c.zipcode || '',
                address: c.address || '',
                detail_address: c.detail_address || ''
            });
            savedCount++;
        }

        // 2단계: 유효한 고객만 엑셀에 일괄 추가
        const validCustomers = customers.filter(c => {
            const phone = String(c.phone).replace(/[^0-9]/g, '');
            return phone && c.name;
        }).map(c => ({
            ...c,
            phone: String(c.phone).replace(/[^0-9]/g, '')
        }));

        let excelPath = '';
        if (validCustomers.length > 0) {
            excelPath = await appendMultipleToDailyExcel(validCustomers);
        }

        res.json({
            success: true,
            message: `${savedCount}건 저장, ${skippedCount}건 스킵 (이름 미입력)`,
            savedCount,
            skippedCount,
            excelPath
        });
    } catch (err) {
        console.error('Bulk Save/Export Error:', err);
        res.status(500).json({ error: '일괄 저장/내보내기 실패: ' + err.message });
    }
});

// ──────────────────────────────────────────────────────
// [신규 API] 생성된 엑셀 파일 다운로드
// ──────────────────────────────────────────────────────
app.get('/api/download', (req, res) => {
    const filePath = req.query.path;
    if (!filePath) {
        return res.status(400).send('파일 경로가 제공되지 않았습니다.');
    }
    
    // 파일명 추출
    const fileName = path.basename(filePath);
    
    // 클라이언트 브라우저로 파일 전송 (다운로드 트리거)
    res.download(filePath, fileName, (err) => {
        if (err) {
            console.error('파일 다운로드 중 에러:', err);
            if (!res.headersSent) {
                res.status(500).send('파일 다운로드 실패');
            }
        }
    });
});

// React SPA fallback
app.get(/.*/, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 서버 시작 + 구글 시트 동기화
// 왜: 이전에는 서버 시작 시 폴더 내 '주문_*.xlsx'를 그리드에 자동 로드했으나,
// 과거 주문 데이터가 카카오톡/그립 작업 목록에 자동 혼입되는 문제를 막기 위해 자동 로드를 제거함
// (필요 시 그립 전용 페이지에서 파일 업로드 또는 폴더 불러오기 버튼으로 명시적으로 로드 가능)
server.listen(PORT, '0.0.0.0', async () => {
    console.log(`Backend server running on http://0.0.0.0:${PORT}`);
    // 서버가 켜질 때 백그라운드에서 구글 시트 데이터를 로컬 DB로 동기화
    await syncFromSheetToDB();
});
