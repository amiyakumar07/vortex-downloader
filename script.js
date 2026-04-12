const API_URL = 'https://new-name-here.ngrok-free.dev/api';

console.log('🔗 Connected to backend:', API_URL);

let authToken = localStorage.getItem('authToken') || null;
let currentUser = null;

// Global variables
let currentJobId = null;
let pollInterval = null;
let currentQuality = 'highest';
let currentFormat = 'mp4';
let downloadHistory = JSON.parse(localStorage.getItem('downloadHistory') || '[]');

// ==================== TEST BACKEND CONNECTION ====================
async function testBackendConnection() {
    try {
        const response = await fetch(`${API_URL}/health`);
        const data = await response.json();
        console.log('✅ Backend connected:', data);
        return true;
    } catch (error) {
        console.error('❌ Backend connection failed:', error);
        return false;
    }
}

// ==================== AUTHENTICATION FUNCTIONS ====================
async function signup(name, email, password) {
    try {
        const response = await fetch(`${API_URL}/auth/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, password })
        });
        const data = await response.json();
        
        if (data.success) {
            authToken = data.token;
            currentUser = data.user;
            localStorage.setItem('authToken', authToken);
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
            updateUIForLoggedInUser();
            return true;
        } else {
            alert(data.error);
            return false;
        }
    } catch (error) {
        console.error('Signup error:', error);
        alert('Signup failed');
        return false;
    }
}

async function login(email, password, remember) {
    try {
        const response = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await response.json();
        
        if (data.success) {
            authToken = data.token;
            currentUser = data.user;
            localStorage.setItem('authToken', authToken);
            if (remember) {
                localStorage.setItem('currentUser', JSON.stringify(currentUser));
            }
            updateUIForLoggedInUser();
            return true;
        } else {
            alert(data.error);
            return false;
        }
    } catch (error) {
        console.error('Login error:', error);
        alert('Login failed');
        return false;
    }
}

async function logout() {
    authToken = null;
    currentUser = null;
    localStorage.removeItem('authToken');
    localStorage.removeItem('currentUser');
    updateUIForLoggedOutUser();
    alert('Logged out successfully');
}

async function verifyToken() {
    if (!authToken) return false;
    try {
        const response = await fetch(`${API_URL}/auth/verify`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await response.json();
        if (data.success) {
            currentUser = data.user;
            updateUIForLoggedInUser();
            return true;
        }
        return false;
    } catch (error) {
        return false;
    }
}

function updateUIForLoggedInUser() {
    const authButtons = document.getElementById('authButtons');
    const userMenu = document.getElementById('userMenu');
    const userName = document.getElementById('userName');
    const userTier = document.getElementById('userTier');
    const userAvatar = document.getElementById('userAvatar');
    const sidebarUserName = document.getElementById('sidebarUserName');
    const sidebarUserStatus = document.getElementById('sidebarUserStatus');
    const sidebarUserBadge = document.getElementById('sidebarUserBadge');
    const sidebarAuthActions = document.getElementById('sidebarAuthActions');
    const sidebarUserActions = document.getElementById('sidebarUserActions');
    
    if (authButtons) authButtons.style.display = 'none';
    if (userMenu) userMenu.style.display = 'block';
    
    if (currentUser) {
        const avatarUrl = `https://ui-avatars.com/api/?background=8b5cf6&color=fff&name=${encodeURIComponent(currentUser.name)}`;
        if (userName) userName.textContent = currentUser.name;
        if (userTier) userTier.textContent = `${currentUser.tier} Member`;
        if (userAvatar) userAvatar.src = avatarUrl;
        if (sidebarUserName) sidebarUserName.textContent = currentUser.name;
        if (sidebarUserStatus) sidebarUserStatus.textContent = `${currentUser.tier} Member`;
        if (sidebarUserBadge) sidebarUserBadge.style.display = 'inline-block';
        if (sidebarAuthActions) sidebarAuthActions.style.display = 'none';
        if (sidebarUserActions) sidebarUserActions.style.display = 'flex';
    }
    updateHistoryBadge();
}

function updateUIForLoggedOutUser() {
    const authButtons = document.getElementById('authButtons');
    const userMenu = document.getElementById('userMenu');
    const sidebarUserName = document.getElementById('sidebarUserName');
    const sidebarUserStatus = document.getElementById('sidebarUserStatus');
    const sidebarUserBadge = document.getElementById('sidebarUserBadge');
    const sidebarAuthActions = document.getElementById('sidebarAuthActions');
    const sidebarUserActions = document.getElementById('sidebarUserActions');
    
    if (authButtons) authButtons.style.display = 'flex';
    if (userMenu) userMenu.style.display = 'none';
    if (sidebarUserName) sidebarUserName.textContent = 'Welcome, Guest';
    if (sidebarUserStatus) sidebarUserStatus.textContent = 'Sign in for unlimited access';
    if (sidebarUserBadge) sidebarUserBadge.style.display = 'none';
    if (sidebarAuthActions) sidebarAuthActions.style.display = 'flex';
    if (sidebarUserActions) sidebarUserActions.style.display = 'none';
}

function updateHistoryBadge() {
    const badge = document.getElementById('historyBadge');
    if (badge) {
        const count = downloadHistory.length;
        badge.textContent = count;
        badge.style.display = count > 0 ? 'inline-block' : 'none';
    }
}

function addToHistory(videoTitle, filename, platform) {
    const historyItem = {
        id: Date.now(),
        title: videoTitle,
        filename: filename,
        platform: platform,
        date: new Date().toISOString()
    };
    downloadHistory.unshift(historyItem);
    if (downloadHistory.length > 50) downloadHistory.pop();
    localStorage.setItem('downloadHistory', JSON.stringify(downloadHistory));
    updateHistoryBadge();
}

function checkSavedUser() {
    const savedUser = localStorage.getItem('currentUser');
    const savedToken = localStorage.getItem('authToken');
    if (savedUser && savedToken) {
        currentUser = JSON.parse(savedUser);
        authToken = savedToken;
        updateUIForLoggedInUser();
    }
}

// ==================== QUALITY & FORMAT SELECTORS ====================
document.querySelectorAll('.quality-option').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.quality-option').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentQuality = btn.dataset.quality;
    });
});

