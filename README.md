# InkShift Realistic Editor

InkShift is a static browser app for realistic text replacement in screenshots, document photos, and the first page of PDFs.

## What it is built for

- Change fields such as `Name`, `Class`, `Roll no`, `Title`, `Assignment`, or `Experiment`
- Keep the output visually close to the original screenshot or document
- Let the user review detected OCR lines before rendering the final result

## Workflow

1. Upload an image or PDF
2. Add a prompt such as `change name to Adesh Mishra, class to ECS A, roll no to 55`
3. Click `Detect text`
4. Review or manually fix the detected line-to-field mapping
5. Click `Render result`
6. Download the final PNG

## Notes

- PDF support renders only the first page
- OCR and PDF loading use browser CDNs, so the page needs internet on first load
- Realism is better when the source is sharp and the changed value length is similar to the original
- For code/editor screenshots, use the `Monospace / code window` preset for better visual matching
