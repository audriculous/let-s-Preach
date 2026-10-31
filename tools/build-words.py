#!/usr/bin/env python3
"""Builds the offline word-study data in data/words from STEP Bible data (CC BY 4.0,
www.STEPBible.org, github.com/STEPBible/STEPBible-Data).

Usage: python3 tools/build-words.py <folder with the STEP .txt files> <output folder>
Needs the TAGNT (Greek NT) and TAHOT (Hebrew OT) tagged texts and the TBESG / TBESH
brief lexicons. Writes one file per book (verse -> words) and the lexicon in chunks
of 1000 Strong's numbers, so the app only loads what a passage needs.
"""
import json, os, re, sys, glob, collections

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out + '/book', exist_ok=True)
os.makedirs(out + '/lex', exist_ok=True)

REF = re.compile(r'^([1-3A-Z][A-Za-z]{2})\.(\d+)\.(\d+)(?:\([^)]*\))?#(\d+)=(\S+)')
books = collections.OrderedDict()   # code -> { "ch.v": [[word, translit, gloss, strong, morph], ...] }
count = collections.Counter()       # base strong -> occurrences
base = lambda s: s[:5]

def add(book, ch, v, row):
    if not row[3]: return
    books.setdefault(book, collections.OrderedDict()).setdefault(f'{ch}.{v}', []).append(row)
    count[base(row[3])] += 1

for f in sorted(glob.glob(src + '/TAGNT*.txt')):
    for line in open(f, encoding='utf-8'):
        m = REF.match(line)
        if not m: continue
        book, ch, v, _, kind = m.groups()
        if kind[0] not in 'Nn': continue  # keep the words in NA27/28
        c = line.rstrip('\n').split('\t')
        wm = re.match(r'(.*?)\s*\((.*)\)\s*$', c[1])
        word, tr = (wm.group(1), wm.group(2)) if wm else (c[1].strip(), '')
        strong, _, morph = c[3].partition('=')
        add(book, ch, v, [word, tr, c[2].strip(), strong.strip(), morph.strip()])

def ot_order(f):
    return ['Gen-', 'Jos-', 'Job-', 'Isa-'].index(re.search(r'(Gen-|Jos-|Job-|Isa-)', f).group(1))

for f in sorted(glob.glob(src + '/TAHOT*.txt'), key=ot_order):
    for line in open(f, encoding='utf-8'):
        m = REF.match(line)
        if not m: continue
        book, ch, v, _, kind = m.groups()
        c = line.rstrip('\n').split('\t')
        parts = c[4].split('/')
        morphs = c[5].split('/')
        main = next((i for i, p in enumerate(parts) if '{' in p), len(parts) - 1)
        strong = re.sub(r'[{}\\].*$', '', parts[main].replace('{', ''))
        strong = re.sub(r'[^A-Z0-9]', '', strong)
        morph = morphs[main] if main < len(morphs) else morphs[-1]
        if main and not morph.startswith('H'): morph = 'H' + morph
        word = re.sub(r'[/\\]', '', c[1])
        gloss = re.sub(r'/\s*', ' ', c[3]).strip()
        tr = c[2].replace('/', '')
        add(book, ch, v, [word, tr, gloss, strong, morph])

for book, verses in books.items():
    with open(f'{out}/book/{book}.json', 'w', encoding='utf-8') as fh:
        json.dump(verses, fh, ensure_ascii=False, separators=(',', ':'))

# Lexicon: lemma, transliteration, gloss, short definition, uses in the Bible.
def clean(html):
    html = re.sub(r"<ref='[^']*'>(.*?)</ref>", r'\1', html)
    html = re.sub(r'<(?:BR|br)\s*/?>', '<br>', html)
    html = re.sub(r'<(?!/?(?:b|i|br)>)[^>]+>', '', html)
    html = html.replace('__', '').strip()
    if len(html) > 2400:
        cut = html[:2400]
        html = cut[:cut.rfind('<br>')] if '<br>' in cut[1200:] else cut
        html += ' …'
    return html

used = set(count)
used_ext = set(r[3] for vs in books.values() for ws in vs.values() for r in ws)
lex = collections.defaultdict(dict)
for f in ['TBESG', 'TBESH']:
    path = glob.glob(f'{src}/{f}*.txt')[0]
    for line in open(path, encoding='utf-8'):
        c = line.rstrip('\n').split('\t')
        if len(c) < 8 or not re.match(r'^[GH]\d{4}', c[0]): continue
        key = c[1].split('=')[0].strip()
        if base(key) not in used: continue
        entry = [c[3], c[4], c[6], clean(c[7])]
        chunk = key[0] + key[1]
        if key in lex[chunk]: continue
        lex[chunk][key] = entry
        lex[chunk].setdefault(base(key), entry)

# Plain Strong's numbers point at their first meaning, so every tag finds an entry.
for chunk, d in lex.items():
    for k, e in list(d.items()):
        if len(e) == 4: e.append(count.get(base(k), 0))
    with open(f'{out}/lex/{chunk}.json', 'w', encoding='utf-8') as fh:
        json.dump(d, fh, ensure_ascii=False, separators=(',', ':'))

missing = [s for s in used_ext if len(s) >= 5 and s[0] + s[1] in lex and s not in lex[s[0] + s[1]] and base(s) not in lex[s[0] + s[1]]]
print(len(books), 'books;', sum(len(v) for v in books.values()), 'verses;', len(missing), 'tags without a lexicon entry', missing[:10])
