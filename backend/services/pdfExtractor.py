#!/usr/bin/env python3
import sys
import io
import glob

# Find pdfminer in nix store dynamically (hash changes per build)
for path in glob.glob('/nix/store/*pdfminer*/lib/python*/site-packages'):
    if path not in sys.path:
        sys.path.insert(0, path)

# Also try common locations
for path in glob.glob('/root/.nix-profile/lib/python*/site-packages'):
    if path not in sys.path:
        sys.path.insert(0, path)

def try_extract(pdf_bytes, password=''):
    try:
        from pdfminer.high_level import extract_text
        buf = io.BytesIO(pdf_bytes)
        text = extract_text(buf, password=password if password else '')
        if text and len(text.strip()) > 50:
            return text
    except Exception as e:
        print(f"pdfminer error: {e}", file=sys.stderr)
    return None

def main():
    if len(sys.argv) < 2:
        sys.exit(1)

    # Debug: show sys.path
    print(f"sys.path: {sys.path[:3]}", file=sys.stderr)

    pdf_path = sys.argv[1]
    passwords = sys.argv[2:] if len(sys.argv) > 2 else []

    with open(pdf_path, 'rb') as f:
        pdf_bytes = f.read()

    # Try without password first
    text = try_extract(pdf_bytes, '')
    if text:
        sys.stdout.write(text)
        sys.exit(0)

    # Try each password
    for pwd in passwords:
        text = try_extract(pdf_bytes, pwd)
        if text:
            sys.stdout.write(text)
            sys.exit(0)

    print(f"FAILED: tried {len(passwords)+1} passwords", file=sys.stderr)
    sys.exit(1)

if __name__ == '__main__':
    main()
