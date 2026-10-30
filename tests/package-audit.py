"""构建产物审查：应用身份、macOS图标与Windows PE图标资源（仅标准库）。"""
from pathlib import Path
import sys, struct, hashlib, plistlib
root = Path(__file__).resolve().parents[1]
dist = Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'dist'
sha = lambda b: hashlib.sha256(b).hexdigest()
ico = (root / 'assets/branding/app.ico').read_bytes()
count = struct.unpack_from('<H', ico, 4)[0]
wanted_icons = set()
for i in range(count):
    size, offset = struct.unpack_from('<II', ico, 6 + i * 16 + 8)
    wanted_icons.add(sha(ico[offset:offset + size]))
for arch in ['arm64', 'x64']:
    app = dist / ('mac-arm64' if arch == 'arm64' else 'mac') / 'CS-M.app'
    if not app.exists():
        raise AssertionError('缺少macOS应用: ' + str(app))
    info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
    assert info['CFBundleName'] == 'CS-M'
    assert info['CFBundleIdentifier'] == 'io.github.chenshishen.csm'
    assert info['CFBundleShortVersionString'] == '0.1.0'
    icon = app / 'Contents/Resources' / info['CFBundleIconFile']
    assert sha(icon.read_bytes()) == sha((root / 'assets/branding/app.icns').read_bytes())
    print('PASS macOS', arch, '应用身份、版本、图标')
exe = (dist / 'win-unpacked/CS-M.exe').read_bytes()
pe = struct.unpack_from('<I', exe, 0x3c)[0]
assert exe[pe:pe+4] == b'PE\0\0'
machine, sections = struct.unpack_from('<HH', exe, pe+4)
assert machine == 0x8664, 'Windows 应用必须是 x64'
optional_size = struct.unpack_from('<H', exe, pe+20)[0]
optional = pe + 24
assert struct.unpack_from('<H', exe, optional)[0] == 0x20b
resource_rva = struct.unpack_from('<I', exe, optional + 112 + 16)[0]
section_table = optional + optional_size
ranges = []
for i in range(sections):
    at = section_table + 40 * i
    virtual_size, rva, raw_size, raw_offset = struct.unpack_from('<IIII', exe, at+8)
    ranges.append((rva, max(virtual_size, raw_size), raw_offset))
def locate(rva):
    for start, size, raw in ranges:
        if start <= rva < start + size:
            return raw + rva - start
    raise ValueError('Unmapped PE RVA')
base = locate(resource_rva)
icons = set()
def resource_directory(offset, keys=()):
    at = base + offset
    named, ids = struct.unpack_from('<HH', exe, at+12)
    for i in range(named + ids):
        name, child = struct.unpack_from('<II', exe, at+16+8*i)
        identity = name if not name & 0x80000000 else 'named'
        if child & 0x80000000:
            resource_directory(child & 0x7fffffff, keys+(identity,))
        else:
            rva, size = struct.unpack_from('<II', exe, base+child)
            if (keys+(identity,))[0] == 3:
                start = locate(rva)
                icons.add(sha(exe[start:start+size]))
resource_directory(0)
assert wanted_icons <= icons, 'Windows应用没有嵌入图二转换出的全部图标尺寸'
assert 'CS-M'.encode('utf-16le') in exe, '缺少Windows产品名称资源'
print('PASS Windows x64 应用身份与多尺寸图标资源')
