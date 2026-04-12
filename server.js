require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 5000;

// ==================== MIDDLEWARE ====================
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.set('trust proxy', 1);

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Too many requests, please try again later.' },
    validate: { xForwardedForHeader: false }
});
app.use('/api/', limiter);

// ==================== CONFIGURATION ====================
const DOWNLOAD_DIR = path.join(__dirname, 'downloads');
if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

app.use('/downloads', express.static(DOWNLOAD_DIR));

const downloads = new Map();
const users = new Map();
const USERS_FILE = path.join(__dirname, 'users.json');

const JWT_SECRET = process.env.JWT_SECRET || 'vortex_super_secret_key_2024';
const SALT_ROUNDS = 12;

// Working API endpoints
// Using RapidAPI style endpoints (you'll need to sign up for a free API key)
// For now, let's use a different free service
const VIDEO_API = 'https://youtube-video-download-info.p.rapidapi.com/dl';
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || ''; // Add your key in Render environment variables

// Alternative: Use a different free API service
async function getVideoInfoWithAPI(url) {
    // Try multiple approaches
    
    // Method 1: Try to extract video ID from YouTube URL
    let videoId = null;
    if (url.includes('youtu.be')) {
        videoId = url.split('/').pop().split('?')[0];
    } else if (url.includes('youtube.com')) {
        const urlParams = new URLSearchParams(url.split('?')[1]);
        videoId = urlParams.get('v');
    }
    
    if (videoId) {
        // Use a free YouTube info API
        const apiUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
        const response = await fetch(apiUrl);
        const data = await response.json();
        
        if (data && data.title) {
            return {
                title: data.title,
                thumbnail: data.thumbnail_url,
                videoId: videoId
            };
        }
    }
    
    throw new Error('Could not fetch video info');
}

// ==================== PERSISTENT STORAGE ====================
function loadUsers() {
    if (fs.existsSync(USERS_FILE)) {
        try {
            const data = fs.readFileSync(USERS_FILE, 'utf8');
            const savedUsers = JSON.parse(data);
            savedUsers.forEach(user => users.set(user.email, user));
            console.log(`📂 Loaded ${users.size} users`);
        } catch (error) {
            console.error('Error loading users:', error);
        }
    }
}

function saveUsers() {
    try {
        const usersArray = Array.from(users.values());
        fs.writeFileSync(USERS_FILE, JSON.stringify(usersArray, null, 2));
        console.log(`💾 Saved ${usersArray.length} users`);
    } catch (error) {
        console.error('Error saving users:', error);
    }
}

// Auto-cleanup old downloads
setInterval(() => {
    const now = Date.now();
    fs.readdir(DOWNLOAD_DIR, (err, files) => {
        if (err) return;
        files.forEach(file => {
            const filePath = path.join(DOWNLOAD_DIR, file);
            fs.stat(filePath, (err, stats) => {
                if (err) return;
                if (now - stats.mtimeMs > 24 * 60 * 60 * 1000) {
                    fs.unlink(filePath, () => console.log(`🗑️ Cleaned up: ${file}`));
                }
            });
        });
    });
}, 60 * 60 * 1000);

loadUsers();

// ==================== HELPER FUNCTIONS ====================
function detectPlatform(url) {
    const patterns = {
        youtube: /(youtube\.com|youtu\.be)/i,
        instagram: /instagram\.com/i,
        facebook: /facebook\.com|fb\.watch/i,
        tiktok: /tiktok\.com/i,
        twitter: /twitter\.com|x\.com/i,
        pinterest: /pinterest\.com/i
    };
    for (const [platform, pattern] of Object.entries(patterns)) {
        if (pattern.test(url)) return platform;
    }
    return null;
}

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Access denied' });
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.userId = decoded.userId;
        req.userEmail = decoded.email;
        next();
    } catch (error) {
        return res.status(403).json({ error: 'Invalid token' });
    }
}

