"""Save strain art sent by the website script (Art.gs / ArtSave.gs) into the site.

The script drops pairs into incoming/:  <slug>-<time>.jpg  (the Drive picture)  +  <slug>-<time>.json  ({"name": ..., "image": ...})
For each pair this trims the white border, sizes it like the rest of the strain art (720 px max, 26 px white margin),
saves it as img/<md5>.jpg, adds the strain to IMG / EXT in assets/site.js, bumps the site.js cache-buster in every page,
and removes the pair from incoming/. It only ever ADDS art for a strain that has none: existing art is never replaced.
"""
import glob, hashlib, io, json, os, re, sys, time
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SITE = os.path.join(ROOT, 'assets', 'site.js')
MAX, PAD = 720, 26


def web_copy(path):
    im = Image.open(path)
    if im.mode in ('RGBA', 'LA', 'P'):
        im = im.convert('RGBA'); bg = Image.new('RGB', im.size, 'white'); bg.paste(im, mask=im.split()[-1]); im = bg
    im = im.convert('RGB')
    box = im.convert('L').point(lambda x: 255 if x < 235 else 0).getbbox()
    if box: im = im.crop(box)
    im.thumbnail((MAX - 2 * PAD, MAX - 2 * PAD), Image.LANCZOS)
    out = Image.new('RGB', (im.width + 2 * PAD, im.height + 2 * PAD), 'white'); out.paste(im, (PAD, PAD))
    b = io.BytesIO(); out.save(b, 'JPEG', quality=85, optimize=True, progressive=True)
    return b.getvalue(), out.size


def main():
    pairs = sorted(glob.glob(os.path.join(ROOT, 'incoming', '*.json')))
    if not pairs: print('Nothing in incoming/.'); return
    s = open(SITE, encoding='utf-8').read()
    img = json.loads(re.search(r'var IMG = (\{.*?\});', s).group(1))
    ext = json.loads(re.search(r'EXT = (\{[^}]*\})', s).group(1))
    saved, used = [], []
    for j in pairs:
        used.append(j)
        try:
            meta = json.load(open(j, encoding='utf-8'))
            name = str(meta.get('name', '')).strip()
            pic = os.path.join(ROOT, 'incoming', os.path.basename(meta.get('image', '')))
            used.append(pic)
            if not name or not os.path.isfile(pic): print('Skipped %s: missing name or picture' % os.path.basename(j)); continue
            if name in img: print('Skipped %s: already has art on the site' % name); continue
            data, size = web_copy(pic)
            h = hashlib.md5(data).hexdigest()
            open(os.path.join(ROOT, 'img', h + '.jpg'), 'wb').write(data)
            img[name] = ['/_blob/' + h, 'art']; ext[h] = '.jpg'
            saved.append(name); print('Saved %s -> img/%s.jpg %dx%d %d KB' % (name, h, size[0], size[1], len(data) // 1024))
        except Exception as e:
            print('Skipped %s: %s' % (os.path.basename(j), e))
    if saved:
        s = re.sub(r'var IMG = \{.*?\};', lambda m: 'var IMG = ' + json.dumps(img) + ';', s, count=1)
        s = re.sub(r'EXT = \{[^}]*\}', lambda m: 'EXT = ' + json.dumps(ext), s, count=1)
        open(SITE, 'w', encoding='utf-8').write(s)
        v = 'art' + time.strftime('%m%d%H%M')
        for html in glob.glob(os.path.join(ROOT, '**', '*.html'), recursive=True):
            t = open(html, encoding='utf-8').read(); t2 = re.sub(r'site\.js\?v=[A-Za-z0-9]+', 'site.js?v=' + v, t)
            if t2 != t: open(html, 'w', encoding='utf-8').write(t2)
    for f in used:
        if os.path.isfile(f): os.remove(f)
    with open(os.environ.get('GITHUB_OUTPUT', os.devnull), 'a') as o: o.write('saved=%s\n' % ', '.join(saved))


if __name__ == '__main__':
    main()
