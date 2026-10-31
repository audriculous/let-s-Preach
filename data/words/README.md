# Word study data

Greek and Hebrew words for every verse, with English glosses, Strong's numbers, grammar codes and a brief lexicon.

Built from **STEP Bible** data by Tyndale House, Cambridge ([www.STEPBible.org](https://www.STEPBible.org), [github.com/STEPBible/STEPBible-Data](https://github.com/STEPBible/STEPBible-Data)), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/):

- TAGNT (Translators Amalgamated Greek NT): words found in NA27/28.
- TAHOT (Translators Amalgamated Hebrew OT): Leningrad codex, English verse numbers.
- TBESG and TBESH (brief lexicons of extended Strong's numbers): definitions trimmed to about 2,400 characters, with reference links turned into plain text.

The data was reshaped only, not changed: `book/<Book>.json` maps "chapter.verse" to `[word, transliteration, gloss, Strong's, grammar]` and `lex/<G|H><thousands>.json` maps a Strong's number to `[lemma, transliteration, gloss, definition, uses in the Bible]`. Rebuild with `tools/build-words.py`.