// ==================== AUTHENTICATION ENDPOINTS ====================
app.post('/api/auth/signup', async (req, res) => {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
        return res.status(400).json({ error: 'All fields are required' });
    }
    if (users.has(email)) {
        return res.status(400).json({ error: 'User already exists' });
    }
    
    try {
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
        const user = {
            id: uuidv4(),
            name, email,
            password: hashedPassword,
            tier: 'Free',
            createdAt: new Date().toISOString(),
            downloadCount: 0
        };
        users.set(email, user);
        saveUsers();
        console.log(`🎉 New user registered: ${email}`);
        
        const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
        const { password: _, ...userWithoutPassword } = user;
        res.json({ success: true, token, user: userWithoutPassword });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    const user = users.get(email);
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });
    
    try {
        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) return res.status(401).json({ error: 'Invalid email or password' });
        
        console.log(`✅ User logged in: ${email}`);
        const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
        const { password: _, ...userWithoutPassword } = user;
        res.json({ success: true, token, user: userWithoutPassword });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/auth/verify', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token provided' });
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = Array.from(users.values()).find(u => u.id === decoded.userId);
        if (!user) return res.status(401).json({ error: 'User not found' });
        const { password: _, ...userWithoutPassword } = user;
        res.json({ success: true, user: userWithoutPassword });
    } catch (error) {
        res.status(401).json({ error: 'Invalid token' });
    }
});

app.post('/api/auth/logout', (req, res) => {
    res.json({ success: true, message: 'Logged out successfully' });
});

// ==================== VIDEO DOWNLOAD ENDPOINTS ====================

app.post('/api/download/info', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });
    
    try {
        const platform = detectPlatform(url);
        if (!platform) return res.status(400).json({ error: 'Unsupported platform' });
        
        console.log(`🔍 Fetching info for ${platform}: ${url.substring(0, 80)}...`);
        
        // For now, return a demo response since APIs are blocked
        // In production, you'd use a paid API service
        const demoInfo = {
            title: `${platform.toUpperCase()} Video - Demo Mode`,
            duration: 120,
            thumbnail: `https://via.placeholder.com/480x360/8b5cf6/ffffff?text=${platform}+Video`,
            uploader: platform,
            views: 1000
        };
        
        console.log(`✅ Returning demo info for ${platform}`);
        
        res.json({
            success: true,
            platform: platform,
            info: demoInfo
        });
        
    } catch (error) {
        console.error(`❌ Info fetch error: ${error.message}`);
        res.status(500).json({ error: 'Failed to fetch video info: ' + error.message });
    }
});

app.post('/api/download', authenticateToken, async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });
    
    try {
        const platform = detectPlatform(url);
        if (!platform) return res.status(400).json({ error: 'Unsupported platform' });
        
        console.log(`📥 Download request for ${platform} by ${req.userEmail}`);
        
        // Update download count
        const user = Array.from(users.values()).find(u => u.id === req.userId);
        if (user) {
            user.downloadCount++;
            users.set(user.email, user);
            saveUsers();
            console.log(`📊 User ${user.email} total downloads: ${user.downloadCount}`);
        }
        
        // For demo, return a sample video
        const jobId = uuidv4();
        const filename = `${jobId}.mp4`;
        const outputPath = path.join(DOWNLOAD_DIR, filename);
        
        downloads.set(jobId, {
            id: jobId,
            status: 'downloading',
            filename: filename,
            filepath: outputPath
        });
        
        // Create a sample text file for demo
        fs.writeFileSync(outputPath, Buffer.from(`Demo video for ${url}`));
        
        const stats = fs.statSync(outputPath);
        console.log(`✅ Demo download complete: ${filename} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
        
        const download = downloads.get(jobId);
        if (download) {
            download.status = 'completed';
            downloads.set(jobId, download);
        }
        
        res.json({ success: true, jobId: jobId });
        
    } catch (error) {
        console.error(`❌ Download error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/status/:jobId', (req, res) => {
    const download = downloads.get(req.params.jobId);
    if (!download) return res.status(404).json({ error: 'Job not found' });
    res.json({
        state: download.status,
        progress: download.status === 'completed' ? 100 : 50,
        result: download.status === 'completed' ? { filename: download.filename } : null,
        error: download.error || null
    });
});

app.get('/api/download/file/:jobId', (req, res) => {
    const download = downloads.get(req.params.jobId);
    if (!download || download.status !== 'completed') {
        return res.status(404).json({ error: 'File not found' });
    }
    const filePath = download.filepath;
    if (fs.existsSync(filePath)) {
        res.download(filePath, download.filename);
    } else {
        res.status(404).json({ error: 'File not found' });
    }
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ==================== START SERVER ====================
app.listen(PORT, () => {
    console.log(`\n✅ Server running on http://localhost:${PORT}`);
    console.log(`📁 Downloads: ${DOWNLOAD_DIR}`);
    console.log(`👥 Users loaded: ${users.size}`);
    console.log(`\n🚀 Ready!\n`);
});
