import { mountLoginBackground, destroyLoginBackground } from './loginCanvas.js';

export function initLoginPage(pageLogin) {
    if (!pageLogin) return;

    mountLoginBackground(pageLogin);
    bindLoginNav(pageLogin);
}

export function teardownLoginPage() {
    destroyLoginBackground();
}

function bindLoginNav(pageLogin) {
    const toggle = pageLogin.querySelector('#loginNavToggle');
    const menu = pageLogin.querySelector('#loginNavMenu');
    const header = pageLogin.querySelector('.login-nav');

    if (!toggle || !menu || !header) return;

    toggle.addEventListener('click', () => {
        const open = header.classList.toggle('is-open');
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        menu.hidden = !open;
    });
}
