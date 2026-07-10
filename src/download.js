import { SETTINGS, logger } from './config.js';
import {
    buildGitHubFileUrls,
    fetchGitTree,
    gmRequest,
    joinRepoPath,
    parseGitHubEntryContext,
} from './github.js';
import {
    clearDownloadStatus,
    resetDownloadButtonState,
    setDownloadButtonState,
    setDownloadStatus,
    setTransientDownloadStatus,
    showAlertDialog,
    showConfirmDialog,
} from './dialogs.js';

/**
 * @typedef {Object} SelectionEntry
 * @property {'file'|'folder'} kind
 * @property {string} githubPath
 * @property {string} repoPath
 * @property {string} fileName
 */

/**
 * @typedef {Object} DownloadItem
 * @property {string} githubPath
 * @property {string} rawUrl
 * @property {string} outputPath
 * @property {string} fileName
 */

/**
 * @typedef {Object} SelectionResolutionResult
 * @property {DownloadItem[]} items
 * @property {SelectionEntry[]} failedEntries
 */

/**
 * @typedef {Object} DownloadExecutionResult
 * @property {Array<DownloadItem & { bytes: Uint8Array }>} succeeded
 * @property {Array<{ item: DownloadItem, error: Error }>} failed
 */

/**
 * 启动一次下载流程。
 *
 * @param {SelectionEntry[]} entries
 * @returns {Promise<void>}
 */
export async function startDownload(entries) {
    if (entries.length === 0) {
        clearDownloadStatus();
        await showAlertDialog({
            title: '提示',
            message: '未选择任何文件！',
        });
        return;
    }

    logger.info('download', `开始下载，选中 ${entries.length} 个项目`);
    setDownloadButtonState({ disabled: true, text: '下载中...' });

    try {
        setDownloadStatus('解析下载计划...');
        const { items, failedEntries } = await resolveSelectedEntries(entries);
        const zipFilename = `github_files_${Date.now()}.zip`;

        const shouldContinue = await confirmContinueAfterResolutionFailures(failedEntries, items.length);
        if (!shouldContinue) {
            return;
        }

        if (items.length === 0) {
            clearDownloadStatus();
            await showAlertDialog({
                title: '没有可下载的文件',
                message: '没有有效的文件可下载！',
            });
            return;
        }

        const result = await downloadAndSave(items, zipFilename);
        if (result.failed.length === 0) {
            return;
        }

        const shouldRetry = await confirmRetryFailedItems(result);
        if (!shouldRetry) {
            return;
        }

        const retryItems = result.failed.map(({ item }) => item);
        const retryResult = await downloadAndSave(retryItems, `_RETRY_${zipFilename}`);
        if (retryResult.failed.length > 0) {
            await alertFinalFailedItems(retryResult);
        }
    } finally {
        resetDownloadButtonState();
    }
}

/**
 * @param {SelectionEntry[]} entries
 * @returns {Promise<SelectionResolutionResult>}
 */
async function resolveSelectedEntries(entries) {
    const items = [];
    const failedEntries = [];
    const treeRequestCache = new Map();

    for (const entry of entries) {
        const resolved = await resolveSelectionEntry(entry, treeRequestCache);
        items.push(...resolved.items);
        failedEntries.push(...resolved.failedEntries);
    }

    logger.info('plan', `下载计划已生成，文件数: ${items.length}，模式: ${items.length === 1 ? 'single' : 'zip'}`);

    return {
        items,
        failedEntries,
    };
}

async function confirmContinueAfterResolutionFailures(failedEntries, resolvedItemCount) {
    if (failedEntries.length === 0) {
        return true;
    }

    const failedListTop5Lines = failedEntries
        .slice(0, 5)
        .map(entry => entry.repoPath || entry.githubPath);

    if (failedEntries.length > 5) {
        failedListTop5Lines.push('...');
    }

    if (resolvedItemCount === 0) {
        clearDownloadStatus();
        await showAlertDialog({
            title: '没有可下载的文件',
            message: '所选条目全部解析失败，无法继续下载。',
            lines: failedListTop5Lines,
        });
        return false;
    }

    const shouldContinue = await showConfirmDialog({
        title: '继续下载其余成功项？',
        message: `有 ${failedEntries.length} 个条目解析失败，是否继续下载其余成功项？`,
        lines: failedListTop5Lines,
        confirmText: '继续下载',
        cancelText: '取消',
    });

    if (!shouldContinue) {
        clearDownloadStatus();
    }

    return shouldContinue;
}

