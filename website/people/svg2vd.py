"""Tiny SVG -> Android VectorDrawable converter for our simple brand SVGs."""
import sys, re, xml.etree.ElementTree as ET
NS='{http://www.w3.org/2000/svg}'
def circ(cx,cy,rx,ry):
    return f"M{cx-rx},{cy} a{rx},{ry} 0 1,0 {2*rx},0 a{rx},{ry} 0 1,0 {-2*rx},0 Z"
def rect(x,y,w,h,rx=0):
    if not rx: return f"M{x},{y} H{x+w} V{y+h} H{x} Z"
    r=min(rx,w/2,h/2)
    return (f"M{x+r},{y} H{x+w-r} A{r},{r} 0 0 1 {x+w},{y+r} V{y+h-r} A{r},{r} 0 0 1 {x+w-r},{y+h} "
            f"H{x+r} A{r},{r} 0 0 1 {x},{y+h-r} V{y+r} A{r},{r} 0 0 1 {x+r},{y} Z")
def f(e,k,d=0): return float(e.get(k,d))
def geom(e):
    t=e.tag.replace(NS,'')
    if t=='circle': r=f(e,'r'); return circ(f(e,'cx'),f(e,'cy'),r,r)
    if t=='ellipse': return circ(f(e,'cx'),f(e,'cy'),f(e,'rx'),f(e,'ry'))
    if t=='rect': return rect(f(e,'x'),f(e,'y'),f(e,'width'),f(e,'height'),f(e,'rx'))
    if t=='path': return e.get('d')
    return None
def col(c):
    if not c or c=='none': return None
    c=c.strip()
    if c=='#fff': c='#ffffff'
    return c.upper()
def emit(e, inh, out, ind):
    t=e.tag.replace(NS,'')
    st=dict(inh)
    for k in ('fill','stroke','stroke-width','opacity','stroke-linecap'):
        if e.get(k) is not None: st[k]=e.get(k)
    if t=='g':
        for c in e: emit(c, st, out, ind)
        return
    d=geom(e)
    if d is None: return
    a=[f'android:pathData="{" ".join(d.split())}"']
    fc=col(st.get('fill','#000000'))
    if fc: a.append(f'android:fillColor="{fc}"')
    sc=col(st.get('stroke'))
    if sc:
        a.append(f'android:strokeColor="{sc}"'); a.append(f'android:strokeWidth="{st.get("stroke-width","1")}"')
        if st.get('stroke-linecap'): a.append(f'android:strokeLineCap="{st["stroke-linecap"]}"')
    if e.get('opacity'):
        if fc: a.append(f'android:fillAlpha="{e.get("opacity")}"')
        if sc: a.append(f'android:strokeAlpha="{e.get("opacity")}"')
    out.append(ind+'<path '+' '.join(a)+'/>')
def convert(src, w):
    root=ET.parse(src).getroot()
    vb=[float(x) for x in root.get('viewBox').split()]
    clips={}
    for cp in root.iter(NS+'clipPath'):
        clips[cp.get('id')]=' '.join(geom(c) for c in cp)
    out=[]
    for e in root:
        if e.tag==NS+'defs': continue
        cid=re.search(r'#([^)]+)',e.get('clip-path','') or '')
        if cid:
            out.append(f'  <group>\n    <clip-path android:pathData="{" ".join(clips[cid.group(1)].split())}"/>')
            emit(e,{},out,'    '); out.append('  </group>')
        else: emit(e,{},out,'  ')
    h=w*vb[3]/vb[2]
    return ('<?xml version="1.0" encoding="utf-8"?>\n<!-- Generated from the website brand SVG by svg2vd.py -->\n'
            f'<vector xmlns:android="http://schemas.android.com/apk/res/android"\n    android:width="{w:g}dp" android:height="{h:g}dp"\n'
            f'    android:viewportWidth="{vb[2]:g}" android:viewportHeight="{vb[3]:g}">\n'+'\n'.join(out)+'\n</vector>\n')
if __name__=='__main__':
    open(sys.argv[2],'w').write(convert(sys.argv[1], float(sys.argv[3]) if len(sys.argv)>3 else 48))
