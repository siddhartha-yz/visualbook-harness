"""Serve the extracted book on loopback; no install or generation."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import webbrowser


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8769)
    parser.add_argument('--open', action='store_true')
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        parser.error('port must be between 0 and 65535')
    directory = Path(__file__).resolve().parent
    if not (directory / 'index.html').is_file():
        parser.error('Extract the entire book archive before running serve.py')
    try:
        server = ThreadingHTTPServer(('127.0.0.1', args.port),
            partial(SimpleHTTPRequestHandler, directory=str(directory)))
    except OSError as error:
        parser.exit(1, f'Cannot start reader: {error}. Try --port 0 for a free port.\n')
    url = f'http://127.0.0.1:{server.server_port}/index.html'
    print(url, flush=True)
    if args.open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
