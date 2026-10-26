# Let's Preach

A sermon prep notebook for iPad and Apple Pencil. Type a passage, it pulls the text from Bible Gateway (NIV by default), and you write all over it.

## Features

- **Fetch any passage** from Bible Gateway: NIV, ESV, NASB, CSB, NKJV, KJV. Or paste text, or start a blank page.
- **Apple Pencil writes, finger scrolls.** Your palm is ignored while the Pencil is down.
- **Pen** in 8 colours and 3 widths, pressure sensitive, with **handwriting smoothing** (Off / Low / Med / High in Page options).
- **Hold still to snap:** end a stroke and hold the Pencil still, and it becomes a straight line (level if nearly level) or a neat oval. Keep holding to drag the end of a line.
- **Highlighter** in 6 colours. It sits behind the words, so the text stays crisp.
- **Eraser** removes whole strokes. Or just **scribble over ink** with the pen to rub it out.
- **Text boxes** for typed notes. Drag them by the gold dot, delete with the ×. Scribble also works if you write into one with the Pencil.
- **Undo / redo** for everything (Cmd+Z on a keyboard too).
- **Wide margins and roomy line spacing** so you have space to think. The page grows as you write near the bottom.
- **Export PDF** of the marked-up page (share icon in the toolbar, or Page options). It splits onto A4 pages without cutting through a line, and opens the share sheet so you can save to Files, AirDrop or print.
- **Pin studies** to the top of your list with the pin button.
- Saves automatically on the iPad and works offline. **Back up / Restore** on the home screen exports everything as one file.

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

## Design

It shares the look of Let's Pray and Lemme Werk-out: Barlow and Barlow Condensed (bundled in `fonts/`, so it works offline), warm off-white cards, spaced green eyebrows, and an ochre accent. The icon source is `icons/icon.html`.

## Notes

- Layout settings (text size, spacing, margins, verse numbers) change where the words sit. Set them before you start marking up, since existing ink will not move with the text.
- Your studies live in Safari's storage on that iPad. Use **Back up** now and then.
- The PDF is an image of each page, so its text can't be selected or searched.
- Scripture text is fetched for personal study. NIV text is copyright Biblica, Inc.
