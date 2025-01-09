const db = require('../../db');

class DashboardController {
    async dashboardAdminDay(req, res) {
        try {
            const { date } = req.query;
            const timezone = '+07:00';

            if (!date) {
                return res.status(400).json({
                    success: false,
                    error: 'Please provide date parameter'
                });
            }

            await db.execute('SET time_zone = ?', [timezone]);

            const [forwardsData] = await db.execute(`
                SELECT 
                    HOUR(created_at) as hour,
                    COUNT(*) as total_forwards
                FROM forward
                WHERE DATE(created_at) = ?
                GROUP BY HOUR(created_at)
                ORDER BY hour
            `, [date]);

            const [detailsData] = await db.execute(`
                SELECT 
                    HOUR(insert_time) as hour,
                    SUM(success_count) as total_success,
                    SUM(fail_count) as total_fail
                FROM forward_detail
                WHERE DATE(insert_time) = ?
                GROUP BY HOUR(insert_time)
                ORDER BY hour
            `, [date]);

            // สร้างข้อมูลสำหรับทุกชั่วโมง
            const hourlyData = Array.from({ length: 24 }, (_, hour) => {
                const forward = forwardsData.find(d => d.hour === hour) || { total_forwards: 0 };
                const detail = detailsData.find(d => d.hour === hour) || { total_success: 0, total_fail: 0 };
                
                return {
                    hour: `${hour.toString().padStart(2, '0')}:00`,
                    forwards: [{
                        total: forward.total_forwards
                    }],
                    details: [{
                        total_success: detail.total_success,
                        total_fail: detail.total_fail
                    }]
                };
            });

            return res.json({
                success: true,
                data: {
                    date,
                    hours: hourlyData,
                    chart: {
                        labels: hourlyData.map(h => h.hour),
                        datasets: [
                            {
                                label: 'Forwards',
                                data: hourlyData.map(h => h.forwards[0].total),
                                borderColor: 'rgb(75, 192, 192)',
                                tension: 0.1
                            },
                            {
                                label: 'Success',
                                data: hourlyData.map(h => h.details[0].total_success),
                                borderColor: 'rgb(54, 162, 235)',
                                tension: 0.1
                            },
                            {
                                label: 'Fail',
                                data: hourlyData.map(h => h.details[0].total_fail),
                                borderColor: 'rgb(255, 99, 132)',
                                tension: 0.1
                            }
                        ]
                    }
                }
            });

        } catch (error) {
            console.error('Error generating dashboard data:', error);
            res.status(500).json({ 
                success: false,
                error: 'Failed to generate dashboard data',
                details: error.message 
            });
        }
    }

    async dashboardAdminMonth(req, res) {
        try {
            const { month } = req.query; // Format: YYYY-MM
            const timezone = '+07:00';

            if (!month) {
                return res.status(400).json({
                    success: false,
                    error: 'Please provide month parameter (YYYY-MM)'
                });
            }

            await db.execute('SET time_zone = ?', [timezone]);

            const [forwardsData] = await db.execute(`
                SELECT 
                    DAY(created_at) as day,
                    COUNT(*) as total_forwards
                FROM forward
                WHERE DATE_FORMAT(created_at, '%Y-%m') = ?
                GROUP BY DAY(created_at)
                ORDER BY day
            `, [month]);

            const [detailsData] = await db.execute(`
                SELECT 
                    DAY(insert_time) as day,
                    SUM(success_count) as total_success,
                    SUM(fail_count) as total_fail
                FROM forward_detail
                WHERE DATE_FORMAT(insert_time, '%Y-%m') = ?
                GROUP BY DAY(insert_time)
                ORDER BY day
            `, [month]);

            // สร้างข้อมูลสำหรับทุกวันในเดือน
            const [year, monthNum] = month.split('-');
            const daysInMonth = new Date(parseInt(year), parseInt(monthNum), 0).getDate();

            const dailyData = Array.from({ length: daysInMonth }, (_, i) => {
                const day = i + 1;
                const forward = forwardsData.find(d => d.day === day) || { total_forwards: 0 };
                const detail = detailsData.find(d => d.day === day) || { total_success: 0, total_fail: 0 };

                return {
                    date: `${month}-${day.toString().padStart(2, '0')}`,
                    forwards: [{
                        total: forward.total_forwards
                    }],
                    details: [{
                        total_success: detail.total_success,
                        total_fail: detail.total_fail
                    }]
                };
            });

            return res.json({
                success: true,
                data: {
                    month,
                    days: dailyData,
                    chart: {
                        labels: dailyData.map(d => d.date),
                        datasets: [
                            {
                                label: 'Forwards',
                                data: dailyData.map(d => d.forwards[0].total),
                                borderColor: 'rgb(75, 192, 192)',
                                tension: 0.1
                            },
                            {
                                label: 'Success',
                                data: dailyData.map(d => d.details[0].total_success),
                                borderColor: 'rgb(54, 162, 235)',
                                tension: 0.1
                            },
                            {
                                label: 'Fail',
                                data: dailyData.map(d => d.details[0].total_fail),
                                borderColor: 'rgb(255, 99, 132)',
                                tension: 0.1
                            }
                        ]
                    }
                }
            });

        } catch (error) {
            console.error('Error generating dashboard data:', error);
            res.status(500).json({ 
                success: false,
                error: 'Failed to generate dashboard data',
                details: error.message 
            });
        }
    }