document.querySelectorAll('.format-option').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.format-option').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFormat = btn.dataset.format;
    });
});

// ==================== FETCH VIDEO INFO ====================
document.getElementById('fetchInfoBtn').addEventListener('click', async () => {
    const url = document.getElementById('urlInput').value.trim();
    if (!url) {
        showError('Please enter a video URL');
        return;
    }
    
    const fetchBtn = document.getElementById('fetchInfoBtn');
    fetchBtn.disabled = true;
    fetchBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Analyzing...';
    
    document.getElementById('loading').style.display = 'block';
    document.getElementById('videoInfo').style.display = 'none';
    document.getElementById('errorBox').style.display = 'none';
    
    try {
        const response = await fetch(`${API_URL}/download/info`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });
        const data = await response.json();
        
        if (data.success) {
            displayVideoInfo(data.info, data.platform);
            document.getElementById('loading').style.display = 'none';
            document.getElementById('videoInfo').style.display = 'flex';
        } else {
            showError(data.error || 'Failed to fetch video info');
            document.getElementById('loading').style.display = 'none';
        }
    } catch (error) {
        showError('Error: ' + error.message);
        document.getElementById('loading').style.display = 'none';
    } finally {
        fetchBtn.disabled = false;
        fetchBtn.innerHTML = '<i class="fas fa-magic"></i> Analyze';
    }
});

function displayVideoInfo(info, platform) {
    document.getElementById('videoTitle').textContent = info.title || 'Video Title';
    document.getElementById('videoDuration').textContent = formatDuration(info.duration);
    if (info.views) {
        document.getElementById('videoViews').textContent = formatNumber(info.views);
    }
    
    const thumb = document.getElementById('thumbnail');
    if (info.thumbnail) {
        thumb.src = info.thumbnail;
    } else {
        thumb.src = `https://via.placeholder.com/480x360/8b5cf6/ffffff?text=${platform}`;
    }
    
    const badge = document.getElementById('platformBadge');
    const platformConfig = {
        youtube: { icon: 'fab fa-youtube', color: '#ff0000', name: 'YouTube' },
        instagram: { icon: 'fab fa-instagram', color: '#e4405f', name: 'Instagram' },
        facebook: { icon: 'fab fa-facebook', color: '#1877f2', name: 'Facebook' },
        tiktok: { icon: 'fab fa-tiktok', color: '#ffffff', name: 'TikTok' },
        twitter: { icon: 'fab fa-x-twitter', color: '#000000', name: 'X' },
        pinterest: { icon: 'fab fa-pinterest', color: '#e60023', name: 'Pinterest' }
    };
    const config = platformConfig[platform] || { icon: 'fas fa-video', color: '#8b5cf6', name: platform };
    badge.innerHTML = `<i class="${config.icon}" style="color: ${config.color}"></i> ${config.name}`;
}

