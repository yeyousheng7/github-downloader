import { SETTINGS, logger } from './config.js';
import { clearGitHubToken, setGitHubToken } from './github.js';

/**
 * @typedef {Object} DialogOptions
 * @property {string} title
 * @property {string} message
 * @property {string[]} [lines]
 * @property {string} [confirmText]
 * @property {string} [cancelText]
 */

let downloadStatusClearTimer = null;

/**
 * @param {DialogOptions} options
 * @returns {Promise<void>}
 */
export async function showAlertDialog(options) {
    await Swal.fire({
        title: options.title,
        html: buildDialogHtml(options.message, options.lines),
        confirmButtonText: options.confirmText || '确定',
        theme: 'auto',
        allowOutsideClick: true,
        allowEscapeKey: true,
        heightAuto: false,
    });
}

/**
 * @param {DialogOptions} options
 * @returns {Promise<boolean>}
 */
export async function showConfirmDialog(options) {
    const result = await Swal.fire({
        title: options.title,
        html: buildDialogHtml(options.message, options.lines),
        confirmButtonText: options.confirmText || '继续',
        cancelButtonText: options.cancelText || '取消',
        theme: 'auto',
        showCancelButton: true,
        reverseButtons: true,
        allowOutsideClick: true,
        allowEscapeKey: true,
        heightAuto: false,
    });

    return result.isConfirmed;
}

export function openGitHubTokenDialog() {
    const storedToken = GM_getValue(SETTINGS.GITHUB_TOKEN_STORED_KEY, '');

    return Swal.fire({
        title: 'GitHub Token 设置',
        text: '留空后点击保存，将清空已保存的 token。',
        input: 'password',
        inputValue: storedToken || '',
        inputPlaceholder: 'ghp_xxx 或 github_pat_xxx',
        inputAttributes: {
            autocomplete: 'off',
            spellcheck: 'false',
        },
        confirmButtonText: '保存',
        cancelButtonText: '取消',
        theme: 'auto',
        showCancelButton: true,
        reverseButtons: true,
        focusConfirm: false,
        allowOutsideClick: false,
        allowEscapeKey: true,
        heightAuto: false,
        preConfirm: () => {
            const input = Swal.getInput();
            return input instanceof HTMLInputElement ? input.value.trim() : '';
        },
    }).then((result) => {
        if (!result.isConfirmed) {
            return;
        }

        const value = typeof result.value === 'string' ? result.value : '';
        if (value) {
            setGitHubToken(value);
        } else {
            clearGitHubToken();
        }
    });
}

export function setDownloadButtonState({ disabled, text }) {
    const button = document.querySelector('.tm-download-btn');
    if (!button) {
        logger.warn('ui', '未找到下载按钮元素');
        return;
    }
    button.disabled = disabled;
    button.textContent = text;
}

export function resetDownloadButtonState() {
    setDownloadButtonState({ disabled: false, text: '下载所选文件' });
}

export function setDownloadStatus(text) {
    const status = document.querySelector('.tm-download-status');
    const toolbar = document.querySelector('.tm-download-toolbar');
    if (!status) {
        return;
    }

    if (downloadStatusClearTimer) {
        clearTimeout(downloadStatusClearTimer);
        downloadStatusClearTimer = null;
    }

    status.textContent = text || '';
    status.classList.toggle('is-empty', !text);
    toolbar?.classList.toggle('has-status', Boolean(text));
}

export function setTransientDownloadStatus(text, delayMs = 1500) {
    setDownloadStatus(text);

    downloadStatusClearTimer = setTimeout(() => {
        downloadStatusClearTimer = null;
        clearDownloadStatus();
    }, delayMs);
}

export function clearDownloadStatus() {
    if (downloadStatusClearTimer) {
        clearTimeout(downloadStatusClearTimer);
        downloadStatusClearTimer = null;
    }

    setDownloadStatus('');
}

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function buildDialogHtml(message, lines = []) {
    const messageHtml = message
        ? `<div class="tm-dialog-message">${escapeHtml(message)}</div>`
        : '';

    if (!Array.isArray(lines) || lines.length === 0) {
        return messageHtml;
    }

    const renderedLines = lines
        .map(line => `<li class="tm-dialog-line">${escapeHtml(line)}</li>`)
        .join('');

    return `<div class="tm-dialog-body tm-dialog-body-with-lines">${messageHtml}<ul class="tm-dialog-lines">${renderedLines}</ul></div>`;
}
