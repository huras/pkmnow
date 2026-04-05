import http.server
import socketserver
import os

PORT = 8000

# Improved MIME type handling for modules
class NuclearHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    pass

# Force MIME types via extensions_map
NuclearHTTPRequestHandler.extensions_map.update({
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.png': 'image/png',
    '.jpg': 'image/jpeg'
})

print(f"Server NUCLEAR starting at http://localhost:{PORT}")
with socketserver.TCPServer(("", PORT), NuclearHTTPRequestHandler) as httpd:
    httpd.serve_forever()
