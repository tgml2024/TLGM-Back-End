const mysql = require('mysql2');
require('dotenv').config();

// สร้าง connection pool
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// แปลง pool เป็น promise เพื่อให้ใช้ async/await ได้
const promisePool = pool.promise();

// ทดสอบการเชื่อมต่อ
pool.getConnection((err, connection) => {
    if (err) {
        console.error('Error connecting to the database:', err);
        return;
    }
    console.log('Successfully connected to database');
    connection.release();
});

module.exports = promisePool;