async function resolveSelectionEntry(entry, treeRequestCache) {
    if (!entry) {
        return { items: [], failedEntries: [] };
    }

    if (entry.kind === 'file') {
        const item = toDownloadItem(entry);
        return item ? { items: [item], failedEntries: [] } : { items: [], failedEntries: [entry] };
    }

    if (entry.kind === 'folder') {
        try {
            const items = await expandFolderEntry(entry, treeRequestCache);
            return { items, failedEntries: [] };
        } catch (error) {
            logger.error('plan', `展开文件夹失败: ${entry.githubPath}`, error);
            return { items: [], failedEntries: [entry] };
        }
    }

    return { items: [], failedEntries: [] };
}

function toDownloadItem(entry) {
    if (!entry || entry.kind !== 'file') {
        return null;
    }

    const ctx = parseGitHubEntryContext(entry.githubPath);
    if (!ctx || ctx.viewKind !== 'blob') {
        logger.warn('plan', `无法转换为 raw URL: ${entry.githubPath}`);
        return null;
    }

    const urls = buildGitHubFileUrls(ctx, entry.repoPath);

    return {
        githubPath: urls.githubPath,
        rawUrl: urls.rawUrl,
        outputPath: entry.repoPath,
        fileName: entry.fileName,
    };
}

async function expandFolderEntry(entry, treeRequestCache) {
    const ctx = parseGitHubEntryContext(entry.githubPath);
    if (!ctx || ctx.viewKind !== 'tree') {
        throw new Error(`无法解析文件夹上下文: ${entry?.githubPath}`);
    }

    const rootTree = await fetchGitTree(ctx, ctx.ref, true, treeRequestCache);
    let filePaths;

    if (rootTree.truncated) {
        const folderTreeSha = await resolveFolderTreeSha(ctx, rootTree, treeRequestCache);
        filePaths = await collectTreeFilePaths(ctx, folderTreeSha, ctx.repoPath, treeRequestCache);
    } else {
        const folderPrefix = `${ctx.repoPath}/`;
        filePaths = rootTree.tree
            .filter(node => node.type === 'blob' && node.path.startsWith(folderPrefix))
            .map(node => node.path);
    }

    return filePaths.map(repoPath => {
        const urls = buildGitHubFileUrls(ctx, repoPath);

        return {
            githubPath: urls.githubPath,
            rawUrl: urls.rawUrl,
            outputPath: repoPath,
            fileName: repoPath.split('/').pop() || '',
        };
    });
}

async function resolveFolderTreeSha(ctx, rootTree, treeRequestCache) {
    let closestPath = '';
    let currentTreeSha = rootTree.sha;

    for (const node of rootTree.tree) {
        if (node.type !== 'tree') {
            continue;
        }

        const containsTarget = ctx.repoPath === node.path
            || ctx.repoPath.startsWith(`${node.path}/`);

        if (containsTarget && node.path.length > closestPath.length) {
            closestPath = node.path;
            currentTreeSha = node.sha;
        }
    }

    const remainingPath = closestPath
        ? ctx.repoPath.slice(closestPath.length + 1)
        : ctx.repoPath;

    for (const segment of remainingPath.split('/').filter(Boolean)) {
        const treeData = await fetchGitTree(ctx, currentTreeSha, false, treeRequestCache);
        if (treeData.truncated) {
            throw new Error(`非递归 Tree 返回被截断: ${closestPath || '/'}`);
        }

        const childTree = treeData.tree.find(node => (
            node.type === 'tree' && node.path === segment
        ));

        if (!childTree) {
            throw new Error(`无法定位文件夹 Tree: ${ctx.repoPath}`);
        }

        currentTreeSha = childTree.sha;
        closestPath = joinRepoPath(closestPath, segment);
    }

    return currentTreeSha;
}

async function collectTreeFilePaths(ctx, treeSha, baseRepoPath, treeRequestCache) {
    const recursiveTree = await fetchGitTree(ctx, treeSha, true, treeRequestCache);

    if (!recursiveTree.truncated) {
        return recursiveTree.tree
            .filter(node => node.type === 'blob')
            .map(node => joinRepoPath(baseRepoPath, node.path));
    }

    const directTree = await fetchGitTree(ctx, treeSha, false, treeRequestCache);
    if (directTree.truncated) {
        throw new Error(`非递归 Tree 返回被截断: ${baseRepoPath}`);
    }

    const filePaths = [];

    for (const node of directTree.tree) {
        const repoPath = joinRepoPath(baseRepoPath, node.path);

        if (node.type === 'blob') {
            filePaths.push(repoPath);
            continue;
        }

        if (node.type === 'tree') {
            const childPaths = await collectTreeFilePaths(
                ctx,
                node.sha,
                repoPath,
                treeRequestCache
            );
            filePaths.push(...childPaths);
        }
    }

    return filePaths;
}