// ==================== DOWNLOAD FUNCTION ====================
document.getElementById('downloadBtn')?.addEventListener('click', async () => {
    const url = document.getElementById('urlInput').value.trim();
    const videoTitle = document.getElementById('videoTitle').textContent;
    const platformBadge = document.getElementById('platformBadge');
    const platform = platformBadge?.textContent?.trim() || 'Unknown';
    
    if (!url) {
        showError('Please enter a video URL');
        return;
    }
    
    if (!authToken) {
        alert('Please login or sign up to download videos!');
        document.getElementById('loginModal').style.display = 'flex';
        return;
    }
    
    const downloadBtn = document.getElementById('downloadBtn');
    downloadBtn.disabled = true;
    downloadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
    
    showProgress();
    
    try {
        const response = await fetch(`${API_URL}/download`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ url, quality: currentQuality, format: currentFormat })
        });
        const data = await response.json();
        
        if (data.success) {
            currentJobId = data.jobId;
            window.currentVideoInfo = { title: videoTitle, platform: platform };
            startPolling(currentJobId);
        } else {
            showError(data.error || 'Download failed');
            hideProgress();
            downloadBtn.disabled = false;
            downloadBtn.innerHTML = '<i class="fas fa-download"></i> Download Now <i class="fas fa-arrow-right"></i>';
        }
    } catch (error) {
        showError('Error: ' + error.message);
        hideProgress();
        downloadBtn.disabled = false;
        downloadBtn.innerHTML = '<i class="fas fa-download"></i> Download Now <i class="fas fa-arrow-right"></i>';
    }
});

function startPolling(jobId) {
    if (pollInterval) clearInterval(pollInterval);
    
    pollInterval = setInterval(async () => {
        try {
            const response = await fetch(`${API_URL}/status/${jobId}`);
            const status = await response.json();
            
            updateProgress(status.progress || 0);
            
            if (status.state === 'completed') {
                clearInterval(pollInterval);
                onDownloadComplete(status.result);
            } else if (status.state === 'failed') {
                clearInterval(pollInterval);
                onDownloadFailed(status.error);
            }
        } catch (error) {
            console.error('Status check failed:', error);
        }
    }, 2000);
}

function updateProgress(percent) {
    const circle = document.getElementById('progressRing');
    const percentText = document.getElementById('progressPercent');
    const statusText = document.getElementById('progressStatus');
    
    if (circle) {
        const circumference = 220;
        const offset = circumference - (percent / 100) * circumference;
        circle.style.strokeDashoffset = offset;
    }
    percentText.textContent = `${Math.round(percent)}%`;
    
    if (percent < 30) statusText.textContent = 'Initializing download...';
    else if (percent < 70) statusText.textContent = 'Downloading video...';
    else statusText.textContent = 'Processing your file...';
}

function onDownloadComplete(result) {
    hideProgress();
    document.getElementById('videoInfo').style.display = 'none';
    
    const downloadLink = document.getElementById('downloadFileLink');
    downloadLink.href = `${API_URL}/download/file/${currentJobId}`;
    
    if (window.currentVideoInfo) {
        addToHistory(window.currentVideoInfo.title, result.filename, window.currentVideoInfo.platform);
    }
    
    document.getElementById('successBox').style.display = 'block';
    
    const downloadBtn = document.getElementById('downloadBtn');
    downloadBtn.disabled = false;
    downloadBtn.innerHTML = '<i class="fas fa-download"></i> Download Now <i class="fas fa-arrow-right"></i>';
}

