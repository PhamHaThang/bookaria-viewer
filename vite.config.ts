import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig, loadEnv } from 'vite';
import { readDevHttps } from './scripts/dev-https.ts';

export default defineConfig(({ command, mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const https = command === 'serve' ? readDevHttps({ ...env, ...process.env }) : undefined;
    return {
        plugins: [
            tailwindcss(),
            ...(command === 'serve' && !https
                ? [basicSsl({ name: 'bookaria-viewer', domains: ['viewer.localhost'] })]
                : []),
        ],
        server: {
            https,
            port: 5174,
            strictPort: true,
            host: '0.0.0.0',
            allowedHosts: ['viewer.localhost'],
            headers: {
                'Cache-Control': 'no-store',
                'Referrer-Policy': 'no-referrer',
                'X-Robots-Tag': 'noindex, nofollow',
            },
            proxy: {
                '/api': {
                    target: env.VITE_API_PROXY_TARGET || 'http://localhost:4000',
                    changeOrigin: true,
                },
            },
        },
    };
});
