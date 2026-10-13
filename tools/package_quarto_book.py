"""Package an explicitly reviewed Quarto reader with exact file identities.

This is a local offline artifact, not publication or mathematical certification.
The final browser review must bind the assembly and every rendered resource.
"""
import argparse
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
from urllib.parse import unquote, urlsplit
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def sha(data):
    return hashlib.sha256(data).hexdigest()


class References(HTMLParser):
    def __init__(self):
        super().__init__()
        self.references = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        for key in ('src', 'href', 'poster'):
            if key in attrs:
                self.references.append((tag, key, attrs[key]))


def package(project, review_file, output):
    project = Path(project).resolve()
    book = project / '_book'
    output = Path(output).resolve()
    if output.exists():
        raise ValueError('Output exists; preserve earlier packages')
    assembly_bytes = (project / 'assembly-record.json').read_bytes()
    assembly = json.loads(assembly_bytes)
    checks = json.loads((project / 'reader-build-check.json').read_text())
    review = json.loads(Path(review_file).read_text())
    if (assembly.get('draft') is not False or checks.get('status') != 'awaiting-browser-review'
        or review.get('readyForPackage') is not True
        or review.get('assemblyRecordSha256') != sha(assembly_bytes)
        or review.get('blockingIssues') != []):
        raise ValueError('Final source/render/browser review missing, stale or blocked')
    files = {}
    for file in sorted(book.rglob('*')):
        if file.is_symlink():
            raise ValueError('Symbolic links need an explicit resource adapter')
        if file.is_file():
            files[file.relative_to(book).as_posix()] = file.read_bytes()
    actual = {name: sha(data) for name, data in files.items()}
    if actual != review.get('fileHashes'):
        raise ValueError('Reader files changed after browser review')
    required = {'index.html', 'search.json', 'reader.js', 'reader.css', 'downloads/textbook.md'}
    required.update(ch['id'] + '.html' for ch in assembly['chapters'])
    if not required <= files.keys():
        raise ValueError('Required native reader resource missing')
    for name, data in files.items():
        references = []
        if name.endswith('.html'):
            parser = References()
            parser.feed(data.decode('utf8'))
            references = parser.references
        elif name.endswith('.css'):
            text = data.decode('utf8')
            # Cover native compiled CSS imports and fonts/images, including
            # quoted imports without url(). This is not arbitrary CSS parsing.
            text = re.sub(r'/\*.*?\*/', '', text, flags=re.S)
            targets = [next(v for v in match if v) for match in
                re.findall(r'''url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)''', text, re.I)]
            targets += [next(v for v in match if v) for match in
                re.findall(r'''@import\s*(?:"([^"]+)"|'([^']+)')''', text, re.I)]
            references = [('css', 'url', target.strip()) for target in targets]
        for tag, key, target in references:
            url = urlsplit(target)
            if url.scheme or url.netloc:
                if tag == 'a' and key == 'href' and url.scheme in ('http', 'https', 'mailto'):
                    continue
                if url.scheme == 'data':
                    continue
                raise ValueError('External executable/media resource: ' + name + ': ' + target)
            if not url.path:
                continue
            local = (book / Path(name).parent / unquote(url.path)).resolve()
            if not local.is_relative_to(book):
                raise ValueError('Reader resource escapes book: ' + target)
            # Native Quarto home/section links may name a directory. Only
            # navigation can resolve its existing index; assets must be files.
            if tag == 'a' and key == 'href' and local.is_dir():
                local = local / 'index.html'
            if not local.is_file():
                raise ValueError('Missing local reader resource: ' + name + ': ' + target)
    reserved = {'serve.py', 'README-阅读.txt', 'book-provenance.json'}
    if reserved & files.keys():
        raise ValueError('Native reader collides with portable package files')
    files['serve.py'] = (ROOT / 'packages/visualbook/quarto/serve.py').read_bytes()
    files['README-阅读.txt'] = ('解压整个压缩包后，在该目录运行：\n'
        'python3 serve.py --open\n\n'
        '默认地址：http://127.0.0.1:8769/index.html\n'
        '端口占用时可运行 python3 serve.py --port 0 --open。Ctrl+C 停止。\n'
        '正文、图解、公式、搜索及依赖均在包内，无需在线安装。\n'
        '请通过本地服务器阅读；直接双击HTML时，浏览器可能禁止搜索读取。\n'
        'downloads/textbook.md 是完整Markdown教材，各章原文也在downloads目录。\n'
        '本包是AI维护者复核的课程整理与图解，未经过授课教师审定。\n').encode('utf8')
    provenance = {'scope': 'Local reviewed reader artifact. No provider logs, credentials, audio/video, prompts or model sessions. Source Markdown included for study. File identities are not teacher or learning-effect certification.',
        'assemblyRecordSha256': sha(assembly_bytes), 'readerReviewSha256': sha(Path(review_file).read_bytes()),
        'chapters': [{'id': c['id'], 'title': c['title'], 'sourceMarkdownSha256': c['originalMarkdownSha256'],
                      'planSha256': c['planFileSha256'], 'figures': len(c['widgets'])} for c in assembly['chapters']],
        'fileHashes': {n: sha(v) for n, v in files.items()}}
    files['book-provenance.json'] = (json.dumps(provenance, ensure_ascii=False, indent=2) + '\n').encode('utf8')
    with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    with zipfile.ZipFile(output) as archive:
        if archive.testzip() is not None:
            raise ValueError('Archive CRC verification failed')
    return {'scope': 'Identity-checked local packaging; not publication, new generation or quality certification.',
        'chapters': len(assembly['chapters']), 'files': len(files), 'bytes': output.stat().st_size,
        'archiveSha256': sha(output.read_bytes()), 'modelCalls': 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('project', type=Path)
    parser.add_argument('review', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    if not args.output.resolve().is_relative_to((ROOT / 'work').resolve()):
        parser.error('Keep source-derived packages in ignored work/')
    print(json.dumps(package(args.project, args.review, args.output)))


if __name__ == '__main__':
    main()
