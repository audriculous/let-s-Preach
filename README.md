# Let's Preach

A sermon prep notebook for iPad and Apple Pencil. Type a passage, it pulls the text from Bible Gateway (NIV by default), and you write all over it.

## Features

- **Fetch any passage** from Bible Gateway: NIV, ESV, NASB, NASB 1995, CSB, NKJV, KJV, NLT, NRSVue. Or paste text, or start a blank page.
- **Apple Pencil writes, finger scrolls.** Your palm is ignored while the Pencil is down.
- **Pen** in 8 colours and 6 thicknesses, pressure sensitive, with **handwriting smoothing** (Off / Low / Med / High in Page options). The ink always reaches the Pencil tip with no lag. Smoothing only eases the line behind the tip, and each stroke is drawn as one clean variable-width shape, so nothing shifts when you lift the Pencil.
- **Hold still to snap:** end a stroke and hold the Pencil still, and it becomes a straight line (level if nearly level) or a neat oval. Keep holding to drag the end of a line.
- **Highlighter** in 6 colours. It sits behind the words, so the text stays crisp.
- **Eraser** removes whole strokes. Or just **scribble over ink** with the pen to rub it out. It only rubs out when you scribble on top of existing pen marks, so ordinary handwriting (and writing over highlights) is never erased.
- **Lasso** a loop around ink to select it, then drag it, resize it from the gold corner handle, recolour it from the colour row, duplicate or delete it. Your finger can drag a selection too.
- **Shapes:** straight line, arrow, box or oval. Pick one, then drag.
- **Ruler:** move it with one finger, turn it with two (it settles on level, upright and 45°). Pen or highlighter strokes that start beside its edge run dead straight along it.
- **Spot repeated words:** with the magnifier tool, tap a word to box every place it appears in the passage, each word in its own colour ("law" and "laws" count as one). The bar suggests the most repeated words, and **Connectives** underlines words like therefore, but, for, because and so that show how the argument is built.
- **Outline** (list icon): big idea, the breakup into points (each with lettered **sub-points**: Return adds the next, Backspace on an empty one removes it), and handwriting pads for **application** and **illustrations** (write with the Pencil, Erase, More space; they go into the PDF). A Pencil tap on a typed field opens the keyboard rather than the small handwriting palette. **Breakup explorer:** a strip of every verse, with dots showing the natural seams (headings, new paragraphs, words like "therefore"). Tap a verse to split before it, tap again to join, or turn on **Split on the page** and tap verse numbers in the passage itself. **Try a different breakup** offers ready-made splits (by headings, turning words, paragraphs, chapters, or the best 2, 3 or 4 points), each with a coloured preview. Titles and notes stay with their point when you move splits, and Undo steps back through every change. Each point shows on the page as a numbered badge with a coloured band down the margin, and its title appears as a small coloured label where the point starts (in the gap between lines, so the text never moves; turn it off with **Show point titles in the text**). **Before you preach** has a short checklist and gently flags typed text that touches sensitive topics (suicide, abuse, sexuality, politics, personal stories and so on) so you can handle it with care. **Share outline** sends it as text, and it is added to the end of the PDF.
- **Preach mode:** tap **Preach a PDF** on the home screen and pick your sermon PDF from Files (iCloud Drive, OneDrive, Google Drive, Downloads), or drag one in from the Files app. Or choose **Preach this study** in Page options. The PDF fills the screen and scrolls with your finger. The timer counts up or down (tap it to switch) against a set length and turns amber in the last two minutes and red when you run over. **Start and lock** starts the timer and locks the screen so stray touches, the Pencil and pinching do nothing; only scrolling works, and you hold the lock for a second to unlock. The screen stays awake, **Dim** gives a dark page for a dark room, and A−/A+ resize. The app remembers where you were in each PDF.
- **Preaching roster from Google Sheets:** paste your roster's link in Settings with your name as it appears on it. The home screen shows **Next up** (date, passage, title, series) and the few after it, and one tap opens the passage as a study already set up with its series and date. As each Sunday comes within two weeks, the app fetches that passage and sets up the study for you, so it is waiting in the library (and works offline). An Excel (.xlsx) or CSV roster file from Files works too. See below for setting it up.
- **Christ-centred prompts** in the Outline: what the passage shows about God, the fallen condition it addresses, how it points to Christ, and the response of faith it calls for. Handwrite or type each answer; they go into the PDF.
- **Footnotes and cross references:** small letters in the text (grey a, b for footnotes; green A, B for cross references). Tap one, or a verse number, for a card showing the note or where the cross references point, and tap a reference to read it there or open it as a new study. The **References** tab in the side sheet lists them verse by verse. Older studies can load them without moving any text. Turn the letters off in Page options.
- **Compare translations** (Outline sheet, Compare tab): see any of the other versions verse by verse beside your text, with the different words highlighted.
- **Series, tags and date preached** for each study (Page options). On the home screen, search your studies and filter by series or tag.
- **Text boxes** for typed notes. Drag them by the gold dot, delete with the ×. Scribble also works if you write into one with the Pencil.
- **Undo / redo** for everything (Cmd+Z on a keyboard too).
- **Wide margins and roomy line spacing** so you have space to think. The page grows as you write near the bottom.
- **Export PDF** of the marked-up page (share icon in the toolbar, or Page options). It splits onto A4 pages without cutting through a line, and opens the share sheet so you can save to Files, AirDrop or print.
- **Pin studies** to the top of your list with the pin button.
- Saves automatically on the iPad and works offline. **Back up / Restore** on the home screen exports everything as one file.
- **Sync and daily cloud backup** between your iPad and laptop through your own Worker (see below).