    async dashboardAdminYear(req, res) {
        try {
            const { year } = req.query;
            const timezone = '+07:00';

            if (!year) {
                return res.status(400).json({
                    success: false,
                    error: 'Please provide year parameter'
                });
            }

            await db.execute('SET time_zone = ?', [timezone]);

            const [forwardsData] = await db.execute(`
                SELECT 
                    MONTH(created_at) as month,
                    COUNT(*) as total_forwards
                FROM forward
                WHERE YEAR(created_at) = ?
                GROUP BY MONTH(created_at)
                ORDER BY month
            `, [year]);

            const [detailsData] = await db.execute(`
                SELECT 
                    MONTH(insert_time) as month,
                    SUM(success_count) as total_success,
                    SUM(fail_count) as total_fail
                FROM forward_detail
                WHERE YEAR(insert_time) = ?
                GROUP BY MONTH(insert_time)
                ORDER BY month
            `, [year]);

            // สร้างข้อมูลสำหรับทุกเดือน
            const monthlyData = Array.from({ length: 12 }, (_, i) => {
                const month = i + 1;
                const forward = forwardsData.find(d => d.month === month) || { total_forwards: 0 };
                const detail = detailsData.find(d => d.month === month) || { total_success: 0, total_fail: 0 };

                return {
                    date: `${year}-${month.toString().padStart(2, '0')}`,
                    forwards: [{
                        total: forward.total_forwards
                    }],
                    details: [{
                        total_success: detail.total_success,
                        total_fail: detail.total_fail
                    }]
                };
            });

            return res.json({
                success: true,
                data: {
                    year,
                    months: monthlyData,
                    chart: {
                        labels: monthlyData.map(m => m.date),
                        datasets: [
                            {
                                label: 'Forwards',
                                data: monthlyData.map(m => m.forwards[0].total),
                                borderColor: 'rgb(75, 192, 192)',
                                tension: 0.1
                            },
                            {
                                label: 'Success',
                                data: monthlyData.map(m => m.details[0].total_success),
                                borderColor: 'rgb(54, 162, 235)',
                                tension: 0.1
                            },
                            {
                                label: 'Fail',
                                data: monthlyData.map(m => m.details[0].total_fail),
                                borderColor: 'rgb(255, 99, 132)',
                                tension: 0.1
                            }
                        ]
                    }
                }
            });

        } catch (error) {
            console.error('Error generating dashboard data:', error);
            res.status(500).json({ 
                success: false,
                error: 'Failed to generate dashboard data',
                details: error.message 
            });
        }
    }

    async dashboardAdminTotal(req, res) {
        try {
            const timezone = '+07:00';
            await db.execute('SET time_zone = ?', [timezone]);

            // ดึงข้อมูลรวมทั้งหมด
            const [totalData] = await db.execute(`
                SELECT 
                    COUNT(DISTINCT f.forward_id) as total_forwards,
                    SUM(fd.success_count) as total_success,
                    SUM(fd.fail_count) as total_fail
                FROM forward f
                LEFT JOIN forward_detail fd ON f.forward_id = fd.forward_id
            `);

            return res.json({
                success: true,
                data: {
                    summary: {
                        total_forwards: totalData[0].total_forwards,
                        total_success: totalData[0].total_success || 0,
                        total_fail: totalData[0].total_fail || 0
                    }
                }
            });

        } catch (error) {
            console.error('Error generating total stats:', error);
            res.status(500).json({ 
                success: false,
                error: 'Failed to generate total stats',
                details: error.message 
            });
        }
    }
}

module.exports = new DashboardController();