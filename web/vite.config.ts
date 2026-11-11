import { defineConfig } from 'vite';
export default defineConfig({
  build: { rollupOptions: { input: { main: 'index.html', whiteboardPrototype: 'whiteboard-prototype.html', whiteboard: 'whiteboard.html' } } },
  plugins: [{
    name: 'same-origin-terminal',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.startsWith('/api/') && request.headers.origin && request.headers.origin !== `http://${request.headers.host}`) { response.statusCode = 403; response.end('cross-origin request rejected'); return; }
        next();
      });
      // Check before the development proxy rewrites Origin for the backend.
      server.httpServer?.prependListener('upgrade', (request, socket) => {
        if (request.url?.startsWith('/api/') && request.headers.origin !== `http://${request.headers.host}`) socket.destroy();
      });
    },
  }],
  server: { host: '127.0.0.1', cors: false, proxy: { '/api': { target: 'http://127.0.0.1:8080', ws: true, changeOrigin: true, rewriteWsOrigin: true, configure(proxy) { proxy.on('proxyReq', request => { if (request.getHeader('origin')) request.setHeader('origin', 'http://127.0.0.1:8080'); }); } } } },
});
