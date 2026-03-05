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
    },

    // --- Modal Creation ---
    showModal(content) {
        // Remove any existing modal
        const existing = document.querySelector('.pwa-modal-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.className = 'pwa-modal-overlay show';
        overlay.innerHTML = `
            <div class="pwa-modal">
                <button class="pwa-modal-close" aria-label="Close">&times;</button>
                ${content}
            </div>
        `;

        document.body.appendChild(overlay);

        // Close on X button
        overlay.querySelector('.pwa-modal-close').addEventListener('click', () => {
            overlay.remove();
        });

        // Close on overlay click
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });
    },

    showIOSInstructions() {
        this.showModal(`
            <div class="pwa-modal-icon">&#128241;</div>
            <h3>Install SAFE Action</h3>
            <ol class="pwa-modal-steps">
                <li>
                    <span class="pwa-modal-step-num">1</span>
                    <span>Tap the <strong>Share</strong> button <span style="font-size:1.2em">&#11014;&#65039;</span> at the bottom of Safari</span>
                </li>
                <li>
                    <span class="pwa-modal-step-num">2</span>
                    <span>Scroll down and tap <strong>"Add to Home Screen"</strong></span>
                </li>
                <li>
                    <span class="pwa-modal-step-num">3</span>
                    <span>Tap <strong>"Add"</strong> to confirm</span>
                </li>
            </ol>
            <p class="pwa-modal-note">The app will appear on your home screen for quick access.</p>
        `);
    },

    showAndroidInstructions() {
        this.showModal(`
            <div class="pwa-modal-icon">&#128241;</div>
            <h3>Install SAFE Action</h3>
            <ol class="pwa-modal-steps">
                <li>
                    <span class="pwa-modal-step-num">1</span>
                    <span>Tap the browser menu <strong>&#8942;</strong> (three dots) in the top-right corner</span>
                </li>
                <li>
                    <span class="pwa-modal-step-num">2</span>
                    <span>Tap <strong>"Add to Home Screen"</strong> or <strong>"Install App"</strong></span>
                </li>
                <li>
                    <span class="pwa-modal-step-num">3</span>
                    <span>Tap <strong>"Add"</strong> to confirm</span>
                </li>
            </ol>
            <p class="pwa-modal-note">The app will appear on your home screen for quick access.</p>
        `);
    },

    // --- Header Button Handler ---
    handleHeaderButton() {
        const btn = document.getElementById('headerInstallBtn');
        if (!btn) return;

        // Hide the button entirely if already installed as standalone
        if (this.isStandalone()) {
            btn.style.display = 'none';
            return;
        }

        btn.addEventListener('click', () => {
            if (this.deferredPrompt) {
                // Browser supports native prompt (Chrome, Edge on Android, etc.)
                this.deferredPrompt.prompt();
                this.deferredPrompt.userChoice.then((choice) => {
                    console.log('Install outcome:', choice.outcome);
                    this.deferredPrompt = null;
                });
            } else if (this.isIOS()) {
                this.showIOSInstructions();
            } else if (this.isAndroid()) {
                this.showAndroidInstructions();
            } else {
                // Desktop or unknown - show generic instructions
                this.showAndroidInstructions();
            }
        });
    },

    init() {
        this.handleHeaderButton();
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

    // Also hide the header button
    const btn = document.getElementById('headerInstallBtn');
    if (btn) btn.style.display = 'none';
});

// Initialize header button when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => PWAInstall.init());
} else {
    PWAInstall.init();
}
