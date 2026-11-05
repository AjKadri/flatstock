# WCAG 2.x contrast ratios for the Flatstock palette. Run: python3 scripts/contrast.py
def lin(c):
    c/=255
    return c/12.92 if c<=0.03928 else ((c+0.055)/1.055)**2.4
def lum(h):
    h=h.lstrip('#'); r,g,b=[int(h[i:i+2],16) for i in (0,2,4)]
    return 0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b)
def ratio(a,b):
    la,lb=lum(a),lum(b); hi,lo=max(la,lb),min(la,lb); return (hi+0.05)/(lo+0.05)
MINT,INK,GREEN,GREEN_D,MUTED,LOSS,MINT2="#E6F7D9","#07110C","#2BD67B","#126B3A","#3F5A4A","#A63A2B","#D6EFC6"
rows=[
 ("ink text on mint (body)",INK,MINT,4.5),
 ("muted text on mint",MUTED,MINT,4.5),
 ("muted text on mint2 panel",MUTED,MINT2,4.5),
 ("green-d text on mint (gains, links, active tab)",GREEN_D,MINT,4.5),
 ("green-d text on mint2",GREEN_D,MINT2,4.5),
 ("loss red text on mint",LOSS,MINT,4.5),
 ("ink text on logo green (buttons, selected dot)",INK,GREEN,4.5),
 ("mint text on ink (ticker in ink dot, ink panels)",MINT,INK,4.5),
 ("muted-on-ink #A9C0B0 on ink (ink panel captions)","#A9C0B0",INK,4.5),
 ("green on ink (accent on ink panel)",GREEN,INK,4.5),
 ("ink dot/line on mint (graphic)",INK,MINT,3.0),
 ("green-d chart line on mint (graphic)",GREEN_D,MINT,3.0),
 ("loss chart line on mint (graphic)",LOSS,MINT,3.0),
 ("ink outline on green dot vs mint (selected dot edge, graphic)",INK,MINT,3.0),
 ("ink ticker text on green dot (selected)",INK,GREEN,4.5),
 ("disabled button text #5B7064 on #D0E6C3 (exempt, shown for legibility)","#5B7064","#D0E6C3",3.0),
 ("input border #6F8B78 on mint (graphic)","#6F8B78",MINT,3.0),
]
bad=0
for name,fg,bg,need in rows:
    r=ratio(fg,bg); ok=r>=need; bad+= (not ok)
    print(f"{'PASS' if ok else 'FAIL'}  {r:5.2f}:1  need {need}  {name}  ({fg} on {bg})")
raise SystemExit(1 if bad else 0)
