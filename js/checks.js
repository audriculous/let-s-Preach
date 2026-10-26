// "Before you preach": a gentle scan of typed outline text and text boxes for topics
// that can hurt or offend if handled carelessly. It never blocks anything; it just
// points out what is worth a second look. Handwriting cannot be read, so it is not checked.

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
