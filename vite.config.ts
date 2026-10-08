import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative assets work both at the domain root and under a GitHub Pages repo path.
  base: './',
});