async function downloadAndSave(items, zipFilename) {
    const outputMode = items.length === 1 ? 'single' : 'zip';
    const result = await fetchDownloadItems(items, ({ completed, total }) => {
        setDownloadStatus(`下载中 ${completed} / ${total}`);
    });

    if (result.succeeded.length > 0) {
        if (outputMode === 'single') {
            setDownloadStatus('保存中...');
            const file = result.succeeded[0];
            const blob = new Blob([file.bytes], { type: 'application/octet-stream' });
            saveAs(blob, file.fileName);
        } else {
            setDownloadStatus('打包中...');
            saveAs(buildZipBlob(result.succeeded), zipFilename);
        }
        logger.info('download', `下载完成，成功 ${result.succeeded.length} 个，失败 ${result.failed.length} 个`);
    }

    if (result.failed.length === 0) {
        setTransientDownloadStatus('下载完成');
    } else if (result.succeeded.length > 0) {
        setTransientDownloadStatus(`部分完成，失败 ${result.failed.length} 个`);
    } else {
        setTransientDownloadStatus('下载失败');
    }

    return result;
}

function buildZipBlob(files) {
    const entries = {};

    for (const file of files) {
        entries[file.outputPath] = file.bytes;
    }

    logger.debug('download', '开始打包');
    const zipU8 = fflate.zipSync(entries, { level: SETTINGS.COMPRESS_LEVEL });
    logger.debug('download', '打包完成!');

    return new Blob([zipU8], { type: 'application/zip' });
}

async function fetchDownloadItems(items, onProgress) {
    const queue = [...items];
    const succeeded = [];
    const failed = [];
    const total = items.length;

    async function worker() {
        while (queue.length > 0) {
            const item = queue.pop();

            try {
                logger.debug('download', `正在下载 [剩余:${queue.length}]: ${item.outputPath}`);
                const buf = await fetchArrayBufferWithRetry(item);

                succeeded.push({
                    ...item,
                    bytes: new Uint8Array(buf),
                });

                logger.debug('download', `下载完成: ${item.outputPath}`);
            } catch (error) {
                failed.push({
                    item,
                    error,
                });
                logger.error('network', `文件下载失败: ${item.rawUrl}`, error);
            } finally {
                const completed = succeeded.length + failed.length;
                onProgress?.({
                    completed,
                    total,
                    succeeded: succeeded.length,
                    failed: failed.length,
                });
            }
        }
    }

    const workers = [];
    const limit = SETTINGS.CONCURRENCY_LIMIT || 3;

    for (let i = 0; i < limit; i++) {
        workers.push(worker());
    }

    await Promise.all(workers);

    return { succeeded, failed };
}

async function confirmRetryFailedItems(result) {
    const title = result.succeeded.length > 0
        ? `下载完成，成功 ${result.succeeded.length} 个，失败 ${result.failed.length} 个。`
        : `本次下载全部失败，共 ${result.failed.length} 个文件失败。`;

    return await showConfirmDialog({
        title: '是否重试失败文件？',
        message: `${title} 是否重试失败文件？`,
        lines: buildFailedItemsLines(result.failed),
        confirmText: '重试',
        cancelText: '取消',
    });
}

async function alertFinalFailedItems(result) {
    const title = result.succeeded.length > 0
        ? '部分文件仍下载失败'
        : '文件仍然全部下载失败';

    const messagePrefix = result.succeeded.length > 0
        ? '部分文件仍下载失败，请检查网络或稍后重试。'
        : '文件仍然全部下载失败，请检查网络或稍后重试。';

    await showAlertDialog({
        title,
        message: `${messagePrefix} 失败文件列表:`,
        lines: buildFailedItemsLines(result.failed),
        confirmText: '知道了',
    });
}

function buildFailedItemsLines(failedItems) {
    const lines = failedItems
        .slice(0, 5)
        .map(failure => failure.item.outputPath);

    if (failedItems.length > 5) {
        lines.push('...');
    }

    return lines;
}

async function fetchArrayBufferWithRetry(item) {
    const maxAttempts = SETTINGS.RETRY_COUNT + 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await gmRequest(item.rawUrl, {
                responseType: 'arraybuffer',
                timeoutMs: SETTINGS.REQUEST_TIMEOUT_MS,
            });
        } catch (error) {
            if (attempt >= maxAttempts) {
                throw error;
            }

            logger.warn(
                'network',
                `下载失败，准备重试 (${attempt}/${SETTINGS.RETRY_COUNT}): ${item.outputPath}`,
                error
            );
            await sleep(SETTINGS.RETRY_DELAY_MS);
        }
    }

    throw new Error(`下载重试异常结束: ${item.outputPath}`);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
