import http.server
import socketserver
import mimetypes

# Fix for Windows Registry MIME type issues (preventing text/plain for .js)
mimetypes.add_type('application/javascript', '.js')
mimetypes.add_type('text/css', '.css')
mimetypes.add_type('text/html', '.html')

PORT = 8000

class MyHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Additional safety for COOP/COEP if needed in the future
        # self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        # self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        super().end_headers()

Handler = MyHTTPRequestHandler

print(f"Starting server at http://localhost:{PORT}")
print("MIME types explicitly set for .js, .css, .html")

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    httpd.serve_forever()
