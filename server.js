const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

const users = new Map();
const returns = new Map();

const demoReturns = [
    {
        id: 'demo-1',
        userId: 'demo',
        retailer: 'Amazon',
        orderNumber: 'AMZ-112-9384756',
        itemName: 'Wireless Headphones',
        returnInitiated: new Date('2026-02-01'),
        returnDeadline: new Date('2026-03-01'),
        expectedRefund: 79.99,
        status: 'in_transit',
        trackingNumber: '1Z999AA10123456784',
        refundReceived: false,
        lastUpdated: new Date('2026-02-10')
    },
    {
        id: 'demo-2',
        userId: 'demo',
        retailer: 'Target',
        orderNumber: 'TGT-8293847',
        itemName: 'Coffee Maker',
        returnInitiated: new Date('2026-01-25'),
        returnDeadline: new Date('2026-02-25'),
        expectedRefund: 49.99,
        status: 'received',
        trackingNumber: '9405511899223197428490',
        refundReceived: false,
        lastUpdated: new Date('2026-02-08')
    },
    {
        id: 'demo-3',
        userId: 'demo',
        retailer: 'Walmart',
        orderNumber: 'WMT-45678901',
        itemName: 'Desk Lamp',
        returnInitiated: new Date('2026-01-15'),
        returnDeadline: new Date('2026-02-15'),
        expectedRefund: 29.99,
        status: 'refund_issued',
        trackingNumber: '420934569405511899223197428490',
        refundReceived: true,
        refundDate: new Date('2026-02-12'),
        lastUpdated: new Date('2026-02-12')
    },
    {
        id: 'demo-4',
        userId: 'demo',
        retailer: 'Best Buy',
        orderNumber: 'BBY-9876543',
        itemName: 'USB-C Cable',
        returnInitiated: new Date('2026-02-14'),
        returnDeadline: new Date('2026-03-14'),
        expectedRefund: 19.99,
        status: 'pending',
        trackingNumber: null,
        refundReceived: false,
        lastUpdated: new Date('2026-02-14')
    },
    {
        id: 'demo-5',
        userId: 'demo',
        retailer: 'Nordstrom',
        orderNumber: 'NRD-2938475',
        itemName: 'Winter Jacket',
        returnInitiated: new Date('2026-02-05'),
        returnDeadline: new Date('2026-02-20'),
        expectedRefund: 149.99,
        status: 'delayed',
        trackingNumber: '1Z999AA10123456785',
        refundReceived: false,
        lastUpdated: new Date('2026-02-16'),
        daysOverdue: 1
    }
];

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Access token required' });
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid token' });
        req.user = user;
        next();
    });
};

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'ReturnGuard API is running' });
});

