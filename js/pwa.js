// ============================================
// SAFE Action - PWA Install + Service Worker
// ============================================

// Register service worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('SW registered:', reg.scope))
            .catch(err => console.log('SW registration failed:', err));
    });
}

// --- Platform Detection ---
const PWAInstall = {
    deferredPrompt: null,

    isIOS() {
        return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    },

    isAndroid() {
        return /Android/.test(navigator.userAgent);
    },

    isStandalone() {
        return window.matchMedia('(display-mode: standalone)').matches ||
            window.navigator.standalone === true;
    }
};

// --- Install Prompt (Chrome / Edge / Samsung Internet) ---
let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    PWAInstall.deferredPrompt = e;
    showInstallBanner();
});

function showInstallBanner() {
    // Only show on mobile/tablet — not desktop
    if (window.innerWidth > 900) return;
    // Don't show if already dismissed this session
    if (sessionStorage.getItem('pwa_dismissed')) return;

    const banner = document.createElement('div');
    banner.className = 'pwa-install-banner';
    banner.innerHTML = `
        <div class="pwa-install-inner">
            <div class="pwa-install-text">
                <strong>Install SAFE Action</strong>
                <span>Add to your home screen for quick access to track bills and contact reps.</span>
            </div>
            <div class="pwa-install-actions">
                <button class="btn btn-primary btn-sm pwa-install-btn">Install App</button>
                <button class="pwa-dismiss-btn" aria-label="Dismiss">&times;</button>
            </div>
        </div>
    `;

    document.body.appendChild(banner);

    // Animate in
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            banner.classList.add('show');
        });
    });

    banner.querySelector('.pwa-install-btn').addEventListener('click', async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log('Install outcome:', outcome);
        deferredPrompt = null;
        PWAInstall.deferredPrompt = null;
        banner.remove();
    });

    banner.querySelector('.pwa-dismiss-btn').addEventListener('click', () => {
        sessionStorage.setItem('pwa_dismissed', '1');
        banner.classList.remove('show');
        setTimeout(() => banner.remove(), 300);
    });
}

// Hide banner if app is already installed
window.addEventListener('appinstalled', () => {
    const banner = document.querySelector('.pwa-install-banner');
    if (banner) banner.remove();
    deferredPrompt = null;
    PWAInstall.deferredPrompt = null;
});

