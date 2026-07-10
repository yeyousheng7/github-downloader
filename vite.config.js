import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';
import packageJson from './package.json' with { type: 'json' };

export default defineConfig({
    plugins: [
        monkey({
            entry: 'src/main.js',
            userscript: {
                name: {
                    '': 'GitHub 批量下载器',
                    en: 'GitHub Multi-File Downloader',
                },
                namespace: 'https://github.com/yeyousheng7/github-multi-file-downloader',
                version: packageJson.version,
                description: {
                    '': '在 GitHub 仓库页面勾选多个文件或文件夹，并将它们直接下载或打包为 ZIP。',
                    en: 'Add checkboxes to GitHub repository file lists and download selected files or folders as individual files or ZIP archives.',
                },
                homepageURL: 'https://github.com/yeyousheng7/github-multi-file-downloader',
                supportURL: 'https://github.com/yeyousheng7/github-multi-file-downloader/issues',
                author: 'yyyyys',
                license: 'MIT',
                icon: 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==',
                match: ['https://github.com/*'],
                require: [
                    'https://unpkg.com/file-saver@2.0.5/dist/FileSaver.min.js',
                    'https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js',
                    'https://cdn.jsdelivr.net/npm/sweetalert2@11.23.0/dist/sweetalert2.all.min.js',
                ],
                grant: [
                    'GM_addStyle',
                    'GM_xmlhttpRequest',
                    'GM_getValue',
                    'GM_setValue',
                    'GM_deleteValue',
                    'GM_registerMenuCommand',
                ],
                connect: [
                    'github.com',
                    'raw.githubusercontent.com',
                    'api.github.com',
                    'objects.githubusercontent.com',
                ],
            },
            build: {
                fileName: 'downloader.user.js',
                autoGrant: false,
            },
        }),
    ],
    build: {
        minify: false,
    },
});
