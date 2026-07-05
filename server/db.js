const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dataDir = process.env.DATA_DIR || process.cwd();
const dbPath = path.join(dataDir, 'customers.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Database connection error:', err.message);
    } else {
        console.log('Connected to SQLite database.');
        db.run(`
            CREATE TABLE IF NOT EXISTS customers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                zipcode TEXT,
                address TEXT,
                detail_address TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
    }
});

const getCustomerByPhone = (phone) => {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM customers WHERE phone = ?', [phone], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
};

const upsertCustomer = (customer, isSync = false) => {
    const { phone, name, zipcode, address, detail_address } = customer;
    return new Promise((resolve, reject) => {
        const query = `
            INSERT INTO customers (phone, name, zipcode, address, detail_address, updated_at)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(phone) DO UPDATE SET
                name = excluded.name,
                zipcode = excluded.zipcode,
                address = excluded.address,
                detail_address = excluded.detail_address,
                updated_at = CURRENT_TIMESTAMP
        `;
        db.run(query, [phone, name, zipcode, address, detail_address], async function (err) {
            if (err) {
                reject(err);
            } else {
                // 구글 시트 동기화 시에는 무한루프 방지를 위해 다시 Push하지 않음
                if (!isSync) {
                    try {
                        const { pushCustomerToSheet } = require('./google_sheets');
                        await pushCustomerToSheet(customer);
                    } catch (e) {
                        console.error('구글 시트 연동 실패:', e);
                    }
                }
                resolve(this.lastID);
            }
        });
    });
};

/**
 * 전화번호 배열로 한 번에 DB 조회
 * 왜: 카카오톡 텍스트에서 추출한 여러 전화번호를 한 번의 쿼리로 매칭하기 위함
 * IN 절을 사용하여 네트워크 왕복 최소화
 */
const getCustomersByPhones = (phones) => {
    return new Promise((resolve, reject) => {
        if (!phones || phones.length === 0) {
            return resolve([]);
        }
        // phones 배열 길이만큼 ? 플레이스홀더 생성
        const placeholders = phones.map(() => '?').join(',');
        const query = `SELECT * FROM customers WHERE phone IN (${placeholders})`;
        db.all(query, phones, (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
};

module.exports = {
    db,
    getCustomerByPhone,
    getCustomersByPhones,
    upsertCustomer
};
