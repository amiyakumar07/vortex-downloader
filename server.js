require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const util = require('util');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const winston = require('winston');

const execPromise = util.promisify(exec);
const app = express();
const PORT = process.env.PORT || 5000;

// ==================== LOGGING SETUP ====================
const LOGS_DIR = path.join(__dirname, 'logs');
if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
}

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: path.join(LOGS_DIR, 'error.log'), level: 'error' }),
        new winston.transports.File({ filename: path.join(LOGS_DIR, 'combined.log') })
    ]
});

if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.simple()
    }));
}

// ==================== SECURITY MIDDLEWARE ====================
app.use(helmet());

// CORS configuration
app.use(cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
    message: { error: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/', limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ==================== CONFIGURATION ====================
const DOWNLOAD_DIR = path.join(__dirname, 'downloads');
if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

app.use('/downloads', express.static(DOWNLOAD_DIR));

const downloads = new Map();
const users = new Map();
const USERS_FILE = path.join(__dirname, 'users.json');

// Paths for downloaders
const YT_DLP_PATH = 'C:\\Users\\sahoo\\AppData\\Local\\Python\\pythoncore-3.14-64\\Scripts\\yt-dlp.exe';
const UNIVERSAL_API = process.env.UNIVERSAL_API || 'http://localhost:3000';
const PYTHON_PATH = 'C:\\Users\\sahoo\\AppData\\Local\\Python\\pythoncore-3.14-64\\python.exe';

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    logger.error('FATAL: JWT_SECRET is not set in environment variables');
    process.exit(1);
}

const SALT_ROUNDS = 12;

// ==================== PERSISTENT STORAGE ====================
function loadUsers() {
    if (fs.existsSync(USERS_FILE)) {
        try {
            const data = fs.readFileSync(USERS_FILE, 'utf8');
            const savedUsers = JSON.parse(data);
            savedUsers.forEach(user => {
                users.set(user.email, user);
            });
            console.log(`📂 Loaded ${users.size} users from file`);
            return users.size;
        } catch (error) {
            logger.error('Error loading users:', error);
            return 0;
        }
    }
    return 0;
}

function saveUsers() {
    try {
        const usersArray = Array.from(users.values());
        fs.writeFileSync(USERS_FILE, JSON.stringify(usersArray, null, 2));
        console.log(`💾 Saved ${usersArray.length} users to file`);
        return usersArray.length;
    } catch (error) {
        logger.error('Error saving users:', error);
        return 0;
    }
}

// Auto-cleanup old downloads
setInterval(() => {
    const now = Date.now();
    const CLEANUP_HOURS = parseInt(process.env.DOWNLOAD_CLEANUP_HOURS) || 24;
    fs.readdir(DOWNLOAD_DIR, (err, files) => {
        if (err) return;
        files.forEach(file => {
            const filePath = path.join(DOWNLOAD_DIR, file);
            fs.stat(filePath, (err, stats) => {
                if (err) return;
                if (now - stats.mtimeMs > CLEANUP_HOURS * 60 * 60 * 1000) {
                    fs.unlink(filePath, () => {
                        console.log(`🗑️ Cleaned up old file: ${file}`);
                    });
                }
            });
        });
    });
}, 60 * 60 * 1000);

// Load users on startup
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

function getPlatformEmoji(platform) {
    const emojis = {
        youtube: '🎬',
        instagram: '📸',
        facebook: '📘',
        tiktok: '🎵',
        twitter: '🐦',
        pinterest: '📌',
        default: '🎥'
    };
    return emojis[platform] || emojis.default;
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

// ==================== yt-dlp FUNCTIONS ====================
async function getInfoWithYtDlp(url) {
    return new Promise((resolve, reject) => {
        let command = `"${YT_DLP_PATH}" -j --flat-playlist "${url}"`;
        
        exec(command, { timeout: 30000 }, (error, stdout) => {
            if (error || !stdout) {
                const fallbackCommand = `"${PYTHON_PATH}" -m yt_dlp -j --flat-playlist "${url}"`;
                exec(fallbackCommand, { timeout: 30000 }, (fallbackError, fallbackStdout) => {
                    if (fallbackError || !fallbackStdout) {
                        reject(new Error('Failed to fetch video info'));
                    } else {
                        try {
                            resolve(JSON.parse(fallbackStdout));
                        } catch (e) {
                            reject(e);
                        }
                    }
                });
            } else {
                try {
                    resolve(JSON.parse(stdout));
                } catch (e) {
                    reject(e);
                }
            }
        });
    });
}

async function downloadWithYtDlp(url, outputPath, format) {
    return new Promise((resolve, reject) => {
        let command;
        if (format === 'mp3') {
            command = `"${YT_DLP_PATH}" -x --audio-format mp3 --audio-quality 0 -o "${outputPath}" "${url}"`;
        } else {
            command = `"${YT_DLP_PATH}" -f "best[ext=mp4]/best" --merge-output-format mp4 -o "${outputPath}" "${url}"`;
        }
        
        exec(command, { timeout: 300000 }, (error) => {
            if (error) {
                let fallbackCommand;
                if (format === 'mp3') {
                    fallbackCommand = `"${PYTHON_PATH}" -m yt_dlp -x --audio-format mp3 --audio-quality 0 -o "${outputPath}" "${url}"`;
                } else {
                    fallbackCommand = `"${PYTHON_PATH}" -m yt_dlp -f "best[ext=mp4]/best" --merge-output-format mp4 -o "${outputPath}" "${url}"`;
                }
                
                exec(fallbackCommand, { timeout: 300000 }, (fallbackError) => {
                    if (fallbackError || !fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
                        reject(new Error('Download failed'));
                    } else {
                        resolve(outputPath);
                    }
                });
            } else if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
                resolve(outputPath);
            } else {
                reject(new Error('File not created'));
            }
        });
    });
}

async function getPinterestInfo(url) {
    const response = await fetch(`${UNIVERSAL_API}/api/pinterest/download?url=${encodeURIComponent(url)}`);
    const data = await response.json();
    
    if (data.success && data.data) {
        return {
            title: data.data.title || 'Pinterest Video',
            thumbnail: data.data.thumbnail,
            duration: 0,
            uploader: 'Pinterest'
        };
    }
    throw new Error('No Pinterest media found');
}

async function downloadPinterest(url, outputPath) {
    const response = await fetch(`${UNIVERSAL_API}/api/pinterest/download?url=${encodeURIComponent(url)}`);
    const data = await response.json();
    
    if (data.success && data.data && data.data.downloads && data.data.downloads.length > 0) {
        const videoDownload = data.data.downloads.find(d => d.format === 'MP4' || d.format === 'mp4');
        const mediaUrl = videoDownload?.url || data.data.downloads[0].url;
        
        if (mediaUrl) {
            const mediaResponse = await fetch(mediaUrl);
            const arrayBuffer = await mediaResponse.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            fs.writeFileSync(outputPath, buffer);
            return outputPath;
        }
    }
    throw new Error('No downloadable media found');
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
        logger.error('Signup error:', error);
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
        logger.error('Login error:', error);
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
app.post('/api/download/info', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });
    
    try {
        const platform = detectPlatform(url);
        if (!platform) return res.status(400).json({ error: 'Unsupported platform' });
        
        const emoji = getPlatformEmoji(platform);
        console.log(`\n🔍 ${emoji} FETCHING INFO for ${platform.toUpperCase()} ${emoji}`);
        console.log(`📎 URL: ${url.substring(0, 80)}...`);
        
        let info;
        
        if (platform === 'pinterest') {
            info = await getPinterestInfo(url);
        } else {
            const ytInfo = await getInfoWithYtDlp(url);
            info = {
                title: ytInfo.title || ytInfo.fulltitle || 'Untitled Video',
                duration: ytInfo.duration || 0,
                thumbnail: ytInfo.thumbnail || ytInfo.thumbnails?.[0]?.url,
                uploader: ytInfo.uploader || ytInfo.channel || 'Unknown',
                views: ytInfo.view_count || 0
            };
            
            if (info.thumbnail && info.thumbnail.startsWith('//')) {
                info.thumbnail = 'https:' + info.thumbnail;
            }
            if (info.thumbnail && platform === 'youtube') {
                info.thumbnail = info.thumbnail.replace('hqdefault', 'maxresdefault');
            }
        }
        
        console.log(`✅ ${emoji} Successfully fetched: "${info.title?.substring(0, 50)}..."`);
        console.log(`⏱️ Duration: ${info.duration}s | 👁️ Views: ${info.views?.toLocaleString() || 'N/A'}\n`);
        
        res.json({
            success: true,
            platform: platform,
            info: {
                title: info.title,
                duration: info.duration,
                thumbnail: info.thumbnail || `https://via.placeholder.com/480x360/6366f1/ffffff?text=${platform}`,
                uploader: info.uploader || platform,
                views: info.views || 0
            }
        });
    } catch (error) {
        console.error(`❌ Info fetch error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/download', authenticateToken, async (req, res) => {
    const { url, format = 'mp4' } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });
    
    try {
        const platform = detectPlatform(url);
        if (!platform) return res.status(400).json({ error: 'Unsupported platform' });
        
        const emoji = getPlatformEmoji(platform);
        console.log(`\n📥 ${emoji} DOWNLOAD REQUEST ${emoji}`);
        console.log(`👤 User: ${req.userEmail}`);
        console.log(`🎬 Platform: ${platform.toUpperCase()}`);
        console.log(`📎 URL: ${url.substring(0, 80)}...`);
        
        const user = Array.from(users.values()).find(u => u.id === req.userId);
        if (user) {
            user.downloadCount++;
            users.set(user.email, user);
            saveUsers();
            console.log(`📊 User ${user.email} total downloads: ${user.downloadCount}`);
        }
        
        const jobId = uuidv4();
        const filename = `${jobId}.${format === 'mp3' ? 'mp3' : 'mp4'}`;
        const outputPath = path.join(DOWNLOAD_DIR, filename);
        
        downloads.set(jobId, {
            id: jobId,
            status: 'downloading',
            filename: filename,
            filepath: outputPath,
            platform: platform
        });
        
        console.log(`🆔 Job ID: ${jobId.substring(0, 8)}...`);
        console.log(`📄 Format: ${format.toUpperCase()}\n`);
        
        (async () => {
            try {
                if (platform === 'pinterest') {
                    await downloadPinterest(url, outputPath);
                } else {
                    await downloadWithYtDlp(url, outputPath, format);
                }
                
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
            } catch (error) {
                console.error(`\n❌ DOWNLOAD FAILED: ${error.message}\n`);
                const download = downloads.get(jobId);
                if (download) {
                    download.status = 'failed';
                    download.error = error.message;
                    downloads.set(jobId, download);
                }
            }
        })();
        
        res.json({ success: true, jobId: jobId });
    } catch (error) {
        console.error('Download start error:', error);
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
app.get('/api/health', async (req, res) => {
    const healthcheck = {
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        checks: {
            memory: process.memoryUsage(),
            downloads: downloads.size,
            users: users.size
        }
    };
    res.json(healthcheck);
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
    
    logger.info(`Server started on port ${PORT}`);
});
