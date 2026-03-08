#!/usr/bin/env python3
"""
PDF text extractor with password support using pikepdf + pdfminer
"""
import sys
import io
import os

def extract_with_pikepdf_pdfminer(pdf_path, password=''):
    """Decrypt with pikepdf, extract text with pdfminer"""
    try:
        import pikepdf
        from pdfminer.high_level import extract_text
        
        # Open and decrypt with pikepdf
        pdf = pikepdf.open(pdf_path, password=password)
        
        # Save decrypted to memory buffer
        buf = io.BytesIO()
        pdf.save(buf)
        buf.seek(0)
        
        # Extract text with pdfminer
        text = extract_text(buf)
        if text and len(text.strip()) > 100:
            return text
    except Exception as e:
        pass
    return None

def extract_with_pdfminer_only(pdf_path, password=''):
    """Try pdfminer directly"""
    try:
        from pdfminer.high_level import extract_text
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
    passwords = sys.argv[2:] if len(sys.argv) > 2 else []
    
    # Always try empty password first
    all_passwords = [''] + [p for p in passwords if p != '']
    
    for pwd in all_passwords:
        # Try pikepdf + pdfminer first (best for encrypted PDFs)
        text = extract_with_pikepdf_pdfminer(pdf_path, pwd)
        if text:
            sys.stdout.write(text)
            sys.stdout.flush()
            sys.exit(0)
        
        # Fallback to pdfminer only
        text = extract_with_pdfminer_only(pdf_path, pwd)
        if text:
            sys.stdout.write(text)
            sys.stdout.flush()
            sys.exit(0)
    
    print(f"FAILED: tried {len(all_passwords)} passwords", file=sys.stderr)
    sys.exit(1)

if __name__ == '__main__':
    main()
