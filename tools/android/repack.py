# Rebuilds the game APK from a previous signed build without the Android SDK: keeps its compiled manifest,
# resources and classes.dex, replaces assets/www with the current build, sets the version, stores and
# 4-byte-aligns the entries that must not be compressed. Sign the result with Sign.java.
# usage: python3 repack.py template.apk repo_dir out_unsigned.apk versionName versionCode [--dex classes.dex] [--perm android.permission.X ...]
import os, struct, sys, zipfile
tpl, repo, out, vname, vcode = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], int(sys.argv[5])
extra = sys.argv[6:]; dex = None; perms = []
while extra:
    a = extra.pop(0)
    if a == '--dex': dex = extra.pop(0)
    elif a == '--perm': perms.append(extra.pop(0))

def add_permissions(data, perms):
    # inserts <uses-permission android:name="..."/> after <manifest> in a binary XML manifest (strings appended to the pool)
    b = bytearray(data); assert struct.unpack_from('<HHI', b, 0)[0] == 0x0003
    pos = 8; pool = None; resmap = []; strs = []; manifest_end = None
    while pos < len(b):
        ctype, hsize, csize = struct.unpack_from('<HHI', b, pos)
        if ctype == 0x0001: pool = pos
        if ctype == 0x0180: resmap = list(struct.unpack_from('<%dI' % ((csize - 8) // 4), b, pos + 8))
        if ctype == 0x0102 and manifest_end is None:
            name = struct.unpack_from('<I', b, pos + 20)[0]
            if strs and strs[name] == 'manifest': manifest_end = pos + csize
        if ctype == 0x0001:
            count, styles, flags, sstart, _ = struct.unpack_from('<IIIII', b, pos + 8); utf8 = bool(flags & 0x100)
            offs = struct.unpack_from('<%dI' % count, b, pos + hsize)
            for o in offs:
                q = pos + sstart + o
                if utf8:
                    n = b[q]; q += 2 if n & 0x80 else 1; m = b[q]; r = q + (2 if m & 0x80 else 1); m = ((m & 0x7f) << 8 | b[q + 1]) if m & 0x80 else m
                    strs.append(b[r:r + m].decode('utf-8'))
                else:
                    n = struct.unpack_from('<H', b, q)[0]; strs.append(b[q + 2:q + 2 + n * 2].decode('utf-16le'))
        pos += csize
    ns = strs.index('http://schemas.android.com/apk/res/android')
    name = next(i for i, s in enumerate(strs) if s == 'name' and i < len(resmap) and resmap[i] == 0x01010003)
    ctype, hsize, csize = struct.unpack_from('<HHI', b, pool)
    count, styles, flags, sstart, sstyles = struct.unpack_from('<IIIII', b, pool + 8); utf8 = bool(flags & 0x100)
    assert styles == 0, 'string pool with styles'
    new = []
    for s in ['uses-permission'] + perms:
        if s in strs: continue
        new.append(s)
    idx = {s: (strs.index(s) if s in strs else count + new.index(s)) for s in ['uses-permission'] + perms}
    offs = list(struct.unpack_from('<%dI' % count, b, pool + hsize))
    sdata = bytes(b[pool + sstart: pool + csize])
    blob = bytearray(sdata)
    # (pad blob back to its real end: strip trailing alignment zeros only beyond the last string)
    end = max(offs) if offs else 0
    q = end
    if utf8:
        n = blob[q]; q += 2 if n & 0x80 else 1; m = blob[q]; r = q + (2 if m & 0x80 else 1); m = ((m & 0x7f) << 8 | blob[q + 1]) if m & 0x80 else m; last_end = r + m + 1
    else:
        n = struct.unpack_from('<H', blob, q)[0]; last_end = q + 2 + n * 2 + 2
    blob = blob[:last_end]
    for s in new:
        offs.append(len(blob))
        if utf8:
            e = s.encode('utf-8'); assert len(s) < 128 and len(e) < 128
            blob += bytes([len(s), len(e)]) + e + b'\0'
        else:
            blob += struct.pack('<H', len(s)) + s.encode('utf-16le') + b'\0\0'
    while len(blob) % 4: blob += b'\0'
    count2 = count + len(new); sstart2 = hsize + 4 * count2
    head = bytearray(b[pool:pool + hsize]); struct.pack_into('<HHI', head, 0, ctype, hsize, sstart2 + len(blob)); struct.pack_into('<IIIII', head, 8, count2, 0, flags, sstart2, 0)
    newpool = bytes(head) + struct.pack('<%dI' % count2, *offs) + bytes(blob)
    delta = len(newpool) - csize
    # the elements to insert after <manifest>
    els = b''
    for s in perms:
        start = struct.pack('<HHI', 0x0102, 0x10, 0x24 + 20) + struct.pack('<II', 1, 0xFFFFFFFF) + struct.pack('<II', 0xFFFFFFFF, idx['uses-permission']) + struct.pack('<HHHHHH', 0x14, 0x14, 1, 0, 0, 0)
        start += struct.pack('<III', ns, name, idx[s]) + struct.pack('<HBBI', 8, 0, 0x03, idx[s])
        endel = struct.pack('<HHI', 0x0103, 0x10, 0x18) + struct.pack('<II', 1, 0xFFFFFFFF) + struct.pack('<II', 0xFFFFFFFF, idx['uses-permission'])
        els += start + endel
    out = bytes(b[:pool]) + newpool + bytes(b[pool + csize:manifest_end]) + els + bytes(b[manifest_end:])
    out = bytearray(out); struct.pack_into('<I', out, 4, len(out))
    print('permissions added:', perms, '(%d new strings)' % len(new))
    return bytes(out)

def patch_manifest(data, vname, vcode):
    b = bytearray(data)
    assert struct.unpack_from('<HHI', b, 0)[0] == 0x0003, 'not a binary XML file'
    pos = 8; strings = []; sp = None
    while pos < len(b):
        ctype, hsize, csize = struct.unpack_from('<HHI', b, pos)
        if ctype == 0x0001:   # string pool
            count, styles, flags, sstart, _ = struct.unpack_from('<IIIII', b, pos + 8)
            utf8 = bool(flags & 0x100); offs = struct.unpack_from('<%dI' % count, b, pos + hsize)
            for o in offs:
                p = pos + sstart + o
                if utf8:
                    n = b[p]; p += 2 if n & 0x80 else 1
                    m = b[p]; q = p + (2 if m & 0x80 else 1); m = ((m & 0x7f) << 8 | b[p + 1]) if m & 0x80 else m
                    strings.append((b[q:q + m].decode('utf-8'), q, m, 'utf8'))
                else:
                    n = struct.unpack_from('<H', b, p)[0]; strings.append((b[p + 2:p + 2 + n * 2].decode('utf-16le'), p + 2, n * 2, 'utf16'))
        if ctype == 0x0102:   # start element
            name = struct.unpack_from('<I', b, pos + 20)[0]
            astart, asize, acount = struct.unpack_from('<HHH', b, pos + 24)
            if strings[name][0] == 'manifest':
                for k in range(acount):
                    a = pos + 16 + astart + k * asize
                    an = strings[struct.unpack_from('<I', b, a + 4)[0]][0]
                    raw, vsize, res0, dtype, d = struct.unpack_from('<IHBBI', b, a + 8)
                    if an == 'versionCode':
                        print('versionCode', d, '->', vcode); struct.pack_into('<I', b, a + 16, vcode)
                    if an == 'versionName':
                        s, q, m, enc = strings[d]
                        new = vname.encode('utf-8' if enc == 'utf8' else 'utf-16le')
                        assert len(new) == m, 'version name must keep its length (%s -> %s)' % (s, vname)
                        print('versionName', s, '->', vname); b[q:q + m] = new
        pos += csize
    return bytes(b)

zin = zipfile.ZipInfo
src = zipfile.ZipFile(tpl)
stored_ext = {os.path.splitext(i.filename)[1].lower() for i in src.infolist() if i.compress_type == zipfile.ZIP_STORED and i.filename.startswith('assets/www/')}
print('stored in the template:', sorted(stored_ext))
fh = open(out, 'wb'); zout = zipfile.ZipFile(fh, 'w', allowZip64=False)
def add(name, data, stored):
    zi = zipfile.ZipInfo(name, date_time=(2026, 11, 25, 12, 0, 0))
    zi.compress_type = zipfile.ZIP_STORED if stored else zipfile.ZIP_DEFLATED
    zi.external_attr = 0o644 << 16
    if stored:   # an alignment extra field (0xd935, as zipalign/apksig use) puts the data on a 4-byte boundary
        off = fh.tell(); hdr = 30 + len(name.encode('utf-8'))
        k = (-(off + hdr + 6)) % 4
        zi.extra = struct.pack('<HHH', 0xD935, 2 + k, 4) + b'\0' * k
    zout.writestr(zi, data)
n_tpl = n_www = 0
for i in src.infolist():
    if i.filename.startswith('META-INF/') or i.filename.startswith('assets/www/'): continue
    data = src.read(i.filename)
    if i.filename == 'AndroidManifest.xml':
        data = patch_manifest(data, vname, vcode)
        if perms: data = add_permissions(data, perms)
    if i.filename == 'classes.dex' and dex: data = open(dex, 'rb').read(); print('classes.dex replaced by', dex)
    add(i.filename, data, i.compress_type == zipfile.ZIP_STORED or i.filename == 'resources.arsc'); n_tpl += 1
# assets/www as tools/android/build.sh copies them
for top in ['index.html', 'app.js', 'worker.js', 'hud.css', 'county-menu.webp', 'characters', 'vehicles', 'weapons', 'props', 'sfx', 'world', 'assets']:
    p = os.path.join(repo, 'www', top)
    files = [p] if os.path.isfile(p) else [os.path.join(d, f) for d, _, fs in os.walk(p) for f in fs]
    for f in sorted(files):
        rel = os.path.relpath(f, os.path.join(repo, 'www')).replace(os.sep, '/')
        with open(f, 'rb') as h: add('assets/www/' + rel, h.read(), os.path.splitext(f)[1].lower() in stored_ext); n_www += 1
zout.close(); fh.close()
# check: every stored entry's data starts on a 4-byte boundary
chk = zipfile.ZipFile(out); bad = 0
with open(out, 'rb') as h:
    for i in chk.infolist():
        if i.compress_type != zipfile.ZIP_STORED: continue
        h.seek(i.header_offset); fn_len, ex_len = struct.unpack('<HH', h.read(30)[26:30])
        if (i.header_offset + 30 + fn_len + ex_len) % 4: bad += 1
print('entries: template %d, www %d; misaligned stored entries: %d; size %.1f MB' % (n_tpl, n_www, bad, os.path.getsize(out) / 1e6))
