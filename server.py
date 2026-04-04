import http.server
import socketserver
import os

PORT = 8000

class NuclearHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Nuclear option: FORCE MIME types based on extension for ALL files
        ext = os.path.splitext(self.path)[1].lower()
        if ext == '.js':
            self.send_header('Content-Type', 'application/javascript')
        elif ext == '.css':
            self.send_header('Content-Type', 'text/css')
        elif ext == '.html':
            self.send_header('Content-Type', 'text/html')
        elif ext in ['.png', '.jpg', '.jpeg', '.gif']:
            self.send_header('Content-Type', f'image/{ext[1:]}')
        super().end_headers()

# Allow socket reuse
socketserver.TCPServer.allow_reuse_address = True

print(f"Server NUCLEAR starting at http://localhost:{PORT}")
with socketserver.TCPServer(("", PORT), NuclearHTTPRequestHandler) as httpd:
    httpd.serve_forever()
