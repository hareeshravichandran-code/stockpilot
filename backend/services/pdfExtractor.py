#!/usr/bin/env python3
"""
PDF text extractor with password support.
Usage: python3 pdfExtractor.py <pdf_path> [password1] [password2] ...
Outputs extracted text to stdout, errors to stderr.
"""
import sys
import io

def extract_with_pdfminer(pdf_path, password=''):
    from pdfminer.high_level import extract_text
    try:
        text = extract_text(pdf_path, password=password)
        if text and len(text.strip()) > 100:
            return text
    except Exception as e:
        pass
    return None

def main():
    if len(sys.argv) < 2:
        print("Usage: pdfExtractor.py <pdf_path> [passwords...]", file=sys.stderr)
        sys.exit(1)
    
    pdf_path = sys.argv[1]
    passwords = sys.argv[2:] if len(sys.argv) > 2 else ['']
    
    # Always try empty password first
    if '' not in passwords:
        passwords = [''] + passwords
    
    for pwd in passwords:
        text = extract_with_pdfminer(pdf_path, pwd)
        if text:
            sys.stdout.write(text)
            sys.stdout.flush()
            sys.exit(0)
    
    print(f"FAILED: Could not extract text with any of {len(passwords)} passwords", file=sys.stderr)
    sys.exit(1)

if __name__ == '__main__':
    main()
