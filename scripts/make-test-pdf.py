#!/usr/bin/env python3
"""Generate a fake scanned document (image-only PDF) for testing zotero-ocr.

The document contains no text layer, so running OCR on it exercises the
whole pipeline: page rasterization (pdf.js or pdftoppm), Tesseract
recognition, and creation of the note / searchable PDF / hOCR output.

Examples:
    python3 scripts/make-test-pdf.py
    python3 scripts/make-test-pdf.py --paper letter --pages 3
    python3 scripts/make-test-pdf.py --dpi 200 --font times --output test.pdf
"""

import argparse
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

PAPERS = {
    "a4": (8.27, 11.69),     # 210 x 297 mm
    "letter": (8.5, 11.0),   # US Letter
}

# Named fonts (macOS system fonts); --font also accepts a path to a
# .ttf/.ttc/.otf file for other systems or special fonts.
FONTS = {
    "georgia": "/System/Library/Fonts/Supplemental/Georgia.ttf",
    "times": "/System/Library/Fonts/Supplemental/Times New Roman.ttf",
    "helvetica": "/System/Library/Fonts/Helvetica.ttc",
}

PARAS = [
    "The quick brown fox jumps over the lazy dog. This sentence contains every letter of the English alphabet and is therefore useful to check that the OCR engine recognizes all characters correctly. The same property makes it a common test text for typesetting and optical character recognition systems alike.",
    "Numbers and punctuation are equally important: the invoice total was 1,234.56 EUR, which corresponds to a margin of 12.5% and a growth rate of 0.8% compared to the previous fiscal year (2024/2025). Note the mixed use of commas, periods, percent signs, and parentheses in this passage.",
    "Optical character recognition (OCR) is the machine recognition of typed, printed, or handwritten text from images, usually from scans. Modern OCR systems can achieve high accuracy on clean documents, but their performance degrades with low resolution, skew, noise, and unusual fonts. A test document such as this one should therefore be rendered at a realistic resolution and font.",
    "Zotero OCR is a plugin for the Zotero reference manager. It converts the pages of a PDF document into images, runs the Tesseract command line engine on them, and attaches the recognized text to the library item as a note, a searchable PDF with a hidden text layer, and an hOCR file with word coordinates.",
    "The conversion of PDF pages to images can be done either with the external poppler tool pdftoppm or, if available, with the pdf.js library that is bundled with Zotero itself. Both renderers should produce images that are close enough for the OCR engine to yield the same recognition results on a clean document like this one.",
    "Scanned documents often contain artifacts that do not occur in born-digital PDFs: slight rotation of the paper, uneven illumination, shadowing at the binding edge, dust and specks on the scanner glass, and halftone dots introduced by the copier. None of these artifacts is simulated in this document, because the goal here is a deterministic test, not a stress test.",
    "If you are reading this with your own eyes, the rendering pipeline worked. If you are reading this through the OCR output of the Zotero plugin, then the entire pipeline, from page rasterization over optical character recognition to the creation of the note and the searchable PDF, worked. Congratulations.",
    "The end of page content should also be handled correctly. This paragraph is the last one on most pages of this document, and it exists mainly to fill the vertical space in a plausible way so that the pages look like real document pages rather than a single short note.",
]


def load_font(path, size):
    return ImageFont.truetype(path, size)


def load_italic(regular_path, size):
    # macOS system fonts follow the convention "Name Italic.ttf"
    p = Path(regular_path)
    candidate = str(p.with_name(p.stem + " Italic" + p.suffix))
    if Path(candidate).exists():
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            pass
    return None


def wrap(text, font, max_width, draw):
    words = text.split()
    lines, cur = [], ""
    for w in words:
        trial = (cur + " " + w).strip()
        if draw.textlength(trial, font=font) <= max_width:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def render_page(n, n_pages, page_w, page_h, margin, body_font, head_font, ital_font):
    img = Image.new("RGB", (int(page_w), int(page_h)), "white")
    d = ImageDraw.Draw(img)
    y = margin
    text_width = int(page_w) - 2 * margin

    d.text((margin, y), f"Zotero OCR Test Document, page {n} of {n_pages}",
           font=head_font, fill="black")
    y += int(body_font.size * 2.6)

    for para in PARAS:
        for line in wrap(para, body_font, text_width, d):
            d.text((margin, y), line, font=body_font, fill="black")
            y += int(body_font.size * 1.4)
        y += int(body_font.size * 0.6)
        if y > page_h - margin - body_font.size * 4:
            break

    # italic line near the bottom, like a footnote
    font = ital_font if ital_font else body_font
    d.text((margin, int(page_h) - margin - body_font.size * 1.2),
           f"Italic footnote on page {n}: rendered with a serif font at a realistic resolution.",
           font=font, fill="black")
    return img


def main():
    parser = argparse.ArgumentParser(
        description="Generate a fake scanned document (image-only PDF) for testing zotero-ocr.")
    parser.add_argument("--pages", type=int, default=12,
                        help="number of pages (default: 12; use more than 9 to test zero-padded page names)")
    parser.add_argument("--dpi", type=int, default=300,
                        help="rendering resolution in dots per inch (default: 300, the plugin default)")
    parser.add_argument("--paper", choices=sorted(PAPERS), default="a4",
                        help="page size (default: a4)")
    parser.add_argument("--font", default="georgia",
                        help="font name (%s) or path to a font file (default: georgia)" % ", ".join(sorted(FONTS)))
    parser.add_argument("--quality", type=int, default=85,
                        help="JPEG quality of the page images (default: 85)")
    parser.add_argument("--output", default="zotero-ocr-test.pdf",
                        help="output file (default: zotero-ocr-test.pdf)")
    args = parser.parse_args()

    font_path = FONTS.get(args.font.lower(), args.font)
    if not Path(font_path).exists():
        sys.exit(f"error: font not found: {font_path}")

    dpi = args.dpi
    page_w, page_h = PAPERS[args.paper][0] * dpi, PAPERS[args.paper][1] * dpi
    margin = 1.0 * dpi

    body_size = int(12 / 72 * dpi)   # 12 pt
    head_size = int(18 / 72 * dpi)   # 18 pt
    body_font = load_font(font_path, body_size)
    head_font = load_font(font_path, head_size)
    ital_font = load_italic(font_path, body_size)

    pages = [render_page(n, args.pages, page_w, page_h, margin,
                         body_font, head_font, ital_font)
             for n in range(1, args.pages + 1)]
    pages[0].save(args.output, save_all=True, append_images=pages[1:],
                  resolution=dpi, quality=args.quality)
    print(f"wrote {args.output}: {args.pages} pages, {int(page_w)}x{int(page_h)} px, "
          f"{args.paper} at {dpi} dpi, font {Path(font_path).name}")


if __name__ == "__main__":
    main()
