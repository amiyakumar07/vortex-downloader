# VortexDownload - Universal Video Downloader

## Features
- Download videos from YouTube, Instagram, Facebook, TikTok, X (Twitter), Pinterest
- Multiple quality options (1080p, 720p, 480p)
- MP4 video and MP3 audio formats
- User authentication with JWT
- Download history tracking
- Mobile responsive design

## Deployment

### Prerequisites
- Node.js 18+
- Python 3.8+ (for yt-dlp)
- PM2 (for production)
- Nginx (for reverse proxy)
- SSL certificate (Let's Encrypt)

### Quick Deploy
```bash
# Clone repository
git clone https://github.com/yourusername/vortex-downloader.git
cd vortex-downloader

# Install dependencies
cd backend && npm ci --only=production
cd ../frontend && npm ci --only=production

# Setup environment
cp backend/.env.example backend/.env
# Edit .env with your values

# Start with PM2
pm2 start backend/ecosystem.config.js --env production
pm2 save
pm2 startup

# Configure Nginx
sudo cp nginx/vortex-downloader.conf /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/vortex-downloader.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# Setup SSL
sudo certbot --nginx -d yourdomain.com