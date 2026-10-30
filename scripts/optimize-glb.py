#!/usr/bin/env python3
"""Shrink a GLB for the projectors: textures down to JPEG (base color max 2048 px, others 1024 px),
animations removed (the scenes animate the skeleton themselves). Usage: optimize-glb.py in.glb out.glb"""
import io
import json
import struct
import sys

from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
b = open(src, 'rb').read()
jl = struct.unpack('<I', b[12:16])[0]
j = json.loads(b[20:20 + jl])
bin0 = 20 + jl + 8
views = j['bufferViews']
data = [b[bin0 + v.get('byteOffset', 0): bin0 + v.get('byteOffset', 0) + v['byteLength']] for v in views]

# which images are base color (sRGB, bigger) – the rest get smaller
base = set()
for m in j.get('materials', []):
    t = m.get('pbrMetallicRoughness', {}).get('baseColorTexture')
    if t is not None:
        base.add(j['textures'][t['index']]['source'])
for i, im in enumerate(j.get('images', [])):
    img = Image.open(io.BytesIO(data[im['bufferView']])).convert('RGB')
    size = 2048 if i in base else 1024
    if max(img.size) > size:
        img = img.resize((size, size * img.size[1] // img.size[0]), Image.LANCZOS)
    out = io.BytesIO()
    img.save(out, 'JPEG', quality=86, optimize=True)
    data[im['bufferView']] = out.getvalue()
    im['mimeType'] = 'image/jpeg'

j.pop('animations', None)
# keep only the buffer views still used (accessors + images)
used = sorted({a['bufferView'] for a in j['accessors'] if 'bufferView' in a} | {im['bufferView'] for im in j.get('images', [])})
remap = {o: n for n, o in enumerate(used)}
blob = b''
nviews = []
for o in used:
    v = dict(views[o])
    while len(blob) % 4:
        blob += b'\0'
    v['byteOffset'] = len(blob)
    v['byteLength'] = len(data[o])
    v['buffer'] = 0
    blob += data[o]
    nviews.append(v)
for a in j['accessors']:
    if 'bufferView' in a:
        a['bufferView'] = remap[a['bufferView']]
for im in j.get('images', []):
    im['bufferView'] = remap[im['bufferView']]
j['bufferViews'] = nviews
# accessors only used by the removed animations would dangle: drop unreferenced ones is not
# needed – glTF allows unused accessors.
while len(blob) % 4:
    blob += b'\0'
j['buffers'] = [{'byteLength': len(blob)}]
js = json.dumps(j, separators=(',', ':')).encode()
while len(js) % 4:
    js += b' '
total = 12 + 8 + len(js) + 8 + len(blob)
out = struct.pack('<III', 0x46546C67, 2, total) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(blob), 0x004E4942) + blob
open(dst, 'wb').write(out)
print(f'{len(b) / 1e6:.1f} MB -> {len(out) / 1e6:.1f} MB')
