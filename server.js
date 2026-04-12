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

// ==================== SECURITY MIDDLEWARE ====================
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Too many requests, please try again later.' }
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

// ==================== PERSISTENT STORAGE ====================
function loadUsers() {
    if (fs.existsSync(USERS_FILE)) {
        try {
            const data = fs.readFileSync(USERS_FILE, 'utf8');
            const savedUsers = JSON.parse(data);
            savedUsers.forEach(user => users.set(user.email, user));
            console.log(`📂 Loaded ${users.size} users from file`);
        } catch (error) {
            console.error('Error loading users:', error);
        }
    } else {
        console.log('📂 No existing users file, starting fresh');
    }
}

function saveUsers() {
    try {
        const usersArray = Array.from(users.values());
        fs.writeFileSync(USERS_FILE, JSON.stringify(usersArray, null, 2));
        console.log(`💾 Saved ${usersArray.length} users to file`);
    } catch (error) {
        console.error('Error saving users:', error);
    }
}

// Auto-cleanup old downloads (every hour)
setInterval(() => {
    const now = Date.now();
    fs.readdir(DOWNLOAD_DIR, (err, files) => {
        if (err) return;
        files.forEach(file => {
            const filePath = path.join(DOWNLOAD_DIR, file);
            fs.stat(filePath, (err, stats) => {
                if (err) return;
                if (now - stats.mtimeMs > 24 * 60 * 60 * 1000) {
                    fs.unlink(filePath, () => console.log(`🗑️ Cleaned up old file: ${file}`));
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
    
    if (!token) {
        return res.status(401).json({ error: 'Access denied' });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.userId = decoded.userId;
        req.userEmail = decoded.email;
        next();
    } catch (error) {
        return res.status(403).json({ error: 'Invalid token' });
    }
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ==================== AUTHENTICATION ENDPOINTS ====================
app.post('/api/auth/signup', async (req, res) => {
    const { name, email, password } = req.body;
    
    if (!name || !email || !password) {
        return res.status(400).json({ error: 'All fields are required' });
    }
    
    if (users.has(email)) {
        console.log(`❌ Signup failed: ${email} - User already exists`);
        return res.status(400).json({ error: 'User already exists with this email' });
    }
    
    try {
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
        
        const user = {
            id: uuidv4(),
            name: name,
            email: email,
            password: hashedPassword,
            tier: 'Free',
            createdAt: new Date().toISOString(),
            downloadCount: 0,
            settings: {
                defaultQuality: 'highest',
                language: 'English',
                notifications: true
            }
        };
        
        users.set(email, user);
        saveUsers();
        
        console.log(`\n✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨`);
        console.log(`🎉 NEW USER REGISTERED! 🎉`);
        console.log(`📧 Email: ${email}`);
        console.log(`👤 Name: ${name}`);
        console.log(`⭐ Tier: Free Member`);
        console.log(`📅 Date: ${new Date().toLocaleString()}`);
        console.log(`👥 Total Users: ${users.size}`);
        console.log(`✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨\n`);
        
        const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
        
        const { password: _, ...userWithoutPassword } = user;
        
        res.json({
            success: true,
            message: 'Account created successfully',
            token: token,
            user: userWithoutPassword
        });
        
    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }
    
    console.log(`🔐 Login attempt: ${email}`);
    
    const user = users.get(email);
    if (!user) {
        console.log(`❌ Login failed: ${email} - User not found`);
        return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    try {
        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) {
            console.log(`❌ Login failed: ${email} - Wrong password`);
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        
        console.log(`✅✅✅ LOGIN SUCCESSFUL! ✅✅✅`);
        console.log(`📧 Email: ${email}`);
        console.log(`👤 Name: ${user.name}`);
        console.log(`⭐ Tier: ${user.tier} Member`);
        console.log(`📥 Total Downloads: ${user.downloadCount}`);
        console.log(`🕐 Time: ${new Date().toLocaleString()}\n`);
        
        const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
        
        const { password: _, ...userWithoutPassword } = user;
        
        res.json({
            success: true,
            message: 'Login successful',
            token: token,
            user: userWithoutPassword
        });
        
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/auth/verify', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = Array.from(users.values()).find(u => u.id === decoded.userId);
        
        if (!user) {
            return res.status(401).json({ error: 'User not found' });
        }
        
        const { password: _, ...userWithoutPassword } = user;
        res.json({ success: true, user: userWithoutPassword });
        
    } catch (error) {
        res.status(401).json({ error: 'Invalid token' });
    }
});

app.get('/api/auth/profile', authenticateToken, (req, res) => {
    const user = Array.from(users.values()).find(u => u.id === req.userId);
    
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    const { password: _, ...userWithoutPassword } = user;
    res.json({ success: true, user: userWithoutPassword });
});

app.post('/api/auth/logout', (req, res) => {
    res.json({ success: true, message: 'Logged out successfully' });
});

// ==================== VIDEO DOWNLOAD ENDPOINTS ====================

// Get video info using free API
app.post('/api/download/info', async (req, res) => {
    const { url } = req.body;
    
    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }
    
    try {
        const platform = detectPlatform(url);
        if (!platform) {
            return res.status(400).json({ error: 'Unsupported platform' });
        }
        
        console.log(`🔍 Fetching info for ${platform}: ${url.substring(0, 80)}...`);
        
        // Use free video download API
        const apiUrl = `https://p.oceansaver.in/ajax/download.php?url=${encodeURIComponent(url)}`;
        const response = await fetch(apiUrl);
        const data = await response.json();
        
        if (data && data.video) {
            console.log(`✅ Successfully fetched: "${data.title?.substring(0, 50)}..."`);
            
            res.json({
                success: true,
                platform: platform,
                info: {
                    title: data.title || 'Video Title',
                    duration: data.duration || 0,
                    thumbnail: data.image || `https://via.placeholder.com/480x360/8b5cf6/ffffff?text=${platform}`,
                    uploader: platform,
                    views: 0
                }
            });
        } else {
            throw new Error('No video found in API response');
        }
    } catch (error) {
        console.error(`❌ Info fetch error: ${error.message}`);
        res.status(500).json({ error: 'Failed to fetch video info: ' + error.message });
    }
});

// Download video using free API
app.post('/api/download', authenticateToken, async (req, res) => {
    const { url } = req.body;
    
    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }
    
    try {
        const platform = detectPlatform(url);
        if (!platform) {
            return res.status(400).json({ error: 'Unsupported platform' });
        }
        
        console.log(`\n📥 DOWNLOAD REQUEST`);
        console.log(`👤 User: ${req.userEmail}`);
        console.log(`🎬 Platform: ${platform.toUpperCase()}`);
        console.log(`📎 URL: ${url.substring(0, 80)}...`);
        
        // Update user download count
        const user = Array.from(users.values()).find(u => u.id === req.userId);
        if (user) {
            user.downloadCount++;
            users.set(user.email, user);
            saveUsers();
            console.log(`📊 User ${user.email} total downloads: ${user.downloadCount}`);
        }
        
        // Get video URL from API
        const apiUrl = `https://p.oceansaver.in/ajax/download.php?url=${encodeURIComponent(url)}`;
        const response = await fetch(apiUrl);
        const data = await response.json();
        
        if (!data || !data.video) {
            throw new Error('Could not get video URL from API');
        }
        
        const videoUrl = data.video;
        console.log(`🎬 Video URL obtained`);
        
        const jobId = uuidv4();
        const filename = `${jobId}.mp4`;
        const outputPath = path.join(DOWNLOAD_DIR, filename);
        
        downloads.set(jobId, {
            id: jobId,
            status: 'downloading',
            filename: filename,
            filepath: outputPath,
            platform: platform
        });
        
        console.log(`🆔 Job ID: ${jobId.substring(0, 8)}...`);
        
        // Download the video
        const videoResponse = await fetch(videoUrl);
        const buffer = await videoResponse.arrayBuffer();
        fs.writeFileSync(outputPath, Buffer.from(buffer));
        
        if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
            const size = formatBytes(fs.statSync(outputPath).size);
            console.log(`\n✅✅✅ DOWNLOAD COMPLETE! ✅✅✅`);
            console.log(`📁 Filename: ${filename}`);
            console.log(`📦 Size: ${size}`);
            console.log(`👤 User: ${req.userEmail}\n`);
            
            const download = downloads.get(jobId);
            if (download) {
                download.status = 'completed';
                downloads.set(jobId, download);
            }
        } else {
            throw new Error('Download failed - file not created');
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

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        downloads: downloads.size,
        users: users.size
    });
});

// ==================== START SERVER ====================
const startTime = new Date();

app.listen(PORT, () => {
    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║                    🚀 VORTEX DOWNLOADER API                      ║');
    console.log('╠════════════════════════════════════════════════════════════════╣');
    console.log(`║  📡 Server     : http://localhost:${PORT}                               ║`);
    console.log(`║  🩺 Health     : http://localhost:${PORT}/api/health                    ║`);
    console.log('╠════════════════════════════════════════════════════════════════╣');
    console.log(`║  👥 Users      : ${String(users.size).padStart(4)}                                      ║`);
    console.log(`║  🕐 Started    : ${startTime.toLocaleTimeString().padStart(20)}                              ║`);
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`📁 Downloads folder: ${DOWNLOAD_DIR}`);
    console.log(`🚀 Server is ready to accept requests!\n`);
});