function onDownloadFailed(error) {
    hideProgress();
    showError(error || 'Download failed');
    
    const downloadBtn = document.getElementById('downloadBtn');
    downloadBtn.disabled = false;
    downloadBtn.innerHTML = '<i class="fas fa-download"></i> Download Now <i class="fas fa-arrow-right"></i>';
}

// ==================== UI HELPER FUNCTIONS ====================
function showProgress() {
    document.getElementById('progressContainer').style.display = 'flex';
    document.getElementById('downloadBtn').disabled = true;
}

function hideProgress() {
    document.getElementById('progressContainer').style.display = 'none';
    document.getElementById('downloadBtn').disabled = false;
}

function showError(message) {
    document.getElementById('errorMsg').textContent = message;
    document.getElementById('errorBox').style.display = 'block';
    document.getElementById('videoInfo').style.display = 'none';
    document.getElementById('successBox').style.display = 'none';
    document.getElementById('progressContainer').style.display = 'none';
}

function resetDownloader() {
    currentJobId = null;
    if (pollInterval) clearInterval(pollInterval);
    document.getElementById('urlInput').value = '';
    document.getElementById('videoInfo').style.display = 'none';
    document.getElementById('progressContainer').style.display = 'none';
    document.getElementById('successBox').style.display = 'none';
    document.getElementById('errorBox').style.display = 'none';
    
    const downloadBtn = document.getElementById('downloadBtn');
    if (downloadBtn) {
        downloadBtn.disabled = false;
        downloadBtn.innerHTML = '<i class="fas fa-download"></i> Download Now <i class="fas fa-arrow-right"></i>';
    }
}

function formatDuration(seconds) {
    if (!seconds || seconds === 0) return 'Unknown';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatNumber(num) {
    if (!num) return '-';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
}

// ==================== MODAL FUNCTIONALITY ====================
const loginModal = document.getElementById('loginModal');
const signupModal = document.getElementById('signupModal');
const premiumModal = document.getElementById('premiumModal');
const loginBtn = document.getElementById('loginBtn');
const signupBtn = document.getElementById('signupBtn');
const premiumBtn = document.getElementById('premiumBtn');
const closeLoginModal = document.getElementById('closeLoginModal');
const closeSignupModal = document.getElementById('closeSignupModal');
const closePremiumModal = document.getElementById('closePremiumModal');

if (loginBtn) loginBtn.onclick = () => loginModal.style.display = 'flex';
if (signupBtn) signupBtn.onclick = () => signupModal.style.display = 'flex';
if (premiumBtn) premiumBtn.onclick = () => premiumModal.style.display = 'flex';

if (closeLoginModal) closeLoginModal.onclick = () => loginModal.style.display = 'none';
if (closeSignupModal) closeSignupModal.onclick = () => signupModal.style.display = 'none';
if (closePremiumModal) closePremiumModal.onclick = () => premiumModal.style.display = 'none';

window.onclick = (event) => {
    if (event.target === loginModal) loginModal.style.display = 'none';
    if (event.target === signupModal) signupModal.style.display = 'none';
    if (event.target === premiumModal) premiumModal.style.display = 'none';
};

const switchToSignup = document.getElementById('switchToSignup');
const switchToLogin = document.getElementById('switchToLogin');
if (switchToSignup) {
    switchToSignup.onclick = (e) => {
        e.preventDefault();
        loginModal.style.display = 'none';
        signupModal.style.display = 'flex';
    };
}
if (switchToLogin) {
    switchToLogin.onclick = (e) => {
        e.preventDefault();
        signupModal.style.display = 'none';
        loginModal.style.display = 'flex';
    };
}

const loginForm = document.getElementById('loginForm');
if (loginForm) {
    loginForm.onsubmit = async (e) => {
        e.preventDefault();
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;
        const remember = document.getElementById('rememberMe').checked;
        const success = await login(email, password, remember);
        if (success) {
            loginModal.style.display = 'none';
            loginForm.reset();
        }
    };
}

const signupForm = document.getElementById('signupForm');
if (signupForm) {
    signupForm.onsubmit = async (e) => {
        e.preventDefault();
        const name = document.getElementById('signupName').value;
        const email = document.getElementById('signupEmail').value;
        const password = document.getElementById('signupPassword').value;
        const confirm = document.getElementById('signupConfirm').value;
        const agree = document.getElementById('agreeTerms').checked;
        
        if (password !== confirm) {
            alert('Passwords do not match!');
            return;
        }
        if (!agree) {
            alert('Please agree to the Terms and Conditions');
            return;
        }
        const success = await signup(name, email, password);
        if (success) {
            signupModal.style.display = 'none';
            signupForm.reset();
            alert('Account created successfully! Welcome aboard! 🎉');
        }
    };
}

const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
    logoutBtn.onclick = async (e) => {
        e.preventDefault();
        await logout();
    };
}

