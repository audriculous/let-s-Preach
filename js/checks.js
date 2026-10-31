// "Before you preach": a gentle scan of typed outline text and text boxes for topics
// that can hurt or offend if handled carelessly. It never blocks anything; it just
// points out what is worth a second look. Handwriting cannot be read, so it is not checked.

import { normWord, isStopWord } from './verses.js';

const TOPICS = [
  { re: /\b(suicid\w*|self[- ]?harm\w*|kill(ing)? (myself|himself|herself|themselves)|cutting myself)\b/i,
    note: 'Suicide and self-harm. Give a content note first, keep detail light, and point people to support (Lifeline 13 11 14).' },
  { re: /\b(abuse[ds]?|abusive|abuser|rape[ds]?|molest\w*|assault\w*|domestic violence|grooming)\b/i,
    note: 'Abuse. Some hearers may be survivors. Avoid graphic detail and never use it as a light illustration.' },
  { re: /\b(depress\w*|anxiety|mental (illness|health)|eating disorder|anorexi\w*|bulimi\w*|panic attacks?)\b/i,
    note: 'Mental health. Take care not to suggest it is simply a lack of faith.' },
  { re: /\b(miscarri\w*|infertil\w*|stillb\w*|barren|ivf)\b/i,
    note: 'Pregnancy loss and infertility. Often a hidden grief in a young-adult room.' },
  { re: /\b(divorce[ds]?|affairs?|adulter\w*|cheated|unfaithful)\b/i,
    note: 'Marriage breakdown. Some hearers come from divorced homes or are walking through it.' },
  { re: /\b(porn\w*|masturbat\w*|sexting|hook-?ups?|sleeping around)\b/i,
    note: 'Sexual sin. Name it plainly but carefully, and offer hope, not just shame.' },
  { re: /\b(gay|lesbian|lgbt\w*|homosexual\w*|same-sex|transgender|trans|queer|bisexual)\b/i,
    note: 'Sexuality and gender. Speak with care and precision, and assume people in the room are personally affected.' },
  { re: /\b(abortions?)\b/i,
    note: 'Abortion. Some hearers may have been involved. Hold truth and grace together.' },
  { re: /\b(election|labor party|liberal party|greens|one nation|albanese|dutton|trump|biden|harris|referendum|left-wing|right-wing|woke)\b/i,
    note: 'Politics. Check you are applying the text, not a party line.' },
  { re: /\b(aboriginal|indigenous|first nations|racis\w*|ethnic\w*|asian|immigrants?|refugees?)\b/i,
    note: 'Culture and race. Check your wording and facts, and how it lands for people from that background.' },
  { re: /\b(muslims?|islam\w*|catholics?|mormons?|jehovah'?s? witness\w*|buddhis\w*|hindus?|atheists?)\b/i,
    note: 'Other beliefs and groups. Describe them as their own people would recognise, and avoid caricature.' },
  { re: /\b(cancer|terminal(ly)? ill|funeral|passed away|grief|grieving|suddenly died|lost (my|his|her|their) (mum|dad|mother|father|baby|child|son|daughter|wife|husband))\b/i,
    note: 'Grief and illness. Be aware of recent losses in the congregation.' },
  { re: /\b(addict\w*|drunk\w*|alcoholi\w*|drugs?|gambling)\b/i,
    note: 'Addiction. Some may be struggling right now. Make the way to help clear.' },
  { re: /\b(my (wife|husband|kids?|son|daughter|mum|dad|mother|father|housemate|flatmate|friend)|a friend of mine|someone (at|in) (our )?church|one of our)\b/i,
    note: 'Personal story. Check you have permission and that nobody can be identified.' },
  { re: /\b(retard\w*|spastic|psycho|crazy|fatso|ugly|dumb|idiots?|bogans?|karen)\b/i,
    note: 'Labels. Easy to say as a joke, hard to hear if it is about you.' },
];

export const CHECKLIST = [
  ['bigIdea', 'The big idea fits in one sentence'],
  ['fromText', 'Every point comes out of the text'],
  ['flow', 'The points follow the passage’s own flow'],
  ['gospel', 'Christ and the gospel are clear'],
  ['applied', 'Applied to real young-adult life (study, work, dating, friendships, faith)'],
  ['care', 'Illustrations and jokes checked for anything that could hurt or offend'],
];

// sources: [{ where, text }] -> [{ where, word, note }]
export function scanSensitive(sources) {
  const out = [];
  const seen = new Set();
  for (const { where, text } of sources) {
    if (!text || !text.trim()) continue;
    for (const t of TOPICS) {
      const m = text.match(t.re);
      if (!m) continue;
      const key = where + '|' + t.note;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ where, word: m[0], note: t.note });
    }
  }
  return out;
}

