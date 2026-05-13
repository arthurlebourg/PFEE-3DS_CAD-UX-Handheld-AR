import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
    server: {
        host: true,
        https: true,
    },
    plugins: [
        basicSsl()
    ]
});
