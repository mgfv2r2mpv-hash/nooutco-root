// Draws the app icon: a close-up of the left edge of a Mac keyboard, his
// design of 2026-09-24. The caps lock key, with its green light, reads
// "clickc lack" (the typo is his, on purpose), then A, then half of S where the
// tile cuts the row. Below, the left Shift reads "oracl", then z, then a sliver
// of x. The Shift is wider than caps lock, so z sits right of A, as it does.
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
func ns(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat, _ a: CGFloat = 1) -> NSColor { NSColor(srgbRed: r/255, green: g/255, blue: b/255, alpha: a) }

// The tile: Apple's icon grid margin, a rounded square, and everything clipped to it.
let tile = CGRect(x: 100, y: 100, width: 824, height: 824)
let tilePath = CGPath(roundedRect: tile, cornerWidth: 186, cornerHeight: 186, transform: nil)
ctx.saveGState()
ctx.addPath(tilePath); ctx.clip()

// The deck: dark slate, lit a little from the top left.
let deck = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: [c(58, 70, 88), c(30, 38, 50), c(20, 26, 36)] as CFArray, locations: [0, 0.6, 1])!
ctx.drawLinearGradient(deck, start: CGPoint(x: 120, y: 924), end: CGPoint(x: 900, y: 100), options: [])

// One key unit, the gap between keys, and the two rows centred on the tile.
let u: CGFloat = 220, gap: CGFloat = 24
let rowH = u
let lowY = tile.midY - gap / 2 - rowH      // the Shift row
let highY = tile.midY + gap / 2             // the caps lock row
let left: CGFloat = 132

/// A keycap: a soft shadow, the skirt, and a lighter, slightly inset top face.
func key(_ r: CGRect) {
    let radius: CGFloat = 34
    ctx.saveGState()
    ctx.setShadow(offset: CGSize(width: 0, height: -10), blur: 22, color: c(0, 0, 0, 0.45))
    ctx.addPath(CGPath(roundedRect: r, cornerWidth: radius, cornerHeight: radius, transform: nil))
    ctx.setFillColor(c(206, 202, 196)); ctx.fillPath()
    ctx.restoreGState()
    let face = r.insetBy(dx: 10, dy: 10).offsetBy(dx: 0, dy: 5)
    ctx.saveGState()
    ctx.addPath(CGPath(roundedRect: face, cornerWidth: radius - 8, cornerHeight: radius - 8, transform: nil)); ctx.clip()
    let g = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: [c(252, 250, 246), c(236, 232, 226)] as CFArray, locations: [0, 1])!
    ctx.drawLinearGradient(g, start: CGPoint(x: face.minX, y: face.maxY), end: CGPoint(x: face.minX, y: face.minY), options: [])
    ctx.restoreGState()
}

/// Text on a key: `at` is the baseline start.
func label(_ s: String, _ at: CGPoint, _ pt: CGFloat, _ weight: NSFont.Weight = .regular) {
    let font = NSFont.systemFont(ofSize: pt, weight: weight)
    NSAttributedString(string: s, attributes: [.font: font, .foregroundColor: ns(62, 66, 74)]).draw(at: at)
}
/// A letter centred on a key.
func letter(_ s: String, in r: CGRect, _ pt: CGFloat) {
    let font = NSFont.systemFont(ofSize: pt, weight: .regular)
    let a = NSAttributedString(string: s, attributes: [.font: font, .foregroundColor: ns(52, 56, 64)])
    let sz = a.size()
    a.draw(at: CGPoint(x: r.midX - sz.width / 2, y: r.midY - sz.height / 2 + 6))
}

// Top row: caps lock (1.75 units), A, and the S the tile cuts in half.
let caps = CGRect(x: left, y: highY, width: 1.75 * u, height: rowH)
let keyA = CGRect(x: caps.maxX + gap, y: highY, width: u, height: rowH)
let keyS = CGRect(x: keyA.maxX + gap, y: highY, width: u, height: rowH)
key(caps); key(keyA); key(keyS)
// The caps lock light: a green dot, lit, top left.
let led = CGRect(x: caps.minX + 34, y: caps.maxY - 62, width: 26, height: 26)
ctx.saveGState()
ctx.setShadow(offset: .zero, blur: 26, color: c(64, 230, 110, 0.95))
ctx.setFillColor(c(64, 222, 104)); ctx.fillEllipse(in: led)
ctx.restoreGState()
ctx.setFillColor(c(200, 255, 214, 0.9)); ctx.fillEllipse(in: led.insetBy(dx: 8, dy: 8).offsetBy(dx: -2, dy: 3))
label("clickc lack", CGPoint(x: caps.minX + 32, y: caps.minY + 34), 50)
letter("A", in: keyA, 96)
letter("S", in: keyS, 96)

// Bottom row: the left Shift (2.25 units), z, and a sliver of x.
let shift = CGRect(x: left, y: lowY, width: 2.25 * u, height: rowH)
let keyZ = CGRect(x: shift.maxX + gap, y: lowY, width: u, height: rowH)
let keyX = CGRect(x: keyZ.maxX + gap, y: lowY, width: u, height: rowH)
key(shift); key(keyZ); key(keyX)
label("oracl", CGPoint(x: shift.minX + 32, y: shift.minY + 34), 56)
letter("z", in: keyZ, 96)

ctx.restoreGState()
NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
print("wrote \(out)")
