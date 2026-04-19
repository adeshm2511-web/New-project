# InkShift

InkShift is a static browser app for editing assignment sheets, experiment records, and photo-based documents with a plain-language prompt.

## What it does

- Upload a document image
- Write a prompt like `change name to Rohan, class to 12-A, roll no to 14`
- Run OCR in the browser with `tesseract.js`
- Match common fields such as name, class, roll no, assignment, experiment, subject, and title
- Redraw edited text on the image canvas and download the result as a PNG

## Files

- `index.html`: app UI
- `styles.css`: responsive styling
- `script.js`: OCR, prompt parsing, text replacement, export flow
- `manifest.webmanifest`: PWA metadata
- `sw.js`: basic offline cache

## Notes

- This is a static app, so it can be hosted on GitHub Pages, Netlify, Vercel static hosting, or any simple web server.
- OCR loads from a CDN in the browser, so internet access is needed when the page first loads.
- Font matching is approximate because the app infers style from OCR bounding boxes and image colors.
