// Draws the app icon: a warm-to-blue tile, a keycap, and a sprig growing from it.
// swift make-icon.swift <out.png>   (1024 x 1024)
import AppKit

let size: CGFloat = 1024
let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "icon.png"
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size), pixelsHigh: Int(size), bitsPerSample: 8,
                           samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
let ctx = NSGraphicsContext.current!.cgContext
func c(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat, _ a: CGFloat = 1) -> CGColor { CGColor(red: r/255, green: g/255, blue: b/255, alpha: a) }

// The tile: Apple's icon grid leaves a margin; a squircle-ish rounded rect.
let tile = CGRect(x: 100, y: 100, width: 824, height: 824)
let tilePath = CGPath(roundedRect: tile, cornerWidth: 186, cornerHeight: 186, transform: nil)
ctx.saveGState()
ctx.addPath(tilePath); ctx.clip()
let grad = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: [c(250, 238, 222), c(236, 222, 204), c(120, 170, 235)] as CFArray, locations: [0, 0.55, 1])!
ctx.drawLinearGradient(grad, start: CGPoint(x: 150, y: 924), end: CGPoint(x: 874, y: 100), options: [])
ctx.restoreGState()

// The keycap: a dark base and a lighter top face.
let base = CGPath(roundedRect: CGRect(x: 262, y: 250, width: 500, height: 400), cornerWidth: 90, cornerHeight: 90, transform: nil)
ctx.setShadow(offset: CGSize(width: 0, height: -18), blur: 40, color: c(40, 50, 70, 0.35))
ctx.addPath(base); ctx.setFillColor(c(34, 44, 58)); ctx.fillPath()
ctx.setShadow(offset: .zero, blur: 0, color: nil)
let top = CGPath(roundedRect: CGRect(x: 312, y: 330, width: 400, height: 290), cornerWidth: 70, cornerHeight: 70, transform: nil)
ctx.addPath(top); ctx.setFillColor(c(44, 140, 255)); ctx.fillPath()
// A letter-ish mark on the cap: a short line and a dot, like a cursor mid-word.
ctx.setFillColor(c(255, 255, 255, 0.95))
ctx.fill(CGRect(x: 420, y: 455, width: 150, height: 30))
ctx.fillEllipse(in: CGRect(x: 590, y: 452, width: 36, height: 36))

// The sprig: a stem out of the cap and two leaves, sage green.
ctx.setStrokeColor(c(96, 146, 108)); ctx.setLineWidth(22); ctx.setLineCap(.round)
ctx.move(to: CGPoint(x: 512, y: 650)); ctx.addCurve(to: CGPoint(x: 540, y: 820), control1: CGPoint(x: 500, y: 710), control2: CGPoint(x: 560, y: 760))
ctx.strokePath()
func leaf(_ x: CGFloat, _ y: CGFloat, _ angle: CGFloat, _ s: CGFloat) {
    ctx.saveGState(); ctx.translateBy(x: x, y: y); ctx.rotate(by: angle)
    let p = CGMutablePath()
    p.move(to: .zero)
    p.addCurve(to: CGPoint(x: 150 * s, y: 0), control1: CGPoint(x: 50 * s, y: 70 * s), control2: CGPoint(x: 110 * s, y: 60 * s))
    p.addCurve(to: .zero, control1: CGPoint(x: 110 * s, y: -60 * s), control2: CGPoint(x: 50 * s, y: -70 * s))
    ctx.addPath(p); ctx.setFillColor(c(128, 176, 138)); ctx.fillPath()
    ctx.restoreGState()
}
leaf(530, 760, 0.55, 1.0)
leaf(522, 720, 2.6, 0.85)
// A small warm bloom at the tip.
ctx.setFillColor(c(244, 176, 120))
for i in 0..<6 {
    let a = CGFloat(i) * .pi / 3
    ctx.fillEllipse(in: CGRect(x: 540 + cos(a) * 26 - 20, y: 830 + sin(a) * 26 - 20, width: 40, height: 40))
}
ctx.setFillColor(c(255, 206, 92)); ctx.fillEllipse(in: CGRect(x: 522, y: 812, width: 36, height: 36))

NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
print("wrote \(out)")
