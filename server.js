// EasyInv API Server - Node.js/Express
// Installation: npm install express cors body-parser

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8010;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// In-memory storage (replace with database in production)
let inventoryData = [];
let connectionLog = [];

// API Key validation (optional)
const API_KEY = process.env.API_KEY || 'dev-only-key';

function validateApiKey(req, res, next) {
    const apiKey = req.headers['authorization']?.replace('Bearer ', '') || 
                   req.headers['x-api-key'];
    
    // Comment this out if you don't want API key validation
    // if (apiKey !== API_KEY) {
    //     return res.status(401).json({ error: 'Invalid API key' });
    // }
    
    next();
}

// Log all requests
app.use((req, res, next) => {
    const logEntry = {
        timestamp: new Date().toISOString(),
        method: req.method,
        path: req.path,
        ip: req.ip,
        userAgent: req.get('user-agent')
    };
    connectionLog.push(logEntry);
    console.log(`${logEntry.method} ${logEntry.path} from ${logEntry.ip}`);
    next();
});

// ============================================
// API ENDPOINTS
// ============================================

// Health check
app.get('/api/status', (req, res) => {
    res.json({
        status: 'online',
        timestamp: new Date().toISOString(),
        totalRecords: inventoryData.length,
        version: '1.0.0'
    });
});

// Receive inventory data from EasyInv (single record)
app.post('/api/inventory', validateApiKey, (req, res) => {
    try {
        const { action, data, source, version } = req.body;
        
        if (action === 'add_inventory' && data) {
            // Add single record
            inventoryData.push({
                ...data,
                receivedAt: new Date().toISOString(),
                source: source || 'Unknown'
            });
            
            console.log('✅ New inventory record received:', data.productBarcode);
            
            res.status(201).json({
                success: true,
                message: 'Inventory record added',
                recordId: inventoryData.length - 1,
                totalRecords: inventoryData.length
            });
        } else if (action === 'sync_inventory' && Array.isArray(data)) {
            // Bulk sync
            const newRecords = data.map(record => ({
                ...record,
                receivedAt: new Date().toISOString(),
                source: source || 'Unknown'
            }));
            
            inventoryData.push(...newRecords);
            
            console.log(`✅ Bulk sync: ${newRecords.length} records received`);
            
            res.status(200).json({
                success: true,
                message: 'Bulk sync completed',
                recordsAdded: newRecords.length,
                totalRecords: inventoryData.length
            });
        } else {
            res.status(400).json({
                success: false,
                error: 'Invalid request format'
            });
        }
    } catch (error) {
        console.error('❌ Error processing inventory data:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// Get all inventory data
app.get('/api/inventory', validateApiKey, (req, res) => {
    const { site, floor, room, shelf, product, limit } = req.query;
    
    let filtered = [...inventoryData];
    
    // Apply filters
    if (site) filtered = filtered.filter(r => r.site === site);
    if (floor) filtered = filtered.filter(r => r.floor === floor);
    if (room) filtered = filtered.filter(r => r.room === room);
    if (shelf) filtered = filtered.filter(r => r.shelf === shelf);
    if (product) filtered = filtered.filter(r => r.productBarcode === product);
    
    // Apply limit
    if (limit) {
        filtered = filtered.slice(-parseInt(limit));
    }
    
    res.json({
        success: true,
        totalRecords: inventoryData.length,
        filteredRecords: filtered.length,
        data: filtered
    });
});

// Get inventory statistics
app.get('/api/stats', (req, res) => {
    const stats = {
        totalRecords: inventoryData.length,
        totalProducts: inventoryData.reduce((sum, r) => sum + (r.quantity || 0), 0),
        uniqueProducts: new Set(inventoryData.map(r => r.productBarcode)).size,
        sites: [...new Set(inventoryData.map(r => r.site).filter(Boolean))],
        floors: [...new Set(inventoryData.map(r => r.floor).filter(Boolean))],
        rooms: [...new Set(inventoryData.map(r => r.room).filter(Boolean))],
        shelves: [...new Set(inventoryData.map(r => r.shelf).filter(Boolean))],
        lastUpdate: inventoryData.length > 0 ? 
            inventoryData[inventoryData.length - 1].receivedAt : null
    };
    
    res.json(stats);
});

// Get connection log
app.get('/api/logs', (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    res.json({
        logs: connectionLog.slice(-limit),
        totalLogs: connectionLog.length
    });
});

// Clear all data (use with caution!)
app.delete('/api/inventory', validateApiKey, (req, res) => {
    const count = inventoryData.length;
    inventoryData = [];
    
    console.log(`🗑️ All inventory data cleared (${count} records)`);
    
    res.json({
        success: true,
        message: `${count} records deleted`,
        totalRecords: 0
    });
});

// Export data as CSV
app.get('/api/export/csv', (req, res) => {
    const headers = ['Timestamp', 'Site', 'Floor', 'Room', 'Shelf', 'Product_Barcode', 'Quantity', 'Received_At'];
    const csvRows = [headers.join(',')];
    
    inventoryData.forEach(record => {
        const row = [
            `"${record.timestamp || ''}"`,
            `"${record.site || 'NULL'}"`,
            `"${record.floor || 'NULL'}"`,
            `"${record.room || 'NULL'}"`,
            `"${record.shelf || 'NULL'}"`,
            `"${record.productBarcode || ''}"`,
            record.quantity || 0,
            `"${record.receivedAt || ''}"`
        ];
        csvRows.push(row.join(','));
    });
    
    const csv = csvRows.join('\n');
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=inventory_${Date.now()}.csv`);
    res.send(csv);
});

// Export data as JSON
app.get('/api/export/json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=inventory_${Date.now()}.json`);
    res.json(inventoryData);
});

// ============================================
// SERVE WEB INTERFACE
// ============================================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║         🚀 EasyInv API Server is Running! 🚀             ║
║                                                            ║
║  📡 API Endpoint: http://localhost:${PORT}/api/inventory    ║
║  🌐 Web Interface: http://localhost:${PORT}                ║
║  📊 Statistics: http://localhost:${PORT}/api/stats         ║
║  🔑 API Key: ${API_KEY}                        ║
║                                                            ║
║  Ready to receive data from EasyInv! 📦                   ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
    `);
    
    console.log('\n📝 Available endpoints:');
    console.log('  POST   /api/inventory      - Receive inventory data');
    console.log('  GET    /api/inventory      - Get all inventory data');
    console.log('  GET    /api/stats          - Get statistics');
    console.log('  GET    /api/status         - Health check');
    console.log('  GET    /api/logs           - Connection logs');
    console.log('  DELETE /api/inventory      - Clear all data');
    console.log('  GET    /api/export/csv     - Export as CSV');
    console.log('  GET    /api/export/json    - Export as JSON');
    console.log('\n✨ Ready to receive inventory scans!\n');
});