app.post('/api/register', async (req, res) => {
    try {
        const { email, password, name } = req.body;
        if (!email || !password || !name) {
            return res.status(400).json({ error: 'All fields required' });
        }
        if (users.has(email)) {
            return res.status(400).json({ error: 'User already exists' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const userId = uuidv4();
        users.set(email, {
            id: userId,
            email,
            password: hashedPassword,
            name,
            createdAt: new Date(),
            emailConnected: false
        });
        res.json({ message: 'User registered successfully', userId });
    } catch (error) {
        res.status(500).json({ error: 'Registration failed' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = users.get(email);
        if (!user) return res.status(400).json({ error: 'Invalid credentials' });
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) return res.status(400).json({ error: 'Invalid credentials' });
        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '24h' });
        res.json({
            token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                emailConnected: user.emailConnected
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Login failed' });
    }
});

app.post('/api/demo-login', (req, res) => {
    try {
        const demoUser = { id: 'demo', email: 'demo@returnguard.com', name: 'Demo User' };
        const token = jwt.sign({ id: demoUser.id, email: demoUser.email }, JWT_SECRET, { expiresIn: '24h' });
        demoReturns.forEach(ret => returns.set(ret.id, ret));
        res.json({
            token,
            user: { ...demoUser, emailConnected: true, isDemo: true }
        });
    } catch (error) {
        res.status(500).json({ error: 'Demo login failed' });
    }
});

app.get('/api/profile', authenticateToken, (req, res) => {
    const user = users.get(req.user.email) || {
        id: 'demo',
        email: 'demo@returnguard.com',
        name: 'Demo User',
        emailConnected: true
    };
    res.json({
        id: user.id,
        email: user.email,
        name: user.name,
        emailConnected: user.emailConnected
    });
});

app.post('/api/scan-emails', authenticateToken, (req, res) => {
    try {
        const userId = req.user.id;
        const mockReturns = [{
            id: uuidv4(),
            userId,
            retailer: 'Amazon',
            orderNumber: 'AMZ-' + Math.floor(Math.random() * 1000000),
            itemName: 'Sample Product',
            returnInitiated: new Date(),
            returnDeadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            expectedRefund: Math.floor(Math.random() * 200) + 20,
            status: 'pending',
            trackingNumber: null,
            refundReceived: false,
            lastUpdated: new Date()
        }];
        mockReturns.forEach(ret => returns.set(ret.id, ret));
        res.json({
            success: true,
            message: `Scanned and found ${mockReturns.length} new returns`,
            newReturns: mockReturns.length
        });
    } catch (error) {
        res.status(500).json({ error: 'Email scan failed' });
    }
});

app.get('/api/returns', authenticateToken, (req, res) => {
    try {
        const userId = req.user.id;
        const userReturns = Array.from(returns.values())
            .filter(ret => ret.userId === userId)
            .sort((a, b) => b.returnInitiated - a.returnInitiated);
        res.json(userReturns);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch returns' });
    }
});

app.get('/api/returns/:id', authenticateToken, (req, res) => {
    try {
        const returnItem = returns.get(req.params.id);
        if (!returnItem) return res.status(404).json({ error: 'Return not found' });
        if (returnItem.userId !== req.user.id) return res.status(403).json({ error: 'Unauthorized' });
        res.json(returnItem);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch return' });
    }
});

app.patch('/api/returns/:id', authenticateToken, (req, res) => {
    try {
        const returnItem = returns.get(req.params.id);
        if (!returnItem) return res.status(404).json({ error: 'Return not found' });
        if (returnItem.userId !== req.user.id) return res.status(403).json({ error: 'Unauthorized' });
        const { status, trackingNumber, refundReceived } = req.body;
        if (status) returnItem.status = status;
        if (trackingNumber) returnItem.trackingNumber = trackingNumber;
        if (refundReceived !== undefined) {
            returnItem.refundReceived = refundReceived;
            if (refundReceived) returnItem.refundDate = new Date();
        }
        returnItem.lastUpdated = new Date();
        returns.set(req.params.id, returnItem);
        res.json(returnItem);
    } catch (error) {
        res.status(500).json({ error: 'Failed to update return' });
    }
});

app.get('/api/analytics', authenticateToken, (req, res) => {
    try {
        const userId = req.user.id;
        const userReturns = Array.from(returns.values()).filter(ret => ret.userId === userId);
        const stats = {
            totalReturns: userReturns.length,
            activeReturns: userReturns.filter(r => !r.refundReceived).length,
            completedReturns: userReturns.filter(r => r.refundReceived).length,
            totalRefundsReceived: userReturns.filter(r => r.refundReceived).reduce((sum, r) => sum + r.expectedRefund, 0),
            pendingRefunds: userReturns.filter(r => !r.refundReceived).reduce((sum, r) => sum + r.expectedRefund, 0),
            statusBreakdown: {
                pending: userReturns.filter(r => r.status === 'pending').length,
                in_transit: userReturns.filter(r => r.status === 'in_transit').length,
                received: userReturns.filter(r => r.status === 'received').length,
                refund_issued: userReturns.filter(r => r.status === 'refund_issued').length,
                delayed: userReturns.filter(r => r.status === 'delayed').length
            }
        };
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch analytics' });
    }
});

app.delete('/api/returns/:id', authenticateToken, (req, res) => {
    try {
        const returnItem = returns.get(req.params.id);
        if (!returnItem) return res.status(404).json({ error: 'Return not found' });
        if (returnItem.userId !== req.user.id) return res.status(403).json({ error: 'Unauthorized' });
        returns.delete(req.params.id);
        res.json({ success: true, message: 'Return deleted' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete return' });
    }
});

app.listen(PORT, () => {
    console.log(`ReturnGuard API running on port ${PORT}`);
});
