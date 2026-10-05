import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// Served from the root of stahpthestahp.com
export default defineConfig({
  base: '/',
  plugins: [tailwindcss()],
  build: { target: 'es2022' },
});