## Put it on your iPad

1. Host it with GitHub Pages: repo **Settings → Pages → Build and deployment → Deploy from a branch**, pick the branch and `/ (root)`, save.
2. Open the Pages URL in Safari on the iPad.
3. Tap **Share → Add to Home Screen**. It now opens full screen like an app.

## Reliable passage fetching (recommended, 5 minutes, free)

Bible Gateway does not let web apps read its pages directly, so the app goes through a relay. It tries free public relays first, but they can be slow or go down. Your own Cloudflare Worker is more reliable:

1. Sign up at [dash.cloudflare.com](https://dash.cloudflare.com) (free).
2. **Workers & Pages → Create → Create Worker**, name it e.g. `lets-preach`, click **Deploy**.
3. Click **Edit code**, replace everything with the contents of [`worker/worker.js`](worker/worker.js), click **Deploy**.
4. Copy the worker URL (like `https://lets-preach.yourname.workers.dev`).
5. In the app, tap **Settings** on the home screen and paste the URL.

The worker only fetches Bible Gateway passages, so nobody can misuse it as a general proxy.

## Preaching roster from Google Sheets (2 minutes)

1. Your roster sheet needs a heading row with at least **Date** and **Passage**. **Preacher**, **Series**, **Title** and **Service** are used if they are there. Dates can be written the Australian way (2/11/2026) or like "Sun 2 Nov".
2. In Google Sheets: **File → Share → Publish to web**, choose the roster tab and **Comma-separated values (.csv)**, then **Publish** and copy the link.
3. In the app: **Settings → Preaching roster**, paste the link and type your name as it appears in the Preacher column, then **Save**.

**Roster in Excel?** In Settings choose **Choose the Excel or CSV file** and pick it from Files (OneDrive, iCloud Drive and so on). The app tries each sheet in the workbook until it finds the Date and Passage headings. A file does not update itself, so choose it again when the roster changes, or upload it to Google Sheets to get automatic updates.

**Passages ready ahead:** with **Get my passages ready two weeks ahead** on (the default), each of your roster dates fetches its passage once it is 14 days away and creates the study with its title, series and date. The home screen marks it **Ready for you**.

The roster is checked each time you open the app (at most once an hour) and with **Refresh roster**. If Google will not let the app read the sheet directly, it goes through your Worker (the updated `worker/worker.js` adds a small relay that only reads Google Sheets).

## Sync between iPad and laptop, with daily backups (10 minutes, free)

This uses the same Worker plus a small free Cloudflare database (KV).

1. In Cloudflare: **Storage & Databases → KV → Create**, name it `lets-preach`.
2. Open your Worker: **Settings → Bindings → Add → KV namespace**. Variable name **`LP`** (capitals), pick the `lets-preach` namespace, save.
3. **Edit code**, replace everything with the new [`worker/worker.js`](worker/worker.js), **Deploy**.
4. On the iPad: **Settings → New code**, then **Save**. Copy the code.
5. On the laptop: open the app link, **Settings**, paste the same Worker URL and the same sync code, **Save**.

After that each device syncs when you open the app, when you leave a study, a minute or two after you stop writing, and every five minutes while it is open. If the same study is changed on both devices before they sync, the most recent change wins. Once a day it also saves a backup of every study to the Worker; the last 30 days are kept, and **Settings → Cloud backups** can restore any of them.

Keep the sync code private: anyone with the code and your Worker URL can read your studies. Cloudflare's free plan allows 1,000 saves a day, which is plenty for normal use.

## Design

It shares the look of Let's Pray and Lemme Werk-out: Barlow and Barlow Condensed (bundled in `fonts/`, so it works offline), warm off-white cards, spaced green eyebrows, and an ochre accent. The icon source is `icons/icon.html`.

## Notes

- Layout settings (text size, spacing, margins, verse numbers) change where the words sit. Set them before you start marking up, since existing ink will not move with the text.
- Your studies live in Safari's storage on each device. Turn on sync for an automatic daily backup, or use **Back up** now and then.
- The sensitive-topic check reads typed text only, not handwriting, and is a prompt to think, not a judgement.
- The PDF is an image of each page, so its text can't be selected or searched.
- Scripture text is fetched for personal study. NIV text is copyright Biblica, Inc.