const mobileLogoutBtn = document.getElementById('mobileLogoutBtn');
if (mobileLogoutBtn) {
    mobileLogoutBtn.onclick = async () => {
        await logout();
        closeMobileMenu();
    };
}

// Social login buttons (demo)
const googleLogin = document.getElementById('googleLogin');
const githubLogin = document.getElementById('githubLogin');
if (googleLogin) googleLogin.onclick = () => alert('Google login demo');
if (githubLogin) githubLogin.onclick = () => alert('GitHub login demo');

// ==================== MOBILE MENU ====================
const mobileMenuBtn = document.getElementById('mobileMenuBtn');
const mobileSidebar = document.getElementById('mobileSidebar');
const mobileOverlay = document.getElementById('mobileOverlay');
const closeSidebar = document.getElementById('closeSidebar');

function openMobileMenu() {
    if (mobileSidebar) mobileSidebar.classList.add('open');
    if (mobileOverlay) mobileOverlay.classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeMobileMenu() {
    if (mobileSidebar) mobileSidebar.classList.remove('open');
    if (mobileOverlay) mobileOverlay.classList.remove('open');
    document.body.style.overflow = '';
}

if (mobileMenuBtn) mobileMenuBtn.onclick = openMobileMenu;
if (closeSidebar) closeSidebar.onclick = closeMobileMenu;
if (mobileOverlay) mobileOverlay.onclick = closeMobileMenu;

const mobileLoginBtn = document.getElementById('mobileLoginBtn');
const mobileSignupBtn = document.getElementById('mobileSignupBtn');
if (mobileLoginBtn) {
    mobileLoginBtn.onclick = () => {
        closeMobileMenu();
        if (loginModal) loginModal.style.display = 'flex';
    };
}
if (mobileSignupBtn) {
    mobileSignupBtn.onclick = () => {
        closeMobileMenu();
        if (signupModal) signupModal.style.display = 'flex';
    };
}

// ==================== PARTICLES & CURSOR ====================
function initParticles() {
    const canvas = document.getElementById('particleCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const particles = [];
    for (let i = 0; i < 80; i++) {
        particles.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            radius: Math.random() * 2 + 1,
            speedX: (Math.random() - 0.5) * 0.5,
            speedY: (Math.random() - 0.5) * 0.5,
            alpha: Math.random() * 0.5
        });
    }
    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        particles.forEach(p => {
            p.x += p.speedX;
            p.y += p.speedY;
            if (p.x < 0) p.x = canvas.width;
            if (p.x > canvas.width) p.x = 0;
            if (p.y < 0) p.y = canvas.height;
            if (p.y > canvas.height) p.y = 0;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(139, 92, 246, ${p.alpha})`;
            ctx.fill();
        });
        requestAnimationFrame(animate);
    }
    animate();
    window.addEventListener('resize', () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    });
}

function initCursor() {
    const cursor = document.querySelector('.cursor');
    const follower = document.querySelector('.cursor-follower');
    if (!cursor || !follower) return;
    document.addEventListener('mousemove', (e) => {
        cursor.style.transform = `translate(${e.clientX - 4}px, ${e.clientY - 4}px)`;
        follower.style.transform = `translate(${e.clientX - 20}px, ${e.clientY - 20}px)`;
    });
}

// ==================== INITIALIZE ====================
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 App initializing...');
    console.log('🔗 API_URL:', API_URL);
    const isConnected = await testBackendConnection();
    if (!isConnected) {
        showError('Cannot connect to server. Please try again later.');
    }
    checkSavedUser();
    await verifyToken();
    initParticles();
    initCursor();
    console.log('✅ App ready');
});

window.resetDownloader = resetDownloader;