// ---------- Tighten the logic ----------
// Structural checks on the outline: one clear big idea, points that serve it and share
// the passage sensibly, a line to Christ, and application that rests on grace.
// Each result is { key, ok, label, note }. Not ok means "worth a look", never "wrong".

const stem = w => {
  let s = normWord(w).replace(/[^a-z]/g, '');
  for (const suf of ['ness', 'ing', 'ful', 'ed', 'ly', 'es', 'er']) {
    if (s.length > suf.length + 3 && s.endsWith(suf)) { s = s.slice(0, -suf.length); break; }
  }
  return s;
};
const keywords = text => new Set((String(text || '').match(/[\p{L}’'-]+/gu) || [])
  .filter(w => !isStopWord(w.toLowerCase(), normWord(w))).map(stem).filter(Boolean));
const wordCount = text => (String(text || '').match(/[\p{L}\d’'-]+/gu) || []).length;
const inked = pad => !!(pad && pad.strokes && pad.strokes.length);
const listNums = ns => ns.length === 1 ? 'Point ' + ns[0] : 'Points ' + ns.slice(0, -1).join(', ') + ' and ' + ns[ns.length - 1];

const CHRIST_RE = /\b(jesus|christ|cross|gospel|messiah|son of god|son of man|crucif\w*|resurrect\w*|lamb of god|saviou?r)\b/i;
const DEMAND_RE = /\b(should|shouldn['’]t|must|need to|needs to|have to|has to|ought|try harder|try to|make sure|don['’]t|stop)\b/gi;
const GRACE_RE = /\b(grace|gracious|jesus|christ|gospel|forgiv\w*|spirit|gift|cross|mercy|merciful|free(ly|dom)?|already|adopted|loved|because (god|he|jesus|christ))\b/i;

export function logicChecks({ outline: o, starts = [], verseCount = 0, grid = [] }) {
  const out = [];
  const add = (key, ok, label, note) => out.push({ key, ok, label, note });
  const pts = o.points || [];
  const big = String(o.bigIdea || '').trim();

  // Big idea
  if (!big) add('big', false, 'Big idea', 'No big idea yet. Write the whole passage in one sentence; everything else hangs off it.');
  else {
    const n = wordCount(big);
    const sentences = big.split(/[.!?]+\s+(?=\p{L})/u).filter(s => s.trim()).length;
    if (sentences > 1) add('big', false, 'Big idea', `That is ${sentences} sentences. Can you say it in one?`);
    else if (n > 25) add('big', false, 'Big idea', `${n} words. Could you say it in one breath? Aim for under 20.`);
    else if (/\?\s*$/.test(big)) add('big', false, 'Big idea', 'It is a question. A question makes a good hook, but the big idea should be the answer.');
    else add('big', true, 'Big idea', `One sentence, ${n} words.`);
  }

  // Number of points
  if (!pts.length) add('count', false, 'Points', 'No points yet. Try Suggest a breakup, or add them by hand.');
  else if (pts.length === 1) add('count', false, 'Points', 'Only one point. Is the big idea itself the sermon, or is there a breakup to find?');
  else if (pts.length > 5) add('count', false, 'Points', `${pts.length} points is a lot to hold in your head. Could any join?`);
  else add('count', true, 'Points', `${pts.length} points.`);

  if (pts.length) {
    // Titles
    const missing = pts.map((p, i) => (p.title || '').trim() ? 0 : i + 1).filter(Boolean);
    const lens = pts.map(p => wordCount(p.title)).filter(Boolean);
    if (missing.length) add('titles', false, 'Point titles', `${listNums(missing)} ${missing.length === 1 ? 'has' : 'have'} no title yet.`);
    else if (lens.length > 1 && Math.max(...lens) > 8 && Math.max(...lens) >= 2.5 * Math.min(...lens)) {
      add('titles', false, 'Point titles', `Titles run from ${Math.min(...lens)} to ${Math.max(...lens)} words. Short, parallel titles are easier to remember.`);
    } else add('titles', true, 'Point titles', 'Every point has a title.');

    // Each point serves the big idea
    if (big && !missing.length) {
      const bk = keywords(big);
      const loose = pts.map((p, i) => {
        const pk = keywords([p.title, ...(p.subs || [])].join(' '));
        return [...pk].some(k => bk.has(k)) ? 0 : i + 1;
      }).filter(Boolean);
      if (loose.length === pts.length && pts.length > 1) add('serve', false, 'Fits the big idea', 'None of the point titles share a key word with the big idea. Check they build it, or reword the big idea to sum them up.');
      else if (loose.length) add('serve', false, 'Fits the big idea', `${listNums(loose)} ${loose.length === 1 ? 'shares' : 'share'} no key words with the big idea. Check ${loose.length === 1 ? 'it serves' : 'they serve'} it, or let the title echo it.`);
      else add('serve', true, 'Fits the big idea', 'Every point echoes the big idea.');
    }

    // How the points share the passage
    if (verseCount > 1 && starts.length === pts.length) {
      const bad = starts.map((s, i) => (s < 0 && pts[i].verses ? i + 1 : 0)).filter(Boolean);
      const valid = starts.filter(s => s >= 0);
      const ordered = valid.every((s, i) => !i || s > valid[i - 1]);
      if (bad.length) add('balance', false, 'Breakup', `${listNums(bad)}: those verses are not in this passage.`);
      else if (!ordered) add('balance', false, 'Breakup', 'The points jump around the passage. Fine if deliberate, but following the text is usually easier to follow.');
      else if (valid.length > 1) {
        const sorted = [...valid].sort((a, b) => a - b);
        const sizes = sorted.map((s, i) => (i + 1 < sorted.length ? sorted[i + 1] : verseCount) - (i ? s : 0));
        const max = Math.max(...sizes), min = Math.min(...sizes);
        const big1 = sizes.indexOf(max) + 1, small1 = sizes.indexOf(min) + 1;
        if (sizes.length >= 3 && max / verseCount > 0.6) add('balance', false, 'Breakup', `Point ${big1} carries ${max} of ${verseCount} verses. Is that where the weight of the passage really is?`);
        else if (max >= 6 && max >= 4 * min) add('balance', false, 'Breakup', `Point ${big1} covers ${max} verses and point ${small1} only ${min}. Fine if deliberate, but check the weight.`);
        else add('balance', true, 'Breakup', 'The points share the passage sensibly.');
      }
    }

    // Sub-points
    const single = pts.map((p, i) => ((p.subs || []).filter(s => s && s.trim()).length === 1 ? i + 1 : 0)).filter(Boolean);
    if (single.length) add('subs', false, 'Sub-points', `${listNums(single)} ${single.length === 1 ? 'has' : 'have'} a single sub-point. Fold it into the point, or add a second.`);
  }

  // Christ
  const cc = o.cc || {};
  const christ = cc.christ && (String(cc.christ.text || '').trim() || inked(cc.christ.pad));
  const typed = [big, ...pts.flatMap(p => [p.title, p.notes, ...(p.subs || [])]), o.application, ...Object.values(cc).map(a => a && a.text),
    ...grid.map(g => g.text)].join(' ');
  if (christ || CHRIST_RE.test(typed)) add('christ', true, 'Christ', 'There is a line to Jesus.');
  else add('christ', false, 'Christ', 'Nothing points to Jesus yet. Where does this passage lead to him?');

  // Application
  const appTyped = [o.application, ...grid.map(g => g.text)].filter(s => s && s.trim()).join('\n');
  const hasApp = appTyped || inked(o.pads && o.pads.application) || grid.some(g => inked(g.pad)) || (cc.response && (cc.response.text || inked(cc.response.pad)));
  if (!hasApp) add('app', false, 'Application', 'No application yet. What does this mean on Monday? The application grid can help.');
  else add('app', true, 'Application', grid.length ? `Applied to ${grid.length} area${grid.length === 1 ? '' : 's'} of life.` : 'There is application.');

  // Grace, not just effort
  if (appTyped) {
    const demands = (appTyped.match(DEMAND_RE) || []).length;
    if (demands >= 2 && !GRACE_RE.test(appTyped)) {
      add('grace', false, 'Grace', `The application has ${demands} “should” and “must” words and nothing yet about grace. What does the gospel make possible here, and why would they want it?`);
    } else if (demands) add('grace', true, 'Grace', 'The application rests on grace, not just effort.');
  }
  return out;
}
