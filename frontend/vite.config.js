import { defineConfig } from 'vite'

export default defineConfig({
  // Ensure assets are properly handled
  assetsInclude: ['**/*.svg'],
  
  // Configure asset processing
  build: {
    // Include assets directory in the build
    rollupOptions: {
      input: {
        main: './index.html'
      }
    },
    // Copy static assets
    copyPublicDir: true,
    assetsDir: 'assets'
  },
  
  // Configure public directory for static assets
  publicDir: 'src/assets',
  
  // Base URL for assets (important for Wails)
  base: './',
  
  // Configure server for development
  server: {
    port: 5173,
    strictPort: true
  }
}) 