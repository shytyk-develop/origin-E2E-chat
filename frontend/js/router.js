// frontend/js/router.js

// Array of registered routes
const routes = [
    { path: '/login', view: 'login' },
    { path: '/chat', view: 'chat' },
    { path: /^\/chat\/@([a-zA-Z0-9_]+)$/, view: 'chat-user' } // Regular expression for /chat/@username
];

export function initRouter(onRouteChanged) {
    // Fires when the user clicks the browser's "Back/Forward" buttons
    window.addEventListener('popstate', () => {
        handleRouting(onRouteChanged);
    });

    // Intercept link clicks to prevent page reloads
    document.body.addEventListener('click', e => {
        if (e.target.matches('[data-link]')) {
            e.preventDefault();
            navigateTo(e.target.getAttribute('href'), onRouteChanged);
        }
    });

    // Process the initial URL when the website is opened
    handleRouting(onRouteChanged);
}

export function navigateTo(url, onRouteChanged) {
    window.history.pushState(null, null, url);
    handleRouting(onRouteChanged);
}

function handleRouting(onRouteChanged) {
    const path = window.location.pathname;
    
    // By default, if the path is empty or root, redirect to /login
    if (path === '/' || path === '') {
        navigateTo('/login', onRouteChanged);
        return;
    }

    // Look for a matching route
    for (let route of routes) {
        if (route.path instanceof RegExp) {
            const match = path.match(route.path);
            if (match) {
                // If it's a regex match (e.g., /chat/@alina), extract the username
                const username = match[1];
                onRouteChanged(route.view, username);
                return;
            }
        } else if (route.path === path) {
            onRouteChanged(route.view, null);
            return;
        }
    }

    // If no route matches, redirect to /login (or a 404 page)
    navigateTo('/login', onRouteChanged);
}