export function buildChatTranscript({ owner, partner, messages }) {
    const header = [
        'OriginHub Local Chat Export',
        `Owner: ${owner}`,
        `Partner: ${partner}`,
        `Exported: ${new Date().toISOString()}`,
        ''
    ];

    const lines = messages.map(message => {
        const timestamp = message.timestamp
            ? new Date(message.timestamp).toISOString()
            : 'no-time';
        return `[${timestamp}] ${message.sender}: ${message.text}`;
    });

    return [...header, ...lines].join('\n');
}

export function downloadTextFile(filename, content) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);
}

export async function copyText(text) {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
}

export function createFileMarkers(files) {
    return [...files].map(file => {
        return `[file: ${file.name} | ${formatBytes(file.size)}]`;
    }).join('\n');
}

export function makeSafeFilename(name) {
    return name
        .replace(/[^a-z0-9_-]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase() || 'chat';
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
